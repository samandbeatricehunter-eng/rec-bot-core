import { isPayoutEligibleForGame, REC_END_SEASON_PAYOUTS, evaluatePayoutTier, isEosPayoutEligibleStage, regularSeasonWeeks, type LeagueGame, type RecPayoutTier } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { qualifyDefenseNickname } from "./defense-nicknames.service.js";

type EosPayoutItem = {
  league_id: string;
  user_id: string;
  team_id: string | null;
  season_number: number;
  payout_category: string;
  payout_key: string;
  payout_label: string;
  qualified_tier: string | null;
  qualified_value: number;
  amount: number;
  metadata: Record<string, unknown>;
};

export const TEAM_DEFINITIONS = REC_END_SEASON_PAYOUTS.filter((definition) => definition.scope === "team");
const RANK_DEFINITION = REC_END_SEASON_PAYOUTS.find((definition) => definition.key === "power_ranking_position");

function num(value: unknown) {
  return Number(value) || 0;
}

function jsonNum(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object") return 0;
  return num((raw as Record<string, unknown>)[key]);
}

/** "16:22" -> 982 seconds; a plain jsonNum() would misparse this (strips the colon, giving 1622). */
function jsonClockSeconds(raw: unknown, key: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  const m = value != null ? String(value).match(/^(\d+):(\d{2})$/) : null;
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** "9-12" -> [9, 12]. Falls back to [made-only, null] if the attempts half wasn't recoverable. */
function jsonMadeAttempts(raw: unknown, key: string): [number, number | null] {
  if (!raw || typeof raw !== "object") return [0, null];
  const value = (raw as Record<string, unknown>)[key];
  const m = value != null ? String(value).match(/^(-?\d+)-(-?\d+)$/) : null;
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [num(value), null];
}

export function evalTeamStat(statKey: string, rows: any[]) {
  const games = rows.length;
  const sum = (key: string) => rows.reduce((total, row) => total + num(row[key]), 0);
  const jsonSum = (sourceKey: string, key: string) => rows.reduce((total, row) => total + jsonNum(row[sourceKey], key), 0);
  if (statKey === "points_per_game") return games ? sum("points_for") / games : 0;
  if (statKey === "points_allowed_per_game") return games ? sum("points_against") / games : 0;
  // CFB-only: a team's defensive INTs = its opponent's interceptions_thrown, which
  // recordTeamGameStats already mirrors into this team's defensive_stats JSONB.
  if (statKey === "team_interceptions") return jsonSum("defensive_stats", "interceptions_thrown");
  if (statKey === "total_yards_allowed") return sum("yards_allowed");
  if (statKey === "turnover_differential") return sum("generated_turnovers") - sum("turnovers_committed");
  if (statKey === "total_offense_yards") return sum("total_yards_gained") || sum("off_yards_gained");
  if (statKey === "red_zone_td_rate") {
    const values = rows.map((row) => row.red_zone_off_percentage).filter((value) => value != null).map(num);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  if (statKey === "red_zone_td_rate_allowed") {
    const values = rows.map((row) => row.red_zone_def_percentage).filter((value) => value != null).map(num);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  if (statKey === "avg_time_of_possession_seconds") {
    const values = rows.map((row) => jsonClockSeconds(row.offensive_stats, "time_of_possession")).filter((v): v is number => v != null);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  if (statKey === "total_penalties") return jsonSum("offensive_stats", "penalties");
  if (statKey === "red_zone_td_finish_rate") {
    const tds = jsonSum("offensive_stats", "red_zone_tds");
    const fgs = jsonSum("offensive_stats", "red_zone_fgs");
    return tds + fgs > 0 ? (tds / (tds + fgs)) * 100 : 0;
  }
  if (statKey === "rb_workhorse_score") {
    const attempts = jsonSum("offensive_stats", "off_rush_attempts");
    const tds = jsonSum("offensive_stats", "off_rush_tds");
    const yardsPerRushValues = rows.map((row) => jsonNum(row.offensive_stats, "yards_per_rush")).filter((v) => v > 0);
    const avgYardsPerRush = yardsPerRushValues.length ? yardsPerRushValues.reduce((total, v) => total + v, 0) / yardsPerRushValues.length : 0;
    return attempts / 25 + avgYardsPerRush * 8 + tds * 4;
  }
  if (statKey === "defense_identity_score") {
    const redZoneDefPct = (() => {
      const values = rows.map((row) => row.red_zone_def_percentage).filter((value) => value != null).map(num);
      return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
    })();
    const oppIntsThrown = jsonSum("defensive_stats", "interceptions_thrown");
    const oppFumblesLost = jsonSum("defensive_stats", "fumbles_lost");
    let oppThirdMade = 0, oppThirdAttempts = 0, oppFourthMade = 0, oppFourthAttempts = 0;
    for (const row of rows) {
      const [tm, ta] = jsonMadeAttempts(row.defensive_stats, "third_down_conversions");
      const [fm, fa] = jsonMadeAttempts(row.defensive_stats, "fourth_down_conversions");
      oppThirdMade += tm; if (ta != null) oppThirdAttempts += ta;
      oppFourthMade += fm; if (fa != null) oppFourthAttempts += fa;
    }
    // No recoverable attempts data must never read as a 0% (perfect) allowed rate —
    // that would reward missing OCR data with the max bonus. Skip the term instead.
    const oppThirdPct = oppThirdAttempts > 0 ? (oppThirdMade / oppThirdAttempts) * 100 : null;
    const oppFourthPct = oppFourthAttempts > 0 ? (oppFourthMade / oppFourthAttempts) * 100 : null;

    const redZoneTerm = (redZoneDefPct / 10) * 5;
    const takeawayTerm = games ? ((oppIntsThrown / games) + (oppFumblesLost / games)) * 10 : 0;
    const thirdDownTerm = oppThirdPct != null ? (100 - oppThirdPct) * 10 : 0;
    const fourthDownTerm = oppFourthPct != null ? (100 - oppFourthPct) * 10 : 0;
    return redZoneTerm + takeawayTerm + thirdDownTerm + fourthDownTerm;
  }
  return 0;
}

async function loadOrCreateBatch(guildId: string, leagueId: string, seasonNumber: number, requestedByDiscordId: string) {
  const existing = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("batch_type", "eos_regular_season")
    .neq("status", "cleared")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout batch.", existing.error);
  if (existing.data) return existing.data;

  const creator = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", requestedByDiscordId).maybeSingle();
  const created = await supabase
    .from("rec_eos_payout_batches")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      batch_type: "eos_regular_season",
      status: "draft",
      created_by_user_id: creator.data?.user_id ?? null,
    })
    .select("*")
    .single();
  if (created.error) throw new ApiError(500, "Failed to create EOS payout batch.", created.error);

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildId,
    server_id: null,
    league_id: leagueId,
    season_number: seasonNumber,
    week_number: null,
    queue_type: "eos_payout",
    status: "pending",
    priority: 0,
    header: `EOS Payouts — Season ${seasonNumber}`,
    summary: `End-of-season payout batch created for season ${seasonNumber}.`,
    requester_discord_id: requestedByDiscordId,
    requester_user_id: creator.data?.user_id ?? null,
    amount: null,
    source_table: "rec_eos_payout_batches",
    source_id: created.data.id,
    payload: { batchId: created.data.id, batchType: "eos_regular_season" },
  });

  return created.data;
}

async function buildPowerRankItems(leagueId: string, seasonNumber: number): Promise<EosPayoutItem[]> {
  if (!RANK_DEFINITION) return [];
  const rankRows = await supabase.rpc("rec_eos_rank_payouts", { p_league_id: leagueId, p_season_number: seasonNumber });
  if (rankRows.error) throw new ApiError(500, "Failed to calculate power-ranking EOS payouts.", rankRows.error);
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load EOS team assignments.", assignments.error);
  const teamByUser = new Map((assignments.data ?? []).map((row) => [row.user_id, row.team_id]));

  return (rankRows.data ?? [])
    .filter((row: any) => Number(row.rank_amount ?? 0) > 0)
    .map((row: any) => ({
      league_id: leagueId,
      user_id: row.user_id,
      team_id: teamByUser.get(row.user_id) ?? null,
      season_number: seasonNumber,
      payout_category: "ranking",
      payout_key: `eos:${seasonNumber}:power_rank:${row.user_id}`,
      payout_label: row.rank_label ?? RANK_DEFINITION.label,
      qualified_tier: evaluatePayoutTier(Number(row.rank), RANK_DEFINITION.tiers)?.tier ?? null,
      qualified_value: Number(row.rank),
      amount: Number(row.rank_amount),
      metadata: { rank: Number(row.rank), source: "power_rankings" },
    }));
}

async function buildTeamStatItems(leagueId: string, seasonNumber: number, game: LeagueGame): Promise<EosPayoutItem[]> {
  const stats = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", regularSeasonWeeks(game))
    .not("user_id", "is", null);
  if (stats.error) throw new ApiError(500, "Failed to load EOS team stats.", stats.error);

  const byUser = new Map<string, any[]>();
  for (const row of stats.data ?? []) {
    const rows = byUser.get(row.user_id) ?? [];
    rows.push(row);
    byUser.set(row.user_id, rows);
  }

  const items: EosPayoutItem[] = [];
  for (const [userId, rows] of byUser.entries()) {
    const teamId = rows.find((row) => row.team_id)?.team_id ?? null;
    for (const definition of TEAM_DEFINITIONS.filter((d) => isPayoutEligibleForGame(d, game))) {
      const value = evalTeamStat(definition.statKey, rows);
      const tier = evaluatePayoutTier(value, definition.tiers);
      if (!tier) continue;
      items.push({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        season_number: seasonNumber,
        payout_category: "team",
        payout_key: `eos:${seasonNumber}:${definition.key}:${userId}`,
        payout_label: definition.label,
        qualified_tier: tier.tier,
        qualified_value: Math.round(value * 100) / 100,
        amount: tier.amount,
        metadata: { statKey: definition.statKey, games: rows.length },
      });
    }
  }
  return items;
}

// Shared by the commissioner-triggered `prepareEosPayouts` (which gates on season stage)
// and the automatic advance-time trigger (which already knows it's the right moment and
// would otherwise re-fetch a season_stage that's already flipped past eligible — see
// autoPrepareEosPayouts below). Safe to call repeatedly: only replaces items still "pending",
// never touches ones already approved/issued/denied.
async function prepareEosPayoutsForLeague(guildId: string, leagueId: string, game: LeagueGame, seasonNumber: number, requestedByDiscordId: string) {
  const batch = await loadOrCreateBatch(guildId, leagueId, seasonNumber, requestedByDiscordId);
  const existingIssued = await supabase
    .from("rec_eos_payout_items")
    .select("id")
    .eq("batch_id", batch.id)
    .in("status", ["approved", "issued"])
    .limit(1);
  if (existingIssued.error) throw new ApiError(500, "Failed to check existing EOS payout items.", existingIssued.error);

  const items = [...await buildPowerRankItems(leagueId, seasonNumber), ...await buildTeamStatItems(leagueId, seasonNumber, game)];
  if (!(existingIssued.data ?? []).length) {
    await supabase.from("rec_eos_payout_items").delete().eq("batch_id", batch.id).eq("status", "pending");
    if (items.length) {
      const insert = await supabase.from("rec_eos_payout_items").upsert(
        items.map((item) => ({ ...item, batch_id: batch.id, status: "pending" })),
        { onConflict: "batch_id,payout_key" },
      );
      if (insert.error) throw new ApiError(500, "Failed to save EOS payout items.", insert.error);
    }
  }

  return listEosPayoutBatch(batch.id);
}

export async function prepareEosPayouts(input: { guildId: string; requestedByDiscordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  if (!isEosPayoutEligibleStage(currentStage, context.rec_leagues.game)) {
    throw new ApiError(400, "EOS payouts are only available during the postseason (after the regular season ends, through the championship game).");
  }
  const seasonNumber = resolveSeasonNumber(context);
  return prepareEosPayoutsForLeague(input.guildId, context.leagueId, context.rec_leagues.game, seasonNumber, input.requestedByDiscordId);
}

// Called from completeAdvanceWeek once postseason play ends (Madden: advancing out of the
// terminal stage into the offseason) or, for CFB — which has no offseason stages yet — once
// the league advances past week 16. Re-runs on every subsequent advance past that point too,
// so the ledger keeps reflecting the latest playoff results until a commissioner approves it.
export async function autoPrepareEosPayouts(input: { guildId: string; leagueId: string; game: LeagueGame; seasonNumber: number; requestedByDiscordId: string }) {
  return prepareEosPayoutsForLeague(input.guildId, input.leagueId, input.game, input.seasonNumber, input.requestedByDiscordId);
}

// Wipes every not-yet-issued item off the league's current EOS batch, clears its
// commissioner-inbox entry, and immediately recalculates a fresh batch — for when a
// league-wide data issue means the open ledgers can't be trusted. Already-issued items
// (money already paid out) are left untouched.
export async function wipeAndRerunEosLedger(input: { guildId: string; requestedByDiscordId: string; reason: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const reviewer = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.requestedByDiscordId).maybeSingle();

  const existing = await supabase
    .from("rec_eos_payout_batches")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("batch_type", "eos_regular_season")
    .neq("status", "cleared");
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout batches to clear.", existing.error);
  const batchIds = (existing.data ?? []).map((row) => row.id);

  if (batchIds.length) {
    const now = new Date().toISOString();
    const cleared = await supabase
      .from("rec_eos_payout_batches")
      .update({ status: "cleared", cleared_by_user_id: reviewer.data?.user_id ?? null, clear_reason: input.reason, cleared_at: now, updated_at: now })
      .in("id", batchIds);
    if (cleared.error) throw new ApiError(500, "Failed to clear EOS payout batches.", cleared.error);

    const removedItems = await supabase.from("rec_eos_payout_items").delete().in("batch_id", batchIds).in("status", ["pending", "denied"]);
    if (removedItems.error) throw new ApiError(500, "Failed to wipe pending EOS payout items.", removedItems.error);

    const inboxCleared = await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "cleared", reviewed_by_discord_id: input.requestedByDiscordId, review_reason: input.reason, reviewed_at: now })
      .eq("source_table", "rec_eos_payout_batches")
      .in("source_id", batchIds)
      .eq("status", "pending");
    if (inboxCleared.error) throw new ApiError(500, "Failed to clear the EOS payout inbox entry.", inboxCleared.error);
  }

  return prepareEosPayoutsForLeague(input.guildId, context.leagueId, context.rec_leagues.game, seasonNumber, input.requestedByDiscordId);
}

export async function projectEosPayouts(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const items = [...await buildPowerRankItems(context.leagueId, seasonNumber), ...await buildTeamStatItems(context.leagueId, seasonNumber, context.rec_leagues.game)];
  const withDiscord = await attachPayeeDiscordIds(items);
  const totalAmount = withDiscord.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return {
    league: {
      id: context.leagueId,
      seasonNumber,
      currentWeek: Number(context.rec_leagues.current_week ?? 1),
      seasonStage: context.rec_leagues.season_stage ?? "regular_season",
    },
    items: withDiscord,
    totalAmount,
  };
}

async function attachPayeeDiscordIds(items: any[]): Promise<any[]> {
  const userIds = [...new Set(items.map((item) => item.user_id).filter(Boolean))];
  if (!userIds.length) return items.map((item) => ({ ...item, payee_discord_id: null }));
  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds);
  const discordByUser = new Map((accounts.data ?? []).map((row) => [row.user_id, row.discord_id]));
  return items.map((item) => ({ ...item, payee_discord_id: discordByUser.get(item.user_id) ?? null }));
}

export async function listEosPayoutBatch(batchId: string) {
  const batch = await supabase.from("rec_eos_payout_batches").select("*").eq("id", batchId).maybeSingle();
  if (batch.error) throw new ApiError(500, "Failed to load EOS payout batch.", batch.error);
  if (!batch.data) throw new ApiError(404, "EOS payout batch was not found.");
  const items = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", batchId)
    .order("payout_category", { ascending: true })
    .order("amount", { ascending: false });
  if (items.error) throw new ApiError(500, "Failed to load EOS payout items.", items.error);
  const withDiscord = await attachPayeeDiscordIds(items.data ?? []);
  const totalAmount = withDiscord.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return { batch: batch.data, items: withDiscord, totalAmount };
}

// Approve or deny ALL of one coach's pending EOS items in a batch, so the bot
// can post a single per-coach review embed. Returns the processed items (with
// labels/tiers/values) and the coach's Discord id for the payout DM.
export async function reviewEosPayoutsForUser(input: {
  batchId: string;
  userId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
}) {
  const pending = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", input.batchId)
    .eq("user_id", input.userId)
    .eq("status", "pending");
  if (pending.error) throw new ApiError(500, "Failed to load EOS payout items for coach.", pending.error);

  // Each item touches a distinct row and a distinct wallet-ledger idempotency key
  // (itemId-scoped), so reviewing a coach's items is safe to run in parallel.
  const outcomes = await Promise.all((pending.data ?? []).map(async (item) => {
    try {
      const result = await reviewEosPayoutItem({
        itemId: item.id,
        action: input.action,
        reviewedByDiscordId: input.reviewedByDiscordId,
        deniedReason: input.deniedReason,
      });
      return result.updated ? { ok: true as const, item: result.item } : null;
    } catch (error) {
      return { ok: false as const, itemId: item.id, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const processed = outcomes.filter((o): o is { ok: true; item: any } => o?.ok === true).map((o) => o.item);
  const failed = outcomes.filter((o): o is { ok: false; itemId: string; error: string } => o?.ok === false);

  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.userId).maybeSingle();
  const payeeDiscordId = account.data?.discord_id ?? null;
  const totalAmount = processed.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);

  if (payeeDiscordId && processed.length) {
    const dm = input.action === "approve"
      ? [
          "**Your EOS payout ledger was approved.**",
          "",
          ...processed.map((item) => `- ${item.payout_label}${item.qualified_tier ? ` (Tier ${item.qualified_tier})` : ""}: $${Number(item.amount ?? 0)}`),
          "",
          `**Total: $${totalAmount}** — sent to your wallet.`,
          `Approved by <@${input.reviewedByDiscordId}>.`,
        ].join("\n")
      : [
          "**Your EOS payout ledger was rejected.**",
          "",
          `Reason: ${input.deniedReason ?? "No reason given."}`,
          `Reviewed by <@${input.reviewedByDiscordId}>.`,
        ].join("\n");
    await sendDiscordDirectMessage(payeeDiscordId, dm).catch((error) => {
      console.error("[ERROR] Failed to DM EOS payout review outcome (non-fatal):", error);
    });
  }

  return { action: input.action, userId: input.userId, payeeDiscordId, items: processed, failed, totalAmount };
}

export async function reviewEosPayoutItem(input: { itemId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const existing = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout item.", existing.error);
  if (!existing.data) throw new ApiError(404, "EOS payout item was not found.");
  if (existing.data.status !== "pending") return { updated: false, reason: `Item is already ${existing.data.status}.`, item: existing.data };

  const reviewer = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.reviewedByDiscordId).maybeSingle();
  if (input.action === "deny") {
    const denied = await supabase
      .from("rec_eos_payout_items")
      .update({
        status: "denied",
        denied_by_user_id: reviewer.data?.user_id ?? null,
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        denied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.itemId)
      .select("*")
      .single();
    if (denied.error) throw new ApiError(500, "Failed to deny EOS payout item.", denied.error);
    return { updated: true, item: denied.data };
  }

  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: existing.data.user_id,
    p_amount: Number(existing.data.amount ?? 0),
    p_league_id: existing.data.league_id,
    p_description: `EOS payout - ${existing.data.payout_label}`,
    p_transaction_type: "eos_payout",
    p_source: "eos",
    p_source_reference: { itemId: existing.data.id, batchId: existing.data.batch_id, payoutKey: existing.data.payout_key },
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue EOS payout.", ledger.error);

  const issued = await supabase
    .from("rec_eos_payout_items")
    .update({
      status: "issued",
      approved_by_user_id: reviewer.data?.user_id ?? null,
      issued_ledger_id: ledger.data,
      approved_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.itemId)
    .select("*")
    .single();
  if (issued.error) throw new ApiError(500, "Failed to mark EOS payout issued.", issued.error);

  if (issued.data.payout_key === "defense_needs_a_name" && issued.data.team_id) {
    await qualifyDefenseNickname({
      leagueId: issued.data.league_id, teamId: issued.data.team_id, userId: issued.data.user_id, seasonNumber: issued.data.season_number,
    }).catch((error) => console.error("[ERROR] qualifyDefenseNickname failed after EOS payout issue (non-fatal):", error));
  }

  return { updated: true, item: issued.data };
}

export async function issueEosPayoutBatch(input: { batchId: string; reviewedByDiscordId: string }) {
  const batch = await listEosPayoutBatch(input.batchId);
  const pending = batch.items.filter((item: any) => item.status === "pending");
  // Each item touches a distinct row and a distinct wallet-ledger idempotency key
  // (itemId-scoped), so issuing a whole batch is safe to run in parallel.
  const outcomes = await Promise.all(pending.map(async (item: any) => {
    try {
      const result = await reviewEosPayoutItem({ itemId: item.id, action: "approve", reviewedByDiscordId: input.reviewedByDiscordId });
      return { ok: true as const, item: result.item };
    } catch (error) {
      return { ok: false as const, itemId: item.id, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const issued = outcomes.filter((o) => o.ok).map((o: any) => o.item);
  const failed = outcomes.filter((o) => !o.ok);
  const refreshed = await listEosPayoutBatch(input.batchId);
  const issuedItems = await attachPayeeDiscordIds(issued);
  const stillPending = refreshed.items.filter((item: any) => item.status === "pending").length;
  await supabase
    .from("rec_eos_payout_batches")
    .update({
      status: failed.length ? "failed" : stillPending ? "partially_approved" : "issued",
      issued_at: failed.length ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.batchId);

  if (!failed.length && !stillPending) {
    const now = new Date().toISOString();
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
      .eq("source_table", "rec_eos_payout_batches")
      .eq("source_id", input.batchId);
  }

  return { ...refreshed, issuedCount: issued.length, issuedItems, failed };
}

function definitionForItem(item: { payout_category: string; payout_key: string }) {
  if (item.payout_category === "ranking") return RANK_DEFINITION ?? null;
  const key = String(item.payout_key ?? "").split(":")[2];
  return TEAM_DEFINITIONS.find((d) => d.key === key) ?? null;
}

// Lets a commissioner bump a single line item to a different tier (or clear its payout
// entirely) before approving the ledger — e.g. a stat was miscounted, or the league wants
// to award a courtesy tier bump. Amount is always recomputed from the chosen tier's rule,
// never entered freehand, so it can't drift from the published payout table.
export async function adjustEosPayoutItem(input: { itemId: string; tier: RecPayoutTier | null; actorDiscordId: string }) {
  const existing = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout item.", existing.error);
  if (!existing.data) throw new ApiError(404, "EOS payout item was not found.");
  if (existing.data.status !== "pending") throw new ApiError(400, "Only pending items can be adjusted.");

  const definition = definitionForItem(existing.data);
  if (!definition) throw new ApiError(400, "Could not resolve the payout tier table for this item.");

  let amount = 0;
  if (input.tier) {
    const rule = definition.tiers.find((t) => t.tier === input.tier);
    if (!rule) throw new ApiError(400, "That tier isn't valid for this payout.");
    amount = rule.amount;
  }

  const updated = await supabase
    .from("rec_eos_payout_items")
    .update({ qualified_tier: input.tier, amount, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to adjust EOS payout item.", updated.error);
  return { item: updated.data };
}

export type EosLedgerLineItem = {
  id: string;
  payoutCategory: string;
  payoutLabel: string;
  qualifiedTier: string | null;
  qualifiedValue: number;
  amount: number;
  availableTiers: Array<{ tier: string; amount: number; threshold: number; operator: string }>;
};

export type EosLedger = {
  userId: string;
  displayName: string;
  teamName: string | null;
  discordId: string | null;
  items: EosLedgerLineItem[];
  total: number;
};

// The commissioner "Pending Payouts" inbox — every linked user's still-pending items on the
// league's current (not cleared) EOS batch, grouped into one collapsible receipt per user
// with a grand total, plus each line's other selectable tiers for in-place adjustment.
export async function listPendingEosLedgers(guildId: string): Promise<{ batch: any; ledgers: EosLedger[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const batch = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("batch_type", "eos_regular_season")
    .neq("status", "cleared")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (batch.error) throw new ApiError(500, "Failed to load the EOS payout batch.", batch.error);
  if (!batch.data) return { batch: null, ledgers: [] };

  const items = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", batch.data.id)
    .eq("status", "pending")
    .order("payout_category", { ascending: true })
    .order("amount", { ascending: false });
  if (items.error) throw new ApiError(500, "Failed to load EOS payout items.", items.error);

  const userIds = [...new Set((items.data ?? []).map((item) => item.user_id))];
  const [accounts, users, assignments] = await Promise.all([
    userIds.length ? supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : Promise.resolve({ data: [] as any[], error: null }),
    userIds.length ? supabase.from("rec_users").select("id,display_name").in("id", userIds) : Promise.resolve({ data: [] as any[], error: null }),
    userIds.length
      ? supabase.from("rec_team_assignments").select("user_id,team:rec_teams(name)").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null).in("user_id", userIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const discordByUser = new Map<string, string | null>((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  const nameByUser = new Map<string, string>((users.data ?? []).map((row: any) => [row.id, row.display_name]));
  const teamByUser = new Map<string, string | null>((assignments.data ?? []).map((row: any) => [row.user_id, Array.isArray(row.team) ? row.team[0]?.name : row.team?.name]));

  const byUser = new Map<string, EosLedgerLineItem[]>();
  for (const item of items.data ?? []) {
    const rows = byUser.get(item.user_id) ?? [];
    rows.push({
      id: item.id,
      payoutCategory: item.payout_category,
      payoutLabel: item.payout_label,
      qualifiedTier: item.qualified_tier,
      qualifiedValue: Number(item.qualified_value ?? 0),
      amount: Number(item.amount ?? 0),
      availableTiers: (definitionForItem(item)?.tiers ?? []).map((t) => ({ tier: t.tier, amount: t.amount, threshold: t.threshold, operator: t.operator })),
    });
    byUser.set(item.user_id, rows);
  }

  const ledgers: EosLedger[] = [...byUser.entries()]
    .map(([userId, lineItems]) => ({
      userId,
      displayName: nameByUser.get(userId) ?? "REC Member",
      teamName: teamByUser.get(userId) ?? null,
      discordId: discordByUser.get(userId) ?? null,
      items: lineItems,
      total: lineItems.reduce((sum, item) => sum + item.amount, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return { batch: batch.data, ledgers };
}
