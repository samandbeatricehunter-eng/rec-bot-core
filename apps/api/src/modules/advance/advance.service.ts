import { REC_GOTW_CORRECT_GUESS_PAYOUT, REC_POTW_PAYOUT_AMOUNT, calculateDefensivePotwScore, calculateOffensivePotwScore, readStat } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { calculateAdvanceGamePayouts } from "./advance-payouts.service.js";
import { assignWeeklyBadges, assignSeasonEndBadges, assignPlayoffBadges } from "./advance-badges.service.js";
import { generateWeeklyChallenges, getChallengeAudit, evaluateWeeklyChallenges } from "./advance-challenges.service.js";
import { applyAdvanceRecords, auditAndRepairRecords } from "./advance-records.service.js";

const TIME_ZONES = [
  ["EST", "America/New_York"],
  ["CST", "America/Chicago"],
  ["PST", "America/Los_Angeles"],
  ["AKST", "America/Anchorage"]
] as const;

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickStat(stats: any, keys: string[]) {
  for (const key of keys) {
    if (stats?.[key] !== undefined && stats?.[key] !== null) return asNumber(stats[key]);
  }
  return 0;
}

export function formatAdvanceTimes(nextAdvanceAt?: string | null) {
  if (!nextAdvanceAt) return [];
  const date = new Date(nextAdvanceAt);
  if (Number.isNaN(date.getTime())) return [];
  return TIME_ZONES.map(([label, timeZone]) => ({
    label,
    value: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short"
    }).format(date)
  }));
}

// League teams are stored with full names ("Jacksonville Jaguars"); game channels and matchup
// text should use just the nickname ("Jaguars"). The nickname is the trailing word of the name.
function teamNickname(name: string | null | undefined, fallback: string) {
  const text = (name ?? "").trim();
  if (!text) return fallback;
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] || fallback;
}

function humanizeFourthDownRule(type: string | null | undefined, custom: string | null | undefined) {
  if (!type) return "Use league settings.";
  if (type === "custom") return custom?.trim() || "Custom league fourth-down rule (see league rules).";
  if (type === "standard_rec") return "Standard REC Rule: past midfield on 4th & 3 or less. If trailing in the second half, you may go for it on any 4th down.";
  if (type === "none") return "No 4th down restrictions.";
  const text = type.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function streamingRequirementText(requirement: string | null | undefined) {
  if (requirement === "required") return "Streaming is required for this game.";
  if (requirement === "optional") return "Streaming is optional for this game.";
  if (requirement === "not_required") return "Streaming is not required for this game.";
  return "Based on league settings";
}

function nextWeekStage(currentWeek: number, currentStage: string) {
  const weekNumber = currentStage === "preseason_training_camp" ? 1 : currentWeek + 1;
  const seasonStage =
    currentStage === "regular_season" && weekNumber >= 19 ? "wild_card"
    : currentStage === "wild_card" ? "divisional"
    : currentStage === "divisional" ? "conference_championship"
    : currentStage === "conference_championship" ? "super_bowl"
    : currentStage === "super_bowl" ? "coach_hiring"
    : currentStage === "coach_hiring" ? "final_resigning"
    : currentStage === "final_resigning" ? "free_agency"
    : currentStage === "free_agency" ? "draft"
    : currentStage === "draft" ? "preseason_training_camp"
    : currentStage === "preseason_training_camp" ? "regular_season"
    : currentStage;
  return { weekNumber, seasonStage };
}

function payoutWeekNumber(payout: any) {
  return asNumber(payout?.source_reference?.weekNumber ?? payout?.source_reference?.week);
}

function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function getLeagueConfiguration(leagueId: string) {
  const { data } = await supabase.from("rec_league_configuration").select("*").eq("league_id", leagueId).maybeSingle();
  return (data ?? null) as any;
}

async function resolveDiscordIdsByUser(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", ids);
  for (const row of data ?? []) if (row.user_id && row.discord_id) map.set(String(row.user_id), String(row.discord_id));
  return map;
}

const BADGE_QUALIFIERS: Record<string, string> = {
  comeback_artist: "winning after a 3+ game losing streak",
  record_breaker_wins: "breaking the league's all-time wins record",
  record_breaker_point_differential: "breaking the league's all-time point differential record",
  record_breaker_points_for: "breaking the league's all-time points scored record",
  record_holder_wins: "permanently holding the league's all-time wins record",
  record_holder_point_differential: "permanently holding the league's all-time point differential record",
  record_holder_points_for: "permanently holding the league's all-time points scored record",
  undefeated: "going 17-0 through an undefeated regular season",
  dominant: "finishing the regular season with an 80%+ win rate",
  winning_season: "finishing the regular season with more wins than losses",
  scoring_leader: "leading the league in total points scored",
  high_octane: "averaging 40+ points per game",
  blowout_master: "winning 50%+ of games by 21+ points",
  shutout_king: "holding opponents scoreless 3+ times",
  closer: "winning 50%+ of games by 7 or fewer points",
  defensive_powerhouse: "allowing the fewest points in the league",
  h2h_dominator: "going undefeated in all head-to-head matchups",
  h2h_specialist: "maintaining an 85%+ win rate in H2H matchups",
  road_warrior: "going undefeated on the road this season",
  home_fortress: "going undefeated at home this season",
  cardiac_cats: "winning 6+ games by one score or fewer",
  offensive_juggernaut: "finishing in the top 3 in scoring offense",
  defensive_anchor: "finishing in the top 3 in scoring defense",
  playoff_qualifier: "qualifying for the playoffs",
  wild_card_survivor: "winning the Wild Card round",
  conference_champion: "winning the Conference Championship",
  playoff_warrior: "earning 3+ playoff wins in a single postseason",
  perfect_playoff_run: "winning the Super Bowl without a single playoff loss",
  sb_champion: "winning the Super Bowl",
  sb_runner_up: "finishing as Super Bowl runner-up",
  air_raid: "throwing for 400+ yards with 4+ TDs in a win",
  ground_assault: "rushing for 200+ yards in a win",
  balanced_offense_week: "throwing for 250+ and rushing for 150+ yards in a win",
  turnover_machine: "forcing 3+ turnovers in a win",
  sack_artist: "recording 5+ sacks in a win",
  lockdown_week: "holding the opponent to 150 or fewer passing yards in a win"
};

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "game";
}

async function findLeagueContext(guildId: string) {
  const serverResult = await supabase.from("rec_discord_servers").select("id,name,guild_id").eq("guild_id", guildId).maybeSingle();
  if (serverResult.error) throw serverResult.error;
  if (!serverResult.data) return null;
  const linkResult = await supabase.from("rec_server_league_links").select("server_id, league_id").eq("server_id", serverResult.data.id).limit(1).maybeSingle();
  if (linkResult.error) throw linkResult.error;
  if (!linkResult.data?.league_id) return null;
  const leagueResult = await supabase.from("rec_leagues").select("*").eq("id", linkResult.data.league_id).maybeSingle();
  if (leagueResult.error) throw leagueResult.error;
  if (!leagueResult.data) return null;
  return { server_id: serverResult.data.id, league_id: linkResult.data.league_id, rec_discord_servers: serverResult.data, rec_leagues: leagueResult.data } as any;
}

async function getLeagueContext(guildId: string) {
  const context = await findLeagueContext(guildId);
  if (!context) throw new Error("No REC league is set up for this Discord server.");
  return context;
}

async function getRoutes(serverId: string) {
  const { data, error } = await supabase.from("rec_server_routes").select("*").eq("server_id", serverId).maybeSingle();
  if (error) throw error;
  return data as any;
}

function nowIso() { return new Date().toISOString(); }

async function getGuildIdForServer(serverId?: string | null) {
  if (!serverId) return null;
  const { data, error } = await supabase.from("rec_discord_servers").select("guild_id").eq("id", serverId).maybeSingle();
  if (error) throw error;
  return data?.guild_id ?? null;
}

async function upsertCommissionersInboxItem(input: {
  guildId: string;
  serverId: string;
  leagueId: string;
  seasonNumber?: number | null;
  weekNumber?: number | null;
  queueType: string;
  status?: "pending" | "approved" | "denied" | "cancelled" | "expired" | "resolved";
  priority?: number;
  header: string;
  summary?: string | null;
  requesterUserId?: string | null;
  requesterDiscordId?: string | null;
  targetUserId?: string | null;
  targetDiscordId?: string | null;
  teamId?: string | null;
  amount?: number | null;
  sourceTable: string;
  sourceId: string;
  sourceReference?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .upsert({
      guild_id: input.guildId,
      server_id: input.serverId,
      league_id: input.leagueId,
      season_number: input.seasonNumber ?? null,
      week_number: input.weekNumber ?? null,
      queue_type: input.queueType,
      status: input.status ?? "pending",
      priority: input.priority ?? 0,
      header: input.header,
      summary: input.summary ?? null,
      requester_user_id: input.requesterUserId ?? null,
      requester_discord_id: input.requesterDiscordId ?? null,
      target_user_id: input.targetUserId ?? null,
      target_discord_id: input.targetDiscordId ?? null,
      team_id: input.teamId ?? null,
      amount: input.amount ?? null,
      source_table: input.sourceTable,
      source_id: input.sourceId,
      source_reference: input.sourceReference ?? {},
      payload: input.payload ?? {},
      updated_at: nowIso()
    }, { onConflict: "guild_id,queue_type,source_table,source_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function updateCommissionersInboxBySource(input: {
  guildId?: string | null;
  queueType: string;
  sourceTable: string;
  sourceId: string;
  patch: Record<string, unknown>;
}) {
  let query = supabase
    .from("rec_commissioners_inbox")
    .update({ ...input.patch, updated_at: nowIso() })
    .eq("queue_type", input.queueType)
    .eq("source_table", input.sourceTable)
    .eq("source_id", input.sourceId);
  if (input.guildId) query = query.eq("guild_id", input.guildId);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordCommissionersInboxMessage(input: { inboxId: string; discordChannelId: string; discordMessageId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({
      review_channel_id: input.discordChannelId,
      review_message_id: input.discordMessageId,
      updated_at: nowIso()
    })
    .eq("id", input.inboxId)
    .select("*")
    .single();
  if (error) throw error;
  return { recorded: true, inbox: data };
}

function deadlineDisplay(date: Date) {
  return Object.fromEntries(formatAdvanceTimes(date.toISOString()).map((time) => [time.label, time.value]));
}

async function getDiscordIdForUserId(userId?: string | null) {
  if (!userId) return null;
  const { data } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  return data?.discord_id ?? null;
}

async function getLinkedActiveTeamUsers(leagueId: string) {
  const { data, error } = await supabase.from("rec_team_assignments").select("team_id,user_id,rec_teams(id,name,abbreviation,conference,division)").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as any[];
}

async function getWalletBalance(userId: string) {
  const { data } = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", userId).maybeSingle();
  return { wallet: asNumber(data?.wallet_balance), savings: asNumber(data?.savings_balance) };
}

// GOTW Sophisticated Scoring System
// Used for: GOTW selection, strength of schedule, power rankings
async function calculateUserPowerRanking(userId: string, leagueId: string, seasonNumber: number) {
  const { data: record } = await supabase
    .from("rec_league_user_records")
    .select("wins,losses,ties,point_differential,games_played")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!record || record.games_played === 0) return { ranking: 0.5, wins: 0, losses: 0, pd: 0 };

  const winPct = record.wins / record.games_played;
  const avgPd = record.point_differential / record.games_played;

  // Simple power ranking: (win% * 0.7 + normalized PD * 0.3)
  // Normalized PD: +5 per point (so 10 PD per game = +0.5 boost)
  const pdBoost = Math.max(-0.3, Math.min(0.3, avgPd / 30));
  const ranking = (winPct * 0.7) + (0.5 + pdBoost * 0.3);

  return {
    ranking: Math.max(0, Math.min(1, ranking)),
    wins: record.wins,
    losses: record.losses,
    pd: record.point_differential,
    winPct,
    avgPd
  };
}

async function calculateH2hHistory(userId1: string, userId2: string) {
  const ids = [userId1, userId2].sort();
  const { data } = await supabase
    .from("rec_user_h2h_global_records")
    .select("wins,losses,ties,pointDifferential")
    .eq("user_a_id", ids[0])
    .eq("user_b_id", ids[1])
    .maybeSingle();

  if (!data) return { history: null, recency: null };

  const totalGames = (data.wins ?? 0) + (data.losses ?? 0) + (data.ties ?? 0);
  return {
    history: { wins: data.wins ?? 0, losses: data.losses ?? 0, ties: data.ties ?? 0, pd: data.pointDifferential ?? 0 },
    competitiveness: totalGames > 0 ? Math.abs(data.pointDifferential ?? 0) / totalGames : 0
  };
}

async function calculateMatchupStrength(game: any, leagueId: string, seasonNumber: number, weekNumber: number) {
  const homeRanking = await calculateUserPowerRanking(game.home_user_id, leagueId, seasonNumber);
  const awayRanking = await calculateUserPowerRanking(game.away_user_id, leagueId, seasonNumber);
  const h2hHistory = await calculateH2hHistory(game.home_user_id, game.away_user_id);

  // Matchup competitiveness: how close the teams are in power ranking
  const rankingDiff = Math.abs(homeRanking.ranking - awayRanking.ranking);
  const competitiveness = 1 - Math.min(1, rankingDiff * 2); // Closer rankings = more competitive

  // Calculate strength of schedule (quality of wins)
  const sosBoost = ((homeRanking.wins + awayRanking.wins) / Math.max(1, weekNumber + 1)) * 0.1;

  // Recent history (H2H competitiveness boost if they've played close games)
  const h2hBoost = h2hHistory.history ? (1 - h2hHistory.competitiveness / 50) * 0.15 : 0;

  // Division game bonus (if applicable)
  const divisionBonus = game.home_team?.division === game.away_team?.division ? 0.2 : 0;

  // Calculate overall strength rating (0-100 scale)
  const baseScore = 50;
  const powerScore = (homeRanking.ranking + awayRanking.ranking) / 2 * 30;
  const competitiveScore = competitiveness * 20;
  const totalScore = baseScore + powerScore + competitiveScore + (sosBoost * 10) + (h2hBoost * 5) + (divisionBonus * 10);

  return {
    strengthRating: Math.min(100, Math.max(0, totalScore)),
    homeRanking,
    awayRanking,
    competitiveness,
    h2hHistory,
    details: {
      powerScore,
      competitiveScore,
      sosBoost,
      h2hBoost,
      divisionBonus
    }
  };
}

export async function creditUserWallet(input: {
  userId: string;
  leagueId: string;
  seasonNumber: number;
  amount: number;
  transactionType: string;
  description: string;
  sourceReference: Record<string, unknown>;
}) {
  if (!input.amount) return { ledger: null, wallet: await getWalletBalance(input.userId), created: false };

  const idempotencyKey = String(input.sourceReference.idempotencyKey ?? "");
  if (idempotencyKey) {
    const existing = await supabase
      .from("rec_dollar_ledger")
      .select("*")
      .eq("user_id", input.userId)
      .eq("transaction_type", input.transactionType)
      .contains("source_reference", { idempotencyKey })
      .maybeSingle();
    if (existing.data) return { ledger: existing.data, wallet: await getWalletBalance(input.userId), created: false };
  }

  const { data: currentWallet, error: walletReadError } = await supabase
    .from("rec_wallets")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (walletReadError) throw walletReadError;

  if (currentWallet) {
    // rec_wallets is keyed by user_id — it has no id column.
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .update({ wallet_balance: asNumber(currentWallet.wallet_balance) + input.amount, updated_at: nowIso() })
      .eq("user_id", input.userId);
    if (walletError) throw walletError;
  } else {
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .insert({ user_id: input.userId, wallet_balance: input.amount, savings_balance: 0 });
    if (walletError) throw walletError;
  }

  const { data: ledger, error: ledgerError } = await supabase.from("rec_dollar_ledger").insert({
    user_id: input.userId,
    league_id: input.leagueId,
    season_id: null,
    amount: input.amount,
    transaction_type: input.transactionType,
    description: input.description,
    source: "internal_import",
    source_reference: input.sourceReference
  }).select("*").single();
  if (ledgerError) throw ledgerError;

  return { ledger, wallet: await getWalletBalance(input.userId), created: true };
}

export async function viewLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { league: context.rec_leagues, server: context.rec_discord_servers };
}

async function getLeagueFeatureSettings(leagueId: string) {
  const { data, error } = await supabase.from("rec_league_feature_settings").select("*").eq("league_id", leagueId).maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function setNextAdvance(input: { guildId: string; nextAdvanceAt: string; timezone?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const when = new Date(input.nextAdvanceAt);
  if (Number.isNaN(when.getTime())) throw new Error("Invalid next advance time.");
  const { data, error } = await supabase
    .from("rec_leagues")
    .update({ next_advance_at: when.toISOString(), next_advance_timezone: input.timezone ?? null, updated_at: new Date().toISOString() })
    .eq("id", context.league_id)
    .select("*")
    .single();
  if (error) throw error;
  return { league: data, nextAdvanceTimes: formatAdvanceTimes(data.next_advance_at) };
}

export async function setLeagueWeek(input: { guildId: string; seasonNumber?: number; weekNumber: number; seasonStage: string; markAdvanced?: boolean }) {
  const context = await getLeagueContext(input.guildId);
  const currentLeague = context.rec_leagues;
  const seasonNumber = input.seasonNumber ?? currentLeague.season_number ?? currentLeague.display_season_number ?? 1;

  const patch: Record<string, unknown> = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    current_phase: (
      input.seasonStage === "regular_season" ? "regular_season"
      : input.seasonStage === "preseason_training_camp" ? "preseason"
      : input.seasonStage === "coach_hiring" ? "coach_hiring_period"
      : input.seasonStage === "final_resigning" ? "offseason"
      : input.seasonStage === "free_agency" ? "free_agency_stage_1"
      : input.seasonStage === "draft" ? "draft"
      : ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(input.seasonStage) ? "playoffs"
      : "offseason"
    ),
    updated_at: new Date().toISOString()
  };
  if (input.markAdvanced) patch.last_advanced_at = new Date().toISOString();
  if (input.seasonNumber) patch.season_number = input.seasonNumber;
  const { data, error } = await supabase.from("rec_leagues").update(patch).eq("id", context.league_id).select("*").single();
  if (error) throw error;

  const previousStage = currentLeague.season_stage;
  let transitionBadgesEarned: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];
  let transitionBadgesRemoved: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];

  if (previousStage === "regular_season" && input.seasonStage !== "regular_season") {
    try {
      const result = await assignSeasonEndBadges(context.league_id, seasonNumber);
      transitionBadgesEarned = result.earned ?? [];
    } catch {
      // Non-fatal
    }
  }

  if (previousStage === "super_bowl" && input.seasonStage === "coach_hiring") {
    try {
      const result = await assignPlayoffBadges(context.league_id, seasonNumber);
      transitionBadgesEarned = [...transitionBadgesEarned, ...(result.earned ?? [])];
      transitionBadgesRemoved = result.removed ?? [];
    } catch {
      // Non-fatal
    }
  }

  const features = await getLeagueFeatureSettings(context.league_id);
  const economyEnabled = Boolean(features?.coin_economy_enabled);
  const warning = economyEnabled
    ? "Economy is active. Setting the week manually does not trigger payouts for previous weeks. To catch up prior weeks, import and advance each week using catch-up mode."
    : null;
  return { league: data, warning, economyEnabled, transitionBadgesEarned, transitionBadgesRemoved };
}

export async function viewEconomyConfig(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { routes: await getRoutes(context.server_id), league: context.rec_leagues };
}

export async function setEconomyConfig(input: { guildId: string; pendingEconomyChannelId?: string; pendingPayoutsChannelId?: string; gameChannelsCategoryId?: string; commissionerOfficeChannelId?: string; streamsChannelId?: string; highlightsChannelId?: string; announcementsChannelId?: string; votingPollsChannelId?: string; commissionerRoleId?: string; compCommitteeRoleId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = { server_id: context.server_id, updated_at: new Date().toISOString() };
  if (input.pendingEconomyChannelId !== undefined) patch.pending_economy_channel_id = input.pendingEconomyChannelId;
  if (input.pendingPayoutsChannelId !== undefined) patch.pending_payouts_channel_id = input.pendingPayoutsChannelId;
  if (input.gameChannelsCategoryId !== undefined) patch.game_channels_category_id = input.gameChannelsCategoryId;
  if (input.commissionerOfficeChannelId !== undefined) patch.commissioner_office_channel_id = input.commissionerOfficeChannelId;
  if (input.streamsChannelId !== undefined) patch.streams_channel_id = input.streamsChannelId;
  if (input.highlightsChannelId !== undefined) patch.highlights_channel_id = input.highlightsChannelId;
  if (input.announcementsChannelId !== undefined) patch.announcements_channel_id = input.announcementsChannelId;
  if (input.votingPollsChannelId !== undefined) patch.voting_polls_channel_id = input.votingPollsChannelId;
  if (input.commissionerRoleId !== undefined) patch.commissioner_role_id = input.commissionerRoleId;
  if (input.compCommitteeRoleId !== undefined) patch.comp_committee_role_id = input.compCommitteeRoleId;
  const existing = await getRoutes(context.server_id);
  const query = existing
    ? supabase.from("rec_server_routes").update(patch).eq("server_id", context.server_id)
    : supabase.from("rec_server_routes").insert(patch);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return { routes: data };
}

export async function clearPendingEosBatch(input: { guildId: string; clearReason: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: batch, error } = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.league_id)
    .in("status", ["draft", "posted", "partially_approved", "approved", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!batch) return { cleared: false, reason: "No pending EOS batch found." };
  const { data: supersededItems } = await supabase
    .from("rec_eos_payout_items")
    .select("id,discord_channel_id,discord_message_id,status")
    .eq("batch_id", batch.id)
    .in("status", ["pending", "approved"]);
  await supabase
    .from("rec_eos_payout_items")
    .update({ status: "voided", updated_at: new Date().toISOString() })
    .eq("batch_id", batch.id)
    .in("status", ["pending", "approved"]);
  const { data: updated, error: updateError } = await supabase
    .from("rec_eos_payout_batches")
    .update({ status: "cleared", clear_reason: input.clearReason, cleared_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return {
    cleared: true,
    batch: updated,
    supersededMessages: (supersededItems ?? [])
      .filter((item: any) => item.discord_channel_id && item.discord_message_id)
      .map((item: any) => ({
        itemId: item.id,
        discordChannelId: item.discord_channel_id,
        discordMessageId: item.discord_message_id,
        previousStatus: item.status
      }))
  };
}

async function getWeekGames(leagueId: string, seasonNumber: number, weekNumber: number, stage?: string) {
  // The Super Bowl is stored in rec_games at EA's week number (22 in Madden franchise),
  // which may differ from the league calendar week (e.g. 23 when week 22 is a Pro Bowl skip).
  // When stage is super_bowl, find playoff games at the highest stored week number instead.
  if (stage === "super_bowl") {
    const { data, error } = await supabase
      .from("rec_games")
      .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
      .eq("league_id", leagueId)
      .neq("phase", "regular_season")
      .order("week_number", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return [];
    const maxWeek = rows[0].week_number;
    return rows.filter((g: any) => g.week_number === maxWeek);
  }

  const { data, error } = await supabase
    .from("rec_games")
    .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (error) throw error;
  return (data ?? []) as any[];
}

export { generateWeeklyChallenges, getChallengeAudit, evaluateWeeklyChallenges };

export async function getGameChannelPlans(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber, stage);
  const advanceTimes = formatAdvanceTimes(league.next_advance_at);
  const h2hGames = games.filter((g) => g.home_user_id && g.away_user_id);

  // Resolve real Discord IDs so channel messages tag users (the raw user_id is an internal UUID).
  const discordByUser = await resolveDiscordIdsByUser(h2hGames.flatMap((g) => [g.home_user_id, g.away_user_id]));

  // Pull the league's configured game rules (fourth-down / streaming) from rec_league_configuration.
  const config = await getLeagueConfiguration(context.league_id);
  const isPlayoffStage = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(stage);
  // For playoffs: check explicit postseason setting first. If null but streaming_scope is
  // "playoffs_only", the league intended playoffs to require streaming — treat it as required.
  const streamingRequirement = stage === "regular_season"
    ? config?.regular_season_streaming_requirement ?? config?.streaming_requirement
    : config?.postseason_streaming_requirement
      ?? (config?.streaming_scope === "playoffs_only" ? "required" : config?.streaming_requirement);
  const fourthDownRules = humanizeFourthDownRule(config?.fourth_down_rule_type, config?.custom_fourth_down_rule);

  // Determine which game is GOTW: in playoffs every H2H game is GOTW; in regular season look up selected candidate
  let gotwGameId: string | null = null;
  if (!isPlayoffStage) {
    const { data: gotwSelected } = await supabase
      .from("rec_game_of_week_candidates")
      .select("game_id")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber)
      .eq("is_selected", true)
      .maybeSingle();
    gotwGameId = gotwSelected?.game_id ?? null;
  }

  const plans = h2hGames.map((game) => ({
    leagueId: context.league_id,
    seasonNumber,
    weekNumber,
    gameId: game.id,
    channelName: slug(`${teamNickname(game.away_team?.name, "away")}-vs-${teamNickname(game.home_team?.name, "home")}`),
    awayTeamId: game.away_team_id,
    homeTeamId: game.home_team_id,
    awayTeamName: teamNickname(game.away_team?.name, "Away Team"),
    homeTeamName: teamNickname(game.home_team?.name, "Home Team"),
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    awayDiscordId: game.away_user_id ? discordByUser.get(String(game.away_user_id)) ?? null : null,
    homeDiscordId: game.home_user_id ? discordByUser.get(String(game.home_user_id)) ?? null : null,
    categoryId: routes?.game_channels_category_id ?? null,
    nextAdvanceTimes: advanceTimes,
    streamingRequired: streamingRequirement === "required",
    streamingRequirement: streamingRequirementText(streamingRequirement),
    streamingSide: (config?.streaming_side as string | null | undefined) ?? null,
    fourthDownRules,
    fairSimRequirements: (config?.fair_sim_requirements as string | null | undefined) ?? null,
    forceWinRequirements: (config?.force_win_requirements as string | null | undefined) ?? null,
    isGotw: isPlayoffStage || (gotwGameId ? String(game.id) === String(gotwGameId) : false),
    isPlayoff: isPlayoffStage,
    seasonStage: stage
  }));
  return { plans, routes, league, server: context.rec_discord_servers };
}

export async function getActiveGameChannels(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("status", "active");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannel(input: any) {
  const { data, error } = await supabase.from("rec_game_channels").upsert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    game_id: input.gameId,
    discord_channel_id: input.discordChannelId,
    away_team_id: input.awayTeamId,
    home_team_id: input.homeTeamId,
    away_user_id: input.awayUserId,
    home_user_id: input.homeUserId,
    status: "active",
    updated_at: new Date().toISOString()
  }, { onConflict: "discord_channel_id" }).select("*").single();
  if (error) throw error;
  return { channel: data };
}

export async function markGameChannelDeleted(input: { discordChannelId: string }) {
  const { data, error } = await supabase.from("rec_game_channels").update({ status: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("discord_channel_id", input.discordChannelId).select("*");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannelCheckin(input: { discordChannelId: string; discordUserId: string }) {
  const { data: channel, error } = await supabase.from("rec_game_channels").select("*").eq("discord_channel_id", input.discordChannelId).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!channel) return { recorded: false };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordUserId).maybeSingle();
  const existing = await supabase.from("rec_game_channel_checkins").select("*").eq("game_channel_id", channel.id).eq("discord_user_id", input.discordUserId).maybeSingle();
  if (existing.data) {
    await supabase.from("rec_game_channel_checkins").update({ last_message_at: new Date().toISOString(), message_count: (existing.data.message_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
  } else {
    await supabase.from("rec_game_channel_checkins").insert({ game_channel_id: channel.id, league_id: channel.league_id, season_number: channel.season_number, week_number: channel.week_number, discord_channel_id: input.discordChannelId, discord_user_id: input.discordUserId, user_id: discord?.user_id ?? null });
  }
  return { recorded: true };
}

export async function getReminderState(guildId: string) {
  const active = await getActiveGameChannels(guildId);
  const ids = active.channels.map((c: any) => c.id);
  if (!ids.length) return { channels: [] };
  const { data: checkins } = await supabase.from("rec_game_channel_checkins").select("*").in("game_channel_id", ids);
  const { data: reminders } = await supabase.from("rec_game_channel_reminders").select("*").in("game_channel_id", ids);
  return { channels: active.channels, checkins: checkins ?? [], reminders: reminders ?? [] };
}

export async function recordReminder(input: { gameChannelId: string; reminderType: string; targetUserId?: string | null; status?: string; details?: any }) {
  const { data, error } = await supabase.from("rec_game_channel_reminders").upsert({ game_channel_id: input.gameChannelId, reminder_type: input.reminderType, target_user_id: input.targetUserId ?? null, status: input.status ?? "sent", details: input.details ?? {} }, { onConflict: "game_channel_id,reminder_type,target_user_id" }).select("*").single();
  if (error) throw error;

  if (input.reminderType === "twelve_hour" && input.details?.missingUserIds?.length) {
    const { data: channel } = await supabase.from("rec_game_channels").select("*").eq("id", input.gameChannelId).maybeSingle();
    if (channel) {
      const rows = input.details.missingUserIds.map((userId: string) => ({
        league_id: channel.league_id,
        season_number: channel.season_number,
        week_number: channel.week_number,
        game_channel_id: input.gameChannelId,
        game_id: channel.game_id,
        user_id: userId,
        penalty_type: "no_12_hour_checkin",
        details: input.details ?? {},
        created_at: nowIso()
      }));
      if (rows.length) await supabase.from("rec_game_channel_activity_penalties").insert(rows);
    }
  }

  return { reminder: data };
}

export { applyAdvanceRecords, auditAndRepairRecords };

export async function calculateRecPotw(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: assignments, error: assignmentError } = await supabase.from("rec_team_assignments").select("team_id,user_id,rec_teams(conference)").eq("league_id", context.league_id).eq("assignment_status", "active").is("ended_at", null);
  if (assignmentError) throw assignmentError;
  const eligible = new Map((assignments ?? []).map((a: any) => [a.team_id, a]));
  // Use committed player weekly stats instead of staging data
  const { data: statsRows, error } = await supabase
    .from("rec_player_weekly_stats")
    .select("*, rec_players(id,madden_player_id,position,full_name,league_id), rec_teams(id,name,abbreviation)")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw error;
  const candidates: any[] = [];
  for (const row of statsRows ?? []) {
    const assignment = [...eligible.values()].find((a: any) => String(a.team_id) === String(row.team_id));
    if (!assignment) continue;
    const conference = assignment.rec_teams?.conference ?? "Unknown";
    const position = row.rec_players?.position ?? row.position ?? null;
    const playerName = row.rec_players?.full_name ?? row.player_name ?? "Unknown Player";
    const stats = (row.stats ?? row.raw_payload ?? {}) as Record<string, any>;
    const offensiveScore = calculateOffensivePotwScore({ position, passYds: readStat(stats, "pass_yards"), passTDs: readStat(stats, "pass_tds"), passInts: readStat(stats, "interceptions_thrown"), rushYds: readStat(stats, "rush_yards"), rushTDs: readStat(stats, "rush_tds"), recYds: readStat(stats, "receiving_yards"), recTDs: readStat(stats, "receiving_tds"), receptions: readStat(stats, "receptions") });
    const defensiveScore = calculateDefensivePotwScore({ sacks: readStat(stats, "sacks"), ints: readStat(stats, "interceptions"), defensiveTDs: readStat(stats, "defensive_tds"), forcedFumbles: readStat(stats, "forced_fumbles"), tackles: readStat(stats, "tackles") });
    candidates.push({ row, assignment, conference, position, playerName, offensiveScore, defensiveScore });
  }
  const awards: any[] = [];
  for (const conference of [...new Set(candidates.map((c) => c.conference))]) {
    const group = candidates.filter((c) => c.conference === conference);
    const offense = group.sort((a, b) => b.offensiveScore - a.offensiveScore)[0];
    const defense = group.sort((a, b) => b.defensiveScore - a.defensiveScore)[0];
    for (const [side, winner, score] of [["offense", offense, offense?.offensiveScore], ["defense", defense, defense?.defensiveScore]] as const) {
      if (!winner || !score || score <= 0) continue;
      awards.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, conference, award_side: side, award_source: "rec_calculated", player_external_id: String(winner.row.rec_players?.madden_player_id ?? winner.row.madden_player_id ?? ""), player_name: winner.playerName, position: winner.position, team_id: winner.assignment.team_id, user_id: winner.assignment.user_id, score, payout_amount: REC_POTW_PAYOUT_AMOUNT, weeklyStats: winner.row.stats ?? {}, raw_payload: winner.row.raw_payload ?? {} });
    }
  }
  // Persist to DB without the in-memory weeklyStats field
  if (awards.length) {
    const dbAwards = awards.map(({ weeklyStats: _ws, ...rest }: any) => rest);
    await supabase.from("rec_weekly_player_awards").upsert(dbAwards, { onConflict: "league_id,season_number,week_number,conference,award_side,award_source" });
  }
  return { awards };
}


export async function issueRecPotwPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: awards, error } = await supabase
    .from("rec_weekly_player_awards")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .is("paid_ledger_id", null)
    .not("user_id", "is", null);
  if (error) throw error;
  let issued = 0;
  for (const award of awards ?? []) {
    const amount = asNumber(award.payout_amount || REC_POTW_PAYOUT_AMOUNT);
    const credit = await creditUserWallet({
      userId: award.user_id,
      leagueId: context.league_id,
      seasonNumber,
      amount,
      transactionType: "potw",
      description: `${award.conference} ${award.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW - ${award.player_name}`,
      sourceReference: {
        idempotencyKey: `potw:${award.id}`,
        type: "rec_potw",
        awardId: award.id,
        weekNumber: completedWeek
      }
    });
    if (credit.ledger?.id) {
      await supabase.from("rec_weekly_player_awards").update({ paid_ledger_id: credit.ledger.id, updated_at: nowIso() }).eq("id", award.id);
    }
    if (credit.created) issued += amount;
  }
  return { issued, awards: awards?.length ?? 0, weekNumber: completedWeek };
}

export async function evaluateStreamCompliance(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const features = await getLeagueFeatureSettings(context.league_id).catch(() => null);
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  // Same playoff-scope fallback as getGameChannelPlans: explicit postseason setting wins;
  // if null but scope is "playoffs_only", the league intended playoffs to require streaming.
  const requirement = stage === "regular_season"
    ? features?.regular_season_streaming_requirement ?? features?.streaming_requirement
    : features?.postseason_streaming_requirement
      ?? (features?.streaming_scope === "playoffs_only" ? "required" : features?.streaming_requirement);
  const streamingRequired = requirement === "required";
  if (!streamingRequired) return { checked: 0, missed: 0, required: false };

  const sidePolicy = features?.streaming_side ?? "either";
  const { data: games, error } = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek);
  if (error) throw error;

  let checked = 0;
  let missed = 0;
  for (const game of games ?? []) {
    const sides = [
      { key: "home", userId: game.home_user_id, teamId: game.home_team_id },
      { key: "away", userId: game.away_user_id, teamId: game.away_team_id }
    ].filter((side) => side.userId);
    if (!sides.length) continue;

    const requiredSides = sidePolicy === "home" ? sides.filter((s) => s.key === "home")
      : sidePolicy === "away" ? sides.filter((s) => s.key === "away")
      : sidePolicy === "both" ? sides
      : sides;

    const { data: streamLogs } = await supabase
      .from("rec_stream_compliance_logs")
      .select("*")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .eq("week_number", completedWeek)
      .in("status", ["posted", "required_complied"]);

    for (const side of requiredSides) {
      const hasStream = (streamLogs ?? []).some((log: any) => log.user_id === side.userId);
      checked += 1;
      if (hasStream) {
        await supabase.from("rec_stream_compliance_logs").insert({
          league_id: context.league_id,
          season_number: seasonNumber,
          week_number: completedWeek,
          user_id: side.userId,
          team_id: side.teamId,
          required: true,
          complied: true,
          status: "required_complied",
          details: { gameId: game.id, streamingSide: sidePolicy, source: "advance_evaluation" }
        });
      } else {
        missed += 1;
        await supabase.from("rec_stream_compliance_logs").insert({
          league_id: context.league_id,
          season_number: seasonNumber,
          week_number: completedWeek,
          user_id: side.userId,
          team_id: side.teamId,
          required: true,
          complied: false,
          status: "required_missed",
          details: { gameId: game.id, streamingSide: sidePolicy, source: "advance_evaluation" }
        });
      }
    }
  }
  return { checked, missed, required: true };
}

export async function buildAdvanceDmPayloads(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const dmStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const next = nextWeekStage(asNumber(weekNumber), dmStage);
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber, dmStage);
  const config = await getLeagueConfiguration(context.league_id);
  const { data: challenges } = await supabase.from("rec_weekly_challenges").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const { data: channels } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const completedWeek = Math.max(1, weekNumber - 1);
  const { data: awards } = await supabase.from("rec_weekly_player_awards").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", completedWeek);
  // Note: .eq("season_id", null) never matched (SQL = NULL is never true), and the type list
  // omitted weekly_game_payout — so game win/loss payouts never appeared in advance DMs. Filter
  // by league only and include every payout transaction type written during advance.
  const { data: payouts } = await supabase
    .from("rec_dollar_ledger")
    .select("user_id,amount,transaction_type,description,source_reference,created_at")
    .eq("league_id", context.league_id)
    .in("transaction_type", ["weekly_game_payout", "weekly_challenge", "potw", "gotw_correct_guess", "stream_payout", "credit", "savings_interest"]);
  const { data: wallets } = await supabase.from("rec_wallets").select("user_id,wallet_balance,savings_balance");
  const walletByUser = new Map((wallets ?? []).map((wallet: any) => [wallet.user_id, wallet]));
  const { data: discordAccounts } = await supabase.from("rec_discord_accounts").select("user_id,discord_id");
  const discordByUser = new Map((discordAccounts ?? []).map((d: any) => [d.user_id, d.discord_id]));
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team:rec_teams(id,name,abbreviation)")
    .eq("league_id", context.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const { data: gotwSelected } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: previousGotw } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .lt("week_number", weekNumber)
    .order("week_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const gotwVoteRows = previousGotw?.id
    ? await supabase.from("rec_game_of_week_votes").select("user_id,selected_team_id,is_correct").eq("poll_id", previousGotw.id)
    : { data: [] as any[] };
  const previousGotwVotesByUser = new Map((gotwVoteRows.data ?? []).map((v: any) => [v.user_id, v]));
  const { data: gotwRecords } = await supabase.from("rec_global_gotw_guessing_records").select("user_id,correct_guesses,wrong_guesses");
  const gotwRecordByUser = new Map((gotwRecords ?? []).map((r: any) => [r.user_id, r]));
  const streamingRequirement = dmStage === "regular_season"
    ? config?.regular_season_streaming_requirement ?? config?.streaming_requirement
    : config?.postseason_streaming_requirement
      ?? (config?.streaming_scope === "playoffs_only" ? "required" : config?.streaming_requirement);
  const payloads: any[] = [];
  const userIdsWithGames = new Set<string>();
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, teamName: teamNickname(game.home_team?.name, "Team"), opponentTeam: teamNickname(game.away_team?.name, "Opponent"), location: "Home", opponentUserId: game.away_user_id, opponentTeamId: game.away_team_id },
      { userId: game.away_user_id, teamId: game.away_team_id, teamName: teamNickname(game.away_team?.name, "Team"), opponentTeam: teamNickname(game.home_team?.name, "Opponent"), location: "Away", opponentUserId: game.home_user_id, opponentTeamId: game.home_team_id }
    ].filter((s) => s.userId);
    for (const side of sides) {
      userIdsWithGames.add(String(side.userId));
      const gameChannel = (channels ?? []).find((c: any) => c.game_id === game.id);
      const gotwRecord = gotwRecordByUser.get(side.userId);
      const gotwCorrect = asNumber(gotwRecord?.correct_guesses);
      const gotwWrong = asNumber(gotwRecord?.wrong_guesses);
      const previousVote = previousGotwVotesByUser.get(side.userId);
      const opponentDiscordId = side.opponentUserId ? (discordByUser.get(side.opponentUserId) ?? null) : null;
      payloads.push({
        userId: side.userId,
        discordId: discordByUser.get(side.userId),
        leagueName: league.name,
        serverName: context.rec_discord_servers?.name ?? "",
        seasonNumber,
        weekNumber,
        seasonStage: league.season_stage,
        nextWeekStage: next,
        team: { id: side.teamId, name: side.teamName },
        nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at),
        matchup: { opponent: side.opponentTeam, opponentDiscordId, location: side.location, gameType: side.opponentUserId ? "User H2H" : "CPU", gameChannelId: gameChannel?.discord_channel_id ?? null },
        streaming: { required: streamingRequirement === "required", requirement: streamingRequirementText(streamingRequirement), side: config?.streaming_side ?? config?.streaming_required_side ?? null },
        challenges: (challenges ?? []).filter((c: any) => c.user_id === side.userId),
        payouts: (payouts ?? [])
          .filter((payout: any) => payout.user_id === side.userId && [completedWeek, weekNumber].includes(payoutWeekNumber(payout)))
          .map((payout: any) => ({ label: payout.description ?? payout.transaction_type, amount: payout.amount ?? 0, type: payout.transaction_type })),
        walletBalance: walletByUser.get(side.userId)?.wallet_balance ?? 0,
        savingsBalance: walletByUser.get(side.userId)?.savings_balance ?? 0,
        potwAwards: (awards ?? []).filter((a: any) => a.user_id === side.userId).map((a: any) => ({ label: `${a.conference} ${a.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW`, playerName: a.player_name, amount: a.payout_amount ?? REC_POTW_PAYOUT_AMOUNT })),
        gotw: {
          selected: gotwSelected ? `${gotwSelected.away_team_name ?? "Away"} @ ${gotwSelected.home_team_name ?? "Home"}` : "Not selected yet",
          isParticipant: gotwSelected ? [gotwSelected.away_user_id, gotwSelected.home_user_id].map(String).includes(String(side.userId)) : false,
          votingRecord: gotwCorrect + gotwWrong > 0 ? `${gotwCorrect}-${gotwWrong} (${Math.round((gotwCorrect / Math.max(1, gotwCorrect + gotwWrong)) * 100)}%)` : "No votes yet",
          previousOutcome: previousGotw ? {
            matchup: `${previousGotw.away_team_name ?? "Away"} @ ${previousGotw.home_team_name ?? "Home"}`,
            winner: previousGotw.winning_team_id ? (String(previousGotw.winning_team_id) === String(previousGotw.away_team_id) ? previousGotw.away_team_name : previousGotw.home_team_name) : "Not settled",
            userPick: previousVote ? (String(previousVote.selected_team_id) === String(previousGotw.away_team_id) ? previousGotw.away_team_name : previousGotw.home_team_name) : "No vote recorded",
            result: previousVote?.is_correct === true ? "Voted winner" : previousVote?.is_correct === false ? "Voted loser" : "No settled vote"
          } : null,
          message: "Go to /menu to vote for the H2H GOTW winner. Correct guesses may earn a payout."
        },
        deadlines: []
      });
    }
  }
  for (const assignment of assignments ?? []) {
    if (!assignment.user_id || userIdsWithGames.has(String(assignment.user_id))) continue;
    const team = oneRelation(assignment.team);
    const gotwRecord = gotwRecordByUser.get(assignment.user_id);
    const gotwCorrect = asNumber(gotwRecord?.correct_guesses);
    const gotwWrong = asNumber(gotwRecord?.wrong_guesses);
    const previousVote = previousGotwVotesByUser.get(assignment.user_id);
    payloads.push({
      userId: assignment.user_id,
      discordId: discordByUser.get(assignment.user_id),
      leagueName: league.name,
      serverName: context.rec_discord_servers?.name ?? "",
      seasonNumber,
      weekNumber,
      seasonStage: league.season_stage,
      nextWeekStage: next,
      team: { id: team?.id ?? null, name: teamNickname(team?.name, "Team") },
      nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at),
      matchup: { opponent: "BYE WEEK", opponentDiscordId: null, location: "NONE", gameType: "BYE", gameChannelId: null },
      streaming: { required: false, requirement: "Not required on bye week", side: null },
      challenges: [],
      payouts: (payouts ?? [])
        .filter((payout: any) => payout.user_id === assignment.user_id && [completedWeek, weekNumber].includes(payoutWeekNumber(payout)))
        .map((payout: any) => ({ label: payout.description ?? payout.transaction_type, amount: payout.amount ?? 0, type: payout.transaction_type })),
      walletBalance: walletByUser.get(assignment.user_id)?.wallet_balance ?? 0,
      savingsBalance: walletByUser.get(assignment.user_id)?.savings_balance ?? 0,
      potwAwards: (awards ?? []).filter((a: any) => a.user_id === assignment.user_id).map((a: any) => ({ label: `${a.conference} ${a.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW`, playerName: a.player_name, amount: a.payout_amount ?? REC_POTW_PAYOUT_AMOUNT })),
      gotw: {
        selected: gotwSelected ? `${gotwSelected.away_team_name ?? "Away"} @ ${gotwSelected.home_team_name ?? "Home"}` : "Not selected yet",
        isParticipant: false,
        votingRecord: gotwCorrect + gotwWrong > 0 ? `${gotwCorrect}-${gotwWrong} (${Math.round((gotwCorrect / Math.max(1, gotwCorrect + gotwWrong)) * 100)}%)` : "No votes yet",
        previousOutcome: previousGotw ? {
          matchup: `${previousGotw.away_team_name ?? "Away"} @ ${previousGotw.home_team_name ?? "Home"}`,
          winner: previousGotw.winning_team_id ? (String(previousGotw.winning_team_id) === String(previousGotw.away_team_id) ? previousGotw.away_team_name : previousGotw.home_team_name) : "Not settled",
          userPick: previousVote ? (String(previousVote.selected_team_id) === String(previousGotw.away_team_id) ? previousGotw.away_team_name : previousGotw.home_team_name) : "No vote recorded",
          result: previousVote?.is_correct === true ? "Voted winner" : previousVote?.is_correct === false ? "Voted loser" : "No settled vote"
        } : null,
        message: "Go to /menu to vote for the H2H GOTW winner. Correct guesses may earn a payout."
      },
      deadlines: []
    });
  }
  const routes = await getRoutes(context.server_id);
  const announcementsChannelId = routes?.announcements_channel_id ?? null;
  const allMatchups = games.map((game) => ({
    awayTeamName: teamNickname(game.away_team?.name, "Away"),
    homeTeamName: teamNickname(game.home_team?.name, "Home"),
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    awayDiscordId: game.away_user_id ? (discordByUser.get(game.away_user_id) ?? null) : null,
    homeDiscordId: game.home_user_id ? (discordByUser.get(game.home_user_id) ?? null) : null,
    isCpu: !game.away_user_id || !game.home_user_id
  }));
  return { payloads, announcementsChannelId, weekNumber, seasonNumber, leagueName: league.name, seasonStage: league.season_stage, nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at), allMatchups };
}

export async function issueWeeklyGamePayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  // The league week is advanced before payout steps run, so the just-played week is current - 1.
  const weekNumber = Math.max(1, asNumber(league.current_week ?? 1) - 1);

  const { data: results, error } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,is_tie,is_cpu_game,is_user_h2h,week_number,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw error;

  const assignments = await getLinkedActiveTeamUsers(leagueId);
  const teamIdToDiscordId = new Map<string, string>();
  for (const a of assignments) {
    if (a.team_id && a.user_id) {
      const { data: discord } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", a.user_id).maybeSingle();
      if (discord?.discord_id) teamIdToDiscordId.set(String(a.team_id), discord.discord_id);
    }
  }

  const issued: Array<{ userId: string; amount: number; reason: string; created: boolean }> = [];
  const skipped: Array<{ resultId: string; reason: string }> = [];

  for (const result of results ?? []) {
    if (result.is_tie) { skipped.push({ resultId: result.id, reason: "tie" }); continue; }

    const homeUserId = result.home_user_id;
    const awayUserId = result.away_user_id;
    const homeScore = asNumber(result.home_score);
    const awayScore = asNumber(result.away_score);
    const homeWon = homeScore > awayScore;

    const candidates: Array<{ userId: string | null; won: boolean; isCpu: boolean }> = [
      { userId: homeUserId, won: homeWon, isCpu: !homeUserId },
      { userId: awayUserId, won: !homeWon, isCpu: !awayUserId }
    ];

    for (const side of candidates) {
      if (!side.userId) continue;
      const isH2H = Boolean(homeUserId && awayUserId);
      let amount = 0;
      let reason = "";
      if (isH2H) {
        amount = side.won ? 50 : 20;
        reason = side.won ? "H2H win" : "H2H loss";
      } else if (side.won) {
        amount = 20;
        reason = "CPU win";
      }
      if (!amount) { skipped.push({ resultId: result.id, reason: "cpu_loss_no_payout" }); continue; }

      const idempotencyKey = `game_payout:${result.id}:${side.userId}`;
      const credit = await creditUserWallet({
        userId: side.userId,
        leagueId,
        seasonNumber,
        amount,
        transactionType: "weekly_game_payout",
        description: `Week ${weekNumber} ${reason}`,
        sourceReference: { idempotencyKey, resultId: result.id, weekNumber, seasonNumber }
      });
      issued.push({ userId: side.userId, amount, reason, created: credit.created });
    }
  }

  return { issued, skipped, weekNumber, seasonNumber };
}

const SAVINGS_INTEREST_RATE = 0.035;
const INTEREST_RATE_LIMIT = 21; // advances per 24h before interest disables
const INTEREST_DISABLE_HOURS = 24;

export async function applyAdvanceSavingsInterest(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;

  // Economy must be enabled
  const features = await getLeagueFeatureSettings(leagueId);
  if (!features?.coin_economy_enabled) return { skipped: "economy_disabled", credited: 0 };

  const linkedUsers = await getLinkedActiveTeamUsers(leagueId);

  // Rate-limit check — update the rolling 24h advance window atomically
  const now = new Date();
  const windowStart = league.advance_rate_window_start ? new Date(league.advance_rate_window_start) : null;
  const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > 24 * 60 * 60 * 1000;

  const newCount = windowExpired ? 1 : (asNumber(league.advance_rate_count) + 1);
  const newWindowStart = windowExpired ? now.toISOString() : league.advance_rate_window_start;

  // Check if interest is already disabled from a prior rate-limit hit
  const disabledUntil = league.interest_disabled_until ? new Date(league.interest_disabled_until) : null;
  if (disabledUntil && disabledUntil > now) {
    // Still within disable window — update rate counter but skip interest
    await supabase.from("rec_leagues").update({
      advance_rate_window_start: newWindowStart,
      advance_rate_count: newCount
    }).eq("id", leagueId);
    return { skipped: "interest_disabled_until", disabledUntil: disabledUntil.toISOString(), credited: 0 };
  }

  if (newCount > INTEREST_RATE_LIMIT) {
    const disableUntil = new Date(now.getTime() + INTEREST_DISABLE_HOURS * 60 * 60 * 1000);
    await supabase.from("rec_leagues").update({
      advance_rate_window_start: newWindowStart,
      advance_rate_count: newCount,
      interest_disabled_until: disableUntil.toISOString()
    }).eq("id", leagueId);
    return { skipped: "rate_limit_exceeded", advancesInWindow: newCount, disabledUntil: disableUntil.toISOString(), credited: 0 };
  }

  // Update the rate window counter
  await supabase.from("rec_leagues").update({
    advance_rate_window_start: newWindowStart,
    advance_rate_count: newCount
  }).eq("id", leagueId);

  // Apply 3.5% interest to each linked user's savings balance
  const userIds = linkedUsers.map((a: any) => a.user_id).filter(Boolean);
  const { data: wallets } = await supabase
    .from("rec_wallets")
    .select("user_id,savings_balance")
    .in("user_id", userIds);

  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  let credited = 0;

  for (const wallet of wallets ?? []) {
    const savings = asNumber(wallet.savings_balance);
    if (savings <= 0) continue;
    const interest = Math.floor(savings * SAVINGS_INTEREST_RATE);
    if (interest <= 0) continue;

    const idempotencyKey = `savings_interest:${leagueId}:${league.current_week}:${wallet.user_id}`;

    // Check idempotency — skip if already credited this advance
    const { data: existing } = await supabase
      .from("rec_dollar_ledger")
      .select("id")
      .eq("user_id", wallet.user_id)
      .eq("transaction_type", "savings_interest")
      .contains("source_reference", { idempotencyKey })
      .maybeSingle();
    if (existing) continue;

    // Credit directly to savings_balance
    const { error: walletErr } = await supabase
      .from("rec_wallets")
      .update({ savings_balance: savings + interest, updated_at: nowIso() })
      .eq("user_id", wallet.user_id);
    if (walletErr) continue;

    // Record the ledger entry
    await supabase.from("rec_dollar_ledger").insert({
      user_id: wallet.user_id,
      league_id: leagueId,
      season_id: null,
      amount: interest,
      transaction_type: "savings_interest",
      description: `Savings interest (3.5%) — Week ${league.current_week}`,
      source: "internal_import",
      source_reference: { idempotencyKey, leagueId, week: league.current_week, seasonNumber }
    });

    credited++;
  }

  return { credited, linkedUsers: linkedUsers.length, advancesInWindow: newCount };
}

export async function assignSeasonEndBadgesForSeason(leagueId: string, seasonNumber: number) {
  return assignSeasonEndBadges(leagueId, seasonNumber);
}

export async function assignPlayoffBadgesForSeason(leagueId: string, seasonNumber: number) {
  return assignPlayoffBadges(leagueId, seasonNumber);
}

export async function advanceLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const previousWeek = asNumber(league.current_week ?? 1);
  const previousStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const weekNumber = previousStage === "preseason_training_camp" ? 1 : previousWeek + 1;
  // REC season: weeks 1-18 regular season, week 19 = wild_card, 20 = divisional,
  // 21 = conference_championship, 22 = super_bowl.
  // Offseason chain: super_bowl → coach_hiring → final_resigning → free_agency → draft → preseason_training_camp → regular_season (season 2+).
  // EOS badges and payouts fire in setLeagueWeek when transitioning out of regular_season.
  const seasonStage =
    previousStage === "regular_season" && weekNumber >= 19 ? "wild_card"
    : previousStage === "wild_card" ? "divisional"
    : previousStage === "divisional" ? "conference_championship"
    : previousStage === "conference_championship" ? "super_bowl"
    : previousStage === "super_bowl" ? "coach_hiring"
    : previousStage === "coach_hiring" ? "final_resigning"
    : previousStage === "final_resigning" ? "free_agency"
    : previousStage === "free_agency" ? "draft"
    : previousStage === "draft" ? "preseason_training_camp"
    : previousStage === "preseason_training_camp" ? "regular_season"
    : previousStage;
  const weekResult = await setLeagueWeek({ guildId, weekNumber, seasonStage, markAdvanced: true });
  return {
    previousWeek,
    weekNumber,
    previousStage,
    seasonStage,
    transitionBadgesEarned: weekResult.transitionBadgesEarned ?? [],
    transitionBadgesRemoved: weekResult.transitionBadgesRemoved ?? []
  };
}

export async function runPostAdvanceAutomation(input: string | { guildId: string; mode?: "normal" | "catch_up" }) {
  const guildId = typeof input === "string" ? input : input.guildId;
  const mode = typeof input === "string" ? "normal" : input.mode ?? "normal";

  // Run each step independently so one failing step (e.g. POTW with no player stats imported)
  // does not abort records/payouts or the rest of the advance. Failures surface as warnings.
  const warnings: string[] = [];
  const completed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      completed.push(name);
    } catch (error) {
      console.error(`[ADVANCE] step "${name}" failed:`, error);
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Advance the league week first: every subsequent step treats current_week - 1 as the
  // just-completed week, and current_week as the upcoming week (challenges, GOTW, channels).
  let week: { previousWeek: number; weekNumber: number; previousStage: string; seasonStage: string } | null = null;
  if (mode === "normal") {
    await step("advance_week", async () => { week = await advanceLeagueWeek(guildId); });
  }

  await step("apply_records", () => applyAdvanceRecords(guildId));
  await step("game_payouts", () => issueWeeklyGamePayouts(guildId));
  await step("savings_interest", () => applyAdvanceSavingsInterest(guildId));
  await step("settle_gotw", () => settleGotwVotes(guildId));
  await step("evaluate_challenges", () => evaluateWeeklyChallenges(guildId));
  await step("calculate_potw", () => calculateRecPotw(guildId));
  await step("potw_payouts", () => issueRecPotwPayouts(guildId));
  await step("stream_compliance", () => evaluateStreamCompliance(guildId));
  await step("generate_challenges", () => generateWeeklyChallenges({ guildId, regenerate: false }));
  await step("assign_badges", () => assignWeeklyBadges(guildId));

  if (mode === "catch_up") {
    return {
      ok: warnings.length === 0,
      mode,
      week,
      completed,
      warnings,
      gameChannels: { plans: [] },
      dmPayloads: { payloads: [] },
      gotw: { pendingApproval: false, candidates: [] },
      skipped: ["advance_dms", "gotw_scheduling", "game_channel_recreation"]
    };
  }

  const gotwResult = await getGotwCandidates(guildId);
  const gameChannels = await getGameChannelPlans(guildId);
  const dmPayloads = await buildAdvanceDmPayloads(guildId);
  return {
    ok: warnings.length === 0,
    mode,
    week,
    completed,
    warnings,
    gameChannels,
    dmPayloads,
    gotw: {
      candidates: gotwResult.candidates,
      recommendedCandidate: gotwResult.candidates?.[0] ?? null,
      pendingApproval: gotwResult.candidates?.length > 0 && gotwResult.stage === "regular_season"
    }
  };
}

export async function getGotwCandidates(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = league.season_stage ?? league.current_phase ?? "regular_season";
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const h2hGames = games.filter((game) => game.home_user_id && game.away_user_id);

  // Pre-fetch all user records for this league to avoid N+1 queries
  const { data: allRecords } = await supabase
    .from("rec_league_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", context.league_id);
  const recordsByUser = new Map((allRecords ?? []).map((r: any) => [r.user_id, r]));

  // Calculate power rankings for all users in this league
  const powerRankings = new Map<string, any>();
  for (const record of allRecords ?? []) {
    const user_id = record.user_id;
    const winPct = record.games_played > 0 ? record.wins / record.games_played : 0;
    const avgPd = record.games_played > 0 ? record.point_differential / record.games_played : 0;
    const pdBoost = Math.max(-0.3, Math.min(0.3, avgPd / 30));
    const ranking = (winPct * 0.7) + (0.5 + pdBoost * 0.3);
    powerRankings.set(user_id, {
      ranking: Math.max(0, Math.min(1, ranking)),
      wins: record.wins,
      losses: record.losses,
      pd: record.point_differential,
      winPct,
      avgPd
    });
  }

  // Fetch all H2H records to check history
  const { data: h2hRecords } = await supabase.from("rec_user_h2h_global_records").select("user_a_id,user_b_id,wins,losses,ties,pointDifferential");
  const h2hMap = new Map<string, any>();
  for (const record of h2hRecords ?? []) {
    const key = [record.user_a_id, record.user_b_id].sort().join(":");
    h2hMap.set(key, record);
  }

  const previousWeek = Math.max(1, weekNumber - 1);
  const { data: previousGotw } = await supabase
    .from("rec_game_of_week_candidates")
    .select("away_user_id,home_user_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", previousWeek)
    .eq("is_selected", true);
  const previousUsers = new Set((previousGotw ?? []).flatMap((row: any) => [row.away_user_id, row.home_user_id]).filter(Boolean));

  const rows = h2hGames.map((game) => {
    const homeRanking = powerRankings.get(game.home_user_id) ?? { ranking: 0.5, wins: 0, losses: 0 };
    const awayRanking = powerRankings.get(game.away_user_id) ?? { ranking: 0.5, wins: 0, losses: 0 };

    // Matchup competitiveness: how close the teams are in power ranking
    const rankingDiff = Math.abs(homeRanking.ranking - awayRanking.ranking);
    const competitiveness = 1 - Math.min(1, rankingDiff * 2);

    // Strength of schedule boost
    const sosBoost = ((homeRanking.wins + awayRanking.wins) / Math.max(1, weekNumber)) * 0.1;

    // H2H history boost (close historical matches are more interesting)
    const h2hKey = [game.home_user_id, game.away_user_id].sort().join(":");
    const h2h = h2hMap.get(h2hKey);
    const h2hBoost = h2h ? (1 - Math.abs(h2h.pointDifferential ?? 0) / Math.max(1, (h2h.wins + h2h.losses + h2h.ties) * 30)) * 0.15 : 0;

    // Division game bonus
    const isDivisionGame = game.away_team?.division === game.home_team?.division;
    const divisionBonus = isDivisionGame ? 0.2 : 0;

    // Previous GOTW penalty (give others a chance)
    const previousGotwUserFlag = previousUsers.has(game.away_user_id) || previousUsers.has(game.home_user_id);
    const previousGotwPenalty = previousGotwUserFlag ? -0.1 : 0;

    // Calculate overall strength rating (0-100 scale)
    const baseScore = 50;
    const powerScore = (homeRanking.ranking + awayRanking.ranking) / 2 * 30;
    const competitiveScore = competitiveness * 20;
    const totalScore = baseScore + powerScore + competitiveScore + (sosBoost * 10) + (h2hBoost * 5) + (divisionBonus * 10) + (previousGotwPenalty * 10);

    const strengthRating = Math.min(100, Math.max(0, totalScore));

    return {
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: game.id,
      stage,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      matchup_title: `${game.away_team?.name ?? "Away Team"} vs ${game.home_team?.name ?? "Home Team"}`,
      strength_rating: strengthRating,
      rating_breakdown: {
        powerScore: Number(powerScore.toFixed(1)),
        competitiveness: Number(competitiveness.toFixed(2)),
        divisionGame: isDivisionGame,
        h2hHistory: h2h ? { wins: h2h.wins, losses: h2h.losses, ties: h2h.ties } : null,
        previousGotwUser: previousGotwUserFlag
      },
      previous_gotw_user_flag: previousGotwUserFlag,
      is_selected: false,
      selection_source: "admin_select"
    };
  });

  if (rows.length) {
    const { error } = await supabase.from("rec_game_of_week_candidates").upsert(rows, { onConflict: "league_id,season_number,week_number,game_id" });
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("rec_game_of_week_candidates")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .order("strength_rating", { ascending: false });

  if (error) throw error;
  return { candidates: data ?? [], league, stage, seasonNumber, weekNumber };
}

function gotwQuestion(stage: string, weekNumber: number) {
  if (stage === "wild_card") return "Who will win their Wild Card matchup?";
  if (stage === "divisional") return "Who will win their Divisional matchup?";
  if (stage === "conference_championship") return "Who will win their Conference Championship matchup?";
  if (stage === "super_bowl") return "Who will win this year's Super Bowl?";
  return `Who will win Week ${weekNumber}'s GOTW?`;
}

export async function selectGotwCandidate(input: { guildId: string; candidateId: string; selectedByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: candidate, error } = await supabase.from("rec_game_of_week_candidates").select("*").eq("id", input.candidateId).single();
  if (error) throw error;
  await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq("league_id", candidate.league_id)
    .eq("season_number", candidate.season_number)
    .eq("week_number", candidate.week_number);
  const { data: selected, error: updateError } = await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: true, selected_by_discord_id: input.selectedByDiscordId, selected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.candidateId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  const question = gotwQuestion(selected.stage, selected.week_number);
  const { data: poll, error: pollError } = await supabase.from("rec_game_of_week_polls").upsert({
    league_id: selected.league_id,
    season_number: selected.season_number,
    week_number: selected.week_number,
    stage: selected.stage,
    game_id: selected.game_id,
    candidate_id: selected.id,
    question,
    away_team_id: selected.away_team_id,
    home_team_id: selected.home_team_id,
    away_team_name: selected.away_team_name,
    home_team_name: selected.home_team_name,
    status: "open",
    poll_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    away_user_id: selected.away_user_id,
    home_user_id: selected.home_user_id,
    vote_deadline_display: Object.fromEntries(formatAdvanceTimes(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()).map((t) => [t.label, t.value])),
    updated_at: new Date().toISOString()
  }, { onConflict: "league_id,season_number,week_number,game_id" }).select("*").single();
  if (pollError) throw pollError;
  const routes = await getRoutes(context.server_id);
  const discordIds = await resolveDiscordIdsByUser([selected.away_user_id, selected.home_user_id]);
  const awayDiscordId = selected.away_user_id ? (discordIds.get(String(selected.away_user_id)) ?? null) : null;
  const homeDiscordId = selected.home_user_id ? (discordIds.get(String(selected.home_user_id)) ?? null) : null;
  return { candidate: selected, poll, routes, channelId: routes?.announcements_channel_id ?? null, awayDiscordId, homeDiscordId };
}

export async function recordGotwPollMessage(input: { pollId: string; discordChannelId: string; discordMessageId?: string | null; discordThreadId?: string | null }) {
  const { data, error } = await supabase.from("rec_game_of_week_polls").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId ?? null, discord_thread_id: input.discordThreadId ?? null, updated_at: new Date().toISOString() }).eq("id", input.pollId).select("*").single();
  if (error) throw error;
  return { poll: data };
}

export async function recordGotwVote(input: { pollId: string; discordId: string; selectedTeamId: string }) {
  const { data: poll, error } = await supabase.from("rec_game_of_week_polls").select("*").eq("id", input.pollId).single();
  if (error) throw error;
  if (poll.status !== "open") return { recorded: false, reason: "Poll is closed.", poll };
  if (poll.poll_expires_at && new Date(poll.poll_expires_at).getTime() < Date.now()) return { recorded: false, reason: "Poll has expired.", poll };
  const selectedTeamName = String(input.selectedTeamId) === String(poll.away_team_id) ? poll.away_team_name : poll.home_team_name;
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const { data: vote, error: voteError } = await supabase.from("rec_game_of_week_votes").upsert({
    poll_id: input.pollId,
    league_id: poll.league_id,
    season_number: poll.season_number,
    week_number: poll.week_number,
    user_id: discord?.user_id ?? null,
    discord_id: input.discordId,
    selected_team_id: input.selectedTeamId,
    selected_team_name: selectedTeamName,
    voted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "poll_id,discord_id" }).select("*").single();
  if (voteError) throw voteError;
  const votes = await getGotwVotes(input.pollId);
  return { recorded: true, poll, vote, votes };
}

export async function getGotwVotes(pollId: string) {
  const { data: votes, error } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", pollId).order("voted_at", { ascending: true });
  if (error) throw error;
  return { votes: votes ?? [] };
}


export async function createActiveCheck(input: { guildId: string; createdByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: existingOpen, error: existingError } = await supabase
    .from("rec_active_check_events")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingOpen) {
    console.info("[active-check] create skipped; open active check already exists", {
      guildId: input.guildId,
      leagueId: context.league_id,
      eventId: existingOpen.id,
      closesAt: existingOpen.closes_at
    });
    return {
      event: existingOpen,
      channelId: routes?.announcements_channel_id ?? existingOpen.discord_channel_id ?? null,
      deadlineDisplay: deadlineDisplay(new Date(existingOpen.closes_at ?? closesAt)),
      alreadyOpen: true
    };
  }

  const { data, error } = await supabase.from("rec_active_check_events").insert({
    league_id: context.league_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    status: "open",
    discord_channel_id: routes?.announcements_channel_id ?? null,
    created_by_discord_id: input.createdByDiscordId,
    closes_at: closesAt,
    created_at: nowIso(),
    updated_at: nowIso()
  }).select("*").single();
  if (error) throw error;
  console.info("[active-check] created", {
    guildId: input.guildId,
    leagueId: context.league_id,
    eventId: data.id,
    seasonNumber,
    weekNumber,
    closesAt
  });
  return { event: data, channelId: routes?.announcements_channel_id ?? null, deadlineDisplay: deadlineDisplay(new Date(closesAt)), alreadyOpen: false };
}

export async function recordActiveCheckMessage(input: { eventId: string; discordChannelId: string; discordMessageId: string }) {
  const { data, error } = await supabase.from("rec_active_check_events").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId, updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (error) throw error;
  return { event: data };
}

export async function recordActiveCheckResponse(input: { eventId: string; discordId: string }) {
  const { data: event, error: eventError } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (eventError) throw eventError;
  if (event.status !== "open") return { recorded: false, reason: "Active Check is closed.", event };
  if (event.closes_at && new Date(event.closes_at).getTime() < Date.now()) return { recorded: false, reason: "Active Check has expired.", event };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC user profile.", event };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", event.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "You are not linked to an active team in this league.", event };
  const { data: response, error } = await supabase.from("rec_active_check_responses").upsert({
    event_id: input.eventId,
    league_id: event.league_id,
    user_id: discord.user_id,
    discord_id: input.discordId,
    team_id: assignment.team_id,
    responded_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  }, { onConflict: "event_id,user_id" }).select("*").single();
  if (error) throw error;
  return { recorded: true, event, response };
}

export async function getActiveCheckStatus(eventId: string) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", eventId).single();
  if (error) throw error;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("*").eq("event_id", eventId).order("responded_at", { ascending: true });
  if (responseError) throw responseError;
  return { event, responses: responses ?? [] };
}

export async function closeActiveCheck(input: { eventId: string }) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (error) throw error;
  if (event.status !== "open") return { closed: false, event, missing: [] };
  const { data: linkedUsers, error: linkedError } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,rec_users(display_name),rec_discord_accounts(discord_id)")
    .eq("league_id", event.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (linkedError) throw linkedError;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("user_id").eq("event_id", input.eventId);
  if (responseError) throw responseError;
  const responded = new Set((responses ?? []).map((row: any) => row.user_id));
  const missing = (linkedUsers ?? []).filter((row: any) => !responded.has(row.user_id));
  if (missing.length) {
    await supabase.from("rec_active_check_misses").insert(missing.map((row: any) => ({
      event_id: input.eventId,
      league_id: event.league_id,
      user_id: row.user_id,
      team_id: row.team_id,
      missed_at: nowIso(),
      created_at: nowIso()
    })));
  }
  const { data: updated, error: updateError } = await supabase.from("rec_active_check_events").update({ status: "closed", closed_at: nowIso(), updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (updateError) throw updateError;
  const context = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", event.league_id).maybeSingle();
  const routes = context.data?.server_id ? await getRoutes(context.data.server_id) : null;
  const discordRows = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", missing.map((m: any) => m.user_id));
  const discordByUser = new Map((discordRows.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  console.info("[active-check] closed", {
    eventId: input.eventId,
    leagueId: event.league_id,
    missingCount: missing.length
  });
  return { closed: true, event: updated, missing: missing.map((row: any) => ({ ...row, discord_id: discordByUser.get(row.user_id) ?? null })), commissionerOfficeChannelId: routes?.commissioner_office_channel_id ?? routes?.admin_import_log_channel_id ?? null };
}

export async function getOpenActiveChecks(guildId: string) {
  // The closeout loop polls every guild the bot is in, including ones that
  // never finished setup. Those have no league context — return empty rather
  // than 500 on every tick.
  const context = await findLeagueContext(guildId);
  if (!context) return { events: [] };
  const { data, error } = await supabase.from("rec_active_check_events").select("*").eq("league_id", context.league_id).eq("status", "open");
  if (error) throw error;
  return { events: data ?? [] };
}

export async function recordStreamPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null; content?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.streams_channel_id || routes.streams_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_streams_channel" };
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const content = input.content ?? "";
  const linkMatch = content.match(/https?:\/\/[^\s<>]+/i);
  // A stream post qualifies if it contains ANY url link, OR mentions the word "discord"
  // (case-insensitive). Either one triggers the stream payout.
  const hasStreamLink = Boolean(linkMatch);
  const mentionsDiscordStream = !hasStreamLink && /\bdiscord\b/i.test(content);
  const status = hasStreamLink ? "posted" : mentionsDiscordStream ? "pending_review" : "invalid";
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const row = {
    league_id: context.league_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? linkMatch?.[0] ?? null,
    posted_at: nowIso(),
    status,
    details: { hasStreamLink, mentionsDiscordStream, contentPreview: content.slice(0, 300), detectedUrl: linkMatch?.[0] ?? null },
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const { data, error } = await supabase.from("rec_stream_compliance_logs").insert(row).select("*").single();
  if (error) throw error;
  // Generate a payout review if the post is a valid stream (url link OR "discord" mention), not
  // offseason, AND it's the first stream this advance week (deduped per user/season/week below).
  let review = null;
  let inbox = null;
  const payoutBlocked = OFFSEASON_STAGES.has(stage);
  const isValidStreamPost = hasStreamLink || mentionsDiscordStream;
  if (isValidStreamPost && !payoutBlocked) {
    const { data: existingReview } = await supabase.from("rec_stream_payout_reviews").select("id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).maybeSingle();
    if (!existingReview) {
      const { data: reviewRow, error: reviewError } = await supabase.from("rec_stream_payout_reviews").upsert({
        stream_log_id: data.id,
        league_id: context.league_id,
        user_id: discord.user_id,
        team_id: assignment.team_id,
        season_number: seasonNumber,
        week_number: weekNumber,
        status: "pending",
        amount: 25,
        created_at: nowIso(),
        updated_at: nowIso()
      }, { onConflict: "stream_log_id" }).select("*").single();
      if (reviewError) throw reviewError;
      review = reviewRow;
      inbox = await upsertCommissionersInboxItem({
        guildId: input.guildId,
        serverId: context.server_id,
        leagueId: context.league_id,
        seasonNumber,
        weekNumber,
        queueType: "stream_payout",
        priority: 50,
        header: "STREAM PAYOUT REVIEW",
        summary: `Week ${weekNumber} stream payout for <@${input.discordId}>.`,
        requesterUserId: discord.user_id,
        requesterDiscordId: input.discordId,
        targetUserId: discord.user_id,
        targetDiscordId: input.discordId,
        teamId: assignment.team_id,
        amount: 25,
        sourceTable: "rec_stream_payout_reviews",
        sourceId: reviewRow.id,
        sourceReference: { type: "stream_payout_review", reviewId: reviewRow.id, streamLogId: data.id },
        payload: {
          reason: mentionsDiscordStream ? "discord_stream_needs_review" : "stream_link_payout",
          streamLogId: data.id,
          streamMessageUrl: input.messageUrl ?? null,
          contentPreview: content.slice(0, 300)
        }
      });
    }
  }
  // Stream-payout reviews are a payout approval, so they post to the pending payouts channel
  // (falling back to the legacy pending economy channel if payouts is unconfigured).
  return { recorded: true, log: data, review, inbox, needsReview: review !== null, invalidStreamPost: status === "invalid", shouldDelete: status === "invalid", pendingPayoutsChannelId: routes?.pending_payouts_channel_id ?? routes?.pending_economy_channel_id ?? null };
}

export async function reviewStreamPayout(input: { reviewId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const { data: review, error } = await supabase.from("rec_stream_payout_reviews").select("*").eq("id", input.reviewId).single();
  if (error) throw error;
  if (review.status !== "pending") return { updated: false, reason: "Review is not pending.", review };
  const { data: serverLink } = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", review.league_id).limit(1).maybeSingle();
  const guildId = serverLink?.server_id ? await getGuildIdForServer(serverLink.server_id) : null;
  if (input.action === "deny") {
    const { data, error: updateError } = await supabase.from("rec_stream_payout_reviews").update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, denied_reason: input.deniedReason ?? null, reviewed_at: nowIso(), updated_at: nowIso() }).eq("id", input.reviewId).select("*").single();
    if (updateError) throw updateError;
    const inbox = await updateCommissionersInboxBySource({
      guildId,
      queueType: "stream_payout",
      sourceTable: "rec_stream_payout_reviews",
      sourceId: input.reviewId,
      patch: {
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: nowIso(),
        review_reason: input.deniedReason ?? null
      }
    });
    return { updated: true, review: data, inbox };
  }
  const { data: ledger, error: ledgerError } = await supabase.from("rec_dollar_ledger").insert({
    user_id: review.user_id,
    league_id: review.league_id,
    amount: review.amount,
    transaction_type: "credit",
    description: `Approved stream payout - Week ${review.week_number}`,
    source: "system_award",
    source_reference: { type: "stream_payout_review", reviewId: review.id, streamLogId: review.stream_log_id },
    created_at: nowIso()
  }).select("id").single();
  if (ledgerError) throw ledgerError;
  const { data, error: updateError } = await supabase.from("rec_stream_payout_reviews").update({ status: "issued", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: nowIso(), issued_at: nowIso(), issued_ledger_id: ledger?.id ?? null, updated_at: nowIso() }).eq("id", input.reviewId).select("*").single();
  if (updateError) throw updateError;
  const inbox = await updateCommissionersInboxBySource({
    guildId,
    queueType: "stream_payout",
    sourceTable: "rec_stream_payout_reviews",
    sourceId: input.reviewId,
    patch: {
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: nowIso(),
      source_reference: { type: "stream_payout_review", reviewId: review.id, streamLogId: review.stream_log_id, ledgerId: ledger?.id ?? null }
    }
  });
  const { data: streamLog } = await supabase
    .from("rec_stream_compliance_logs")
    .select("discord_channel_id, discord_message_id")
    .eq("id", review.stream_log_id)
    .maybeSingle();
  return { updated: true, review: data, ledger, streamLog, inbox };
}

export async function settleGotwVotes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const currentWeek = league.current_week ?? 1;
  const { data: polls, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .lt("week_number", currentWeek)
    .in("status", ["open", "closed"]);
  if (error) throw error;
  const settled: any[] = [];
  for (const poll of polls ?? []) {
    const { data: game } = await supabase.from("rec_game_results").select("*").eq("league_id", poll.league_id).eq("season_number", poll.season_number).eq("week_number", poll.week_number).eq("home_team_id", poll.home_team_id).eq("away_team_id", poll.away_team_id).maybeSingle();
    const winningTeamId = game?.winning_team_id ?? (asNumber(game?.home_score) > asNumber(game?.away_score) ? game?.home_team_id : asNumber(game?.away_score) > asNumber(game?.home_score) ? game?.away_team_id : null);
    if (!winningTeamId) continue;
    const { data: votes } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", poll.id);
    for (const vote of votes ?? []) {
      const isCorrect = String(vote.selected_team_id) === String(winningTeamId);
      let ledgerId = vote.paid_ledger_id;
      if (isCorrect && vote.user_id && !vote.paid_ledger_id) {
        const { data: ledger } = await supabase.from("rec_dollar_ledger").insert({
          user_id: vote.user_id,
          league_id: poll.league_id,
          amount: 10,
          transaction_type: "credit",
          description: `Correct GOTW pick - Week ${poll.week_number}`,
          source: "system_award",
          source_reference: { type: "gotw_correct_guess", pollId: poll.id, voteId: vote.id },
          created_at: nowIso()
        }).select("id").single();
        ledgerId = ledger?.id ?? null;
      }
      await supabase.from("rec_game_of_week_votes").update({ is_correct: isCorrect, payout_amount: isCorrect ? 10 : 0, paid_ledger_id: ledgerId ?? null, settled_at: nowIso(), updated_at: nowIso() }).eq("id", vote.id);
      if (vote.user_id) {
        const { data: existing } = await supabase.from("rec_global_gotw_guessing_records").select("*").eq("user_id", vote.user_id).maybeSingle();
        const patch = {
          user_id: vote.user_id,
          correct_guesses: asNumber(existing?.correct_guesses) + (isCorrect ? 1 : 0),
          wrong_guesses: asNumber(existing?.wrong_guesses) + (isCorrect ? 0 : 1),
          last_result_at: nowIso(),
          updated_at: nowIso()
        };
        if (existing) await supabase.from("rec_global_gotw_guessing_records").update(patch).eq("user_id", vote.user_id);
        else await supabase.from("rec_global_gotw_guessing_records").insert({ ...patch, created_at: nowIso() });
      }
    }
    await supabase.from("rec_game_of_week_polls").update({ status: "settled", winning_team_id: winningTeamId, settled_at: nowIso(), updated_at: nowIso() }).eq("id", poll.id);
    settled.push({ pollId: poll.id, winningTeamId, votes: votes?.length ?? 0 });
  }
  return { settled };
}

// ── Wizard-friendly split advance steps ─────────────────────────────────────

function makeStepRunner() {
  const warnings: string[] = [];
  const completed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); completed.push(name); }
    catch (error) {
      console.error(`[ADVANCE] step "${name}" failed:`, error);
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return { step, warnings, completed };
}

export async function processAdvanceResults(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  let week: { previousWeek: number; weekNumber: number; previousStage: string; seasonStage: string; transitionBadgesEarned?: any[]; transitionBadgesRemoved?: any[] } | null = null;
  await step("advance_week", async () => { week = await advanceLeagueWeek(guildId); });
  await step("apply_records", () => applyAdvanceRecords(guildId));
  await step("game_payouts", () => issueWeeklyGamePayouts(guildId));
  await step("savings_interest", () => applyAdvanceSavingsInterest(guildId));
  await step("settle_gotw", () => settleGotwVotes(guildId));
  await step("evaluate_challenges", () => evaluateWeeklyChallenges(guildId));
  await step("stream_compliance", () => evaluateStreamCompliance(guildId));

  // Resolve discord IDs for any transition badges (season-end or playoff badges)
  const weekAny = week as any;
  const allTransitionEarned: any[] = weekAny?.transitionBadgesEarned ?? [];
  const allTransitionRemoved: any[] = weekAny?.transitionBadgesRemoved ?? [];
  const transitionUserIds = [...allTransitionEarned, ...allTransitionRemoved].map((b) => b.user_id);
  const transitionDiscordMap = transitionUserIds.length > 0 ? await resolveDiscordIdsByUser(transitionUserIds) : new Map<string, string>();

  const context = await getLeagueContext(guildId).catch(() => null);
  const routes = context ? await getRoutes(context.server_id).catch(() => null) : null;

  const transitionBadgeAnnouncements = {
    earned: allTransitionEarned.map((b) => ({
      userId: b.user_id,
      discordId: transitionDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      qualifier: BADGE_QUALIFIERS[b.badge_name] ?? "earning this badge"
    })),
    lost: allTransitionRemoved.map((b) => ({
      userId: b.user_id,
      discordId: transitionDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      reason: "their record was broken"
    })),
    announcementsChannelId: routes?.announcements_channel_id ?? null
  };

  // EOS award polls and REC Award nominees are now triggered manually via the
  // "Run EOS Polls & Awards" advance menu action — not automated during advance.
  const eosPollsData: any = null;
  const prevStage = weekAny?.previousStage ?? "";
  const newStage = weekAny?.seasonStage ?? "";

  let eosLockData: any = null;
  if (prevStage === "wild_card" && newStage === "divisional" && context) {
    try {
      const { lockEosAwardPolls } = await import("../eos-awards/eos-awards.service.js");
      const seasonNumber = context.rec_leagues?.season_number ?? context.rec_leagues?.display_season_number ?? 1;
      eosLockData = await lockEosAwardPolls(context.league_id, seasonNumber);
      if (eosLockData?.commissionerTiebreakers?.length) {
        eosLockData.pendingPayoutsChannelId = routes?.pending_payouts_channel_id ?? null;
      }
    } catch (err) {
      console.error("[processAdvanceResults] EOS poll lock failed:", err);
    }
  }

  // Nomination DMs: send after regular-season advances only. NOT on the week 18→wild_card transition.
  let nominationData: any = null;
  const isRegularSeasonAdvance = prevStage === "regular_season" && newStage === "regular_season";
  if (isRegularSeasonAdvance && context) {
    try {
      nominationData = await getNominationData(guildId);
      nominationData.sendNominationDms = true;
    } catch (err) {
      console.error("[processAdvanceResults] getNominationData failed:", err);
    }
  }

  return { week, completed, warnings, transitionBadgeAnnouncements, eosPollsData, eosLockData, nominationData };
}

export async function processPotwAward(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  let awards: any[] = [];
  let weeklyBadgesEarned: any[] = [];
  let weeklyBadgesRemoved: any[] = [];
  await step("calculate_potw", async () => { const r = await calculateRecPotw(guildId); awards = r.awards ?? []; });
  await step("potw_payouts", () => issueRecPotwPayouts(guildId));
  await step("assign_badges", async () => {
    const r = await assignWeeklyBadges(guildId);
    weeklyBadgesEarned = r.earned ?? [];
    weeklyBadgesRemoved = r.removed ?? [];
  });
  const context = await getLeagueContext(guildId).catch(() => null);
  const routes = context ? await getRoutes(context.server_id).catch(() => null) : null;

  const allBadgeUserIds = [...weeklyBadgesEarned, ...weeklyBadgesRemoved].map((b) => b.user_id);
  const badgeDiscordMap = allBadgeUserIds.length > 0 ? await resolveDiscordIdsByUser(allBadgeUserIds) : new Map<string, string>();

  const discordIds = await resolveDiscordIdsByUser(awards.map((a: any) => a.user_id));
  const announcementAwards = awards.map((award: any) => ({
    ...award,
    discordId: award.user_id ? discordIds.get(String(award.user_id)) ?? null : null
  }));

  const weeklyBadgeAnnouncements = {
    earned: weeklyBadgesEarned.map((b) => ({
      userId: b.user_id,
      discordId: badgeDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      qualifier: BADGE_QUALIFIERS[b.badge_name] ?? "earning this badge"
    })),
    lost: weeklyBadgesRemoved.map((b) => ({
      userId: b.user_id,
      discordId: badgeDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      reason: "their record was broken"
    }))
  };

  return { awards: announcementAwards, announcementsChannelId: routes?.announcements_channel_id ?? null, completed, warnings, weeklyBadgeAnnouncements };
}

export async function getAdvanceWizardOutcomes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = asNumber(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber, seasonStage);

  const { data: results } = await supabase
    .from("rec_game_results")
    .select("id,home_team_id,away_team_id,home_score,away_score,winning_team_id,source")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);

  const resultForGame = (game: any) => (results ?? []).find((result: any) =>
    String(result.home_team_id) === String(game.home_team_id) &&
    String(result.away_team_id) === String(game.away_team_id)
  );

  return {
    leagueName: league.name,
    seasonNumber,
    weekNumber,
    seasonStage,
    games: games.map((game: any, index: number) => {
      const result = resultForGame(game);
      return {
        number: index + 1,
        gameId: game.id,
        awayTeam: teamNickname(game.away_team?.name, "Away"),
        homeTeam: teamNickname(game.home_team?.name, "Home"),
        awayScore: result?.away_score ?? game.away_score ?? null,
        homeScore: result?.home_score ?? game.home_score ?? null,
        resultId: result?.id ?? null,
        outcomeOverride: game.advance_outcome_override ?? null,
        markedByDiscordId: game.advance_outcome_marked_by_discord_id ?? null,
        markedAt: game.advance_outcome_marked_at ?? null
      };
    })
  };
}

export async function markAdvanceWizardOutcomes(input: { guildId: string; markings: Array<{ gameId: string; outcome: string }>; markedByDiscordId?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = asNumber(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber, seasonStage);
  const validGameIds = new Set(games.map((game: any) => String(game.id)));
  const now = nowIso();
  const saved: any[] = [];

  for (const marking of input.markings) {
    const gameId = String(marking.gameId);
    const outcome = String(marking.outcome ?? "").trim().toLowerCase();
    if (!validGameIds.has(gameId)) throw new Error("Cannot mark an outcome for a game outside the current advance week.");
    if (!["fs", "fw"].includes(outcome)) throw new Error("Outcome markings must be FS or FW.");

    const { data, error } = await supabase
      .from("rec_games")
      .update({
        advance_outcome_override: outcome,
        advance_outcome_marked_by_discord_id: input.markedByDiscordId ?? null,
        advance_outcome_marked_at: now,
        updated_at: now
      })
      .eq("id", gameId)
      .eq("league_id", context.league_id)
      .select("id,advance_outcome_override")
      .single();
    if (error) throw error;
    saved.push(data);
  }

  return { saved, outcomes: await getAdvanceWizardOutcomes(input.guildId) };
}

export async function finalizeAdvanceStep(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  await step("generate_challenges", () => generateWeeklyChallenges({ guildId, regenerate: false }));
  return { completed, warnings };
}

// Creates GOTW polls for every H2H game in the current playoff week (wildcard/divisional/etc).
// In playoffs every matchup is a GOTW — this auto-creates candidates + polls for all of them.
export async function processPlayoffGotw(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = String(league.season_stage ?? "wild_card");
  const routes = await getRoutes(context.server_id);
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const h2hGames = games.filter((g) => g.home_user_id && g.away_user_id);
  const question = gotwQuestion(stage, weekNumber);
  const discordIds = await resolveDiscordIdsByUser(h2hGames.flatMap((g) => [g.home_user_id, g.away_user_id]));

  const polls: any[] = [];
  for (const game of h2hGames) {
    // Upsert candidate as selected
    const candidateRow = {
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: game.id,
      stage,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      matchup_title: `${game.away_team?.name ?? "Away"} vs ${game.home_team?.name ?? "Home"}`,
      strength_rating: 100,
      is_selected: true,
      selection_source: "playoff_auto",
      updated_at: new Date().toISOString()
    };
    await supabase.from("rec_game_of_week_candidates").upsert(candidateRow, { onConflict: "league_id,season_number,week_number,game_id" });

    const { data: poll } = await supabase.from("rec_game_of_week_polls").upsert({
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      stage,
      game_id: game.id,
      question,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      status: "open",
      poll_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      vote_deadline_display: Object.fromEntries(formatAdvanceTimes(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()).map((t) => [t.label, t.value])),
      updated_at: new Date().toISOString()
    }, { onConflict: "league_id,season_number,week_number,game_id" }).select("*").single();

    if (poll) {
      polls.push({
        ...poll,
        awayDiscordId: game.away_user_id ? discordIds.get(String(game.away_user_id)) ?? null : null,
        homeDiscordId: game.home_user_id ? discordIds.get(String(game.home_user_id)) ?? null : null
      });
    }
  }

  return { polls, channelId: routes?.announcements_channel_id ?? null };
}

// EOS payout preview: calculates projected end-of-season payouts from season standings without issuing.
// Triggers at regular_season → wildcard transition. Top finishers by record get tiered bonuses.
export async function previewEosPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: records, error } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .order("wins", { ascending: false });
  if (error) throw error;

  const sorted = [...(records ?? [])].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.point_differential ?? 0) - (a.point_differential ?? 0);
  });

  const discordIds = await resolveDiscordIdsByUser(sorted.map((r) => r.user_id));

  // EOS payout tiers (configurable defaults)
  const EOS_TIERS = [
    { rank: 1, label: "Regular Season Champion", amount: 250 },
    { rank: 2, label: "2nd Place", amount: 175 },
    { rank: 3, label: "3rd Place", amount: 125 },
    { rank: 4, label: "4th Place", amount: 100 },
    { rank: 5, label: "5th Place", amount: 75 },
    { rank: 6, label: "6th Place", amount: 75 },
    { rank: 7, label: "7th Place", amount: 50 },
    { rank: 8, label: "8th Place", amount: 50 }
  ];

  const items = sorted.map((record, idx) => {
    const rank = idx + 1;
    const tier = EOS_TIERS.find((t) => t.rank === rank);
    return {
      rank,
      userId: record.user_id,
      discordId: discordIds.get(String(record.user_id)) ?? null,
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
      pointDifferential: record.point_differential ?? 0,
      projectedPayout: tier?.amount ?? 0,
      payoutLabel: tier?.label ?? `Rank ${rank}`
    };
  });

  return { seasonNumber, weekNumber: league.current_week, items, totalPayout: items.reduce((sum, i) => sum + i.projectedPayout, 0) };
}

export async function runEosPollsAndAwards(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id).catch(() => null);
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const PLAYOFF_STAGES = ["wild_card", "divisional", "conference_championship", "super_bowl"];

  if (!PLAYOFF_STAGES.includes(stage)) {
    return { allowed: false, reason: "EOS polls and awards can only be run during Wild Card through Super Bowl weeks." };
  }

  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const announcementsChannelId = routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null;

  const warnings: string[] = [];
  let pollsData: any = null;
  try {
    const { createEosAwardPolls } = await import("../eos-awards/eos-awards.service.js");
    pollsData = await createEosAwardPolls(context.league_id, seasonNumber);
    pollsData.announcementsChannelId = announcementsChannelId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[runEosPollsAndAwards] EOS poll creation failed:", err);
    warnings.push(`eos_community_polls: ${message}`);
    pollsData = { polls: [], nominees: [], closesAt: null, announcementsChannelId };
  }

  try {
    const { generateAwardNominees } = await import("../rec-awards/rec-awards.service.js");
    const recAwardsData = await generateAwardNominees(guildId);
    pollsData.recAwardsData = recAwardsData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[runEosPollsAndAwards] REC award generation failed:", err);
    warnings.push(`rec_awards_generation: ${message}`);
    pollsData.recAwardsData = {
      generated: 0,
      awards: [],
      leagueId: context.league_id,
      seasonNumber,
      announcementsChannelId,
      error: message
    };
  }

  return { allowed: true, pollsData, stage, seasonNumber, warnings };
}

export async function issueEosPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const PLAYOFF_STAGES = ["wild_card", "divisional", "conference_championship", "super_bowl"];
  if (!PLAYOFF_STAGES.includes(stage)) {
    throw new Error("EOS payouts can only be issued during Wild Card through Super Bowl weeks.");
  }

  // Void any unissued items from the existing batch, then create a fresh one.
  const clearedBatch = await clearPendingEosBatch({ guildId, clearReason: "Superseded by new issuance" }).catch(() => null);

  const { data: routes } = await supabase.from("rec_server_routes").select("*").eq("server_id", context.server_id).maybeSingle() as any;
  const serverName = league.name ?? "REC League";

  // Fetch rank payouts through the DB RPC so ordering is deterministic across runs.
  const [rankRowsResult, statPayouts] = await Promise.all([
    supabase.rpc("rec_eos_rank_payouts", { p_league_id: leagueId, p_season_number: seasonNumber }),
    (async () => {
      const { computeEosStatPayouts } = await import("./eos-stat-payouts.service.js");
      return computeEosStatPayouts(leagueId, seasonNumber);
    })().catch((err) => { console.error("[issueEosPayouts] stat payout computation failed:", err); return []; })
  ]);

  if (rankRowsResult.error) throw rankRowsResult.error;

  // Build rank map: userId → { rank, label, amount, wins, losses, ties }
  const rankMap = new Map<string, { rank: number; label: string; rankAmount: number; wins: number; losses: number; ties: number }>();
  for (const record of rankRowsResult.data ?? []) {
    if (!record.user_id) continue;
    rankMap.set(String(record.user_id), {
      rank: asNumber(record.rank),
      label: record.rank_label ?? `Rank ${record.rank}`,
      rankAmount: asNumber(record.rank_amount),
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0
    });
  }

  // Build stat payout map: userId → statData
  const statMap = new Map<string, (typeof statPayouts)[number]>();
  for (const s of statPayouts) statMap.set(s.userId, s);

  // Union of all user IDs that have either rank or stat payouts
  const allUserIds = new Set<string>([...rankMap.keys(), ...statMap.keys()]);
  const discordIds = await resolveDiscordIdsByUser([...allUserIds]);

  const { data: batch, error: batchError } = await supabase
    .from("rec_eos_payout_batches")
    .insert({ league_id: leagueId, season_number: seasonNumber, batch_type: "eos_regular_season", status: "posted", posted_at: nowIso() })
    .select("*")
    .single();
  if (batchError) throw batchError;

  const items: any[] = [];
  const skippedAlreadyIssued: any[] = [];
  const { data: existingResolvedItems, error: existingResolvedError } = await supabase
    .from("rec_eos_payout_items")
    .select("id,user_id,payout_key,payout_label,amount,status,issued_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("status", ["issued"]);
  if (existingResolvedError) throw existingResolvedError;
  const issuedByPayoutKey = new Map((existingResolvedItems ?? []).map((item: any) => [String(item.payout_key), item]));

  for (const userId of allUserIds) {
    const rankData = rankMap.get(userId);
    const statData = statMap.get(userId);

    const rankAmount = rankData?.rankAmount ?? 0;
    const statTotal = statData?.total ?? 0;
    const grandTotal = rankAmount + statTotal;
    if (grandTotal === 0) continue;

    const rank = rankData?.rank ?? null;
    const statCategories = statData?.categories ?? [];
    const payoutKey = `eos:${leagueId}:${seasonNumber}:combined:${userId}`;
    const alreadyIssued = issuedByPayoutKey.get(payoutKey);
    if (alreadyIssued) {
      skippedAlreadyIssued.push({
        ...alreadyIssued,
        rank,
        discordId: discordIds.get(userId) ?? null,
        displayName: statData?.displayName ?? null,
        teamName: statData?.teamName ?? null,
        recalculatedAmount: grandTotal,
        originalAmount: asNumber(alreadyIssued.amount),
        reason: "already_issued"
      });
      continue;
    }

    const rankLabel = rankData?.label ?? null;
    const labelParts = [rankLabel, statTotal > 0 ? "Stat Bonuses" : null].filter(Boolean);
    const payoutLabel = labelParts.join(" + ") || "EOS Payout";

    const { data: item } = await supabase
      .from("rec_eos_payout_items")
      .insert({
        batch_id: batch.id,
        league_id: leagueId,
        user_id: userId,
        season_number: seasonNumber,
        payout_category: "eos_regular_season",
        payout_key: payoutKey,
        payout_label: payoutLabel,
        amount: grandTotal,
        status: "pending",
        metadata: {
          rank,
          rankAmount,
          rankLabel,
          wins: rankData?.wins ?? 0,
          losses: rankData?.losses ?? 0,
          ties: rankData?.ties ?? 0,
          statTotal,
          statCategories
        }
      })
      .select("*")
      .single();

    if (item) {
      items.push({
        ...item,
        rank,
        discordId: discordIds.get(userId) ?? null,
        displayName: statData?.displayName ?? null,
        teamName: statData?.teamName ?? null,
        wins: rankData?.wins ?? 0,
        losses: rankData?.losses ?? 0,
        ties: rankData?.ties ?? 0,
        rankAmount,
        statTotal,
        statCategories
      });
    }
  }

  // Sort by rank (ranked users first, then by stat total descending)
  items.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return b.amount - a.amount;
  });

  return {
    batchId: batch.id,
    items,
    skippedAlreadyIssued,
    supersededMessages: clearedBatch?.supersededMessages ?? [],
    seasonNumber,
    serverName,
    announcementsChannelId: routes?.announcements_channel_id ?? null,
    pendingPayoutsChannelId: routes?.pending_payouts_channel_id ?? null
  };
}

export async function approveEosPayoutItem(input: { itemId: string; discordId: string; role: "user" | "commissioner" }) {
  const { data: item, error } = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("id", input.itemId)
    .maybeSingle();
  if (error || !item) throw new Error("Payout item not found.");
  if (item.status === "issued") return { credited: false, reason: "already_issued", newBalance: null };
  if (item.status === "denied") return { credited: false, reason: "already_denied", newBalance: null };
  if (item.status === "voided") return { credited: false, reason: "already_voided", newBalance: null };

  const { data: discordRow } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const actorUserId = discordRow?.user_id ?? null;

  const patch: Record<string, any> = { updated_at: nowIso() };

  if (input.role === "user") {
    // Recipient must match the item's user
    if (actorUserId && String(actorUserId) !== String(item.user_id)) {
      return { credited: false, reason: "not_recipient", newBalance: null };
    }
    patch.user_approved_at = nowIso();
  } else {
    // Commissioner approval
    patch.approved_by_user_id = actorUserId ?? null;
    patch.approved_at = nowIso();
    patch.commissioner_user_id = actorUserId ?? null;
    patch.status = "approved";
  }

  await supabase.from("rec_eos_payout_items").update(patch).eq("id", input.itemId);

  // Re-fetch to check if both approvals are present
  const { data: updated } = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (!updated) throw new Error("Failed to fetch updated item.");

  const userApproved = Boolean(updated.user_approved_at);
  const commApproved = Boolean(updated.approved_at);

  if (userApproved && commApproved && updated.status !== "issued") {
    // Both approved — credit wallet
    const { data: batch } = await supabase.from("rec_eos_payout_batches").select("*").eq("id", updated.batch_id).maybeSingle();
    const credit = await creditUserWallet({
      userId: String(updated.user_id),
      leagueId: String(updated.league_id),
      seasonNumber: asNumber(updated.season_number),
      amount: asNumber(updated.amount),
      transactionType: "eos_payout",
      description: `${updated.payout_label} — Season ${updated.season_number} EOS Payout`,
      sourceReference: {
        itemId: updated.id,
        batchId: updated.batch_id,
        payoutKey: updated.payout_key,
        idempotencyKey: String(updated.payout_key ?? `eos:${updated.league_id}:${updated.season_number}:combined:${updated.user_id}`)
      }
    });
    await supabase.from("rec_eos_payout_items").update({
      status: "issued",
      issued_ledger_id: credit.ledger?.id ?? null,
      issued_at: nowIso(),
      updated_at: nowIso()
    }).eq("id", input.itemId);

    // Update batch status if all items issued
    const { data: batchItems } = await supabase.from("rec_eos_payout_items").select("status").eq("batch_id", updated.batch_id);
    const allIssued = (batchItems ?? []).every((i: any) => ["issued", "denied", "voided"].includes(i.status));
    if (allIssued && batch) {
      await supabase.from("rec_eos_payout_batches").update({ status: "issued", issued_at: nowIso(), updated_at: nowIso() }).eq("id", batch.id);
    }

    return { credited: true, amount: asNumber(updated.amount), newBalance: credit.wallet, payoutLabel: updated.payout_label };
  }

  // When the user approves via DM, return the commissioner channel info so the bot can
  // update the commissioner embed and ping roles without needing a guild context.
  let guildId: string | null = null;
  if (input.role === "user") {
    const serverLink = await supabase
      .from("rec_server_league_links")
      .select("server_id")
      .eq("league_id", String(updated.league_id))
      .maybeSingle();
    if (serverLink.data?.server_id) {
      const serverRow = await supabase
        .from("rec_discord_servers")
        .select("guild_id")
        .eq("id", serverLink.data.server_id)
        .maybeSingle();
      guildId = serverRow.data?.guild_id ?? null;
    }
  }

  return {
    credited: false,
    reason: input.role === "user" ? "awaiting_commissioner" : "awaiting_user",
    newBalance: null,
    commissionerChannelId: (updated.discord_channel_id as string | null) ?? null,
    commissionerMessageId: (updated.discord_message_id as string | null) ?? null,
    guildId,
    amount: asNumber(updated.amount),
    payoutLabel: updated.payout_label as string | null
  };
}

export async function recordEosPayoutMessage(input: { itemId: string; discordChannelId: string; discordMessageId: string }) {
  const { error } = await supabase
    .from("rec_eos_payout_items")
    .update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId, updated_at: nowIso() })
    .eq("id", input.itemId);
  if (error) throw error;
  return { recorded: true };
}

export async function rejectEosPayoutItem(input: { itemId: string; discordId: string }) {
  const { data: discordRow } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const actorUserId = discordRow?.user_id ?? null;

  const { data: item } = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (!item) throw new Error("Payout item not found.");
  if (["issued", "denied", "voided"].includes(item.status)) return { rejected: false, reason: "already_resolved" };

  await supabase.from("rec_eos_payout_items").update({
    status: "denied",
    denied_by_user_id: actorUserId ?? null,
    denied_at: nowIso(),
    updated_at: nowIso()
  }).eq("id", input.itemId);

  return { rejected: true, payoutLabel: item.payout_label, amount: asNumber(item.amount) };
}

export async function getEosBatchItems(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: batch } = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .in("status", ["posted", "partially_approved", "approved", "issued"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!batch) return { batch: null, items: [] };

  const { data: items } = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", batch.id)
    .order("created_at");

  const userIds = (items ?? []).map((i: any) => i.user_id).filter(Boolean);
  const discordMap = userIds.length > 0 ? await resolveDiscordIdsByUser(userIds) : new Map<string, string>();

  return {
    batch,
    items: (items ?? []).map((i: any) => ({
      ...i,
      discordId: discordMap.get(String(i.user_id)) ?? null
    }))
  };
}

// ─── Power Rankings ────────────────────────────────────────────────────────────

const OFFENSE_POSITIONS = new Set(["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]);
const DEFENSE_POSITIONS = new Set(["LE", "RE", "DT", "NT", "MLB", "LOLB", "ROLB", "CB", "FS", "SS"]);

function recentFormScore(userGames: Array<{ score: number; oppScore: number }>): number {
  // Last 3 games, most-recent weighted 3×, middle 2×, oldest 1×
  const last3 = userGames.slice(0, 3);
  const weights = [3, 2, 1];
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < last3.length; i++) {
    const { score, oppScore } = last3[i];
    const margin = score - oppScore;
    const gameScore = margin >= 14 ? 1.0 : margin >= 7 ? 0.85 : margin > 0 ? 0.70
      : margin === 0 ? 0.50 : margin >= -6 ? 0.30 : margin >= -13 ? 0.15 : 0.0;
    weightedSum += gameScore * weights[i];
    totalWeight += weights[i];
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
}

interface OvrAccum { sum: number; count: number }
function ovrAvg(a: OvrAccum) { return a.count > 0 ? a.sum / a.count : 0; }

export async function calculateAndStorePowerRankings(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  // Rankings are "as of" the week just completed (after advance, current_week is the NEW week)
  const completedWeek = Math.max(1, asNumber(league.current_week ?? 1) - 1);
  const newWeek = asNumber(league.current_week ?? 1);

  // ── 1. All teams in this league ─────────────────────────────────────────────
  const { data: teams, error: teamErr } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division")
    .eq("league_id", leagueId);
  if (teamErr) throw teamErr;
  if (!teams?.length) return { rankings: [], leagueName: league.name ?? "League", completedWeek, newWeek };

  // ── 2. All completed regular-season game results up through completed week ───
  const { data: allGames } = await supabase
    .from("rec_game_results")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", completedWeek)
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("week_number", { ascending: false });

  const games = allGames ?? [];

  // Build per-team game list { score, oppScore, oppTeamId, weekNumber }
  const teamGames = new Map<string, Array<{ score: number; oppScore: number; oppTeamId: string; weekNumber: number }>>();
  for (const g of games) {
    const homeId = String(g.home_team_id ?? "");
    const awayId = String(g.away_team_id ?? "");
    const home = asNumber(g.home_score);
    const away = asNumber(g.away_score);
    if (homeId) {
      if (!teamGames.has(homeId)) teamGames.set(homeId, []);
      teamGames.get(homeId)!.push({ score: home, oppScore: away, oppTeamId: awayId, weekNumber: asNumber(g.week_number) });
    }
    if (awayId) {
      if (!teamGames.has(awayId)) teamGames.set(awayId, []);
      teamGames.get(awayId)!.push({ score: away, oppScore: home, oppTeamId: homeId, weekNumber: asNumber(g.week_number) });
    }
  }

  // ── 3. Player OVR aggregated by team ─────────────────────────────────────────
  // Join rec_player_weekly_stats → rec_players to get overallRating per player/team
  const { data: playerStatRows } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, player_id, position, rec_players(raw_payload)")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .not("player_id", "is", null)
    .not("team_id", "is", null);

  // Dedupe by (team_id, player_id) — a player contributes one OVR reading per team
  const seenPlayerTeam = new Set<string>();
  const teamOvrMap = new Map<string, { all: OvrAccum; offense: OvrAccum; defense: OvrAccum }>();
  for (const row of playerStatRows ?? []) {
    const tid = String(row.team_id);
    const pid = String(row.player_id);
    const key = `${tid}:${pid}`;
    if (seenPlayerTeam.has(key)) continue;
    seenPlayerTeam.add(key);
    const ovr = asNumber((row as any).rec_players?.raw_payload?.overallRating);
    if (!ovr) continue;
    if (!teamOvrMap.has(tid)) teamOvrMap.set(tid, { all: { sum: 0, count: 0 }, offense: { sum: 0, count: 0 }, defense: { sum: 0, count: 0 } });
    const entry = teamOvrMap.get(tid)!;
    entry.all.sum += ovr; entry.all.count++;
    const pos = String(row.position ?? "").toUpperCase();
    if (OFFENSE_POSITIONS.has(pos)) { entry.offense.sum += ovr; entry.offense.count++; }
    if (DEFENSE_POSITIONS.has(pos)) { entry.defense.sum += ovr; entry.defense.count++; }
  }

  // ── 4. Stat leaders per team (best player by season composite score) ─────────
  // Accumulate season stats per (team_id, player_id)
  interface PlayerAccum {
    playerName: string; position: string;
    passYds: number; passTDs: number; passInts: number;
    rushYds: number; rushTDs: number;
    recYds: number; recTDs: number;
    defSacks: number; defInts: number; defTackles: number;
    weeks: number;
  }
  const playerAccumMap = new Map<string, PlayerAccum>();

  const { data: allPlayerStats } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, player_id, position, stats, rec_players(full_name)")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", completedWeek)
    .not("player_id", "is", null)
    .not("team_id", "is", null);

  for (const row of allPlayerStats ?? []) {
    const tid = String(row.team_id);
    const pid = String(row.player_id);
    const mapKey = `${tid}:${pid}`;
    const s = (row.stats ?? {}) as Record<string, any>;
    if (!playerAccumMap.has(mapKey)) {
      playerAccumMap.set(mapKey, {
        playerName: (row as any).rec_players?.full_name ?? "Unknown",
        position: String(row.position ?? "?").toUpperCase(),
        passYds: 0, passTDs: 0, passInts: 0,
        rushYds: 0, rushTDs: 0,
        recYds: 0, recTDs: 0,
        defSacks: 0, defInts: 0, defTackles: 0,
        weeks: 0
      });
    }
    const acc = playerAccumMap.get(mapKey)!;
    acc.passYds += readStat(s, "pass_yards"); acc.passTDs += readStat(s, "pass_tds"); acc.passInts += readStat(s, "interceptions_thrown");
    acc.rushYds += readStat(s, "rush_yards"); acc.rushTDs += readStat(s, "rush_tds");
    acc.recYds += readStat(s, "receiving_yards"); acc.recTDs += readStat(s, "receiving_tds");
    acc.defSacks += readStat(s, "sacks"); acc.defInts += readStat(s, "interceptions");
    acc.defTackles += readStat(s, "tackles");
    acc.weeks++;
  }

  // Score each player; find best per team
  function playerCompositeScore(acc: PlayerAccum): number {
    return acc.passYds * 0.04 + acc.passTDs * 4 - acc.passInts * 2
      + acc.rushYds * 0.06 + acc.rushTDs * 4
      + acc.recYds * 0.05 + acc.recTDs * 4
      + acc.defSacks * 7 + acc.defInts * 8 + acc.defTackles * 0.3;
  }
  function statLine(acc: PlayerAccum): string {
    const pos = acc.position;
    if (["QB"].includes(pos)) return `${acc.passYds.toLocaleString()} pass yds, ${acc.passTDs} TDs`;
    if (["HB", "FB"].includes(pos)) return `${acc.rushYds.toLocaleString()} rush yds, ${acc.rushTDs} TDs`;
    if (["WR", "TE"].includes(pos)) return `${acc.recYds.toLocaleString()} rec yds, ${acc.recTDs} TDs`;
    if (DEFENSE_POSITIONS.has(pos)) {
      const parts = [];
      if (acc.defSacks > 0) parts.push(`${acc.defSacks} sacks`);
      if (acc.defInts > 0) parts.push(`${acc.defInts} INTs`);
      if (acc.defTackles > 0) parts.push(`${acc.defTackles} tackles`);
      return parts.join(", ") || "—";
    }
    return `${acc.rushYds > acc.passYds ? acc.rushYds.toLocaleString() + " rush yds" : acc.passYds.toLocaleString() + " pass yds"}`;
  }

  // Best player per team_id
  const teamStatLeader = new Map<string, { name: string; pos: string; line: string; score: number }>();
  for (const [mapKey, acc] of playerAccumMap) {
    const tid = mapKey.split(":")[0];
    const score = playerCompositeScore(acc);
    const existing = teamStatLeader.get(tid);
    if (!existing || score > existing.score) {
      teamStatLeader.set(tid, { name: acc.playerName, pos: acc.position, line: statLine(acc), score });
    }
  }

  // ── 5. Previous rankings (for movement arrows) ───────────────────────────────
  const { data: prevRanks } = await supabase
    .from("rec_power_rankings")
    .select("team_id,rank")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek - 1);
  const prevRankByTeam = new Map((prevRanks ?? []).map((r: any) => [String(r.team_id), asNumber(r.rank)]));

  // ── 6. Compute score for each team ───────────────────────────────────────────
  // First pass: per-team stats for SOS (needs all win rates pre-computed)
  interface TeamStats {
    teamId: string; wins: number; losses: number; ties: number;
    played: number; pd: number; winPct: number;
  }
  const teamStats = new Map<string, TeamStats>();
  for (const team of teams) {
    const tid = String(team.id);
    const tGames = teamGames.get(tid) ?? [];
    let wins = 0, losses = 0, ties = 0, pd = 0;
    for (const g of tGames) {
      if (g.score > g.oppScore) wins++;
      else if (g.score < g.oppScore) losses++;
      else ties++;
      pd += g.score - g.oppScore;
    }
    const played = wins + losses + ties;
    teamStats.set(tid, { teamId: tid, wins, losses, ties, played, pd, winPct: played > 0 ? wins / played : 0 });
  }

  // League avg OVR for normalizing matchup advantage
  let leagueOffenseOvrSum = 0, leagueOffenseOvrCount = 0;
  let leagueDefenseOvrSum = 0, leagueDefenseOvrCount = 0;
  for (const [, entry] of teamOvrMap) {
    const offOvr = ovrAvg(entry.offense);
    const defOvr = ovrAvg(entry.defense);
    if (offOvr > 0) { leagueOffenseOvrSum += offOvr; leagueOffenseOvrCount++; }
    if (defOvr > 0) { leagueDefenseOvrSum += defOvr; leagueDefenseOvrCount++; }
  }
  const leagueAvgOffenseOvr = leagueOffenseOvrCount > 0 ? leagueOffenseOvrSum / leagueOffenseOvrCount : 75;
  const leagueAvgDefenseOvr = leagueDefenseOvrCount > 0 ? leagueDefenseOvrSum / leagueDefenseOvrCount : 75;

  // Second pass: compute full score
  interface RankEntry {
    teamId: string; teamName: string; abbreviation: string;
    wins: number; losses: number; ties: number; played: number; pd: number;
    winPct: number; avgPd: number; sosScore: number; recentForm: number;
    teamOvrScore: number; offenseOvr: number | null; defenseOvr: number | null;
    score: number;
    statLeaderName: string | null; statLeaderPos: string | null; statLeaderLine: string | null;
  }
  const rankEntries: RankEntry[] = [];

  for (const team of teams) {
    const tid = String(team.id);
    const ts = teamStats.get(tid) ?? { teamId: tid, wins: 0, losses: 0, ties: 0, played: 0, pd: 0, winPct: 0 };
    const tGames = teamGames.get(tid) ?? [];

    // Win %
    const winPct = ts.winPct;

    // Avg PD (normalized to 0-1 range with ±40 spread)
    const avgPd = ts.played > 0 ? ts.pd / ts.played : 0;
    const normPd = (Math.max(-40, Math.min(40, avgPd)) / 40 + 1) / 2;

    // Recent form: last 3 completed games (already sorted desc by week_number)
    const recentForm = recentFormScore(tGames.slice(0, 3));

    // SOS: average win% of opponents faced (only teams with played > 0)
    const opponentWinPcts: number[] = [];
    for (const g of tGames) {
      const oppStats = teamStats.get(g.oppTeamId);
      if (oppStats && oppStats.played > 0) opponentWinPcts.push(oppStats.winPct);
    }
    const sosScore = opponentWinPcts.length > 0
      ? opponentWinPcts.reduce((a, b) => a + b, 0) / opponentWinPcts.length
      : 0.5;

    // OVR component: normalize from typical Madden range (60-99)
    const ovrEntry = teamOvrMap.get(tid);
    const allOvr = ovrEntry ? ovrAvg(ovrEntry.all) : 0;
    const offOvr = ovrEntry ? ovrAvg(ovrEntry.offense) : 0;
    const defOvr = ovrEntry ? ovrAvg(ovrEntry.defense) : 0;

    let teamOvrScore = 0;
    if (allOvr > 0) {
      // Normalize: league avg Madden OVR is ~79; normalize so 99=1.0 and 60=0.0
      const normOvr = (allOvr - 60) / 39;
      // Matchup advantage: (offense OVR advantage over avg defense) + (defense advantage over avg offense)
      const offAdv = offOvr > 0 ? (offOvr - leagueAvgDefenseOvr) / 20 : 0;
      const defAdv = defOvr > 0 ? (defOvr - leagueAvgOffenseOvr) / 20 : 0;
      teamOvrScore = Math.max(0, Math.min(1, normOvr * 0.5 + (offAdv + defAdv) * 0.25 + 0.5));
    }

    // Final score (weights sum to 1.0)
    const score = winPct * 0.35 + normPd * 0.25 + recentForm * 0.15 + sosScore * 0.10 + teamOvrScore * 0.15;

    const leader = teamStatLeader.get(tid);
    rankEntries.push({
      teamId: tid,
      teamName: team.name ?? "Unknown",
      abbreviation: team.abbreviation ?? "???",
      wins: ts.wins, losses: ts.losses, ties: ts.ties, played: ts.played, pd: ts.pd,
      winPct, avgPd, sosScore, recentForm, teamOvrScore,
      offenseOvr: offOvr > 0 ? offOvr : null,
      defenseOvr: defOvr > 0 ? defOvr : null,
      score,
      statLeaderName: leader?.name ?? null,
      statLeaderPos: leader?.pos ?? null,
      statLeaderLine: leader?.line ?? null
    });
  }

  // Sort by score desc
  rankEntries.sort((a, b) => b.score - a.score || b.winPct - a.winPct || b.pd - a.pd);

  // ── 7. Upsert to rec_power_rankings ──────────────────────────────────────────
  const rows = rankEntries.map((entry, idx) => {
    const rank = idx + 1;
    const prevRank = prevRankByTeam.get(entry.teamId) ?? null;
    const rankChange = prevRank != null ? prevRank - rank : null;
    return {
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: newWeek,
      team_id: entry.teamId,
      rank,
      previous_rank: prevRank,
      rank_change: rankChange,
      score: entry.score,
      wins: entry.wins,
      losses: entry.losses,
      ties: entry.ties,
      games_played: entry.played,
      point_differential: entry.pd,
      win_pct: entry.winPct,
      avg_pd_per_game: entry.avgPd,
      sos_score: entry.sosScore,
      recent_form_score: entry.recentForm,
      team_ovr_score: entry.teamOvrScore,
      offense_ovr: entry.offenseOvr,
      defense_ovr: entry.defenseOvr,
      stat_leader_player_name: entry.statLeaderName,
      stat_leader_position: entry.statLeaderPos,
      stat_leader_stat_line: entry.statLeaderLine,
      updated_at: new Date().toISOString()
    };
  });

  if (rows.length) {
    const { error } = await supabase
      .from("rec_power_rankings")
      .upsert(rows, { onConflict: "league_id,season_number,week_number,team_id" });
    if (error) throw error;
  }

  const routes = await getRoutes(context.server_id).catch(() => null);

  return {
    rankings: rankEntries.map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
      previousRank: prevRankByTeam.get(entry.teamId) ?? null,
      rankChange: prevRankByTeam.has(entry.teamId) ? (prevRankByTeam.get(entry.teamId)! - (idx + 1)) : null
    })),
    leagueName: league.name ?? "League",
    completedWeek,
    newWeek,
    announcementsChannelId: routes?.announcements_channel_id ?? null
  };
}

const OFFSEASON_STAGES = new Set(["coach_hiring", "final_resigning", "free_agency", "draft", "preseason_training_camp"]);

export async function recordHighlightPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null; content?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.highlights_channel_id || routes.highlights_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_highlights_channel" };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const { data: existing } = await supabase.from("rec_highlight_posts").select("id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).maybeSingle();
  const isFirstThisWeek = !existing;
  const payoutEligible = isFirstThisWeek && !OFFSEASON_STAGES.has(stage);
  const { data: post, error } = await supabase.from("rec_highlight_posts").insert({
    league_id: context.league_id,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    season_stage: stage,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? null,
    content: (input.content ?? "").slice(0, 500),
    is_first_this_week: isFirstThisWeek,
    created_at: nowIso(),
    updated_at: nowIso()
  }).select("*").single();
  if (error) throw error;
  let inbox = null;
  if (payoutEligible) {
    inbox = await upsertCommissionersInboxItem({
      guildId: input.guildId,
      serverId: context.server_id,
      leagueId: context.league_id,
      seasonNumber,
      weekNumber,
      queueType: "highlight_payout",
      priority: 45,
      header: "HIGHLIGHT PAYOUT REVIEW",
      summary: `Week ${weekNumber} highlight payout for <@${input.discordId}>.`,
      requesterUserId: discord.user_id,
      requesterDiscordId: input.discordId,
      targetUserId: discord.user_id,
      targetDiscordId: input.discordId,
      teamId: assignment.team_id,
      amount: 25,
      sourceTable: "rec_highlight_posts",
      sourceId: post.id,
      sourceReference: { type: "highlight_payout", postId: post.id },
      payload: {
        highlightMessageUrl: input.messageUrl ?? null,
        contentPreview: (input.content ?? "").slice(0, 300),
        isFirstThisWeek,
        payoutEligible
      }
    });
  }
  return { recorded: true, post, inbox, isFirstThisWeek, payoutEligible, pendingPayoutsChannelId: routes?.pending_payouts_channel_id ?? null };
}

export async function approveHighlightPayout(input: { postId: string; discordId: string }) {
  const { data: post, error } = await supabase.from("rec_highlight_posts").select("*").eq("id", input.postId).single();
  if (error) throw error;
  if (post.payout_review_id) return { approved: false, reason: "Payout already issued for this post." };
  const credit = await creditUserWallet({
    userId: post.user_id,
    leagueId: post.league_id,
    seasonNumber: post.season_number,
    amount: 25,
    transactionType: "credit",
    description: `Highlight payout — Week ${post.week_number}`,
    sourceReference: { type: "highlight_payout", postId: post.id, idempotencyKey: `highlight_payout_${post.id}` }
  });
  await supabase.from("rec_highlight_posts").update({ payout_review_id: credit.ledger?.id ?? null, payout_issued: true, updated_at: nowIso() }).eq("id", input.postId);
  const { data: serverLink } = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", post.league_id).limit(1).maybeSingle();
  const guildId = serverLink?.server_id ? await getGuildIdForServer(serverLink.server_id) : null;
  const inbox = await updateCommissionersInboxBySource({
    guildId,
    queueType: "highlight_payout",
    sourceTable: "rec_highlight_posts",
    sourceId: post.id,
    patch: {
      status: "approved",
      reviewed_by_discord_id: input.discordId,
      reviewed_at: nowIso(),
      source_reference: { type: "highlight_payout", postId: post.id, ledgerId: credit.ledger?.id ?? null }
    }
  });
  return { approved: true, ledger: credit.ledger, inbox };
}

export async function denyHighlightPayout(input: { postId: string; discordId: string; deniedReason?: string | null }) {
  const { data: post, error } = await supabase.from("rec_highlight_posts").select("*").eq("id", input.postId).single();
  if (error) throw error;
  if (post.payout_issued) return { denied: false, reason: "Payout already issued for this post." };
  const { data: serverLink } = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", post.league_id).limit(1).maybeSingle();
  const guildId = serverLink?.server_id ? await getGuildIdForServer(serverLink.server_id) : null;
  const inbox = await updateCommissionersInboxBySource({
    guildId,
    queueType: "highlight_payout",
    sourceTable: "rec_highlight_posts",
    sourceId: post.id,
    patch: {
      status: "denied",
      reviewed_by_discord_id: input.discordId,
      reviewed_at: nowIso(),
      review_reason: input.deniedReason ?? "Denied by commissioner review."
    }
  });
  return { denied: true, inbox };
}

export async function submitPotyNomination(input: { guildId: string; nominatorDiscordId: string; nomineeDiscordId: string; potyCategory?: string; highlightId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const seasonNumber = context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1;
  const { data: nominator } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nominatorDiscordId).maybeSingle();
  if (!nominator?.user_id) return { recorded: false, reason: "nominator_unlinked" };
  const { data: nominee } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nomineeDiscordId).maybeSingle();
  if (!nominee?.user_id) return { recorded: false, reason: "nominee_unlinked" };
  const { error } = await supabase.from("rec_poty_nominations").upsert({
    league_id: context.league_id,
    season_number: seasonNumber,
    nominator_user_id: nominator.user_id,
    nominee_user_id: nominee.user_id,
    poty_category: input.potyCategory ?? null,
    highlight_id: input.highlightId ?? null,
    updated_at: nowIso()
  }, { onConflict: "league_id,season_number,nominator_user_id" });
  if (error) throw error;
  return { recorded: true };
}

export async function submitGotyNomination(input: { guildId: string; nominatorDiscordId: string; nominatedGameId: string; nominationNotes?: string }) {
  const context = await getLeagueContext(input.guildId);
  const seasonNumber = context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1;
  const { data: nominator } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nominatorDiscordId).maybeSingle();
  if (!nominator?.user_id) return { recorded: false, reason: "nominator_unlinked" };
  const { data: game } = await supabase.from("rec_game_results").select("id,home_team_id,away_team_id,rec_teams!rec_game_results_home_team_id_fkey(name),rec_teams!rec_game_results_away_team_id_fkey(name)").eq("id", input.nominatedGameId).maybeSingle();
  if (!game) return { recorded: false, reason: "game_not_found" };
  const { error } = await supabase.from("rec_goty_nominations").upsert({
    league_id: context.league_id,
    season_number: seasonNumber,
    nominator_user_id: nominator.user_id,
    nominated_game_id: input.nominatedGameId,
    home_team_label: (game as any)?.["rec_teams!rec_game_results_home_team_id_fkey"]?.name ?? null,
    away_team_label: (game as any)?.["rec_teams!rec_game_results_away_team_id_fkey"]?.name ?? null,
    nomination_notes: input.nominationNotes ?? null,
    updated_at: nowIso()
  }, { onConflict: "league_id,season_number,nominator_user_id" });
  if (error) throw error;
  return { recorded: true };
}

export async function getNominationData(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const currentWeek = league.current_week ?? 1;
  const completedWeek = Math.max(1, currentWeek - 1);

  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, rec_teams(name, abbreviation)")
    .eq("league_id", context.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const userIds = (assignments ?? []).map((a: any) => String(a.user_id)).filter(Boolean);

  const { data: discordAccounts } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .in("user_id", userIds);
  const discordMap = new Map<string, string>();
  for (const d of discordAccounts ?? []) {
    if (d.user_id && d.discord_id) discordMap.set(String(d.user_id), String(d.discord_id));
  }

  const teamMap = new Map<string, string>();
  for (const a of assignments ?? []) {
    const name = (a.rec_teams as any)?.name ?? (a.rec_teams as any)?.abbreviation ?? "Unknown";
    teamMap.set(String(a.user_id), name);
  }

  // POTY: only coaches who submitted a highlight in completedWeek
  const { data: highlights } = await supabase
    .from("rec_highlight_posts")
    .select("id,user_id,message_url")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek);

  const potyNominees = (highlights ?? [])
    .filter((h: any) => h.user_id && userIds.includes(String(h.user_id)))
    .map((h: any) => ({
      userId: String(h.user_id),
      discordId: discordMap.get(String(h.user_id)) ?? null,
      displayName: teamMap.get(String(h.user_id)) ?? "Unknown",
      highlightId: String(h.id),
      highlightUrl: h.message_url ?? null
    }));

  // GOTY: coaches who played an H2H game with ≤7pt margin in completedWeek
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,rec_teams!rec_game_results_home_team_id_fkey(name),rec_teams!rec_game_results_away_team_id_fkey(name)")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .eq("is_playoff", false)
    .eq("is_user_h2h", true);

  const gotyNominees: Array<{ userId: string; discordId: string | null; displayName: string; gameId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; label: string }> = [];
  const seenGames = new Set<string>();

  for (const g of games ?? []) {
    const margin = Math.abs(asNumber(g.home_score) - asNumber(g.away_score));
    if (margin > 7) continue;
    const homeTeam = (g as any)["rec_teams!rec_game_results_home_team_id_fkey"]?.name ?? "Home";
    const awayTeam = (g as any)["rec_teams!rec_game_results_away_team_id_fkey"]?.name ?? "Away";
    const homeScore = asNumber(g.home_score);
    const awayScore = asNumber(g.away_score);
    const label = `${awayTeam} @ ${homeTeam} (${awayScore}-${homeScore})`;
    const gameId = String(g.id);

    for (const userId of [String(g.home_user_id ?? ""), String(g.away_user_id ?? "")]) {
      if (!userId || !userIds.includes(userId)) continue;
      if (seenGames.has(`${userId}:${gameId}`)) continue;
      seenGames.add(`${userId}:${gameId}`);
      gotyNominees.push({
        userId,
        discordId: discordMap.get(userId) ?? null,
        displayName: teamMap.get(userId) ?? "Unknown",
        gameId,
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        label
      });
    }
  }

  return { potyNominees, gotyNominees, seasonNumber, weekNumber: completedWeek };
}

const DEV_TRAIT_TIER: Record<string, number> = { Normal: 0, Star: 1, Superstar: 2, XFactor: 3 };
const DEV_UPGRADE_PRIZE = 50;

export async function processDevUpgradePrizes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const { data: pending, error } = await supabase
    .from("rec_dev_upgrade_prizes")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("issued", false);
  if (error) throw error;
  if (!pending?.length) return { issued: 0, prizes: [] };
  const issued: any[] = [];
  for (const prize of pending) {
    if (!prize.user_id) continue;
    try {
      const credit = await creditUserWallet({
        userId: prize.user_id,
        leagueId: context.league_id,
        seasonNumber,
        amount: prize.prize_amount,
        transactionType: "credit",
        description: `Dev upgrade prize — ${prize.player_name ?? "Player"} upgraded from ${prize.old_dev_trait} to ${prize.new_dev_trait}`,
        sourceReference: { type: "dev_upgrade_prize", prizeId: prize.id, idempotencyKey: `dev_upgrade_${prize.id}` }
      });
      await supabase.from("rec_dev_upgrade_prizes").update({ issued: true, ledger_id: credit.ledger?.id ?? null }).eq("id", prize.id);
      issued.push({ ...prize, ledger: credit.ledger });
    } catch { /* non-fatal — log but continue */ }
  }
  return { issued: issued.length, prizes: issued };
}

export async function getLatestPowerRankings(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? 1);
  const currentWeek = asNumber(league.current_week ?? 1);

  const { data, error } = await supabase
    .from("rec_power_rankings")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", currentWeek)
    .order("rank", { ascending: true });
  if (error) throw error;
  return { rankings: data ?? [], leagueName: league.name ?? "League", currentWeek };
}

// ── Roster Viewer ─────────────────────────────────────────────────────────────

export async function getLeagueConferences(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data: teams } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division")
    .eq("league_id", context.league_id)
    .order("name");
  const confMap = new Map<string, Array<{ id: string; name: string; abbreviation: string; division: string }>>();
  for (const t of teams ?? []) {
    const conf = t.conference ?? "Unknown";
    if (!confMap.has(conf)) confMap.set(conf, []);
    confMap.get(conf)!.push({ id: t.id, name: t.name ?? t.abbreviation ?? "?", abbreviation: t.abbreviation ?? "?", division: t.division ?? "?" });
  }
  const conferences = Array.from(confMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cfTeams]) => ({ name, teams: cfTeams.sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name)) }));
  return { conferences };
}

const ROSTER_POSITION_GROUPS = [
  { label: "QB", positions: ["QB"], posOrder: false },
  { label: "RB", positions: ["HB", "RB"], posOrder: false },
  { label: "FB", positions: ["FB"], posOrder: false },
  { label: "WR", positions: ["WR"], posOrder: false },
  { label: "TE", positions: ["TE"], posOrder: false },
  { label: "OL", positions: ["LT", "LG", "C", "RG", "RT"], posOrder: true },
  { label: "DL", positions: ["LEDGE", "LE", "DT", "REDGE", "RE"], posOrder: true },
  { label: "LB", positions: ["MLB", "LOLB", "WILL", "ROLB", "SAM"], posOrder: true },
  { label: "CB", positions: ["CB"], posOrder: false },
  { label: "FS", positions: ["FS"], posOrder: false },
  { label: "SS", positions: ["SS"], posOrder: false },
] as const;

const ROSTER_POS_DISPLAY: Record<string, string> = {
  LEDGE: "LEdge", LE: "LEdge", DT: "DT", REDGE: "REdge", RE: "REdge",
  MLB: "Mike", LOLB: "Will", WILL: "Will", ROLB: "Sam", SAM: "Sam",
  LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT"
};

export async function getTeamRoster(guildId: string, teamId: string) {
  const context = await getLeagueContext(guildId);
  const { data: team } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division,madden_team_id")
    .eq("id", teamId)
    .eq("league_id", context.league_id)
    .maybeSingle();
  if (!team) return { error: "team_not_found" };

  const maddenTeamId = String(team.madden_team_id ?? "");
  const PAGE = 1000;
  const allPlayers: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("rec_players")
      .select("madden_player_id,full_name,position,dev_trait,overall_rating,raw_payload")
      .eq("league_id", context.league_id)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) break;
    allPlayers.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const teamPlayers = allPlayers.filter((p: any) => {
    const raw = typeof p.raw_payload === "object" && p.raw_payload !== null ? p.raw_payload : {};
    return String(raw.teamId ?? "") === maddenTeamId;
  });

  const posAll = ROSTER_POSITION_GROUPS.flatMap((g) => g.positions as readonly string[]);
  const posIndex = new Map(posAll.map((p, i) => [p, i]));
  const getOvr = (p: any) => asNumber(p.overall_rating ?? (typeof p.raw_payload === "object" && p.raw_payload !== null ? (p.raw_payload as any).overallRating : null) ?? 0);

  const groups = ROSTER_POSITION_GROUPS.map(({ label, positions, posOrder }) => {
    const posSet = new Set(positions as readonly string[]);
    let members = teamPlayers.filter((p: any) => posSet.has(String(p.position ?? "")));
    if (posOrder) {
      members.sort((a: any, b: any) => {
        const pa = String(a.position ?? "");
        const pb = String(b.position ?? "");
        const ia = posIndex.get(pa) ?? 999;
        const ib = posIndex.get(pb) ?? 999;
        return ia !== ib ? ia - ib : getOvr(b) - getOvr(a);
      });
    } else {
      members.sort((a: any, b: any) => getOvr(b) - getOvr(a));
    }
    return {
      label,
      posOrder,
      members: members.map((p: any) => {
        const raw = typeof p.raw_payload === "object" && p.raw_payload !== null ? p.raw_payload : {};
        const ovr = getOvr(p);
        const dev = p.dev_trait ?? (raw as any).devTrait ?? null;
        const years = Number((raw as any).contractYearsLeft ?? 0);
        const pos = String(p.position ?? "");
        const posLabel = posOrder ? (ROSTER_POS_DISPLAY[pos] ?? pos) : null;
        return { name: p.full_name ?? "Unknown", ovr, dev, years, posLabel };
      })
    };
  }).filter((g) => g.members.length > 0);

  return { team: { id: team.id, name: team.name, abbreviation: team.abbreviation, conference: team.conference, division: team.division }, groups };
}
