import { isChampionshipWeek, isCfb, regularSeasonWeeks, type LeagueGame } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

// Every source a game result can legitimately be logged from — box-score OCR,
// schedule-screenshot import (weekly scores), manual commissioner entry, the
// week-advance score entry, and the Madden EA companion-app import are all equally
// final results and must count toward records/W-L the same way. (commissioner_advance
// used to be excluded here and only fed the display-records table — but leagues that
// advance weeks without ever uploading a box score had the *majority* of their games
// silently missing from official/global records. madden_companion_import had the same
// gap for every Madden league: EA-imported games never appeared in season/career/global
// records at all, only in the display-records table.)
export const OFFICIAL_RESULT_SOURCES = ["box_score", "box_score_screenshot", "schedule_screenshot", "manual", "commissioner_advance", "madden_companion_import"] as const;
export const DISPLAY_ADVANCE_SOURCE = "commissioner_advance";

// A single canonical key per REAL game, shared across every source that can log a result
// for it. Each source previously prefixed its own key format (manual:..., boxscore:game:...,
// schedule:..., advance:...), so the same real game logged through two different paths (e.g.
// a manual placeholder score later corrected by an approved box score) created two separate
// rows that both counted in every aggregation reading this table — silently double-counting
// that game's win/loss/point-differential. Keying by game_id when available means whichever
// source reports a game LAST simply overwrites the same row instead of duplicating it.
export function gameResultsApplyKey(input: {
  gameId?: string | null;
  leagueId: string;
  seasonNumber: number;
  weekNumber: number | null | undefined;
  homeTeamId: string;
  awayTeamId: string;
}): string {
  return input.gameId
    ? `game:${input.gameId}`
    : `noGame:${input.leagueId}:${input.seasonNumber}:${input.weekNumber ?? 0}:${input.homeTeamId}:${input.awayTeamId}`;
}

export type RecordTotals = {
  wins: number;
  losses: number;
  ties: number;
  playoffWins: number;
  playoffLosses: number;
  superbowlWins: number;
  superbowlLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  gamesPlayed: number;
};

export function emptyRecordTotals(): RecordTotals {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    playoffWins: 0,
    playoffLosses: 0,
    superbowlWins: 0,
    superbowlLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesPlayed: 0,
  };
}

export function baselineFromLegacyJson(raw: Record<string, unknown> | null | undefined): RecordTotals {
  const base = emptyRecordTotals();
  if (!raw) return base;
  base.wins = Number(raw.wins) || 0;
  base.losses = Number(raw.losses) || 0;
  base.ties = Number(raw.ties) || 0;
  base.playoffWins = Number(raw.playoff_wins) || 0;
  base.playoffLosses = Number(raw.playoff_losses) || 0;
  base.superbowlWins = Number(raw.superbowl_wins) || 0;
  base.superbowlLosses = Number(raw.superbowl_losses) || 0;
  base.pointsFor = Number(raw.points_for) || 0;
  base.pointsAgainst = Number(raw.points_against) || 0;
  base.pointDifferential = Number(raw.point_differential) || 0;
  base.gamesPlayed = Number(raw.games_played) || base.wins + base.losses + base.ties;
  return base;
}

export function mergeRecordTotals(base: RecordTotals, delta: RecordTotals): RecordTotals {
  const gamesPlayed = base.gamesPlayed + delta.gamesPlayed;
  const pointDifferential = base.pointDifferential + delta.pointDifferential;
  return {
    wins: base.wins + delta.wins,
    losses: base.losses + delta.losses,
    ties: base.ties + delta.ties,
    playoffWins: base.playoffWins + delta.playoffWins,
    playoffLosses: base.playoffLosses + delta.playoffLosses,
    superbowlWins: base.superbowlWins + delta.superbowlWins,
    superbowlLosses: base.superbowlLosses + delta.superbowlLosses,
    pointsFor: base.pointsFor + delta.pointsFor,
    pointsAgainst: base.pointsAgainst + delta.pointsAgainst,
    pointDifferential,
    gamesPlayed,
  };
}

function isPlayoffWeek(weekNumber: number | null | undefined, game: LeagueGame) {
  return Number(weekNumber ?? 0) > regularSeasonWeeks(game);
}

function isSuperBowlWeek(weekNumber: number | null | undefined, game: LeagueGame) {
  return isChampionshipWeek(weekNumber, game);
}

function applyGameResult(
  totals: RecordTotals,
  userId: string,
  row: {
    home_user_id?: string | null;
    away_user_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    week_number?: number | null;
    is_tie?: boolean | null;
  },
  game: LeagueGame = null,
) {
  const homeScore = Number(row.home_score ?? 0);
  const awayScore = Number(row.away_score ?? 0);
  const isHome = row.home_user_id === userId;
  const isAway = row.away_user_id === userId;
  if (!isHome && !isAway) return;

  const pointsFor = isHome ? homeScore : awayScore;
  const pointsAgainst = isHome ? awayScore : homeScore;
  const isTie = row.is_tie === true || homeScore === awayScore;
  const isWin = !isTie && pointsFor > pointsAgainst;
  const isLoss = !isTie && pointsFor < pointsAgainst;
  const playoff = isPlayoffWeek(row.week_number, game);
  const superBowl = isSuperBowlWeek(row.week_number, game);

  // Lifetime/all-games totals are inclusive of everything (regular + postseason);
  // playoff_wins/superbowl_wins are an additional breakdown, not a separate bucket.
  // Season-scoped callers that want regular-season-only records pre-filter their
  // input rows instead of relying on this function to split them.
  totals.gamesPlayed += 1;
  totals.pointsFor += pointsFor;
  totals.pointsAgainst += pointsAgainst;
  totals.pointDifferential += pointsFor - pointsAgainst;

  if (isTie) totals.ties += 1;
  else if (isWin) totals.wins += 1;
  else if (isLoss) totals.losses += 1;

  if (playoff) {
    if (isTie) { /* no playoff win/loss on ties */ }
    else if (isWin) totals.playoffWins += 1;
    else if (isLoss) totals.playoffLosses += 1;
  }

  if (superBowl) {
    if (isTie) { /* no sb win/loss on ties */ }
    else if (isWin) totals.superbowlWins += 1;
    else if (isLoss) totals.superbowlLosses += 1;
  }
}

function aggregateResultsForUser(
  userId: string,
  rows: Array<{
    home_user_id?: string | null;
    away_user_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    week_number?: number | null;
    is_tie?: boolean | null;
  }>,
  game: LeagueGame = null,
): RecordTotals {
  const totals = emptyRecordTotals();
  for (const row of rows) applyGameResult(totals, userId, row, game);
  return totals;
}

function recordRowFromTotals(totals: RecordTotals, extra: Record<string, unknown> = {}) {
  const avgPointDifferential = totals.gamesPlayed > 0
    ? Math.round((totals.pointDifferential / totals.gamesPlayed) * 100) / 100
    : 0;
  return {
    wins: totals.wins,
    losses: totals.losses,
    ties: totals.ties,
    playoff_wins: totals.playoffWins,
    playoff_losses: totals.playoffLosses,
    superbowl_wins: totals.superbowlWins,
    superbowl_losses: totals.superbowlLosses,
    points_for: totals.pointsFor,
    points_against: totals.pointsAgainst,
    point_differential: totals.pointDifferential,
    games_played: totals.gamesPlayed,
    avg_point_differential: avgPointDifferential,
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

function allGamesRecordRowFromTotals(totals: RecordTotals, championshipWins: number, extra: Record<string, unknown> = {}) {
  // recordRowFromTotals already computes playoff_wins/playoff_losses/superbowl_losses
  // correctly from totals (baseline + box-score games merged) — only superbowl_wins needs
  // overriding here, to fold in manual championship credits on top of box-score-detected
  // ones. A previous version hardcoded playoff_wins/playoff_losses/superbowl_losses to 0
  // unconditionally, discarding real data (e.g. legacy-baseline playoff history) that had
  // just been correctly computed one line above.
  return {
    ...recordRowFromTotals(totals, extra),
    superbowl_wins: championshipWins,
  };
}

function hasAnyRecordStat(totals: RecordTotals) {
  return totals.gamesPlayed > 0
    || totals.wins > 0
    || totals.losses > 0
    || totals.ties > 0
    || totals.playoffWins > 0
    || totals.playoffLosses > 0
    || totals.superbowlWins > 0
    || totals.superbowlLosses > 0
    || totals.pointsFor > 0
    || totals.pointsAgainst > 0
    || totals.pointDifferential !== 0;
}


function filterResultsByStatsCredit(userId, results, creditStartsAt) {
  if (creditStartsAt == null) return results;
  const startMs = new Date(creditStartsAt).getTime();
  if (Number.isNaN(startMs)) return results;
  const epoch = 0;
  return results.filter((row) => {
    // Only filter rows involving this user; other rows are irrelevant to their aggregation path.
    if (row.home_user_id !== userId && row.away_user_id !== userId) return true;
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : epoch;
    const ts = Number.isNaN(createdMs) ? epoch : createdMs;
    return ts >= startMs;
  });
}

async function loadActiveStatsCreditStarts(leagueId, userIds) {
  const map = new Map();
  if (!userIds?.length) return map;
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id,stats_credit_starts_at")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("user_id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    map.set(row.user_id, row.stats_credit_starts_at ?? null);
  }
  return map;
}

async function loadStatsCreditStartsByUserLeague(userIds) {
  /** @type {Map<string, Map<string, string|null>>} userId -> leagueId -> creditStartsAt */
  const map = new Map();
  if (!userIds?.length) return map;
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id,league_id,stats_credit_starts_at")
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("user_id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    let byLeague = map.get(row.user_id);
    if (!byLeague) {
      byLeague = new Map();
      map.set(row.user_id, byLeague);
    }
    byLeague.set(row.league_id, row.stats_credit_starts_at ?? null);
  }
  return map;
}

async function loadOfficialResultsForLeagueSeason(leagueId: string, seasonNumber: number) {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,week_number,is_tie,source,records_apply_key,created_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

async function loadOfficialResultsForLeague(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,week_number,is_tie,season_number,source,created_at")
    .eq("league_id", leagueId)
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

async function loadAllOfficialResults() {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,week_number,is_tie,league_id,source,created_at")
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

// rec_team_game_stats rows whose league_id/game_id no longer resolve to a live row -- a league
// hard-deleted before preserveGlobalContributionsBeforeLeagueDelete existed (live since
// 2026-07-29) took its rec_games/rec_game_results rows with it but left the raw per-team stat
// rows behind (170 rows / 1 dead league / 7 affected users as of 2026-08-25). Every global
// record rebuild only ever read rec_game_results, so these games were invisible to every W/L/
// points aggregation for those users, permanently -- this recovers them from the one place
// their data actually survived. One row per TEAM per game here (unlike rec_game_results' one
// row per game), so dedupe by game_id: keeping both rows would double-count every recovered
// game for both users.
async function loadOrphanedGameResults() {
  const { data, error } = await supabase
    .from("rec_team_game_stats")
    .select("game_id,league_id,week_number,user_id,opponent_user_id,is_home,points_for,points_against,result")
    .not("game_id", "is", null)
    .not("user_id", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (!rows.length) return [];

  const leagueIds = [...new Set(rows.map((row) => String(row.league_id)))];
  const { data: liveLeagues, error: leagueError } = await supabase.from("rec_leagues").select("id").in("id", leagueIds);
  if (leagueError) throw leagueError;
  const liveLeagueIds = new Set((liveLeagues ?? []).map((row: any) => String(row.id)));

  const gameIds = [...new Set(rows.map((row) => String(row.game_id)))];
  const { data: liveGames, error: gameError } = await supabase.from("rec_games").select("id").in("id", gameIds);
  if (gameError) throw gameError;
  const liveGameIds = new Set((liveGames ?? []).map((row: any) => String(row.id)));

  const orphaned = rows.filter((row) => !liveLeagueIds.has(String(row.league_id)) || !liveGameIds.has(String(row.game_id)));
  const byGame = new Map<string, (typeof orphaned)[number]>();
  for (const row of orphaned) {
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, row);
  }
  return [...byGame.values()].map((row) => {
    const isHome = row.is_home ?? true;
    return {
      home_user_id: isHome ? row.user_id : row.opponent_user_id,
      away_user_id: isHome ? row.opponent_user_id : row.user_id,
      home_score: isHome ? row.points_for : row.points_against,
      away_score: isHome ? row.points_against : row.points_for,
      week_number: row.week_number,
      is_tie: row.result === "tie",
      league_id: row.league_id,
      source: "orphaned_team_game_stats" as const,
      created_at: null,
    };
  });
}

async function loadLeagueGamesMap(leagueIds: string[]) {
  if (!leagueIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("rec_leagues").select("id,game").in("id", leagueIds);
  if (error) throw error;
  return new Map<string, LeagueGame>((data ?? []).map((row: any) => [String(row.id), (row.game ?? "madden_26") as LeagueGame]));
}

async function loadManualChampionshipCredits(userIds: string[]) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("rec_manual_championship_credits")
    .select("user_id,game,championship_count")
    .in("user_id", userIds);
  if (error) {
    if ((error as any).code === "42P01") return [];
    throw error;
  }
  return data ?? [];
}

async function loadLeagueGame(leagueId: string): Promise<LeagueGame> {
  const { data, error } = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
  if (error) throw error;
  return (data?.game as LeagueGame) ?? "madden_26";
}

export async function rebuildSeasonOfficialRecords(leagueId: string, seasonNumber: number) {
  const [results, game] = await Promise.all([
    loadOfficialResultsForLeagueSeason(leagueId, seasonNumber),
    loadLeagueGame(leagueId),
  ]);
  const userIds = new Set<string>();
  for (const row of results) {
    if (row.home_user_id) userIds.add(row.home_user_id);
    if (row.away_user_id) userIds.add(row.away_user_id);
  }
  // Season record wins/losses are regular-season-only for NFL (playoffs shown separately
  // via their own playoff_wins/playoff_losses columns, computed from the full result set).
  // CFB counts its full season including the postseason — a finished "9-4" season is the
  // real convention there, and the playoff/superbowl columns remain an additional breakdown.
  const regularSeasonResults = isCfb(game)
    ? results
    : results.filter((row) => !isPlayoffWeek(row.week_number, game));

  const now = new Date().toISOString();
  const creditByUser = await loadActiveStatsCreditStarts(leagueId, [...userIds]);
  const rows = [...userIds].map((userId) => {
    const creditStartsAt = creditByUser.get(userId) ?? null;
    const userResults = filterResultsByStatsCredit(userId, results, creditStartsAt);
    const userRegular = filterResultsByStatsCredit(userId, regularSeasonResults, creditStartsAt);
    const regularTotals = aggregateResultsForUser(userId, userRegular, game);
    const fullTotals = aggregateResultsForUser(userId, userResults, game);
    const totals: RecordTotals = {
      ...regularTotals,
      playoffWins: fullTotals.playoffWins,
      playoffLosses: fullTotals.playoffLosses,
      superbowlWins: fullTotals.superbowlWins,
      superbowlLosses: fullTotals.superbowlLosses,
    };
    return recordRowFromTotals(totals, { league_id: leagueId, season_number: seasonNumber, user_id: userId });
  });
  if (rows.length) {
    const { error: upsertError } = await supabase.from("rec_season_user_records").upsert(rows, { onConflict: "league_id,season_number,user_id" });
    if (upsertError) throw upsertError;
  }

  return { usersUpdated: userIds.size, updatedAt: now };
}

export async function rebuildLeagueOfficialRecords(leagueId: string) {
  const [results, game] = await Promise.all([
    loadOfficialResultsForLeague(leagueId),
    loadLeagueGame(leagueId),
  ]);
  const userIds = new Set<string>();
  for (const row of results) {
    if (row.home_user_id) userIds.add(row.home_user_id);
    if (row.away_user_id) userIds.add(row.away_user_id);
  }

  const creditByUser = await loadActiveStatsCreditStarts(leagueId, [...userIds]);
  const rows = [...userIds].map((userId) => {
    const creditStartsAt = creditByUser.get(userId) ?? null;
    const userResults = filterResultsByStatsCredit(userId, results, creditStartsAt);
    return recordRowFromTotals(aggregateResultsForUser(userId, userResults, game), { league_id: leagueId, user_id: userId });
  });
  if (rows.length) {
    const { error: upsertError } = await supabase.from("rec_league_user_records").upsert(rows, { onConflict: "league_id,user_id" });
    if (upsertError) throw upsertError;
  }

  return { usersUpdated: userIds.size };
}

/**
 * Call BEFORE rec_delete_league for a league that's about to be torn down. rec_delete_league
 * hard-deletes rec_game_results/rec_league_user_records/rec_award_winners/rec_eos_award_polls
 * for the league — without this, a user's entire history in that league (win/loss/playoff/
 * superbowl record contribution, and any awards they won) vanishes instead of traveling with
 * them as part of their global all-time stats. Freezes W/L/playoff/superbowl/point-differential
 * into rec_global_user_records (untouched by rec_delete_league) and archives settled awards into
 * rec_manual_award_credits (also untouched) before the source rows are destroyed.
 */
export async function preserveGlobalContributionsBeforeLeagueDelete(leagueId: string): Promise<void> {
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .not("user_id", "is", null);
  if (assignments.error) throw assignments.error;
  const userIds = [...new Set<string>((assignments.data ?? []).map((row: any) => String(row.user_id)).filter(Boolean))];
  if (userIds.length) await rebuildOfficialGlobalRecords(userIds);

  const [statAwards, votedAwards] = await Promise.all([
    supabase.from("rec_award_winners").select("winner_user_id,award_key,award_name,season_number").eq("league_id", leagueId),
    supabase
      .from("rec_eos_award_polls")
      .select("winner_user_id,category_key,category_label,season_number")
      .eq("league_id", leagueId)
      .eq("status", "settled")
      .not("winner_user_id", "is", null),
  ]);
  if (statAwards.error) throw statAwards.error;
  if (votedAwards.error) throw votedAwards.error;

  const credits = [
    ...(statAwards.data ?? []).map((row: any) => ({
      user_id: row.winner_user_id,
      award_key: row.award_key,
      award_name: row.award_name,
      season_number: row.season_number ?? null,
      source_key: `league_delete_archive:${leagueId}`,
      note: "Auto-archived when the league that issued this award was deleted.",
    })),
    ...(votedAwards.data ?? []).map((row: any) => ({
      user_id: row.winner_user_id,
      award_key: row.category_key,
      award_name: row.category_label,
      season_number: row.season_number ?? null,
      source_key: `league_delete_archive:${leagueId}`,
      note: "Auto-archived when the league that issued this award was deleted.",
    })),
  ].filter((credit) => credit.user_id);

  if (credits.length) {
    const inserted = await supabase.from("rec_manual_award_credits").insert(credits);
    if (inserted.error) throw inserted.error;
  }
}

/**
 * Companion to preserveGlobalContributionsBeforeLeagueDelete, same call site — copies this
 * league's H2H games into rec_global_h2h_matchups (two rows per game, one per participant's
 * perspective) before rec_delete_league hard-deletes rec_game_results. Without this, a user's
 * "last time we played" history with a given opponent vanishes the moment either league
 * involved gets deleted, even though the opponent relationship itself is durable.
 */
export async function preserveH2hHistoryBeforeLeagueDelete(leagueId: string): Promise<void> {
  const league = await supabase.from("rec_leagues").select("name,game").eq("id", leagueId).maybeSingle();
  if (league.error) throw league.error;
  const leagueName = league.data?.name ?? "Deleted league";
  const gameLabel = league.data?.game ?? null;

  const results = await supabase
    .from("rec_game_results")
    .select("id,season_number,week_number,home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,is_tie,played_at,created_at")
    .eq("league_id", leagueId)
    .eq("is_user_h2h", true)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);
  if (results.error) throw results.error;
  const rows = results.data ?? [];
  if (!rows.length) return;

  const teamIds = [...new Set(rows.flatMap((r: any) => [r.home_team_id, r.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await supabase.from("rec_teams").select("id,name,abbreviation").in("id", teamIds) : { data: [], error: null };
  if (teams.error) throw teams.error;
  const teamNameById = new Map((teams.data ?? []).map((t: any) => [t.id, t.name ?? t.abbreviation ?? "Team"]));

  const ledgerRows = rows.flatMap((row: any) => {
    const playedAt = row.played_at ?? row.created_at;
    const homeScore = Number(row.home_score ?? 0);
    const awayScore = Number(row.away_score ?? 0);
    const homeResult = row.is_tie ? "tie" : homeScore > awayScore ? "win" : "loss";
    const awayResult = row.is_tie ? "tie" : awayScore > homeScore ? "win" : "loss";
    return [
      {
        user_id: row.home_user_id, opponent_user_id: row.away_user_id, league_name: leagueName, game: gameLabel,
        season_number: row.season_number, week_number: row.week_number,
        user_team_name: teamNameById.get(row.home_team_id) ?? null, opponent_team_name: teamNameById.get(row.away_team_id) ?? null,
        user_score: homeScore, opponent_score: awayScore, result: homeResult, played_at: playedAt, source_game_result_id: row.id,
      },
      {
        user_id: row.away_user_id, opponent_user_id: row.home_user_id, league_name: leagueName, game: gameLabel,
        season_number: row.season_number, week_number: row.week_number,
        user_team_name: teamNameById.get(row.away_team_id) ?? null, opponent_team_name: teamNameById.get(row.home_team_id) ?? null,
        user_score: awayScore, opponent_score: homeScore, result: awayResult, played_at: playedAt, source_game_result_id: row.id,
      },
    ];
  });

  const inserted = await supabase.from("rec_global_h2h_matchups").upsert(ledgerRows, { onConflict: "user_id,opponent_user_id,source_game_result_id", ignoreDuplicates: true });
  if (inserted.error) throw inserted.error;
}

/**
 * Every logged matchup between two users, newest first — live rec_game_results for leagues
 * that still exist, plus rec_global_h2h_matchups for any that were preserved off a deleted
 * league. `limit` bounds the live-league query; the preserved ledger has no natural cap since
 * it only ever holds already-finished games.
 */
export async function getH2hHistory(userId: string, opponentUserId: string, limit = 25) {
  const [live, preserved] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("id,league_id,season_number,week_number,home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,is_tie,played_at,created_at,rec_leagues(name,game)")
      .eq("is_user_h2h", true)
      .or(`and(home_user_id.eq.${userId},away_user_id.eq.${opponentUserId}),and(home_user_id.eq.${opponentUserId},away_user_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("rec_global_h2h_matchups")
      .select("league_name,game,season_number,week_number,user_team_name,opponent_team_name,user_score,opponent_score,result,played_at,created_at")
      .eq("user_id", userId)
      .eq("opponent_user_id", opponentUserId)
      .order("created_at", { ascending: false }),
  ]);
  if (live.error) throw live.error;
  if (preserved.error) throw preserved.error;

  const teamIds = [...new Set((live.data ?? []).flatMap((r: any) => [r.home_team_id, r.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await supabase.from("rec_teams").select("id,name,abbreviation").in("id", teamIds) : { data: [], error: null };
  if (teams.error) throw teams.error;
  const teamNameById = new Map((teams.data ?? []).map((t: any) => [t.id, t.name ?? t.abbreviation ?? "Team"]));

  const fromLive = (live.data ?? []).map((row: any) => {
    const isUserHome = row.home_user_id === userId;
    const userScore = Number(isUserHome ? row.home_score ?? 0 : row.away_score ?? 0);
    const opponentScore = Number(isUserHome ? row.away_score ?? 0 : row.home_score ?? 0);
    const result = row.is_tie ? "tie" : userScore > opponentScore ? "win" : "loss";
    const league = Array.isArray(row.rec_leagues) ? row.rec_leagues[0] : row.rec_leagues;
    return {
      leagueName: league?.name ?? "League", game: league?.game ?? null,
      seasonNumber: row.season_number, weekNumber: row.week_number,
      userTeamName: teamNameById.get(isUserHome ? row.home_team_id : row.away_team_id) ?? null,
      opponentTeamName: teamNameById.get(isUserHome ? row.away_team_id : row.home_team_id) ?? null,
      userScore, opponentScore, result,
      playedAt: row.played_at ?? row.created_at,
    };
  });

  const fromPreserved = (preserved.data ?? []).map((row: any) => ({
    leagueName: row.league_name, game: row.game, seasonNumber: row.season_number, weekNumber: row.week_number,
    userTeamName: row.user_team_name, opponentTeamName: row.opponent_team_name,
    userScore: row.user_score, opponentScore: row.opponent_score, result: row.result,
    playedAt: row.played_at ?? row.created_at,
  }));

  const history = [...fromLive, ...fromPreserved].sort((a, b) => new Date(b.playedAt ?? 0).getTime() - new Date(a.playedAt ?? 0).getTime());
  return { lastMatchup: history[0] ?? null, history };
}

export async function rebuildOfficialGlobalRecords(userIds?: string[]) {
  const [officialResults, orphanedResults] = await Promise.all([loadAllOfficialResults(), loadOrphanedGameResults()]);
  const results = [...officialResults, ...orphanedResults];
  const leagueIds = [...new Set<string>(results.map((row: any) => String(row.league_id)).filter(Boolean))];
  const leagueGameById = await loadLeagueGamesMap(leagueIds);

  const affectedUsers = new Set<string>(userIds ?? []);
  if (!userIds?.length) {
    for (const row of results) {
      if (row.home_user_id) affectedUsers.add(row.home_user_id);
      if (row.away_user_id) affectedUsers.add(row.away_user_id);
    }
  }

  const legacyBaselines = affectedUsers.size
    ? await supabase
        .from("rec_legacy_user_baselines")
        .select("user_id,global_record")
        .in("user_id", [...affectedUsers])
    : { data: [], error: null };
  if (legacyBaselines.error) throw legacyBaselines.error;
  const baselineByUser = new Map((legacyBaselines.data ?? []).map((row) => [row.user_id, row.global_record]));
  const manualCredits = await loadManualChampionshipCredits([...affectedUsers]);
  const manualCreditsByUser = new Map<string, Array<{ game: string | null; championship_count: number }>>();
  for (const row of manualCredits) {
    const rows = manualCreditsByUser.get(row.user_id) ?? [];
    rows.push({ game: row.game ?? null, championship_count: Number(row.championship_count ?? 0) });
    manualCreditsByUser.set(row.user_id, rows);
  }

  const globalRows: any[] = [];
  const gameRowsByGame = new Map<string, any[]>();
  const deleteUserIdsByGame = new Map<string, string[]>();

  const creditByUserLeague = await loadStatsCreditStartsByUserLeague([...affectedUsers]);

  for (const userId of affectedUsers) {
    const rawUserResults = results.filter((row) => row.home_user_id === userId || row.away_user_id === userId);
    const creditByLeague = creditByUserLeague.get(userId) ?? new Map();
    const userResults = rawUserResults.filter((row) => {
      const creditStartsAt = creditByLeague.get(row.league_id) ?? null;
      return filterResultsByStatsCredit(userId, [row], creditStartsAt).length > 0;
    });
    // Spans every league the user has ever played in, so playoff/superbowl detection
    // must use each row's own league game, not a single shared one.
    const boxScoreTotals = emptyRecordTotals();
    for (const row of userResults) applyGameResult(boxScoreTotals, userId, row, leagueGameById.get(row.league_id) ?? null);
    const baseline = baselineFromLegacyJson(baselineByUser.get(userId) as Record<string, unknown>);
    const allGames = mergeRecordTotals(baseline, boxScoreTotals);
    const userManualCredits = manualCreditsByUser.get(userId) ?? [];
    const manualChampionships = userManualCredits.reduce((sum, row) => sum + Number(row.championship_count ?? 0), 0);
    const allGamesChampionships = allGames.superbowlWins + manualChampionships;

    globalRows.push(allGamesRecordRowFromTotals(allGames, allGamesChampionships, { user_id: userId }));

    const byGame = new Map<string, RecordTotals>();
    for (const row of userResults) {
      const game = leagueGameById.get(row.league_id) ?? "madden_26";
      const current = byGame.get(game) ?? emptyRecordTotals();
      applyGameResult(current, userId, row, game);
      byGame.set(game, current);
    }

    for (const game of ["madden_26", "madden_27", "cfb_27"] as const) {
      // The legacy carry-over baseline IS the madden_26 record, so merge it in for
      // that game — the per-game record is baseline + box-score games, never reset
      // to box-score-only (which previously erased the seeded baseline).
      const boxTotals = byGame.get(game) ?? emptyRecordTotals();
      const totals = game === "madden_26" ? mergeRecordTotals(baseline, boxTotals) : boxTotals;
      const manualGameChampionships = userManualCredits
        .filter((row) => row.game === game)
        .reduce((sum, row) => sum + Number(row.championship_count ?? 0), 0);
      totals.superbowlWins += manualGameChampionships;
      if (!hasAnyRecordStat(totals)) {
        const ids = deleteUserIdsByGame.get(game) ?? [];
        ids.push(userId);
        deleteUserIdsByGame.set(game, ids);
        continue;
      }
      const rows = gameRowsByGame.get(game) ?? [];
      rows.push(recordRowFromTotals(totals, { user_id: userId, game }));
      gameRowsByGame.set(game, rows);
    }
  }

  if (globalRows.length) {
    const { error: globalError } = await supabase.from("rec_global_user_records").upsert(globalRows, { onConflict: "user_id" });
    if (globalError) throw globalError;
  }
  for (const [game, rows] of gameRowsByGame.entries()) {
    if (!rows.length) continue;
    const { error: gameError } = await supabase.from("rec_global_user_game_records").upsert(rows, { onConflict: "user_id,game" });
    if (gameError) throw gameError;
  }
  for (const [game, userIdsToDelete] of deleteUserIdsByGame.entries()) {
    if (!userIdsToDelete.length) continue;
    const { error: deleteError } = await supabase.from("rec_global_user_game_records").delete().eq("game", game).in("user_id", userIdsToDelete);
    if (deleteError) throw deleteError;
  }

  return { usersUpdated: affectedUsers.size };
}

export async function rebuildOfficialRecordsAfterBoxScore(input: {
  leagueId: string;
  seasonNumber: number;
  homeUserId?: string | null;
  awayUserId?: string | null;
}) {
  await rebuildSeasonOfficialRecords(input.leagueId, input.seasonNumber);
  await rebuildLeagueOfficialRecords(input.leagueId);
  const userIds = [input.homeUserId, input.awayUserId].filter(Boolean) as string[];
  await rebuildOfficialGlobalRecords(userIds.length ? userIds : undefined);
}
