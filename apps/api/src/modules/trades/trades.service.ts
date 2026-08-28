import {
  computeRecTeamPositionNeeds,
  evaluateRecTradeFairness,
  type RecTeamPositionNeeds,
  type RecTradeFairnessReport,
  type RecTradePickInput,
  type RecTradePlayerInput,
} from "@rec/shared";
import { MADDEN_PICK_BASELINE_META } from "../draft-picks/madden-pick-baselines.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext, findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

const MAX_LEGS_PER_SIDE = 7;

type LegInput = { type: "player"; playerId: string } | { type: "pick"; draftPickId: string };

export async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't load your REC account. Please try again.", account.error);
  return account.data?.user_id ?? null;
}

export async function teamForUser(leagueId: string, userId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team. Please try again.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(403, "A linked league team is required to trade.");
  return String(assignment.data.team_id);
}

async function userForTeam(leagueId: string, teamId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("user_id")
    .eq("league_id", leagueId).eq("team_id", teamId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load that team's coach. Please try again.", assignment.error);
  return assignment.data?.user_id ? String(assignment.data.user_id) : null;
}

async function hasSiteAccount(userId: string) {
  const user = await supabase.from("rec_users").select("supabase_auth_user_id").eq("id", userId).maybeSingle();
  if (user.error) throw new ApiError(500, "We couldn't check that coach's site account. Please try again.", user.error);
  return Boolean(user.data?.supabase_auth_user_id);
}

async function walletBalance(userId: string) {
  const wallet = await supabase.from("rec_wallets").select("wallet_balance").eq("user_id", userId).maybeSingle();
  return Number(wallet.data?.wallet_balance ?? 0);
}

// Best-effort — a trade/listing must never fail because the commissioner hasn't set up a
// trade-block channel, or because Discord is briefly unreachable.
async function postToTradeBlockChannel(leagueId: string, payload: Record<string, unknown>) {
  try {
    const linked = await findServerRoutesForLeague(leagueId);
    const channelId = linked?.routes?.trade_block_channel_id as string | null | undefined;
    if (!channelId) return;
    await postDiscordChannelMessage(channelId, payload);
  } catch (err) {
    console.error("[ERROR] Failed to post to trade block channel (non-fatal):", err);
  }
}

async function teamLabel(leagueId: string, teamId: string) {
  const team = await supabase.from("rec_teams").select("name,display_abbr,abbreviation").eq("league_id", leagueId).eq("id", teamId).maybeSingle();
  return team.data?.name ?? team.data?.display_abbr ?? team.data?.abbreviation ?? "A team";
}

async function validateLegs(leagueId: string, teamId: string, legs: LegInput[]) {
  if (legs.length > MAX_LEGS_PER_SIDE) throw new ApiError(400, `A trade side can offer at most ${MAX_LEGS_PER_SIDE} players/picks.`);
  const playerIds = legs.filter((l) => l.type === "player").map((l: any) => l.playerId);
  const pickIds = legs.filter((l) => l.type === "pick").map((l: any) => l.draftPickId);
  if (playerIds.length) {
    const players = await supabase.from("rec_players").select("id,team_id,roster_status").eq("league_id", leagueId).in("id", playerIds);
    if (players.error) throw new ApiError(500, "We couldn't validate those players. Please try again.", players.error);
    for (const id of playerIds) {
      const row = (players.data ?? []).find((p: any) => p.id === id);
      if (!row || row.team_id !== teamId || row.roster_status !== "active") throw new ApiError(400, "One of the offered players is no longer on that active roster.");
    }
  }
  if (pickIds.length) {
    const picks = await supabase.from("rec_draft_picks").select("id,current_team_id").eq("league_id", leagueId).in("id", pickIds);
    if (picks.error) throw new ApiError(500, "We couldn't validate those draft picks. Please try again.", picks.error);
    for (const id of pickIds) {
      const row = (picks.data ?? []).find((p: any) => p.id === id);
      if (!row || row.current_team_id !== teamId) throw new ApiError(400, "One of the offered draft picks is no longer owned by that team.");
    }
  }
}

// ---------------------------------------------------------------------------
// Trade value model wiring — resolves DB rows into the shared calculator's inputs. Madden-only
// (position multipliers and contract/cap fields don't apply to CFB rosters).
// ---------------------------------------------------------------------------

export async function teamPositionNeeds(leagueId: string, teamId: string): Promise<RecTeamPositionNeeds> {
  const roster = await supabase.from("rec_players").select("position,overall_rating").eq("league_id", leagueId).eq("team_id", teamId).eq("roster_status", "active");
  if (roster.error) throw new ApiError(500, "We couldn't load the roster for trade evaluation. Please try again.", roster.error);
  return computeRecTeamPositionNeeds((roster.data ?? []).map((row: any) => ({ position: row.position, overallRating: row.overall_rating })));
}

export type TradeAssetDisplay = {
  id: string;
  type: "player" | "pick" | "coins";
  label: string;
  position: string | null;
  overallRating: number | null;
  devTrait: string | null;
  speed: number | null;
  age: number | null;
};

function coinsDisplay(amount: number): TradeAssetDisplay | null {
  if (amount <= 0) return null;
  return {
    id: "coins", type: "coins", label: `🪙 ${amount.toLocaleString()} coins`,
    position: null, overallRating: null, devTrait: null, speed: null, age: null,
  };
}

async function resolveLegAssets(leagueId: string, legs: LegInput[]): Promise<{ players: RecTradePlayerInput[]; picks: RecTradePickInput[]; displays: TradeAssetDisplay[] }> {
  const playerIds = legs.filter((l) => l.type === "player").map((l: any) => l.playerId);
  const pickIds = legs.filter((l) => l.type === "pick").map((l: any) => l.draftPickId);
  const [players, picks, teamsCount] = await Promise.all([
    playerIds.length
      ? supabase.from("rec_players").select("id,full_name,position,overall_rating,dev_trait,years_pro,contract_years_left,cap_hit,attributes").in("id", playerIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    pickIds.length
      ? supabase.from("rec_draft_picks").select("id,season_number,round,pick_number").in("id", pickIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from("rec_teams").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
  ]);
  if (players.error) throw new ApiError(500, "We couldn't load players for trade valuation. Please try again.", players.error);
  if (picks.error) throw new ApiError(500, "We couldn't load draft picks for trade valuation. Please try again.", picks.error);
  const teamsInLeague = teamsCount.count ?? 32;
  const displays: TradeAssetDisplay[] = [
    ...(players.data ?? []).map((row: any) => ({
      id: row.id, type: "player" as const, label: `${row.position} ${row.full_name}`,
      position: row.position, overallRating: row.overall_rating, devTrait: row.dev_trait,
      speed: row.attributes?.spd ?? null, age: 21 + Math.max(0, row.years_pro ?? 3),
    })),
    ...(picks.data ?? []).map((row: any) => ({
      id: row.id, type: "pick" as const, label: `Round ${row.round} Pick ${row.pick_number ?? "TBD"} (S${row.season_number})`,
      position: null, overallRating: null, devTrait: null, speed: null, age: null,
    })),
  ];
  return {
    players: (players.data ?? []).map((row: any) => ({
      id: row.id, position: row.position, overallRating: row.overall_rating, devTrait: row.dev_trait,
      yearsPro: row.years_pro, contractYearsLeft: row.contract_years_left, capHit: row.cap_hit,
    })),
    // rec_draft_picks.pick_number is round-relative (1..teamsInLeague, reset every round) —
    // estimateRecPickTradeValue's pickNumber is the ABSOLUTE overall draft slot. See the
    // matching comment in trade-targets.service.ts for the exact bug this fixes (a late-round
    // pick scoring as if it were an early-round one).
    picks: (picks.data ?? []).map((row: any) => ({
      id: row.id, round: row.round,
      pickNumber: row.pick_number != null ? (row.round - 1) * teamsInLeague + row.pick_number : null,
      teamsInLeague,
    })),
    displays,
  };
}

export type TradeEvaluatorReport = RecTradeFairnessReport & { proposingAssets: TradeAssetDisplay[]; receivingAssets: TradeAssetDisplay[] };

async function buildTradeFairnessReport(input: {
  leagueId: string; proposingTeamId: string; receivingTeamId: string;
  offeredLegs: LegInput[]; requestedLegs: LegInput[]; offeredCoins: number; requestedCoins: number;
}): Promise<TradeEvaluatorReport> {
  const [proposingNeeds, receivingNeeds, offered, requested] = await Promise.all([
    teamPositionNeeds(input.leagueId, input.proposingTeamId),
    teamPositionNeeds(input.leagueId, input.receivingTeamId),
    resolveLegAssets(input.leagueId, input.offeredLegs),
    resolveLegAssets(input.leagueId, input.requestedLegs),
  ]);
  const report = evaluateRecTradeFairness({
    proposingPlayers: offered.players, proposingPicks: offered.picks, proposingCoins: input.offeredCoins,
    receivingPlayers: requested.players, receivingPicks: requested.picks, receivingCoins: input.requestedCoins,
    proposingTeamNeeds: proposingNeeds, receivingTeamNeeds: receivingNeeds,
  });
  // The value math already folds coins in (evaluateRecTradeFairness above), but the asset
  // list itself never included a line item for them — coins silently raised the total with
  // nothing on screen to show why, making it look like typing an amount did nothing.
  const proposingCoinsDisplay = coinsDisplay(input.offeredCoins);
  const receivingCoinsDisplay = coinsDisplay(input.requestedCoins);
  return {
    ...report,
    proposingAssets: proposingCoinsDisplay ? [...offered.displays, proposingCoinsDisplay] : offered.displays,
    receivingAssets: receivingCoinsDisplay ? [...requested.displays, receivingCoinsDisplay] : requested.displays,
  };
}

/** Live trade-evaluator preview for the Trade Center builder screen — no trade needs to exist
 * yet. Madden-only; CFB rosters don't carry the contract/cap/dev-trait fields the model uses. */
export async function getTradeFairnessPreview(guildId: string, input: {
  proposingTeamId: string; receivingTeamId: string;
  offeredLegs: LegInput[]; requestedLegs: LegInput[]; offeredCoins: number; requestedCoins: number;
}): Promise<TradeEvaluatorReport> {
  const context = await getCurrentLeagueContext(guildId);
  if (!String(context.league.game).startsWith("madden")) throw new ApiError(400, "The trade value calculator is available for Madden leagues only.");
  if (input.proposingTeamId === input.receivingTeamId) throw new ApiError(400, "Select two different teams.");
  return buildTradeFairnessReport({ leagueId: context.leagueId, ...input });
}

export async function proposeTrade(input: {
  guildId: string; discordId: string; receivingTeamId: string;
  offeredLegs: LegInput[]; requestedLegs: LegInput[]; offeredCoins: number; requestedCoins: number;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { isRiseToImmortalityLeagueType } = await import("@rec/shared");
  const seasonNumber = resolveSeasonNumber(context);
  const userId = await userIdFromDiscord(input.discordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const proposingTeamId = await teamForUser(context.leagueId, userId);
  if (proposingTeamId === input.receivingTeamId) throw new ApiError(400, "You can't trade with your own team.");
  if (input.offeredCoins < 0 || input.requestedCoins < 0) throw new ApiError(400, "Coin amounts can't be negative.");

  const config = await supabase.from("rec_league_configuration").select("roster_type,trade_approval_policy,cpu_trading_policy,cpu_trades_season_cap").eq("league_id", context.leagueId).maybeSingle();
  if (config.error) throw new ApiError(500, "We couldn't load trade settings. Please try again.", config.error);
  if (isRiseToImmortalityLeagueType(String(config.data?.roster_type ?? ""))) {
    throw new ApiError(400, "Trades are not available in Rise to Immortality.");
  }
  const approvalPolicy = config.data?.trade_approval_policy ?? "competition_committee_review";
  const cpuPolicy = config.data?.cpu_trading_policy ?? "allowed";

  const receivingUserId = await userForTeam(context.leagueId, input.receivingTeamId);
  const receivingHasSiteAccount = receivingUserId ? await hasSiteAccount(receivingUserId) : false;
  if (receivingUserId && !receivingHasSiteAccount && (input.offeredCoins > 0 || input.requestedCoins > 0)) {
    throw new ApiError(400, "Coins can't be included until the other coach has registered on the REC site.");
  }
  if (!receivingUserId) {
    if (cpuPolicy === "not_allowed") throw new ApiError(400, "This league does not allow trades with CPU-controlled teams.");
    const cpuTradeCap = Number(config.data?.cpu_trades_season_cap ?? 0);
    if (cpuTradeCap > 0) {
      const used = await supabase.from("rec_trades").select("id", { count: "exact", head: true })
        .eq("league_id", context.leagueId)
        .eq("season_number", seasonNumber)
        .eq("proposing_team_id", proposingTeamId)
        .eq("involves_cpu", true)
        .eq("status", "applied");
      if (used.error) throw new ApiError(500, "We couldn't check the CPU trade season limit. Please try again.", used.error);
      if ((used.count ?? 0) >= cpuTradeCap) throw new ApiError(409, `Your team has reached its limit of ${cpuTradeCap} CPU trade${cpuTradeCap === 1 ? "" : "s"} this season.`);
    }
  }
  // A CPU-side trade always needs a human to review it even if the league otherwise allows
  // trades to auto-apply — there's no GM on the other side to have agreed to it.
  const effectivePolicy = !receivingUserId && approvalPolicy === "no_approval_required" ? "commissioner_review" : approvalPolicy;

  if (input.offeredCoins > 0 && (await walletBalance(userId)) < input.offeredCoins) {
    throw new ApiError(400, "You don't have enough coins to offer that amount.");
  }
  if (input.requestedCoins > 0 && receivingUserId && (await walletBalance(receivingUserId)) < input.requestedCoins) {
    throw new ApiError(400, "The other team doesn't have enough coins to cover what you're requesting.");
  }

  await validateLegs(context.leagueId, proposingTeamId, input.offeredLegs);
  await validateLegs(context.leagueId, input.receivingTeamId, input.requestedLegs);

  // Snapshotted once at propose time so the review UI shows a stable value even if rosters
  // change before the trade is reviewed — Madden only (buildTradeFairnessReport assumes
  // Madden-shaped rosters), non-fatal so a valuation hiccup never blocks a real trade.
  const valueSnapshot = String(context.league.game).startsWith("madden")
    ? await buildTradeFairnessReport({
        leagueId: context.leagueId, proposingTeamId, receivingTeamId: input.receivingTeamId,
        offeredLegs: input.offeredLegs, requestedLegs: input.requestedLegs,
        offeredCoins: input.offeredCoins, requestedCoins: input.requestedCoins,
      }).catch((error) => { console.error("[WARN] Failed to compute trade fairness snapshot:", error); return null; })
    : null;

  const trade = await supabase.from("rec_trades").insert({
    league_id: context.leagueId,
    season_number: seasonNumber,
    proposing_team_id: proposingTeamId,
    proposing_user_id: userId,
    receiving_team_id: input.receivingTeamId,
    receiving_user_id: receivingUserId ?? userId, // no CPU "user" to bill/credit against; proposer's own id is a harmless placeholder since CPU-side coin legs are blocked below
    proposing_coins: input.offeredCoins,
    receiving_coins: input.requestedCoins,
    approval_policy_snapshot: effectivePolicy,
    involves_cpu: !receivingUserId,
    value_snapshot: valueSnapshot,
  }).select("*").single();
  if (trade.error) throw new ApiError(500, "We couldn't propose that trade. Please try again.", trade.error);

  if (!receivingUserId && input.requestedCoins > 0) {
    await supabase.from("rec_trades").delete().eq("id", trade.data.id);
    throw new ApiError(400, "Can't request coins from a CPU-controlled team.");
  }

  const legRows = [
    ...input.offeredLegs.map((leg) => legRow(trade.data.id, leg, proposingTeamId, input.receivingTeamId)),
    ...input.requestedLegs.map((leg) => legRow(trade.data.id, leg, input.receivingTeamId, proposingTeamId)),
  ];
  if (legRows.length) {
    const legs = await supabase.from("rec_trade_legs").insert(legRows);
    if (legs.error) { await supabase.from("rec_trades").delete().eq("id", trade.data.id); throw new ApiError(500, "We couldn't save the trade details. Please try again.", legs.error); }
  }

  await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "proposed", actor_user_id: userId, actor_discord_id: input.discordId, next_status: "pending_response" });

  {
    const [proposingName, receivingName] = await Promise.all([teamLabel(context.leagueId, proposingTeamId), teamLabel(context.leagueId, input.receivingTeamId)]);
    void postToTradeBlockChannel(context.leagueId, {
      embeds: [{
        title: "Trade Proposed",
        color: 0x2f8fdb,
        description: `**${proposingName}** proposed a trade with **${receivingName}**${receivingUserId ? "" : " (CPU)"}.`,
      }],
    });
  }

  // No GM on the other side to respond — a CPU-side proposal skips straight to review/auto-apply.
  if (!receivingUserId) {
    return finalizeAcceptedTrade(trade.data.id, effectivePolicy, input.guildId, context.leagueId);
  }
  return trade.data;
}

function legRow(tradeId: string, leg: LegInput, fromTeamId: string, toTeamId: string) {
  return leg.type === "player"
    ? { trade_id: tradeId, leg_type: "player", player_id: leg.playerId, from_team_id: fromTeamId, to_team_id: toTeamId }
    : { trade_id: tradeId, leg_type: "pick", draft_pick_id: leg.draftPickId, from_team_id: fromTeamId, to_team_id: toTeamId };
}

export async function respondToTrade(input: { guildId: string; discordId: string; tradeId: string; action: "accept" | "decline" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.receiving_user_id !== userId) throw new ApiError(403, "Only the receiving team's coach can respond to this trade.");
  if (trade.data.status !== "pending_response") throw new ApiError(409, `This trade is no longer pending (status: ${trade.data.status}).`);

  if (input.action === "decline") {
    await supabase.from("rec_trades").update({ status: "declined", declined_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", trade.data.id);
    await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "declined", actor_user_id: userId, actor_discord_id: input.discordId, previous_status: "pending_response", next_status: "declined" });
    return { status: "declined" };
  }

  return finalizeAcceptedTrade(trade.data.id, trade.data.approval_policy_snapshot, input.guildId, context.leagueId);
}

// Fires once, at the moment a trade actually moves players/picks — not on propose/accept —
// so the league only hears about deals that are actually final. Best-effort: a failure here
// must never undo an already-applied trade.
async function announceAppliedTrade(guildId: string, leagueId: string, tradeId: string) {
  try {
    const trade = await supabase.from("rec_trades").select("proposing_team_id,receiving_team_id").eq("id", tradeId).maybeSingle();
    if (!trade.data) return;
    const legs = await supabase.from("rec_trade_legs").select("leg_type,player_id,draft_pick_id,from_team_id,to_team_id").eq("trade_id", tradeId);
    const [proposingName, receivingName] = await Promise.all([
      teamLabel(leagueId, trade.data.proposing_team_id),
      teamLabel(leagueId, trade.data.receiving_team_id),
    ]);
    const playerIds = (legs.data ?? []).filter((l: any) => l.leg_type === "player").map((l: any) => l.player_id);
    const pickIds = (legs.data ?? []).filter((l: any) => l.leg_type === "pick").map((l: any) => l.draft_pick_id);
    const [players, picks] = await Promise.all([
      playerIds.length ? supabase.from("rec_players").select("id,full_name").in("id", playerIds) : { data: [] as any[] },
      pickIds.length ? supabase.from("rec_draft_picks").select("id,season_number,round,pick_number").in("id", pickIds) : { data: [] as any[] },
    ]);
    const nameByPlayer = new Map((players.data ?? []).map((p: any) => [p.id, p.full_name]));
    // Resolve game for year conversion
    const leagueRow = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
    const game = String(leagueRow.data?.game ?? "");
    const pickById = new Map<string, { season_number: number; round: number; pick_number: number | null }>((picks.data ?? []).map((p: any) => [p.id, p]));
    const toLine = (l: any) => {
      const picked = pickById.get(l.draft_pick_id);
      const label = l.leg_type === "player"
        ? (nameByPlayer.get(l.player_id) ?? "a player")
        : (picked ? pickLabel(picked, game) : "a draft pick");
      return `${label} (${l.from_team_id === trade.data!.proposing_team_id ? proposingName : receivingName} → ${l.to_team_id === trade.data!.proposing_team_id ? proposingName : receivingName})`;
    };
    const lines = (legs.data ?? []).map(toLine);
    const body = lines.length ? `Trade confirmed between **${proposingName}** and **${receivingName}**:\n\n${lines.map((l) => `- ${l}`).join("\n")}` : `Trade confirmed between **${proposingName}** and **${receivingName}**.`;
    await publishTransitionStory({ guildId, headline: `${proposingName} and ${receivingName} agree to a trade`, body, primaryAngle: "trade" });
    void postToTradeBlockChannel(leagueId, { embeds: [{ title: "Trade Confirmed", color: 0x2fb86a, description: body.slice(0, 4096) }] });
  } catch (err) {
    console.error("[ERROR] Failed to announce applied trade (non-fatal):", err);
  }
}

async function finalizeAcceptedTrade(tradeId: string, approvalPolicy: string, guildId: string, leagueId: string) {
  const now = new Date().toISOString();
  if (approvalPolicy === "no_approval_required") {
    await supabase.from("rec_trades").update({ status: "accepted", accepted_at: now, updated_at: now }).eq("id", tradeId);
    const applied = await supabase.rpc("apply_trade", { p_trade_id: tradeId, p_reviewer_discord_id: null, p_review_note: "Auto-applied — no approval required" });
    if (applied.error) throw new ApiError(500, "The trade was accepted, but we couldn't apply it. Please try again.", applied.error);
    void announceAppliedTrade(guildId, leagueId, tradeId);
    return { status: "applied" };
  }
  await supabase.from("rec_trades").update({ status: "pending_review", accepted_at: now, updated_at: now }).eq("id", tradeId);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: tradeId, action: "accepted", previous_status: "pending_response", next_status: "pending_review" });
  const [snapshotRow, tradeRow] = await Promise.all([
    supabase.from("rec_trades").select("value_snapshot").eq("id", tradeId).maybeSingle(),
    supabase.from("rec_trades").select("proposing_team_id,receiving_team_id").eq("id", tradeId).maybeSingle(),
  ]);
  const snapshot = snapshotRow.data?.value_snapshot as TradeEvaluatorReport | null | undefined;
  const [proposingTeamName, receivingTeamName] = await Promise.all([
    teamLabel(leagueId, tradeRow.data?.proposing_team_id ?? ""),
    teamLabel(leagueId, tradeRow.data?.receiving_team_id ?? ""),
  ]);
  // The inbox card is the commissioner's first (often only) look at the trade — spell out
  // both teams, every asset each side sends, and the evaluator verdict with its totals.
  const assetLine = (assets: TradeAssetDisplay[] | undefined) =>
    assets?.length ? assets.map((asset) => asset.label).join(", ") : "no players or picks";
  const verdictLine = snapshot
    ? snapshot.verdict === "balanced"
      ? `Evaluator: estimated fair value (within ${Math.abs(snapshot.deltaPct)}%) — ${proposingTeamName} ${snapshot.proposing.needAdjustedTotal} vs ${receivingTeamName} ${snapshot.receiving.needAdjustedTotal}.`
      : `Evaluator: favors ${snapshot.verdict === "favors_proposing" ? proposingTeamName : receivingTeamName} by ~${Math.abs(snapshot.deltaPct)}% — ${proposingTeamName} ${snapshot.proposing.needAdjustedTotal} vs ${receivingTeamName} ${snapshot.receiving.needAdjustedTotal}.`
    : null;
  const summary = [
    `Accepted by both teams, awaiting review.`,
    `${proposingTeamName} sends: ${assetLine(snapshot?.proposingAssets)}.`,
    `${receivingTeamName} sends: ${assetLine(snapshot?.receivingAssets)}.`,
    verdictLine,
  ].filter(Boolean).join("\n");
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildId, league_id: leagueId, queue_type: "trade", status: "pending", priority: 0,
    header: `Trade pending review — ${proposingTeamName} ⇄ ${receivingTeamName}`,
    summary,
    source_table: "rec_trades", source_id: tradeId,
    payload: { tradeId, approvalPolicy, proposingTeam: proposingTeamName, receivingTeam: receivingTeamName, valueSnapshot: snapshot ?? null },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);
  return { status: "pending_review" };
}

export async function withdrawTrade(input: { guildId: string; discordId: string; tradeId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.proposing_user_id !== userId) throw new ApiError(403, "Only the proposing coach can withdraw this trade.");
  if (!["pending_response", "accepted"].includes(trade.data.status)) throw new ApiError(409, "This trade can no longer be withdrawn.");
  const now = new Date().toISOString();
  await supabase.from("rec_trades").update({ status: "withdrawn", withdrawn_at: now, updated_at: now }).eq("id", trade.data.id);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "withdrawn", actor_user_id: userId, actor_discord_id: input.discordId, previous_status: trade.data.status, next_status: "withdrawn" });
  return { status: "withdrawn" };
}

export async function reviewTrade(input: { guildId: string; reviewerDiscordId: string; tradeId: string; action: "approve" | "reject"; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.status !== "pending_review") {
    // Already resolved (applied/rejected/declined/withdrawn) — most likely a stale inbox row
    // left behind by an earlier review that updated the trade but didn't clean up
    // rec_commissioners_inbox. Clear it instead of throwing so a stuck pending-item card
    // isn't a dead end for the commissioner.
    await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", trade.data.id);
    return { status: trade.data.status, alreadyResolved: true };
  }
  if (trade.data.approval_policy_snapshot === "competition_committee_review") {
    throw new ApiError(400, "This league uses committee voting for trades — cast a vote instead of a direct approve/reject.");
  }

  if (input.action === "reject") {
    const now = new Date().toISOString();
    await supabase.from("rec_trades").update({ status: "rejected", rejected_at: now, updated_at: now, reviewed_by_discord_id: input.reviewerDiscordId, review_note: input.note ?? null }).eq("id", trade.data.id);
    await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "rejected", actor_discord_id: input.reviewerDiscordId, previous_status: "pending_review", next_status: "rejected", details: { note: input.note ?? null } });
    // Remove the commissioner inbox notification for this trade
    await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", trade.data.id);
    return { status: "rejected" };
  }
  const applied = await supabase.rpc("apply_trade", { p_trade_id: trade.data.id, p_reviewer_discord_id: input.reviewerDiscordId, p_review_note: input.note ?? null });
  if (applied.error) throw new ApiError(500, "We couldn't apply that trade. Please try again.", applied.error);
  // Remove the commissioner inbox notification for this trade
  await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", trade.data.id);
  void announceAppliedTrade(input.guildId, context.leagueId, trade.data.id);
  return { status: "applied" };
}

// ---------------------------------------------------------------------------
// Competition-committee voting — each commissioner/co-commissioner casts approve/reject;
// once everyone eligible has voted, the majority result auto-applies/rejects. The league owner
// (head commissioner) can also force an early close short of full votes, but the frontend must
// get an explicit confirmation from them first — this endpoint doesn't re-confirm.
// ---------------------------------------------------------------------------

async function tradeCommitteeElectors(leagueId: string): Promise<Set<string>> {
  const memberships = await supabase.from("rec_league_memberships").select("user_id").eq("league_id", leagueId).eq("status", "active").in("role", ["commissioner", "co_commissioner"]);
  if (memberships.error) throw new ApiError(500, "We couldn't load league commissioners right now. Please try again.", memberships.error);
  return new Set((memberships.data ?? []).map((row: any) => String(row.user_id)));
}

async function tradeVoteTally(tradeId: string, leagueId: string) {
  const [electors, votes] = await Promise.all([
    tradeCommitteeElectors(leagueId),
    supabase.from("rec_trade_votes").select("voter_user_id,vote").eq("trade_id", tradeId),
  ]);
  if (votes.error) throw new ApiError(500, "We couldn't load trade votes right now. Please try again.", votes.error);
  const approve = (votes.data ?? []).filter((v: any) => v.vote === "approve").length;
  const reject = (votes.data ?? []).filter((v: any) => v.vote === "reject").length;
  const voted = new Set((votes.data ?? []).map((v: any) => String(v.voter_user_id)));
  return { electorCount: electors.size, votedCount: voted.size, approve, reject, allVoted: electors.size > 0 && voted.size >= electors.size };
}

export async function getTradeVoteStatus(guildId: string, tradeId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const trade = await supabase.from("rec_trades").select("id,status,approval_policy_snapshot,league_id").eq("id", tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  const tally = await tradeVoteTally(tradeId, context.leagueId);
  return { status: trade.data.status, ...tally };
}

async function resolveTradeVoteOutcome(tradeId: string, leagueId: string, guildId: string) {
  const tally = await tradeVoteTally(tradeId, leagueId);
  if (tally.approve > tally.reject) {
    const applied = await supabase.rpc("apply_trade", { p_trade_id: tradeId, p_reviewer_discord_id: null, p_review_note: `Committee vote: ${tally.approve}-${tally.reject}` });
    if (applied.error) throw new ApiError(500, "The trade passed the committee vote, but we couldn't apply it. Please try again.", applied.error);
    await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", tradeId);
    void announceAppliedTrade(guildId, leagueId, tradeId);
    return { status: "applied", tally };
  }
  const now = new Date().toISOString();
  await supabase.from("rec_trades").update({ status: "rejected", rejected_at: now, updated_at: now, review_note: `Committee vote: ${tally.approve}-${tally.reject}` }).eq("id", tradeId);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: tradeId, action: "rejected", previous_status: "pending_review", next_status: "rejected", details: { committeeVote: tally } });
  await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", tradeId);
  return { status: "rejected", tally };
}

export async function castTradeVote(input: { guildId: string; reviewerDiscordId: string; tradeId: string; vote: "approve" | "reject" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.reviewerDiscordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.status !== "pending_review") throw new ApiError(409, `Trade is not pending review (status: ${trade.data.status}).`);
  if (trade.data.approval_policy_snapshot !== "competition_committee_review") throw new ApiError(400, "This trade doesn't use committee voting.");
  const electors = await tradeCommitteeElectors(context.leagueId);
  if (!electors.has(userId)) throw new ApiError(403, "Only this league's commissioners can vote on trades.");

  const upserted = await supabase.from("rec_trade_votes").upsert(
    { trade_id: input.tradeId, voter_user_id: userId, voter_discord_id: input.reviewerDiscordId, vote: input.vote, voted_at: new Date().toISOString() },
    { onConflict: "trade_id,voter_user_id" },
  );
  if (upserted.error) throw new ApiError(500, "We couldn't record your vote. Please try again.", upserted.error);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: input.tradeId, action: "vote_cast", actor_user_id: userId, actor_discord_id: input.reviewerDiscordId, details: { vote: input.vote } });

  const tally = await tradeVoteTally(input.tradeId, context.leagueId);
  if (tally.allVoted) return resolveTradeVoteOutcome(input.tradeId, context.leagueId, input.guildId);
  return { status: "pending_review" as const, tally };
}

/** Head-commissioner override — closes a committee vote early even if not everyone has voted
 * yet. The frontend is responsible for the "you're closing this without all votes logged" popup
 * confirmation before calling this; this endpoint just enforces that the caller actually is the
 * league owner. */
export async function forceCloseTradeVote(input: { guildId: string; reviewerDiscordId: string; tradeId: string; action: "approve" | "reject" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.reviewerDiscordId);
  if (!userId || String(context.league.ownerUserId ?? "") !== userId) throw new ApiError(403, "Only the head commissioner can force-close a committee vote.");
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.status !== "pending_review") throw new ApiError(409, `Trade is not pending review (status: ${trade.data.status}).`);
  if (trade.data.approval_policy_snapshot !== "competition_committee_review") throw new ApiError(400, "This trade doesn't use committee voting.");

  const tally = await tradeVoteTally(input.tradeId, context.leagueId);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: input.tradeId, action: "vote_force_closed", actor_user_id: userId, actor_discord_id: input.reviewerDiscordId, details: { action: input.action, tally } });
  if (input.action === "reject") {
    const now = new Date().toISOString();
    await supabase.from("rec_trades").update({ status: "rejected", rejected_at: now, updated_at: now, reviewed_by_discord_id: input.reviewerDiscordId, review_note: `Head commissioner closed vote early (${tally.votedCount}/${tally.electorCount} voted): reject` }).eq("id", input.tradeId);
    await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", input.tradeId);
    return { status: "rejected", tally };
  }
  const applied = await supabase.rpc("apply_trade", { p_trade_id: input.tradeId, p_reviewer_discord_id: input.reviewerDiscordId, p_review_note: `Head commissioner closed vote early (${tally.votedCount}/${tally.electorCount} voted): approve` });
  if (applied.error) throw new ApiError(500, "We couldn't apply that trade. Please try again.", applied.error);
  await supabase.from("rec_commissioners_inbox").delete().eq("source_table", "rec_trades").eq("source_id", input.tradeId);
  void announceAppliedTrade(input.guildId, context.leagueId, input.tradeId);
  return { status: "applied", tally };
}

export async function listTradeBlockPlayers(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const players = await supabase.from("rec_players").select("id,full_name,position,overall_rating,team_id,trade_block_note,trade_block_listed_at")
    .eq("league_id", context.leagueId).eq("on_trade_block", true).order("trade_block_listed_at", { ascending: false });
  if (players.error) throw new ApiError(500, "We couldn't load the trade block right now. Please try again.", players.error);
  const teamIds = [...new Set((players.data ?? []).map((p: any) => p.team_id).filter(Boolean))] as string[];
  const names = teamIds.length ? await teamNames(context.leagueId, teamIds) : new Map<string, string>();
  return (players.data ?? []).map((p: any) => ({
    id: p.id, fullName: p.full_name, position: p.position, overallRating: p.overall_rating,
    teamId: p.team_id, teamName: names.get(p.team_id) ?? "Unassigned",
    note: p.trade_block_note, listedAt: p.trade_block_listed_at,
  }));
}

async function teamNames(leagueId: string, teamIds: string[]) {
  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", leagueId).in("id", teamIds);
  return new Map((teams.data ?? []).map((t: any) => [t.id, t.name ?? t.display_abbr ?? t.abbreviation]));
}

export async function setPlayerTradeBlock(input: { guildId: string; discordId: string; playerId: string; listed: boolean; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const player = await supabase.from("rec_players").select("id,team_id,full_name,roster_status").eq("id", input.playerId).eq("league_id", context.leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "We couldn't load that player. Please try again.", player.error);
  if (!player.data || player.data.roster_status !== "active") throw new ApiError(404, "Player not found on an active roster.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");
  const myTeamId = await teamForUser(context.leagueId, userId ?? "");
  if (player.data.team_id !== myTeamId) throw new ApiError(403, "Only that player's own coach can manage their trade-block listing.");

  const now = new Date().toISOString();
  const updated = await supabase.from("rec_players").update({
    on_trade_block: input.listed,
    trade_block_note: input.listed ? (input.note?.trim() || null) : null,
    trade_block_listed_at: input.listed ? now : null,
  }).eq("id", input.playerId).select("id,full_name").single();
  if (updated.error) throw new ApiError(500, "We couldn't update that trade-block listing. Please try again.", updated.error);

  if (input.listed) {
    const label = await teamLabel(context.leagueId, player.data.team_id);
    void postToTradeBlockChannel(context.leagueId, {
      embeds: [{
        title: "Player Added to Trade Block",
        color: 0xd9a521,
        description: `**${player.data.full_name}** (${label})${input.note ? ` — ${input.note}` : ""}`,
      }],
    });
  }
  return updated.data;
}

export async function listMyTrades(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdFromDiscord(discordId);
  if (!userId) return { trades: [] };
  const trades = await supabase.from("rec_trades").select("*").eq("league_id", context.leagueId)
    .or(`proposing_user_id.eq.${userId},receiving_user_id.eq.${userId}`).order("created_at", { ascending: false }).limit(100);
  if (trades.error) throw new ApiError(500, "We couldn't load trades right now. Please try again.", trades.error);
  return { trades: trades.data ?? [] };
}

export async function listPendingReviewTrades(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const trades = await supabase.from("rec_trades").select("*").eq("league_id", context.leagueId).eq("status", "pending_review").order("accepted_at", { ascending: true });
  if (trades.error) throw new ApiError(500, "We couldn't load trades pending review right now. Please try again.", trades.error);
  return { trades: trades.data ?? [] };
}

export async function logCommissionerTrade(input: {
  guildId: string; reviewerDiscordId: string; proposingTeamId: string; receivingTeamId: string;
  offeredLegs: LegInput[]; requestedLegs: LegInput[]; offeredCoins: number; requestedCoins: number;
  classification: "general" | "blockbuster"; note?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (!String(context.league.game).startsWith("madden")) throw new ApiError(400, "The commissioner trade builder is available for Madden leagues only.");
  if (input.proposingTeamId === input.receivingTeamId) throw new ApiError(400, "Select two different teams.");
  if (input.offeredCoins < 0 || input.requestedCoins < 0) throw new ApiError(400, "Coin amounts can't be negative.");
  if (!input.offeredLegs.length && !input.requestedLegs.length && !input.offeredCoins && !input.requestedCoins) throw new ApiError(400, "Add at least one trade asset.");

  const [proposingUserId, receivingUserId, reviewerUserId] = await Promise.all([
    userForTeam(context.leagueId, input.proposingTeamId), userForTeam(context.leagueId, input.receivingTeamId),
    userIdFromDiscord(input.reviewerDiscordId),
  ]);
  if (!reviewerUserId) throw new ApiError(403, "A registered commissioner account is required to publish a trade.");
  await Promise.all([
    validateLegs(context.leagueId, input.proposingTeamId, input.offeredLegs),
    validateLegs(context.leagueId, input.receivingTeamId, input.requestedLegs),
  ]);
  const seasonNumber = resolveSeasonNumber(context);
  const now = new Date().toISOString();
  const created = await supabase.from("rec_trades").insert({
    league_id: context.leagueId, season_number: seasonNumber,
    proposing_team_id: input.proposingTeamId, proposing_user_id: proposingUserId ?? reviewerUserId,
    receiving_team_id: input.receivingTeamId, receiving_user_id: receivingUserId ?? reviewerUserId,
    proposing_coins: input.offeredCoins, receiving_coins: input.requestedCoins,
    approval_policy_snapshot: "commissioner_published_only", status: "applied", accepted_at: now, applied_at: now, involves_cpu: !proposingUserId || !receivingUserId,
    review_note: input.note?.trim() || null, reviewed_by_discord_id: input.reviewerDiscordId,
  }).select("id").single();
  if (created.error) throw new ApiError(500, "We couldn't create that trade. Please try again.", created.error);
  const tradeId = String(created.data.id);
  const rows = [
    ...input.offeredLegs.map((leg) => legRow(tradeId, leg, input.proposingTeamId, input.receivingTeamId)),
    ...input.requestedLegs.map((leg) => legRow(tradeId, leg, input.receivingTeamId, input.proposingTeamId)),
  ];
  if (rows.length) {
    const inserted = await supabase.from("rec_trade_legs").insert(rows);
    if (inserted.error) { await supabase.from("rec_trades").delete().eq("id", tradeId); throw new ApiError(500, "We couldn't save the trade assets. Please try again.", inserted.error); }
  }
  await supabase.from("rec_trade_audit_log").insert({ trade_id: tradeId, action: "commissioner_published", actor_user_id: reviewerUserId, actor_discord_id: input.reviewerDiscordId, next_status: "applied", details: { classification: input.classification, note: input.note ?? null, transactional: false } });

  const [firstName, secondName] = await Promise.all([teamLabel(context.leagueId, input.proposingTeamId), teamLabel(context.leagueId, input.receivingTeamId)]);
  const title = input.classification === "blockbuster" ? `BLOCKBUSTER TRADE: ${firstName} and ${secondName}` : `Trade Confirmed: ${firstName} and ${secondName}`;
  const playerIds = [...input.offeredLegs, ...input.requestedLegs].filter((leg): leg is Extract<LegInput, { type: "player" }> => leg.type === "player").map((leg) => leg.playerId);
  const pickIds = [...input.offeredLegs, ...input.requestedLegs].filter((leg): leg is Extract<LegInput, { type: "pick" }> => leg.type === "pick").map((leg) => leg.draftPickId);
  const [players, picks] = await Promise.all([
    playerIds.length ? supabase.from("rec_players").select("id,full_name").in("id", playerIds) : Promise.resolve({ data: [] as any[] }),
    pickIds.length ? supabase.from("rec_draft_picks").select("id,season_number,round,pick_number").in("id", pickIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const playerNames = new Map((players.data ?? []).map((row: any) => [row.id, row.full_name]));
  const pickNames = new Map((picks.data ?? []).map((row: any) => [row.id, pickLabel(row, context.league.game)]));
  const describe = (selected: LegInput[], coinAmount: number) => [...selected.map((leg) => leg.type === "player" ? playerNames.get(leg.playerId) ?? "Player" : pickNames.get(leg.draftPickId) ?? "Draft pick"), ...(coinAmount ? [`${coinAmount.toLocaleString()} coins`] : [])];
  const firstAssets = describe(input.offeredLegs, input.offeredCoins);
  const secondAssets = describe(input.requestedLegs, input.requestedCoins);
  const body = [`${firstName} and ${secondName} have completed a confirmed trade.`, "", `**${firstName} sends:** ${firstAssets.join(", ") || "No listed assets"}`, `**${secondName} sends:** ${secondAssets.join(", ") || "No listed assets"}`, input.note?.trim() ? `\nCommissioner note: ${input.note.trim()}` : ""].filter(Boolean).join("\n");
  await supabase.from("rec_hub_announcements").insert({ league_id: context.leagueId, title, body, season_number: seasonNumber, week_number: context.league.currentWeek ?? null });
  void postToTradeBlockChannel(context.leagueId, { embeds: [{ title, color: input.classification === "blockbuster" ? 0xf0b429 : 0x2fb86a, description: body.slice(0, 4096) }] });
  return { status: "applied", tradeId };
}

export async function listSeasonTradeCounts(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const [teams, assignments, trades] = await Promise.all([
    supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", context.leagueId).order("name"),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_trades").select("proposing_team_id,receiving_team_id,involves_cpu,status").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("status", "applied"),
  ]);
  if (teams.error || assignments.error || trades.error) throw new ApiError(500, "We couldn't load season trade counts right now. Please try again.", teams.error ?? assignments.error ?? trades.error);
  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  const users = userIds.length ? await supabase.from("rec_users").select("id,username,display_name").in("id", userIds) : { data: [] as any[], error: null };
  if (users.error) throw new ApiError(500, "We couldn't load coaches for trade counts. Please try again.", users.error);
  const userByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user_id]));
  const userName = new Map((users.data ?? []).map((row: any) => [row.id, row.username ?? row.display_name ?? "REC user"]));
  return {
    seasonNumber,
    teams: (teams.data ?? []).map((team: any) => {
      const involved = (trades.data ?? []).filter((trade: any) => trade.proposing_team_id === team.id || trade.receiving_team_id === team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        abbreviation: team.display_abbr ?? team.abbreviation,
        coachName: userByTeam.has(team.id) ? userName.get(userByTeam.get(team.id)) ?? "Linked user" : "CPU",
        humanTrades: involved.filter((trade: any) => !trade.involves_cpu).length,
        cpuTrades: involved.filter((trade: any) => trade.involves_cpu).length,
        totalTrades: involved.length,
      };
    }),
  };
}

export async function listTradeableTeams(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", context.leagueId).order("name");
  if (teams.error) throw new ApiError(500, "We couldn't load teams right now. Please try again.", teams.error);
  const assignments = await supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments right now. Please try again.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((a: any) => [a.team_id, a.user_id]));
  const assignedUserIds = [...new Set([...userByTeam.values()].filter(Boolean))];
  const users = assignedUserIds.length
    ? await supabase.from("rec_users").select("id,supabase_auth_user_id").in("id", assignedUserIds)
    : { data: [], error: null };
  if (users.error) throw new ApiError(500, "We couldn't load coach account status. Please try again.", users.error);
  const siteUsers = new Set((users.data ?? []).filter((user: any) => user.supabase_auth_user_id).map((user: any) => user.id));
  return (teams.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    abbreviation: t.display_abbr || t.abbreviation,
    isCpu: !userByTeam.has(t.id),
    hasSiteAccount: siteUsers.has(userByTeam.get(t.id)),
  }));
}

export async function getTradeDetail(guildId: string, tradeId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "We couldn't load that trade. Please try again.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  const legs = await supabase.from("rec_trade_legs").select("*").eq("trade_id", tradeId);
  if (legs.error) throw new ApiError(500, "We couldn't load that trade's details. Please try again.", legs.error);
  return { trade: trade.data, legs: legs.data ?? [] };
}

// ---------------------------------------------------------------------------
// Trade Block: open "I'm offering these, looking for that" listings — distinct from the
// single-target proposal flow above. A listing packages up to MAX_LEGS_PER_SIDE players/picks
// plus coins, is visible league-wide, and (unlike a proposal) has no receiving team; anyone
// interested reaches out directly. Posting one announces it publicly to the trade-block
// channel, same as a proposal does.
// ---------------------------------------------------------------------------

/** Convert a 1-based season_number to the actual draft year (e.g. Madden 27: 1 → 2027). */
function seasonNumberToYear(seasonNumber: number, game: string): number {
  const meta = MADDEN_PICK_BASELINE_META[game as keyof typeof MADDEN_PICK_BASELINE_META];
  return meta ? meta.firstDraftYear + seasonNumber - 1 : seasonNumber;
}

function pickLabel(p: { season_number: number; round: number; pick_number?: number | null }, game: string): string {
  const year = seasonNumberToYear(p.season_number, game);
  const pickNum = p.pick_number ? `, Pick ${p.pick_number}` : "";
  return `${year} Round ${p.round}${pickNum}`;
}

async function describeLegsForAnnouncement(leagueId: string, legs: LegInput[], game: string): Promise<string> {
  if (!legs.length) return "nothing";
  const playerIds = legs.filter((l) => l.type === "player").map((l: any) => l.playerId);
  const pickIds = legs.filter((l) => l.type === "pick").map((l: any) => l.draftPickId);
  const [players, picks] = await Promise.all([
    playerIds.length ? supabase.from("rec_players").select("id,full_name,position").in("id", playerIds) : Promise.resolve({ data: [] as any[] }),
    pickIds.length ? supabase.from("rec_draft_picks").select("id,season_number,round,pick_number").in("id", pickIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const playerById = new Map<string, { full_name: string; position: string }>((players.data ?? []).map((p: any) => [p.id, p]));
  const pickById = new Map<string, { season_number: number; round: number; pick_number: number | null }>((picks.data ?? []).map((p: any) => [p.id, p]));
  return legs.map((leg) => {
    if (leg.type === "player") {
      const p = playerById.get(leg.playerId);
      return p ? `${p.full_name} (${p.position})` : "a player";
    }
    const p = pickById.get(leg.draftPickId);
    return p ? pickLabel(p, game) : "a draft pick";
  }).join(", ");
}

export async function createTradeBlockListing(input: {
  guildId: string; discordId: string; legs: LegInput[]; coins: number; lookingFor: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const teamId = await teamForUser(context.leagueId, userId);
  const lookingFor = input.lookingFor.trim();
  if (!lookingFor) throw new ApiError(400, "Say what you're looking for.");
  if (lookingFor.length > 300) throw new ApiError(400, "Keep what you're looking for under 300 characters.");
  if (input.coins < 0) throw new ApiError(400, "Coins can't be negative.");
  if (!input.legs.length && input.coins <= 0) throw new ApiError(400, "Offer at least one player, pick, or coin amount.");
  await validateLegs(context.leagueId, teamId, input.legs);
  if (input.coins > 0 && (await walletBalance(userId)) < input.coins) throw new ApiError(400, "You don't have enough coins to offer that amount.");

  const inserted = await supabase.from("rec_trade_block_listings").insert({
    league_id: context.leagueId, team_id: teamId, user_id: userId, discord_id: input.discordId,
    offered_legs: input.legs, offered_coins: input.coins, looking_for: lookingFor, status: "open",
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "We couldn't post to the trade block. Please try again.", inserted.error);

  const [teamName, offerDescription] = await Promise.all([
    teamLabel(context.leagueId, teamId),
    describeLegsForAnnouncement(context.leagueId, input.legs, context.league.game),
  ]);
  const offerLine = [offerDescription !== "nothing" ? offerDescription : null, input.coins > 0 ? `${input.coins} coins` : null].filter(Boolean).join(" + ");
  const channelId = await resolveTradeBlockChannelId(context.leagueId);
  if (channelId) {
    const posted = await postDiscordChannelMessage(channelId, {
      content: "@everyone",
      embeds: [{
        title: "Trade Block",
        color: 0x8855dd,
        description: `**${teamName}** is ISO **${lookingFor}** and is offering: ${offerLine || "nothing yet"}.`,
      }],
      allowed_mentions: { parse: ["everyone"] },
    }).catch((err) => { console.error("[ERROR] Failed to post trade block listing to Discord (non-fatal):", err); return null; });
    if (posted?.id) {
      await supabase.from("rec_trade_block_listings").update({
        discord_message_channel_id: channelId, discord_message_id: posted.id,
      }).eq("id", inserted.data.id);
    }
  }

  return { listing: inserted.data };
}

async function resolveTradeBlockChannelId(leagueId: string): Promise<string> {
  const linked = await findServerRoutesForLeague(leagueId);
  return (linked?.routes?.trade_block_channel_id as string | null | undefined) ?? "";
}

function playerNameFromLeg(leg: LegInput, playersById: Map<string, { fullName: string }>) {
  if (leg.type !== "player") return null;
  const p = playersById.get(leg.playerId);
  return p?.fullName ?? null;
}

export async function listTradeBlockListings(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const listings = await supabase.from("rec_trade_block_listings").select("*")
    .eq("league_id", context.leagueId).eq("status", "open").order("created_at", { ascending: false });
  if (listings.error) throw new ApiError(500, "We couldn't load the trade block right now. Please try again.", listings.error);
  const teamIds = Array.from(new Set<string>((listings.data ?? []).map((l: any) => l.team_id as string)));
  const names = await teamNames(context.leagueId, teamIds);
  // Collect all player IDs from offered legs so we can resolve their names
  const allPlayerIds = new Set<string>();
  (listings.data ?? []).forEach((l: any) => {
    (l.offered_legs ?? []).forEach((leg: any) => {
      if (leg.type === "player" && leg.playerId) allPlayerIds.add(leg.playerId);
    });
  });
  const { data: players, error: playerError } = await supabase.from("rec_players").select("id, full_name").in("id", Array.from(allPlayerIds));
  if (playerError) throw new ApiError(500, "We couldn't load player names. Please try again.", playerError);
  const playersById = new Map<string, { fullName: string }>();
  (players ?? []).forEach((p: any) => playersById.set(p.id, { fullName: p.full_name }));
  return {
    listings: (listings.data ?? []).map((l: any) => ({
      id: l.id,
      teamId: l.team_id,
      teamName: names.get(l.team_id) ?? "A team",
      offeredLegs: l.offered_legs as LegInput[],
      offeredCoins: l.offered_coins,
      lookingFor: l.looking_for,
      createdAt: l.created_at,
      // Include player name lookups so the UI can show names instead of "a player"
      playerNamesById: Object.fromEntries(Array.from(playersById.entries()).map(([k, v]) => [k, v.fullName])),
    })),
  };
}

export async function withdrawTradeBlockListing(input: { guildId: string; discordId: string; listingId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const listing = await supabase.from("rec_trade_block_listings").select("*").eq("id", input.listingId).eq("league_id", context.leagueId).maybeSingle();
  if (listing.error) throw new ApiError(500, "We couldn't load that listing. Please try again.", listing.error);
  if (!listing.data) throw new ApiError(404, "Listing not found.");
  if (listing.data.user_id !== userId) throw new ApiError(403, "You can only withdraw your own trade block listing.");
  const { error } = await supabase.from("rec_trade_block_listings").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", input.listingId);
  if (error) throw new ApiError(500, "We couldn't withdraw that listing. Please try again.", error);
  return { withdrawn: true as const };
}

