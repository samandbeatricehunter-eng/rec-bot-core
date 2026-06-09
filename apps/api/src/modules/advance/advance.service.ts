import { REC_GOTW_CORRECT_GUESS_PAYOUT, REC_POTW_PAYOUT_AMOUNT, REC_WEEKLY_CHALLENGE_PAYOUTS, calculateDefensivePotwScore, calculateOffensivePotwScore } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { calculateAdvanceGamePayouts } from "./advance-payouts.service.js";

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

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "game";
}

async function getLeagueContext(guildId: string) {
  const serverResult = await supabase
    .from("rec_discord_servers")
    .select("id,name,guild_id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (serverResult.error) throw serverResult.error;
  if (!serverResult.data) throw new Error("No REC Discord server record found for this guild.");

  const linkResult = await supabase
    .from("rec_server_league_links")
    .select("server_id, league_id")
    .eq("server_id", serverResult.data.id)
    .limit(1)
    .maybeSingle();
  if (linkResult.error) throw linkResult.error;
  if (!linkResult.data?.league_id) throw new Error("No league linked to this Discord server.");

  const leagueResult = await supabase
    .from("rec_leagues")
    .select("*")
    .eq("id", linkResult.data.league_id)
    .maybeSingle();
  if (leagueResult.error) throw leagueResult.error;
  if (!leagueResult.data) throw new Error("Linked REC league was not found.");

  return {
    server_id: serverResult.data.id,
    league_id: linkResult.data.league_id,
    rec_discord_servers: serverResult.data,
    rec_leagues: leagueResult.data
  } as any;
}

async function getRoutes(serverId: string) {
  const { data, error } = await supabase.from("rec_server_routes").select("*").eq("server_id", serverId).maybeSingle();
  if (error) throw error;
  return data as any;
}


function nowIso() {
  return new Date().toISOString();
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
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id,rec_teams(id,name,abbreviation,conference,division)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as any[];
}

async function getWalletBalance(userId: string) {
  const { data } = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", userId).maybeSingle();
  return { wallet: asNumber(data?.wallet_balance), savings: asNumber(data?.savings_balance) };
}

// BADGES SYSTEM
// Weekly and seasonal badge definitions and auto-assignment
const BADGE_DEFINITIONS = {
  // Weekly badges
  hot_streak: { name: "Hot Streak", tier: "gold", category: "weekly", description: "3+ wins in a row this season" },
  unstoppable: { name: "Unstoppable", tier: "gold", category: "weekly", description: "500+ points scored this week" },
  defensive_wall: { name: "Defensive Wall", tier: "silver", category: "weekly", description: "Opponent scored <10 points" },
  grind: { name: "Grind", tier: "bronze", category: "weekly", description: "Won a close game (≤7 point margin)" },
  shutout_king: { name: "Shutout King", tier: "platinum", category: "weekly", description: "Held opponent to 0 points" },
  challenge_master: { name: "Challenge Master", tier: "gold", category: "weekly", description: "Completed all 3 weekly challenge tiers" },
  perfect_week: { name: "Perfect Week", tier: "platinum", category: "weekly", description: "Won game + all 3 challenge tiers" },

  // Season-end badges
  champion: { name: "🏆 Champion", tier: "platinum", category: "season_end", description: "League champion" },
  runner_up: { name: "🥈 Runner-Up", tier: "gold", category: "season_end", description: "Playoff finals runner-up" },
  finals_appearance: { name: "Finals Appearance", tier: "gold", category: "season_end", description: "Made playoff finals" },
  playoff_clinch: { name: "Playoff Clinch", tier: "silver", category: "season_end", description: "Made playoffs" },
  most_points: { name: "Scoring Machine", tier: "gold", category: "season_end", description: "Most total points scored" },
  best_defense: { name: "Fort Knox", tier: "gold", category: "season_end", description: "Best defensive record" },
  comeback_king: { name: "Comeback King", tier: "silver", category: "season_end", description: "Won final game after losing streak" },
  iron_man: { name: "Iron Man", tier: "bronze", category: "season_end", description: "Played all games" }
};

async function assignWeeklyBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const completedWeek = Math.max(1, weekNumber - 1);

  const badgesToAssign: any[] = [];

  // Get all user records for this season
  const { data: seasonRecords } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,point_differential")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber);

  // Get this week's game results for individual game analysis
  const { data: weekGames } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek);

  // Get this week's challenge completions
  const { data: challenges } = await supabase
    .from("rec_weekly_challenges")
    .select("user_id,earned_tier,status")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .eq("status", "evaluated");

  const recordsByUser = new Map((seasonRecords ?? []).map((r: any) => [r.user_id, r]));
  const challengesByUser = new Map<string, any[]>();
  for (const challenge of challenges ?? []) {
    if (!challengesByUser.has(challenge.user_id)) challengesByUser.set(challenge.user_id, []);
    challengesByUser.get(challenge.user_id)?.push(challenge);
  }

  // Assign badges based on criteria
  for (const [userId, record] of recordsByUser) {
    const userChallenges = challengesByUser.get(userId) ?? [];
    const completedTiers = new Set(userChallenges.filter((c: any) => c.earned_tier).map((c: any) => c.earned_tier));

    // Hot Streak: 3+ consecutive wins
    if (record.wins >= 3) badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "hot_streak", earned_week: weekNumber });

    // Unstoppable: 500+ points this week (check against game scores)
    const userWeekGames = (weekGames ?? []).filter((g: any) => g.home_user_id === userId || g.away_user_id === userId);
    const weekScore = userWeekGames.reduce((sum: number, g: any) => sum + (g.home_user_id === userId ? g.home_score : g.away_score), 0);
    if (weekScore >= 500) badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "unstoppable", earned_week: weekNumber });

    // Defensive Wall: opponent <10 points
    for (const game of userWeekGames) {
      const oppScore = game.home_user_id === userId ? game.away_score : game.home_score;
      if (oppScore < 10) badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "defensive_wall", earned_week: weekNumber });
    }

    // Grind: close game win (≤7 margin)
    for (const game of userWeekGames) {
      const isHome = game.home_user_id === userId;
      const userScore = isHome ? game.home_score : game.away_score;
      const oppScore = isHome ? game.away_score : game.home_score;
      if (userScore > oppScore && (userScore - oppScore) <= 7) {
        badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "grind", earned_week: weekNumber });
      }
    }

    // Shutout King: opponent 0 points
    for (const game of userWeekGames) {
      const oppScore = game.home_user_id === userId ? game.away_score : game.home_score;
      if (oppScore === 0) badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "shutout_king", earned_week: weekNumber });
    }

    // Challenge Master: completed all 3 tiers (O-S, O-A, O-B, D-S, D-A, D-B)
    if (completedTiers.size >= 3) badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "challenge_master", earned_week: weekNumber });

    // Perfect Week: won + all challenge tiers
    if (record.wins > 0 && completedTiers.size >= 3) {
      badgesToAssign.push({ user_id: userId, league_id: context.league_id, badge_name: "perfect_week", earned_week: weekNumber });
    }
  }

  // Batch insert badges (avoiding duplicates)
  if (badgesToAssign.length > 0) {
    try {
      await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,earned_week" });
    } catch {
      // Badge assignment errors are non-fatal
    }
  }

  return { assigned: badgesToAssign.length };
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

async function creditUserWallet(input: {
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
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .update({ wallet_balance: asNumber(currentWallet.wallet_balance) + input.amount, updated_at: nowIso() })
      .eq("id", currentWallet.id);
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

function statValue(stats: any, keys: string[]) {
  return pickStat(stats ?? {}, keys);
}

function wonGame(game: any, teamId: string) {
  if (String(game.home_team_id) === String(teamId)) return asNumber(game.home_score) > asNumber(game.away_score);
  if (String(game.away_team_id) === String(teamId)) return asNumber(game.away_score) > asNumber(game.home_score);
  return false;
}

function userTeamSide(game: any, userId: string) {
  if (game.home_user_id === userId) return { teamId: game.home_team_id, opponentTeamId: game.away_team_id, score: asNumber(game.home_score), oppScore: asNumber(game.away_score), location: "Home" };
  if (game.away_user_id === userId) return { teamId: game.away_team_id, opponentTeamId: game.home_team_id, score: asNumber(game.away_score), oppScore: asNumber(game.home_score), location: "Away" };
  return null;
}

async function getCompletedResultForChallenge(challenge: any) {
  if (challenge.game_id) {
    const byTeams = await supabase
      .from("rec_game_results")
      .select("*")
      .eq("league_id", challenge.league_id)
      .eq("season_number", challenge.season_number)
      .eq("week_number", challenge.week_number)
      .or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`)
      .limit(1)
      .maybeSingle();
    if (byTeams.data) return byTeams.data as any;
  }
  const result = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", challenge.league_id)
    .eq("season_number", challenge.season_number)
    .eq("week_number", challenge.week_number)
    .or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`)
    .limit(1)
    .maybeSingle();
  return result.data as any;
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

export async function setLeagueWeek(input: { guildId: string; seasonNumber?: number; weekNumber: number; seasonStage: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    current_phase: input.seasonStage === "regular_season" ? "regular_season" : input.seasonStage === "offseason" ? "offseason" : "playoffs",
    updated_at: new Date().toISOString()
  };
  if (input.seasonNumber) patch.season_number = input.seasonNumber;
  const { data, error } = await supabase.from("rec_leagues").update(patch).eq("id", context.league_id).select("*").single();
  if (error) throw error;
  const features = await getLeagueFeatureSettings(context.league_id);
  const economyEnabled = Boolean(features?.coin_economy_enabled);
  const warning = economyEnabled
    ? "Economy is active. Setting the week manually does not trigger payouts for previous weeks. To catch up prior weeks, import and advance each week using catch-up mode."
    : null;
  return { league: data, warning, economyEnabled };
}

export async function viewEconomyConfig(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { routes: await getRoutes(context.server_id), league: context.rec_leagues };
}

export async function setEconomyConfig(input: { guildId: string; pendingEconomyChannelId?: string; pendingPayoutsChannelId?: string; gameChannelsCategoryId?: string; commissionerOfficeChannelId?: string; streamsChannelId?: string; highlightsChannelId?: string; announcementsChannelId?: string; commissionerRoleId?: string; compCommitteeRoleId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = { server_id: context.server_id, updated_at: new Date().toISOString() };
  if (input.pendingEconomyChannelId !== undefined) patch.pending_economy_channel_id = input.pendingEconomyChannelId;
  if (input.pendingPayoutsChannelId !== undefined) patch.pending_payouts_channel_id = input.pendingPayoutsChannelId;
  if (input.gameChannelsCategoryId !== undefined) patch.game_channels_category_id = input.gameChannelsCategoryId;
  if (input.commissionerOfficeChannelId !== undefined) patch.commissioner_office_channel_id = input.commissionerOfficeChannelId;
  if (input.streamsChannelId !== undefined) patch.streams_channel_id = input.streamsChannelId;
  if (input.highlightsChannelId !== undefined) patch.highlights_channel_id = input.highlightsChannelId;
  if (input.announcementsChannelId !== undefined) patch.announcements_channel_id = input.announcementsChannelId;
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
  await supabase.from("rec_eos_payout_items").update({ status: "voided", updated_at: new Date().toISOString() }).eq("batch_id", batch.id).eq("status", "pending");
  const { data: updated, error: updateError } = await supabase
    .from("rec_eos_payout_batches")
    .update({ status: "cleared", clear_reason: input.clearReason, cleared_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return { cleared: true, batch: updated };
}

async function getWeekGames(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function generateWeeklyChallenges(input: { guildId: string; regenerate?: boolean }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  if (input.regenerate) {
    await supabase.from("rec_weekly_challenges").update({ status: "voided", updated_at: new Date().toISOString() }).eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  }
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const rows: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id, opponentUserId: game.away_user_id, location: "home" },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id, opponentUserId: game.home_user_id, location: "away" }
    ].filter((side) => side.userId && side.teamId);
    for (const side of sides) {
      rows.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, challenge_side: "offense", challenge_key: "fallback_pass_yards", target_type: "team", s_tier_goal: "Throw for 350+ yards and win", a_tier_goal: "Throw for 250+ yards and win", b_tier_goal: "Win the game" });
      rows.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, challenge_side: "defense", challenge_key: "fallback_hold_qb", target_type: "player", target_player_name: "Opponent QB", target_player_position: "QB", s_tier_goal: "Hold opponent QB under 225 passing yards and win", a_tier_goal: "Hold opponent QB under 275 passing yards and win", b_tier_goal: "Win the game" });
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("rec_weekly_challenges").upsert(rows, { onConflict: "league_id,season_number,week_number,user_id,challenge_side", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { generated: rows.length, weekNumber, seasonNumber };
}

export async function getChallengeAudit(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const weekNumber = league.current_week ?? 1;
  const { data, error } = await supabase
    .from("rec_weekly_challenges")
    .select("*, rec_users(display_name), rec_teams(name,abbreviation)")
    .eq("league_id", context.league_id)
    .gte("week_number", Math.max(1, weekNumber - 2))
    .order("week_number", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { challenges: data ?? [] };
}

export async function getGameChannelPlans(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const advanceTimes = formatAdvanceTimes(league.next_advance_at);
  const plans = games.filter((g) => g.home_user_id && g.away_user_id).map((game) => ({
    leagueId: context.league_id,
    seasonNumber,
    weekNumber,
    gameId: game.id,
    channelName: slug(`${game.away_team?.name ?? "away"}-vs-${game.home_team?.name ?? "home"}`),
    awayTeamId: game.away_team_id,
    homeTeamId: game.home_team_id,
    awayTeamName: game.away_team?.name ?? "Away Team",
    homeTeamName: game.home_team?.name ?? "Home Team",
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    categoryId: routes?.game_channels_category_id ?? null,
    nextAdvanceTimes: advanceTimes,
    streamingRequired: false,
    streamingRequirement: "Based on league settings",
    fourthDownRules: "Use league settings.",
    schedulingRules: "Scheduling, Activity & Sportsmanship rules apply."
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


function getScorePair(game: any) {
  const home = asNumber(game.home_score);
  const away = asNumber(game.away_score);
  return { home, away };
}

function isCompletedGame(game: any) {
  const { home, away } = getScorePair(game);
  return game.status === "final" || game.status === "completed" || home > 0 || away > 0 || game.is_tie || game.winning_user_id || game.losing_user_id;
}

function gameApplyKey(game: any) {
  return [game.league_id, game.season_number, game.week_number, game.external_game_id ?? game.id].join(":");
}

async function incrementRecord(table: string, match: Record<string, any>, patch: Record<string, any>) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  if (existing) {
    const gamesPlayed = asNumber(existing.games_played) + asNumber(patch.games_played);
    const pointDifferential = asNumber(existing.point_differential) + asNumber(patch.point_differential);
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) update[key] = asNumber(existing[key]) + asNumber(value);
    if ("games_played" in patch) update.avg_point_differential = gamesPlayed ? pointDifferential / gamesPlayed : 0;
    await supabase.from(table).update(update).match(match);
  } else {
    const gamesPlayed = asNumber(patch.games_played);
    const pointDifferential = asNumber(patch.point_differential);
    await supabase.from(table).insert({ ...match, ...patch, avg_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0 });
  }
}

async function incrementH2h(table: string, match: Record<string, any>, userAResult: { wins: number; losses: number; ties: number; pointDifferential: number }) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  const gamesPlayed = asNumber(existing?.games_played) + 1;
  const pointDifferential = asNumber(existing?.user_a_point_differential) + userAResult.pointDifferential;
  const row = {
    ...match,
    user_a_wins: asNumber(existing?.user_a_wins) + userAResult.wins,
    user_a_losses: asNumber(existing?.user_a_losses) + userAResult.losses,
    user_a_ties: asNumber(existing?.user_a_ties) + userAResult.ties,
    user_a_point_differential: pointDifferential,
    games_played: gamesPlayed,
    avg_user_a_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0,
    last_played_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing) await supabase.from(table).update(row).match(match);
  else await supabase.from(table).insert(row);
}

export async function applyAdvanceRecords(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const { data: games, error } = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .is("records_applied_at", null);
  if (error) throw error;
  let applied = 0;
  for (const game of games ?? []) {
    if (!isCompletedGame(game)) continue;
    const applyKey = gameApplyKey(game);
    const { home, away } = getScorePair(game);
    const participants = [
      { userId: game.home_user_id, teamId: game.home_team_id, score: home, oppScore: away },
      { userId: game.away_user_id, teamId: game.away_team_id, score: away, oppScore: home }
    ].filter((p) => p.userId);
    for (const p of participants) {
      const win = p.score > p.oppScore ? 1 : 0;
      const loss = p.score < p.oppScore ? 1 : 0;
      const tie = p.score === p.oppScore ? 1 : 0;
      const delta = p.score - p.oppScore;
      const patch = { wins: win, losses: loss, ties: tie, games_played: 1, point_differential: delta };
      await incrementRecord("rec_global_user_records", { user_id: p.userId }, patch).catch(() => undefined);
      await incrementRecord("rec_league_user_records", { league_id: context.league_id, user_id: p.userId }, patch).catch(() => undefined);
      await incrementRecord("rec_season_user_records", { league_id: context.league_id, season_number: seasonNumber, user_id: p.userId }, patch).catch(() => undefined);
    }
    if (game.home_user_id && game.away_user_id) {
      const ids = [game.home_user_id, game.away_user_id].sort();
      const userAIsHome = ids[0] === game.home_user_id;
      const userAPd = userAIsHome ? home - away : away - home;
      const userAResult = { wins: userAPd > 0 ? 1 : 0, losses: userAPd < 0 ? 1 : 0, ties: userAPd === 0 ? 1 : 0, pointDifferential: userAPd };
      await incrementH2h("rec_user_h2h_global_records", { user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
      await incrementH2h("rec_user_h2h_league_records", { league_id: context.league_id, user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
    }
    await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: applyKey, updated_at: new Date().toISOString() }).eq("id", game.id);
    applied += 1;
  }
  return { applied };
}

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
    .select("*, rec_players(id,player_external_id,position,player_name,league_id), rec_teams(id,name,abbreviation)")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw error;
  const candidates: any[] = [];
  for (const row of statsRows ?? []) {
    const stats = row.stats ?? row.raw_payload ?? {};
    const assignment = [...eligible.values()].find((a: any) => String(a.team_id) === String(row.team_id));
    if (!assignment) continue;
    const conference = assignment.rec_teams?.conference ?? "Unknown";
    const position = row.rec_players?.position ?? row.position ?? null;
    const playerName = row.rec_players?.player_name ?? row.player_name ?? "Unknown Player";
    const offensiveScore = calculateOffensivePotwScore({ position, passYds: asNumber(row.pass_yards), passTDs: asNumber(row.pass_touchdowns), passInts: asNumber(row.pass_interceptions), rushYds: asNumber(row.rush_yards), rushTDs: asNumber(row.rush_touchdowns), recYds: asNumber(row.receiving_yards), recTDs: asNumber(row.receiving_touchdowns), receptions: asNumber(row.receptions) });
    const defensiveScore = calculateDefensivePotwScore({ sacks: asNumber(row.sacks), ints: asNumber(row.interceptions), defensiveTDs: asNumber(row.defensive_touchdowns), forcedFumbles: asNumber(row.forced_fumbles), tackles: asNumber(row.tackles), tacklesForLoss: asNumber(row.tackles_for_loss) });
    candidates.push({ row, assignment, conference, position, playerName, offensiveScore, defensiveScore });
  }
  const awards: any[] = [];
  for (const conference of [...new Set(candidates.map((c) => c.conference))]) {
    const group = candidates.filter((c) => c.conference === conference);
    const offense = group.sort((a, b) => b.offensiveScore - a.offensiveScore)[0];
    const defense = group.sort((a, b) => b.defensiveScore - a.defensiveScore)[0];
    for (const [side, winner, score] of [["offense", offense, offense?.offensiveScore], ["defense", defense, defense?.defensiveScore]] as const) {
      if (!winner || !score || score <= 0) continue;
      awards.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, conference, award_side: side, award_source: "rec_calculated", player_external_id: String(winner.row.rec_players?.player_external_id ?? winner.row.player_external_id ?? ""), player_name: winner.playerName, position: winner.position, team_id: winner.assignment.team_id, user_id: winner.assignment.user_id, score, payout_amount: REC_POTW_PAYOUT_AMOUNT, raw_payload: winner.row.raw_payload ?? {} });
    }
  }
  if (awards.length) await supabase.from("rec_weekly_player_awards").upsert(awards, { onConflict: "league_id,season_number,week_number,conference,award_side,award_source" });
  return { awards };
}


export async function evaluateWeeklyChallenges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: challenges, error } = await supabase
    .from("rec_weekly_challenges")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .eq("status", "active");
  if (error) throw error;

  let evaluated = 0;
  let paid = 0;

  for (const challenge of challenges ?? []) {
    const game = await getCompletedResultForChallenge(challenge);
    if (!game || typeof game.home_score !== "number" || typeof game.away_score !== "number") continue;
    const side = userTeamSide(game, challenge.user_id);
    if (!side) continue;
    const didWin = side.score > side.oppScore;
    let earnedTier: "S" | "A" | "B" | null = didWin ? "B" : null;
    const details: Record<string, unknown> = { didWin, score: side.score, opponentScore: side.oppScore };

    if (didWin) {
      if (challenge.challenge_key === "fallback_pass_yards") {
        const { data: passRows } = await supabase
          .from("rec_import_staging_player_stats")
          .select("*")
          .eq("league_id", context.league_id)
          .eq("season_number", seasonNumber)
          .eq("week_number", completedWeek)
          .eq("stat_category", "passing");
        const teamPassingYards = (passRows ?? [])
          .filter((row: any) => String(row.raw_payload?.teamId ?? row.team_external_id ?? row.team_id) === String(side.teamId) || String(row.team_id) === String(side.teamId))
          .reduce((sum: number, row: any) => sum + statValue(row.stats ?? row.raw_payload, ["passYds"]), 0);
        details.teamPassingYards = teamPassingYards;
        if (teamPassingYards >= 350) earnedTier = "S";
        else if (teamPassingYards >= 250) earnedTier = "A";
      } else if (challenge.challenge_key === "fallback_hold_qb") {
        const { data: passRows } = await supabase
          .from("rec_import_staging_player_stats")
          .select("*")
          .eq("league_id", context.league_id)
          .eq("season_number", seasonNumber)
          .eq("week_number", completedWeek)
          .eq("stat_category", "passing");
        const opponentPassingYards = (passRows ?? [])
          .filter((row: any) => String(row.raw_payload?.teamId ?? row.team_external_id ?? row.team_id) === String(side.opponentTeamId) || String(row.team_id) === String(side.opponentTeamId))
          .reduce((sum: number, row: any) => sum + statValue(row.stats ?? row.raw_payload, ["passYds"]), 0);
        details.opponentPassingYards = opponentPassingYards;
        if (opponentPassingYards < 225) earnedTier = "S";
        else if (opponentPassingYards < 275) earnedTier = "A";
      }
    }

    const amount = earnedTier ? REC_WEEKLY_CHALLENGE_PAYOUTS[earnedTier] : 0;
    let ledgerId: string | null = null;
    if (amount > 0) {
      const credit = await creditUserWallet({
        userId: challenge.user_id,
        leagueId: context.league_id,
        seasonNumber,
        amount,
        transactionType: "weekly_challenge",
        description: `${challenge.challenge_side === "offense" ? "Offensive" : "Defensive"} Weekly Challenge - ${earnedTier} Tier`,
        sourceReference: {
          idempotencyKey: `weekly_challenge:${challenge.id}:${earnedTier}`,
          type: "weekly_challenge",
          challengeId: challenge.id,
          tier: earnedTier,
          weekNumber: completedWeek
        }
      });
      ledgerId = credit.ledger?.id ?? null;
      if (credit.created) paid += amount;
    }

    const { error: updateError } = await supabase
      .from("rec_weekly_challenges")
      .update({
        status: "evaluated",
        earned_tier: earnedTier,
        earned_amount: amount,
        evaluation_details: details,
        evaluated_at: nowIso(),
        paid_ledger_id: ledgerId,
        updated_at: nowIso()
      })
      .eq("id", challenge.id);
    if (updateError) throw updateError;
    evaluated += 1;
  }

  return { evaluated, paid, weekNumber: completedWeek, seasonNumber };
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
  const requirement = stage === "regular_season" ? features?.regular_season_streaming_requirement ?? features?.streaming_requirement : features?.postseason_streaming_requirement ?? features?.streaming_requirement;
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
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const { data: challenges } = await supabase.from("rec_weekly_challenges").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const { data: channels } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const completedWeek = Math.max(1, weekNumber - 1);
  const { data: awards } = await supabase.from("rec_weekly_player_awards").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", completedWeek);
  const { data: payouts } = await supabase
    .from("rec_dollar_ledger")
    .select("user_id,amount,transaction_type,description,source_reference,created_at")
    .eq("league_id", context.league_id)
    .eq("season_id", null)
    .in("transaction_type", ["weekly_challenge", "potw", "gotw_correct_guess", "stream_payout"]);
  const { data: wallets } = await supabase.from("rec_wallets").select("user_id,wallet_balance,savings_balance");
  const walletByUser = new Map((wallets ?? []).map((wallet: any) => [wallet.user_id, wallet]));
  const { data: discordAccounts } = await supabase.from("rec_discord_accounts").select("user_id,discord_id");
  const discordByUser = new Map((discordAccounts ?? []).map((d: any) => [d.user_id, d.discord_id]));
  const payloads: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeam: game.away_team?.name ?? "Opponent", location: "Home", opponentUserId: game.away_user_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeam: game.home_team?.name ?? "Opponent", location: "Away", opponentUserId: game.home_user_id }
    ].filter((s) => s.userId);
    for (const side of sides) {
      const gameChannel = (channels ?? []).find((c: any) => c.game_id === game.id);
      payloads.push({
        userId: side.userId,
        discordId: discordByUser.get(side.userId),
        leagueName: league.name,
        serverName: context.rec_discord_servers?.name ?? "",
        seasonNumber,
        weekNumber,
        seasonStage: league.season_stage,
        nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at),
        matchup: { opponent: side.opponentTeam, location: side.location, gameType: side.opponentUserId ? "User H2H" : "CPU", gameChannelId: gameChannel?.discord_channel_id ?? null },
        streaming: { required: false, requirement: "Based on league settings" },
        challenges: (challenges ?? []).filter((c: any) => c.user_id === side.userId),
        payouts: (payouts ?? [])
          .filter((payout: any) => payout.user_id === side.userId && asNumber(payout.source_reference?.weekNumber) === completedWeek)
          .map((payout: any) => ({ label: payout.description ?? payout.transaction_type, amount: payout.amount ?? 0, type: payout.transaction_type })),
        walletBalance: walletByUser.get(side.userId)?.wallet_balance ?? 0,
        potwAwards: (awards ?? []).filter((a: any) => a.user_id === side.userId).map((a: any) => ({ label: `${a.conference} ${a.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW`, playerName: a.player_name, amount: a.payout_amount ?? REC_POTW_PAYOUT_AMOUNT })),
        gotw: { isParticipant: false, message: "Go to /menu to vote for the H2H GOTW winner. Correct guesses may earn a payout." },
        deadlines: []
      });
    }
  }
  return { payloads };
}

export async function issueWeeklyGamePayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = asNumber(league.current_week ?? 1);

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

export async function runPostAdvanceAutomation(input: string | { guildId: string; mode?: "normal" | "catch_up" }) {
  const guildId = typeof input === "string" ? input : input.guildId;
  const mode = typeof input === "string" ? "normal" : input.mode ?? "normal";
  await applyAdvanceRecords(guildId);
  await issueWeeklyGamePayouts(guildId);
  await settleGotwVotes(guildId);
  await evaluateWeeklyChallenges(guildId);
  await calculateRecPotw(guildId);
  await issueRecPotwPayouts(guildId);
  await evaluateStreamCompliance(guildId);
  await generateWeeklyChallenges({ guildId, regenerate: false });
  await assignWeeklyBadges(guildId);

  if (mode === "catch_up") {
    return {
      ok: true,
      mode,
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
    ok: true,
    mode,
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
  if (stage === "conference_championship") return "Who will win their Conference matchup?";
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
  return { candidate: selected, poll, routes, channelId: routes?.announcements_channel_id ?? null };
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
  return { event: data, channelId: routes?.announcements_channel_id ?? null, deadlineDisplay: deadlineDisplay(new Date(closesAt)) };
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
  return { closed: true, event: updated, missing: missing.map((row: any) => ({ ...row, discord_id: discordByUser.get(row.user_id) ?? null })), commissionerOfficeChannelId: routes?.commissioner_office_channel_id ?? routes?.admin_import_log_channel_id ?? null };
}

export async function getOpenActiveChecks(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_active_check_events").select("*").eq("league_id", context.league_id).eq("status", "open");
  if (error) throw error;
  return { events: data ?? [] };
}

export async function recordStreamPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null; content?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.streams_channel_id || routes.streams_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_streams_channel" };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const content = input.content ?? "";
  const linkMatch = content.match(/https?:\/\/[^\s<>]+/i);
  const hasLegitStreamLink = Boolean(linkMatch && /(twitch\.tv|youtube\.com|youtu\.be|kick\.com|facebook\.com\/gaming|discord\.gg|discord\.com\/channels)/i.test(linkMatch[0]));
  const mentionsDiscordStream = !hasLegitStreamLink && /\bdiscord\b/i.test(content);
  const status = hasLegitStreamLink ? "posted" : mentionsDiscordStream ? "pending_review" : "invalid";
  const row = {
    league_id: context.league_id,
    season_number: league.season_number ?? league.display_season_number ?? 1,
    week_number: league.current_week ?? 1,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? linkMatch?.[0] ?? null,
    posted_at: nowIso(),
    status,
    details: { hasLegitStreamLink, mentionsDiscordStream, contentPreview: content.slice(0, 300), detectedUrl: linkMatch?.[0] ?? null },
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const { data, error } = await supabase.from("rec_stream_compliance_logs").insert(row).select("*").single();
  if (error) throw error;
  let review = null;
  if (mentionsDiscordStream) {
    const { data: reviewRow, error: reviewError } = await supabase.from("rec_stream_payout_reviews").upsert({
      stream_log_id: data.id,
      league_id: context.league_id,
      user_id: discord.user_id,
      team_id: assignment.team_id,
      season_number: row.season_number,
      week_number: row.week_number,
      status: "pending",
      amount: 5,
      created_at: nowIso(),
      updated_at: nowIso()
    }, { onConflict: "stream_log_id" }).select("*").single();
    if (reviewError) throw reviewError;
    review = reviewRow;
  }
  return { recorded: true, log: data, review, needsReview: mentionsDiscordStream, invalidStreamPost: status === "invalid", shouldDelete: status === "invalid", pendingEconomyChannelId: routes?.pending_economy_channel_id ?? null };
}

export async function reviewStreamPayout(input: { reviewId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const { data: review, error } = await supabase.from("rec_stream_payout_reviews").select("*").eq("id", input.reviewId).single();
  if (error) throw error;
  if (review.status !== "pending") return { updated: false, reason: "Review is not pending.", review };
  if (input.action === "deny") {
    const { data, error: updateError } = await supabase.from("rec_stream_payout_reviews").update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, denied_reason: input.deniedReason ?? null, reviewed_at: nowIso(), updated_at: nowIso() }).eq("id", input.reviewId).select("*").single();
    if (updateError) throw updateError;
    return { updated: true, review: data };
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
  const { data: streamLog } = await supabase
    .from("rec_stream_compliance_logs")
    .select("discord_channel_id, discord_message_id")
    .eq("id", review.stream_log_id)
    .maybeSingle();
  return { updated: true, review: data, ledger, streamLog };
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
    const { data: game } = await supabase.from("rec_game_results").select("*").eq("league_id", poll.league_id).eq("season_number", poll.season_number).eq("week_number", poll.week_number).or(`external_game_id.eq.${poll.game_id},id.eq.${poll.game_id}`).maybeSingle();
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
