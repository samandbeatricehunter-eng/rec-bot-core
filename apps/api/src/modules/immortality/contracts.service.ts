import {
  characteristicCatalog,
  combinedModifiers,
  performanceContractPayout,
  positionGroupFor,
  rookieContractPayout,
  rtiContractWindow,
  RTI_CONTRACT_FORMULA_VERSION,
  XP_POINTS_PER_LEVEL,
  type ImmortalityPosition,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { creditXpPoints } from "./xp-awards.service.js";
import { loadImmortalityLeague, recUserIdFromDiscordId } from "./immortality.service.js";

function primaryStatKey(position: string): string {
  const pos = position.toUpperCase();
  if (pos === "QB") return "pass_yards";
  if (pos === "HB") return "rush_yards";
  if (pos === "WR" || pos === "TE") return "receiving_yards";
  if (pos === "MIKE" || pos === "WILL" || pos === "SAM" || pos === "LB") return "tackles";
  return "tackles";
}

async function modifiersForProspect(prospect: { id: string; position: string }) {
  const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id);
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  return combinedModifiers(selected);
}

async function productionScore(input: {
  leagueId: string;
  playerId: string;
  position: string;
  fromSeason: number;
  toSeason: number;
}): Promise<number> {
  const rows = await supabase.from("rec_player_weekly_stats")
    .select("stats,season_number")
    .eq("league_id", input.leagueId)
    .eq("player_id", input.playerId)
    .gte("season_number", input.fromSeason)
    .lte("season_number", input.toSeason);
  const key = primaryStatKey(input.position);
  return (rows.data ?? []).reduce((sum, row) => {
    const stats = (row.stats ?? {}) as Record<string, unknown>;
    return sum + (Number(stats[key] ?? 0) || 0);
  }, 0);
}

async function percentileAmongPosition(input: {
  immortalityLeagueId: string;
  leagueId: string;
  prospectId: string;
  position: string;
  fromSeason: number;
  toSeason: number;
}): Promise<number> {
  const peers = await supabase.from("rec_immortality_prospects")
    .select("id,player_id,position")
    .eq("immortality_league_id", input.immortalityLeagueId)
    .eq("position", input.position);
  const scores: Array<{ id: string; value: number }> = [];
  for (const peer of peers.data ?? []) {
    if (!peer.player_id) continue;
    const value = await productionScore({
      leagueId: input.leagueId,
      playerId: String(peer.player_id),
      position: String(peer.position),
      fromSeason: input.fromSeason,
      toSeason: input.toSeason,
    });
    scores.push({ id: String(peer.id), value });
  }
  if (scores.length <= 1) return 0.5;
  scores.sort((a, b) => a.value - b.value);
  const index = scores.findIndex((row) => row.id === input.prospectId);
  if (index < 0) return 0.5;
  return index / (scores.length - 1);
}

async function insertOffer(input: {
  prospectId: string;
  contractNumber: 1 | 2 | 3;
  playerXp: number;
  coins: number;
  band: string;
}): Promise<void> {
  const window = rtiContractWindow(input.contractNumber);
  const inserted = await supabase.from("rec_immortality_contracts").insert({
    prospect_id: input.prospectId,
    contract_number: input.contractNumber,
    start_season: window.startSeason,
    end_season: window.endSeason,
    coins_per_season: input.coins,
    player_xp_payout: input.playerXp,
    coins_payout: input.coins,
    band: input.band,
    offer_status: "offered",
    formula_version: RTI_CONTRACT_FORMULA_VERSION,
  });
  if (inserted.error && inserted.error.code !== "23505") {
    console.error(`[ERROR] Could not create RTI contract ${input.contractNumber} for ${input.prospectId}:`, inserted.error);
  }
}

export async function offerRookieContracts(prospectIds: string[]): Promise<void> {
  for (const prospectId of prospectIds) {
    const payout = rookieContractPayout(prospectId);
    await insertOffer({
      prospectId,
      contractNumber: 1,
      playerXp: payout.playerXp,
      coins: payout.coins,
      band: "rookie",
    });
  }
}

export async function offerDuePerformanceContracts(input: {
  leagueId: string;
  seasonNumber: number;
}): Promise<void> {
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return;
  const due: Array<2 | 3> = [];
  if (input.seasonNumber >= 4) due.push(2);
  if (input.seasonNumber >= 8) due.push(3);
  if (!due.length) return;
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,position,player_id")
    .eq("immortality_league_id", immortality.id);
  for (const prospect of prospects.data ?? []) {
    const existing = await supabase.from("rec_immortality_contracts")
      .select("contract_number,offer_status")
      .eq("prospect_id", prospect.id);
    const byNumber = new Map((existing.data ?? []).map((row) => [Number(row.contract_number), String(row.offer_status)]));
    for (const contractNumber of due) {
      if (byNumber.has(contractNumber)) continue;
      const prior = byNumber.get(contractNumber - 1);
      if (prior !== "signed") continue;
      const modifiers = await modifiersForProspect({ id: String(prospect.id), position: String(prospect.position) });
      const window = contractNumber === 2 ? { fromSeason: 1, toSeason: 3 } : { fromSeason: 4, toSeason: 7 };
      const percentile = prospect.player_id
        ? await percentileAmongPosition({
          immortalityLeagueId: immortality.id,
          leagueId: input.leagueId,
          prospectId: String(prospect.id),
          position: String(prospect.position),
          ...window,
        })
        : 0.5;
      const payout = performanceContractPayout({
        contractNumber,
        percentile,
        negotiatorMultiplier: modifiers.negotiatorMultiplier,
        knownCommodityFloor: modifiers.knownCommodityFloor,
      });
      await insertOffer({
        prospectId: String(prospect.id),
        contractNumber,
        playerXp: payout.playerXp,
        coins: payout.coins,
        band: `performance_p${Math.round(payout.percentile * 100)}`,
      });
    }
  }
}

export async function listImmortalityContracts(input: { guildId: string; discordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const immortality = await loadImmortalityLeague(context.leagueId);
  if (!immortality) throw new ApiError(404, "This is not a Rise to Immortality league.");
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,side,first_name,last_name,position")
    .eq("immortality_league_id", immortality.id)
    .eq("user_id", userId);
  const prospectIds = (prospects.data ?? []).map((row) => String(row.id));
  const contracts = prospectIds.length
    ? await supabase.from("rec_immortality_contracts").select("*").in("prospect_id", prospectIds).order("contract_number")
    : { data: [] as Array<Record<string, unknown>> };
  return {
    contracts: (contracts.data ?? []).map((row) => {
      const prospect = (prospects.data ?? []).find((item) => String(item.id) === String(row.prospect_id));
      return {
        id: String(row.id),
        prospectId: String(row.prospect_id),
        side: prospect?.side ?? null,
        playerName: `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim(),
        position: prospect?.position ?? null,
        contractNumber: Number(row.contract_number),
        startSeason: Number(row.start_season),
        endSeason: Number(row.end_season),
        playerXp: Number(row.player_xp_payout ?? 0),
        coins: Number(row.coins_payout ?? row.coins_per_season ?? 0),
        band: row.band ? String(row.band) : null,
        status: String(row.offer_status ?? "offered"),
        signedAt: row.signed_at ? String(row.signed_at) : null,
      };
    }),
  };
}

export async function signImmortalityContract(input: { guildId: string; discordId: string; contractId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const immortality = await loadImmortalityLeague(context.leagueId);
  if (!immortality) throw new ApiError(404, "This is not a Rise to Immortality league.");
  const userId = await recUserIdFromDiscordId(input.discordId);
  const contract = await supabase.from("rec_immortality_contracts").select("*").eq("id", input.contractId).maybeSingle();
  if (!contract.data) throw new ApiError(404, "Contract not found.");
  const prospect = await supabase.from("rec_immortality_prospects").select("id,user_id,position,first_name,last_name,player_id").eq("id", contract.data.prospect_id).maybeSingle();
  if (!prospect.data || String(prospect.data.user_id) !== userId) throw new ApiError(403, "That contract is not yours to sign.");
  if (String(contract.data.offer_status) === "signed") return { ok: true, alreadySigned: true };

  const playerXp = Number(contract.data.player_xp_payout ?? 0);
  const coins = Number(contract.data.coins_payout ?? contract.data.coins_per_season ?? 0);
  const modifiers = await modifiersForProspect({ id: String(prospect.data.id), position: String(prospect.data.position) });
  if (playerXp > 0) {
    await creditXpPoints({
      prospectId: String(prospect.data.id),
      eventType: `contract_${contract.data.contract_number}`,
      sourceId: String(contract.data.id),
      points: playerXp * XP_POINTS_PER_LEVEL,
      modifiers,
    });
  }
  if (coins > 0) {
    await creditOrBacklog({
      leagueId: context.leagueId,
      seasonNumber: Number(context.rec_leagues.season_number ?? 1),
      userId,
      amount: coins,
      description: `Rise to Immortality contract ${contract.data.contract_number} signing bonus`,
      transactionType: "immortality_contract_payout",
      source: "immortality_contract",
      sourceReference: { contractId: contract.data.id, prospectId: prospect.data.id },
    });
  }
  const signed = await supabase.from("rec_immortality_contracts").update({
    offer_status: "signed",
    signed_at: new Date().toISOString(),
  }).eq("id", input.contractId).eq("offer_status", "offered").select("id").maybeSingle();
  if (!signed.data) return { ok: true, alreadySigned: true };

  const playerName = `${prospect.data.first_name ?? ""} ${prospect.data.last_name ?? ""}`.trim() || "A franchise player";
  const player = prospect.data.player_id
    ? await supabase.from("rec_players").select("team_id").eq("id", prospect.data.player_id).maybeSingle()
    : { data: null };
  const team = player.data?.team_id
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", player.data.team_id).maybeSingle()
    : { data: null };
  const teamName = formatTeamDisplayName(team.data) ?? "the franchise";
  await import("./tweet-generation.service.js").then(({ queueContractSigningTweets }) => queueContractSigningTweets({
    leagueId: context.leagueId,
    seasonNumber: Number(context.rec_leagues.season_number ?? 1),
    weekNumber: Number(context.rec_leagues.current_week ?? 1),
    contractId: String(contract.data.id),
    playerName,
    position: String(prospect.data.position),
    teamName,
    contractNumber: Number(contract.data.contract_number),
    startSeason: Number(contract.data.start_season),
    endSeason: Number(contract.data.end_season),
    playerXp,
    coins,
  })).catch((error) => console.error("[WARN] Could not queue RTI contract-signing tweets (non-fatal):", error));
  return { ok: true, alreadySigned: false, playerXp, coins };
}

/** Queues the signing tweet if it never landed (sign happened while the tweet path was down).
 * queueContractSigningTweets is the idempotency gate — repeated hub loads cannot duplicate it. */
export async function ensureSignedContractAnnouncement(input: { guildId: string; contractId: string }): Promise<void> {
  const context = await getCurrentLeagueContext(input.guildId);
  const contract = await supabase.from("rec_immortality_contracts").select("*").eq("id", input.contractId).maybeSingle();
  if (!contract.data || String(contract.data.offer_status) !== "signed") return;
  const prospect = await supabase.from("rec_immortality_prospects")
    .select("id,position,first_name,last_name,player_id").eq("id", contract.data.prospect_id).maybeSingle();
  if (!prospect.data) return;
  const playerName = `${prospect.data.first_name ?? ""} ${prospect.data.last_name ?? ""}`.trim() || "A franchise player";
  const player = prospect.data.player_id
    ? await supabase.from("rec_players").select("team_id").eq("id", prospect.data.player_id).maybeSingle()
    : { data: null };
  const team = player.data?.team_id
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", player.data.team_id).maybeSingle()
    : { data: null };
  const teamName = formatTeamDisplayName(team.data) ?? "the franchise";
  const playerXp = Number(contract.data.player_xp_payout ?? 0);
  const coins = Number(contract.data.coins_payout ?? contract.data.coins_per_season ?? 0);
  await import("./tweet-generation.service.js").then(({ queueContractSigningTweets }) => queueContractSigningTweets({
    leagueId: context.leagueId,
    seasonNumber: Number(context.rec_leagues.season_number ?? 1),
    weekNumber: Number(context.rec_leagues.current_week ?? 1),
    contractId: String(contract.data.id), playerName, position: String(prospect.data.position), teamName,
    contractNumber: Number(contract.data.contract_number), startSeason: Number(contract.data.start_season),
    endSeason: Number(contract.data.end_season), playerXp, coins,
  }));
}
