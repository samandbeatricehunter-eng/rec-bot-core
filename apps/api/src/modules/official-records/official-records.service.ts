// @ts-nocheck
import { isCfb, regularSeasonWeeks, type LeagueGame } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

// Every source a game result can legitimately be logged from — box-score OCR,
// schedule-screenshot import (weekly scores), and manual commissioner entry are
// all equally final results and must count toward records/W-L the same way.
export const OFFICIAL_RESULT_SOURCES = ["box_score", "box_score_screenshot", "schedule_screenshot", "manual"] as const;
export const DISPLAY_ADVANCE_SOURCE = "commissioner_advance";

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
  return Number(weekNumber ?? 0) >= (isCfb(game) ? 17 : 22);
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
  return {
    ...recordRowFromTotals(totals, extra),
    playoff_wins: 0,
    playoff_losses: 0,
    superbowl_wins: championshipWins,
    superbowl_losses: 0,
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

async function loadOfficialResultsForLeagueSeason(leagueId: string, seasonNumber: number) {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,week_number,is_tie,source,records_apply_key")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

async function loadOfficialResultsForLeague(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,week_number,is_tie,season_number,source")
    .eq("league_id", leagueId)
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

async function loadAllOfficialResults() {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,week_number,is_tie,league_id,source")
    .in("source", [...OFFICIAL_RESULT_SOURCES]);
  if (error) throw error;
  return data ?? [];
}

async function loadLeagueGamesMap(leagueIds: string[]) {
  if (!leagueIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("rec_leagues").select("id,game").in("id", leagueIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, String(row.game ?? "madden_26")]));
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
  // Season record wins/losses are regular-season-only (playoffs shown separately via
  // their own playoff_wins/playoff_losses columns, computed from the full result set).
  const regularSeasonResults = results.filter((row) => !isPlayoffWeek(row.week_number, game));

  const now = new Date().toISOString();
  const rows = [...userIds].map((userId) => {
    const regularTotals = aggregateResultsForUser(userId, regularSeasonResults, game);
    const fullTotals = aggregateResultsForUser(userId, results, game);
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

  const rows = [...userIds].map((userId) =>
    recordRowFromTotals(aggregateResultsForUser(userId, results, game), { league_id: leagueId, user_id: userId }),
  );
  if (rows.length) {
    const { error: upsertError } = await supabase.from("rec_league_user_records").upsert(rows, { onConflict: "league_id,user_id" });
    if (upsertError) throw upsertError;
  }

  return { usersUpdated: userIds.size };
}

export async function rebuildOfficialGlobalRecords(userIds?: string[]) {
  const results = await loadAllOfficialResults();
  const leagueIds = [...new Set(results.map((row) => row.league_id).filter(Boolean))];
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

  for (const userId of affectedUsers) {
    const userResults = results.filter((row) => row.home_user_id === userId || row.away_user_id === userId);
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
