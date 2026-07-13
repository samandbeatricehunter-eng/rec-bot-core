// @ts-nocheck
import { isRegularSeasonWeek, maxSeasonWeek } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { processGameIntelligence } from "../box-score-intelligence/persistence.js";
import { randomUUID } from "node:crypto";

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

// Games with a box-score submission (pending or approved) are authoritative and can't
// be overridden here — correct them through Box Scores instead.
async function boxScoreGameIds(leagueId: string, seasonNumber: number, weekNumber: number): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("game_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["pending", "approved"]);
  if (error) throw new ApiError(500, "Failed to load box scores for the week.", error);
  return new Set((data ?? []).map((r) => String(r.game_id)).filter(Boolean));
}

// List scheduled games for a week that are still eligible for manual entry — games
// already locked by a box-score submission are left out entirely, since those can't
// be overridden here.
export async function listManualScoreGames(input: {
  guildId: string;
  weekNumber?: number | null;
}): Promise<{ seasonNumber: number; weekNumber: number; games: ManualScoreGame[]; lockedCount: number }> {
  const { leagueId, seasonNumber, seasonId, weekNumber } = await loadWeekContext(input.guildId, input.weekNumber);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load the week's scheduled games.", error);
  if (!games?.length) throw new ApiError(400, `No games are scheduled for Week ${weekNumber}. Import the schedule first, then try again.`);

  const [results, boxScored] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("home_team_id,away_team_id,source,home_score,away_score,is_tie")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber),
    boxScoreGameIds(leagueId, seasonNumber, weekNumber),
  ]);
  if (results.error) throw new ApiError(500, "Failed to load existing game results.", results.error);

  const resultByMatchup = new Map((results.data ?? []).map((row: any) => [`${row.home_team_id}:${row.away_team_id}`, row]));

  const eligible = (games as any[]).filter((g) => !boxScored.has(String(g.id)));
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
  manualStats?: { home?: Record<string, any>; away?: Record<string, any> } | null;
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
  if (game.error) throw new ApiError(500, "Failed to load game for manual score entry.", game.error);
  if (!game.data) throw new ApiError(404, "Scheduled game not found.");

  const weekNumber = game.data.week_number;
  const boxScored = await supabase
    .from("rec_box_score_submissions")
    .select("id")
    .eq("game_id", input.gameId)
    .in("status", ["pending", "approved"])
    .limit(1);
  if (boxScored.error) throw new ApiError(500, "Failed to check for an existing box score.", boxScored.error);
  if (boxScored.data?.length) throw new ApiError(409, "This game already has a box score submission — correct it through Box Scores instead.");

  // Prefer real final scores when the commissioner supplied them; otherwise fall back
  // to a 1-0 win/loss flag, matching the advance wizard's W/L/T-only convention.
  const hasRealScores = input.homeScore != null && input.awayScore != null;
  const homeScore = hasRealScores ? Number(input.homeScore) : input.outcome === "home" ? 1 : 0;
  const awayScore = hasRealScores ? Number(input.awayScore) : input.outcome === "away" ? 1 : 0;
  const isTie = input.outcome === "tie";
  const homeTeamId = game.data.home_team_id;
  const awayTeamId = game.data.away_team_id;

  const winningUserId = isTie ? null : input.outcome === "home" ? game.data.home_user_id : game.data.away_user_id;
  const losingUserId = isTie ? null : input.outcome === "home" ? game.data.away_user_id : game.data.home_user_id;
  const winningTeamId = isTie ? null : input.outcome === "home" ? homeTeamId : awayTeamId;
  const losingTeamId = isTie ? null : input.outcome === "home" ? awayTeamId : homeTeamId;

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
    records_apply_key: `manual:${context.leagueId}:${seasonNumber}:${weekNumber}:${homeTeamId}:${awayTeamId}`,
    manual_stats: input.manualStats ?? null,
    created_at: now,
    updated_at: now,
  };

  const result = await supabase.from("rec_game_results").upsert(row, { onConflict: "records_apply_key", ignoreDuplicates: false });
  if (result.error) throw new ApiError(500, "Failed to save the manual game result.", result.error);

  const homeStats = input.manualStats?.home ?? {};
  const awayStats = input.manualStats?.away ?? {};
  const hasManualStats = Object.values(homeStats).some((value) => value !== null && value !== "" && value !== undefined) || Object.values(awayStats).some((value) => value !== null && value !== "" && value !== undefined);
  if (hasManualStats) {
    const old = await supabase.from("rec_box_score_submissions").select("id").eq("game_id", input.gameId).eq("entry_method", "manual");
    const oldIds = (old.data ?? []).map((row: any) => row.id);
    if (oldIds.length) {
      await supabase.from("rec_team_game_stats").delete().in("submission_id", oldIds);
      await supabase.from("rec_box_score_submissions").delete().in("id", oldIds);
    }
    const account = input.submittedByDiscordId
      ? await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.submittedByDiscordId).maybeSingle()
      : { data: null };
    const submissionId = randomUUID();
    const submission = await supabase.from("rec_box_score_submissions").insert({
      id: submissionId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber,
      phase: game.data.phase, submitted_by_discord_id: input.submittedByDiscordId ?? "commissioner-manual-entry",
      submitted_by_user_id: account.data?.user_id ?? null, discord_guild_id: input.guildId, image_urls: [],
      home_team_id: homeTeamId, away_team_id: awayTeamId, home_user_id: game.data.home_user_id, away_user_id: game.data.away_user_id,
      home_score: homeScore, away_score: awayScore, quarter_scores: { home: homeStats.quarterScores ?? [], away: awayStats.quarterScores ?? [] },
      team_stats: { home: homeStats, away: awayStats }, game_id: input.gameId, parse_warnings: [], status: "approved",
      reviewed_by_discord_id: input.submittedByDiscordId ?? null, reviewed_at: now, entry_method: "manual", created_at: now, updated_at: now,
    });
    if (submission.error) throw new ApiError(500, "Failed to create the manual stat submission.", submission.error);

    const numberOrNull = (value: unknown) => value === "" || value == null ? null : Number(value);
    const statsRow = (stats: Record<string, any>, opponent: Record<string, any>, side: "home" | "away") => ({
      id: randomUUID(), league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber, phase: game.data.phase,
      game_id: input.gameId, submission_id: submissionId,
      team_id: side === "home" ? homeTeamId : awayTeamId, opponent_team_id: side === "home" ? awayTeamId : homeTeamId,
      user_id: side === "home" ? game.data.home_user_id : game.data.away_user_id, opponent_user_id: side === "home" ? game.data.away_user_id : game.data.home_user_id,
      is_home: side === "home", result: isTie ? "tie" : (side === input.outcome ? "win" : "loss"),
      points_for: side === "home" ? homeScore : awayScore, points_against: side === "home" ? awayScore : homeScore,
      off_yards_gained: numberOrNull(stats.offYardsGained), off_rush_yards: numberOrNull(stats.offRushYards), off_pass_yards: numberOrNull(stats.offPassYards),
      off_first_down: numberOrNull(stats.offFirstDown), punt_return_yards: numberOrNull(stats.puntReturnYards), kick_return_yards: numberOrNull(stats.kickReturnYards),
      total_yards_gained: numberOrNull(stats.totalYardsGained), turnovers_committed: numberOrNull(stats.turnoversCommitted), red_zone_off_percentage: numberOrNull(stats.redZoneOffPercentage),
      generated_turnovers: numberOrNull(stats.generatedTurnovers ?? opponent.turnoversCommitted), yards_allowed: numberOrNull(stats.yardsAllowed ?? opponent.offYardsGained),
      rush_yards_allowed: numberOrNull(stats.rushYardsAllowed ?? opponent.offRushYards), pass_yards_allowed: numberOrNull(stats.passYardsAllowed ?? opponent.offPassYards),
      first_downs_allowed: numberOrNull(stats.firstDownsAllowed ?? opponent.offFirstDown), red_zone_def_percentage: numberOrNull(stats.redZoneDefPercentage),
      comeback_deficit: numberOrNull(stats.comebackDeficit), comeback_deficit_quarter: numberOrNull(stats.comebackDeficitQuarter), comeback_rate: numberOrNull(stats.comebackRate),
      fourth_quarter_comeback: Boolean(stats.fourthQuarterComeback), quarter_scores: stats.quarterScores ?? null,
      offensive_stats: { third_down_conversions: numberOrNull(stats.thirdDownConversions), fourth_down_conversions: numberOrNull(stats.fourthDownConversions), two_point_conversions: numberOrNull(stats.twoPointConversions) },
      defensive_stats: { third_down_conversions: numberOrNull(opponent.thirdDownConversions), fourth_down_conversions: numberOrNull(opponent.fourthDownConversions), two_point_conversions: numberOrNull(opponent.twoPointConversions), red_zone_off_percentage: numberOrNull(opponent.redZoneOffPercentage) },
      created_at: now,
    });
    const statsInsert = await supabase.from("rec_team_game_stats").insert([statsRow(homeStats, awayStats, "home"), statsRow(awayStats, homeStats, "away")]);
    if (statsInsert.error) throw new ApiError(500, "Failed to save the manually entered team stats.", statsInsert.error);
    await processGameIntelligence({ id: submissionId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber, game_id: input.gameId });
  }

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
    outcome: input.outcome,
  };
}
