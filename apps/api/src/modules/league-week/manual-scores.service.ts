import { isRegularSeasonWeek, maxSeasonWeek } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { gameResultsApplyKey, rebuildOfficialRecordsAfterBoxScore } from "../official-records/official-records.service.js";
import { invalidateLeagueComputeCaches } from "../../lib/compute-cache.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { issueAndGradeWeeklyTeamChallengesForGame } from "../weekly-challenges/weekly-challenge-issuance.service.js";
import { settleGotwPollsForGame } from "../gotw/gotw.service.js";
import { closeWageringForGame } from "../wagers/wagers.service.js";

const MANUAL_SOURCE = "manual";

export type ManualScoreGame = {
  gameId: string;
  weekNumber: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeName: string;
  awayName: string;
  existingResult: { source: string; homeScore: number; awayScore: number; isTie: boolean } | null;
};

async function loadWeekContext(guildId: string, weekNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const week = Number(weekNumber ?? context.rec_leagues.current_week ?? 1);
  if (!Number.isInteger(week) || week < 1 || week > maxSeasonWeek(context.rec_leagues.game ?? null)) throw new ApiError(400, "Invalid week number.");
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  return { context, leagueId: context.leagueId, seasonNumber, seasonId, weekNumber: week };
}

// List scheduled games for a week that are still eligible for manual entry — games with an
// EA-imported result are left out entirely, since that's the authoritative source and can't
// be overridden here (re-import the week to change it).
export async function listManualScoreGames(input: {
  guildId: string;
  weekNumber?: number | null;
}): Promise<{ seasonNumber: number; weekNumber: number; games: ManualScoreGame[]; lockedCount: number }> {
  const { leagueId, seasonNumber, seasonId, weekNumber } = await loadWeekContext(input.guildId, input.weekNumber);

  const { data: games, error } = await leagueWeekGamesQuery(supabase, { leagueId, seasonId, weekNumber },
    "id,week_number,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load this week's scheduled games. Please try again.", error);
  if (!games?.length) throw new ApiError(400, `No games are scheduled for Week ${weekNumber}. Import the schedule first, then try again.`);

  const results = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,source,home_score,away_score,is_tie")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (results.error) throw new ApiError(500, "We couldn't load existing game results right now. Please try again.", results.error);

  const resultByMatchup = new Map<string, any>((results.data ?? []).map((row: any) => [`${row.home_team_id}:${row.away_team_id}`, row]));
  const importedMatchups = new Set(
    (results.data ?? []).filter((row: any) => row.source === "madden_companion_import").map((row: any) => `${row.home_team_id}:${row.away_team_id}`),
  );

  // EA-imported results are off-limits for manual entry.
  const eligible = (games as any[]).filter((g) => !importedMatchups.has(`${g.home_team_id}:${g.away_team_id}`));
  const mapped: ManualScoreGame[] = eligible.map((g) => {
    const existing = resultByMatchup.get(`${g.home_team_id}:${g.away_team_id}`) ?? null;
    return {
      gameId: g.id,
      weekNumber: g.week_number,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      homeName: formatTeamDisplayName(g.home_team) ?? g.home_team?.name ?? "Home",
      awayName: formatTeamDisplayName(g.away_team) ?? g.away_team?.name ?? "Away",
      existingResult: existing ? { source: existing.source, homeScore: existing.home_score, awayScore: existing.away_score, isTie: existing.is_tie } : null,
    };
  });

  return { seasonNumber, weekNumber, games: mapped, lockedCount: games.length - eligible.length };
}

export async function recordManualGameResult(input: {
  guildId: string;
  gameId: string;
  outcome: "home" | "away" | "tie";
  homeScore?: number | null;
  awayScore?: number | null;
  submittedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const now = new Date().toISOString();

  const game = await supabase
    .from("rec_games")
    .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that game for score entry. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Scheduled game not found.");

  const weekNumber = game.data.week_number;

  // Imported results are hard-locked: the EA import is the source of truth for scores, so
  // manual entry can never quietly overwrite what the game reported. Re-import to change.
  const imported = await supabase
    .from("rec_game_results")
    .select("id")
    .eq("game_id", input.gameId)
    .eq("source", "madden_companion_import")
    .limit(1);
  if (imported.error) throw new ApiError(500, "We couldn't check for an imported result. Please try again.", imported.error);
  if (imported.data?.length) throw new ApiError(409, "This game's score was imported from EA and is locked — re-import the week to change it.");

  // Prefer real final scores when the commissioner supplied them; otherwise fall back
  // to a 1-0 win/loss flag, matching the advance wizard's W/L/T-only convention.
  const hasRealScores = input.homeScore != null && input.awayScore != null;
  const homeScore = hasRealScores ? Number(input.homeScore) : input.outcome === "home" ? 1 : 0;
  const awayScore = hasRealScores ? Number(input.awayScore) : input.outcome === "away" ? 1 : 0;
  // The scores are the source of truth once they're provided — anything reading this row
  // later (e.g. the Manage League team summary's W/L count) derives wins/losses straight
  // from home_score vs away_score, not from a stored winner flag. Deriving the outcome from
  // input.outcome instead (a separate set of buttons) let a commissioner pick "Away Win" but
  // type the scores in the wrong boxes, silently writing a row whose winner flag disagreed
  // with its own scoreboard. Re-deriving from the scores here keeps both readings in sync.
  const isTie = hasRealScores ? homeScore === awayScore : input.outcome === "tie";
  const effectiveOutcome: "home" | "away" | "tie" = isTie ? "tie" : hasRealScores ? (homeScore > awayScore ? "home" : "away") : input.outcome;
  const homeTeamId = game.data.home_team_id;
  const awayTeamId = game.data.away_team_id;

  const winningUserId = isTie ? null : effectiveOutcome === "home" ? game.data.home_user_id : game.data.away_user_id;
  const losingUserId = isTie ? null : effectiveOutcome === "home" ? game.data.away_user_id : game.data.home_user_id;
  const winningTeamId = isTie ? null : effectiveOutcome === "home" ? homeTeamId : awayTeamId;
  const losingTeamId = isTie ? null : effectiveOutcome === "home" ? awayTeamId : homeTeamId;

  const row = {
    league_id: context.leagueId,
    game_id: game.data.id,
    season_number: seasonNumber,
    week_number: weekNumber,
    game_type: game.data.phase ?? (isRegularSeasonWeek(weekNumber, context.rec_leagues.game) ? "regular_season" : "postseason"),
    external_game_id: game.data.external_game_id ?? null,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_user_id: game.data.home_user_id,
    away_user_id: game.data.away_user_id,
    home_score: homeScore,
    away_score: awayScore,
    winning_user_id: winningUserId,
    losing_user_id: losingUserId,
    winning_team_id: winningTeamId,
    losing_team_id: losingTeamId,
    is_user_h2h: Boolean(game.data.home_user_id && game.data.away_user_id),
    is_cpu_game: !(game.data.home_user_id && game.data.away_user_id),
    is_tie: isTie,
    is_playoff: !isRegularSeasonWeek(weekNumber, context.rec_leagues.game),
    source: MANUAL_SOURCE,
    records_apply_key: gameResultsApplyKey({
      gameId: input.gameId,
      leagueId: context.leagueId,
      seasonNumber,
      weekNumber,
      homeTeamId,
      awayTeamId,
    }),
    created_at: now,
    updated_at: now,
  };

  const result = await supabase.from("rec_game_results").upsert(row, { onConflict: "records_apply_key", ignoreDuplicates: false });
  if (result.error) throw new ApiError(500, "We couldn't save the manual game result. Please try again.", result.error);
  await closeWageringForGame({ guildId: input.guildId, gameId: input.gameId });
  // "final" is not a rec_game_status enum value (valid: scheduled/pending_schedule/ready/
  // completed/locked/cancelled) -- this update was silently failing on every manual score
  // entry (its result was never checked), leaving rec_games permanently out of sync with the
  // rec_game_results row just written. Root cause of the 167-game rec_games/rec_game_results
  // mismatch found in the 2026-08 combined data-integrity audit.
  const gameSyncResult = await supabase.from("rec_games").update({ status: "completed", home_score: homeScore, away_score: awayScore, updated_at: now }).eq("id", input.gameId);
  if (gameSyncResult.error) {
    console.error("[ERROR] Failed to sync rec_games after manual score entry (non-fatal):", gameSyncResult.error);
  }
  await settleGotwPollsForGame({ guildId: input.guildId, gameId: input.gameId, winningTeamId }).catch((err) => {
    console.error("[ERROR] settleGotwPollsForGame failed after manual score entry (non-fatal):", err);
  });
  // Box score approval already rebuilds rec_season_user_records (point differential, W/L,
  // etc. shown on the hero card and matchup preview) — manual entry wrote the same
  // rec_game_results row but never triggered this rebuild, so those stats went stale for
  // any game logged this way.
  await rebuildOfficialRecordsAfterBoxScore({
    leagueId: context.leagueId,
    seasonNumber,
    homeUserId: game.data.home_user_id,
    awayUserId: game.data.away_user_id,
  }).catch((err) => {
    console.error("[ERROR] rebuildOfficialRecordsAfterBoxScore failed after manual score entry (non-fatal):", err);
  });
  invalidateLeagueComputeCaches(input.guildId);

  await issueAndGradeWeeklyTeamChallengesForGame({
    leagueId: context.leagueId, seasonNumber, weekNumber, gameId: input.gameId,
  }).catch((err) => console.error(`[ERROR] Weekly team challenge grading failed for game ${input.gameId} (non-fatal):`, err));

  await rebuildSeasonDisplayRecords(context.leagueId, seasonNumber).catch((err) => {
    console.error("[ERROR] rebuildSeasonDisplayRecords failed after manual score entry (non-fatal):", err);
  });
  await snapshotPowerRankings(context.leagueId, seasonNumber, weekNumber, context.rec_leagues.game).catch((err) => {
    console.error("[ERROR] snapshotPowerRankings failed after manual score entry (non-fatal):", err);
  });

  return {
    weekNumber,
    homeName: formatTeamDisplayName(game.data.home_team as any) ?? (game.data.home_team as any)?.name ?? "Home",
    awayName: formatTeamDisplayName(game.data.away_team as any) ?? (game.data.away_team as any)?.name ?? "Away",
    homeScore,
    awayScore,
    hasRealScores,
    isTie,
    outcome: effectiveOutcome,
  };
}
