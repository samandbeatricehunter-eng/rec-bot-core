import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { parseScheduleImages, type ParsedScheduleGame } from "../schedule/schedule.parser.js";
import { buildAbbrMap, resolveScheduleAbbr } from "../schedule/schedule.service.js";
import { persistStitchedUploadImage } from "../box-score/box-score.service.js";

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];
const SCHEDULE_SOURCE = "schedule_screenshot";

type TeamRow = {
  id: string;
  name: string | null;
  abbreviation: string | null;
  display_abbr: string | null;
  display_city: string | null;
  display_nick: string | null;
  original_abbreviation: string | null;
  is_relocated: boolean | null;
};

export type WeeklyScoreGame = {
  gameId: string;
  awayTeamId: string | null;
  homeTeamId: string | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
  awayName: string | null;
  homeName: string | null;
  awayScore: number | null;
  homeScore: number | null;
  hasBoxScore: boolean;
  fromOcr: boolean;
};

export type WeeklyScorePreview = {
  seasonNumber: number;
  weekNumber: number;
  games: WeeklyScoreGame[];
  warnings: string[];
  readCount: number;
  imageUrl: string | null;
};

async function loadWeekContext(guildId: string, weekNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const week = Number(weekNumber ?? context.rec_leagues.current_week ?? 1);
  if (!Number.isInteger(week) || week < 1 || week > 22) throw new ApiError(400, "Invalid week number.");
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  return { context, leagueId: context.leagueId, seasonNumber, seasonId, weekNumber: week };
}

async function loadScheduledGamesWithTeams(leagueId: string, seasonId: string, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,original_abbreviation,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,original_abbreviation,is_relocated)")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load the week's scheduled games.", error);
  return data ?? [];
}

async function approvedBoxScoreGameIds(leagueId: string, seasonNumber: number, weekNumber: number): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("game_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("status", "approved");
  if (error) throw new ApiError(500, "Failed to load approved box scores for the week.", error);
  return new Set((data ?? []).map((r) => String(r.game_id)).filter(Boolean));
}

// Pair a scheduled game with a parsed row by unordered team set, then orient the
// scores to the scheduled home/away (so an away/home swap in the read is tolerated).
function scoresForScheduledGame(
  game: { away_team_id: string | null; home_team_id: string | null },
  parsed: ParsedScheduleGame[],
  abbrMap: Map<string, string>,
): { awayScore: number | null; homeScore: number | null; fromOcr: boolean } {
  for (const p of parsed) {
    const pAway = resolveScheduleAbbr(abbrMap, p.awayAbbr);
    const pHome = resolveScheduleAbbr(abbrMap, p.homeAbbr);
    if (!pAway || !pHome) continue;
    if (pAway === game.away_team_id && pHome === game.home_team_id) {
      return { awayScore: p.awayScore, homeScore: p.homeScore, fromOcr: p.awayScore != null || p.homeScore != null };
    }
    if (pAway === game.home_team_id && pHome === game.away_team_id) {
      // Read with away/home swapped — flip the scores back to schedule orientation.
      return { awayScore: p.homeScore, homeScore: p.awayScore, fromOcr: p.awayScore != null || p.homeScore != null };
    }
  }
  return { awayScore: null, homeScore: null, fromOcr: false };
}

function teamLabel(team: TeamRow | null): string | null {
  if (!team) return null;
  return formatTeamDisplayName(team) ?? team.name ?? team.display_abbr ?? team.abbreviation ?? null;
}

function teamAbbr(team: TeamRow | null): string | null {
  return team?.display_abbr ?? team?.abbreviation ?? null;
}

export async function previewWeeklyScores(input: {
  guildId: string;
  weekNumber?: number | null;
  imageUrls: string[];
}): Promise<WeeklyScorePreview> {
  const { leagueId, seasonNumber, seasonId, weekNumber } = await loadWeekContext(input.guildId, input.weekNumber);

  const [scheduled, parsedWeek, boxScoreGameIds] = await Promise.all([
    loadScheduledGamesWithTeams(leagueId, seasonId, weekNumber),
    parseScheduleImages(input.imageUrls),
    approvedBoxScoreGameIds(leagueId, seasonNumber, weekNumber),
  ]);

  if (!scheduled.length) {
    throw new ApiError(400, `No games are scheduled for Week ${weekNumber}. Import the schedule first, then upload scores.`);
  }

  const teams: TeamRow[] = [];
  for (const g of scheduled as any[]) {
    if (g.away_team) teams.push(g.away_team);
    if (g.home_team) teams.push(g.home_team);
  }
  const abbrMap = buildAbbrMap(teams);

  const games: WeeklyScoreGame[] = (scheduled as any[]).map((g) => {
    const scores = scoresForScheduledGame(g, parsedWeek.games, abbrMap);
    return {
      gameId: g.id,
      awayTeamId: g.away_team_id,
      homeTeamId: g.home_team_id,
      awayAbbr: teamAbbr(g.away_team),
      homeAbbr: teamAbbr(g.home_team),
      awayName: teamLabel(g.away_team),
      homeName: teamLabel(g.home_team),
      awayScore: scores.awayScore,
      homeScore: scores.homeScore,
      hasBoxScore: boxScoreGameIds.has(String(g.id)),
      fromOcr: scores.fromOcr,
    };
  });

  const imageUrl = input.imageUrls.length ? await persistStitchedUploadImage(`schedule-${leagueId}-${seasonNumber}-${weekNumber}`, input.imageUrls) : null;

  return {
    seasonNumber,
    weekNumber,
    games,
    warnings: parsedWeek.warnings,
    readCount: games.filter((g) => g.awayScore != null && g.homeScore != null).length,
    imageUrl: imageUrl ?? input.imageUrls[0] ?? null,
  };
}

// Write real final scores for the week's games to rec_game_results. Skips games
// that already have a box-score result (those stay authoritative) and any game
// missing a score. Mirrors the result-writing + rollups in completeAdvanceWeek.
export async function prelogWeeklyScores(input: {
  guildId: string;
  weekNumber: number;
  loggedByDiscordId: string;
  games: Array<{ gameId: string; awayScore: number | null; homeScore: number | null }>;
}): Promise<{ seasonNumber: number; weekNumber: number; logged: number; skipped: number }> {
  const { leagueId, seasonNumber, seasonId, weekNumber } = await loadWeekContext(input.guildId, input.weekNumber);
  const now = new Date().toISOString();

  const scheduled = await loadScheduledGamesWithTeams(leagueId, seasonId, weekNumber);
  const byId = new Map((scheduled as any[]).map((g) => [String(g.id), g]));

  // Don't overwrite games that already carry a box-score result.
  const existing = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (existing.error) throw new ApiError(500, "Failed to load existing game results.", existing.error);
  const boxScoreLocked = new Set(
    (existing.data ?? [])
      .filter((r) => BOX_SCORE_SOURCES.includes(String(r.source)))
      .map((r) => `${r.home_team_id}:${r.away_team_id}`),
  );

  // Game users for win/loss routing.
  const teamIds = [...new Set((scheduled as any[]).flatMap((g) => [g.away_team_id, g.home_team_id]).filter(Boolean))];
  const assignments = teamIds.length
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,user_id")
        .eq("league_id", leagueId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .in("team_id", teamIds)
    : { data: [], error: null };
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments for score logging.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((r: any) => [r.team_id, r.user_id]));

  let logged = 0;
  let skipped = 0;
  const rows: any[] = [];
  for (const g of input.games) {
    const game = byId.get(String(g.gameId));
    if (!game || g.awayScore == null || g.homeScore == null) {
      skipped++;
      continue;
    }
    if (boxScoreLocked.has(`${game.home_team_id}:${game.away_team_id}`)) {
      skipped++;
      continue;
    }
    const homeUserId = userByTeam.get(game.home_team_id) ?? null;
    const awayUserId = userByTeam.get(game.away_team_id) ?? null;
    const isTie = g.homeScore === g.awayScore;
    const homeWon = g.homeScore > g.awayScore;
    rows.push({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_type: weekNumber <= 18 ? "regular_season" : "postseason",
      external_game_id: game.external_game_id ?? null,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_user_id: homeUserId,
      away_user_id: awayUserId,
      home_score: g.homeScore,
      away_score: g.awayScore,
      winning_user_id: isTie ? null : homeWon ? homeUserId : awayUserId,
      losing_user_id: isTie ? null : homeWon ? awayUserId : homeUserId,
      winning_team_id: isTie ? null : homeWon ? game.home_team_id : game.away_team_id,
      losing_team_id: isTie ? null : homeWon ? game.away_team_id : game.home_team_id,
      is_user_h2h: Boolean(homeUserId && awayUserId),
      is_cpu_game: !(homeUserId && awayUserId),
      is_tie: isTie,
      is_playoff: weekNumber > 18,
      source: SCHEDULE_SOURCE,
      records_apply_key: `schedule:${leagueId}:${seasonNumber}:${weekNumber}:${game.home_team_id}:${game.away_team_id}`,
      created_at: now,
      updated_at: now,
    });
    logged++;
  }

  if (rows.length) {
    const result = await supabase.from("rec_game_results").upsert(rows, { onConflict: "records_apply_key", ignoreDuplicates: false });
    if (result.error) throw new ApiError(500, "Failed to log weekly scores.", result.error);

    await rebuildSeasonDisplayRecords(leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] rebuildSeasonDisplayRecords failed after weekly score prelog (non-fatal):", err);
    });
    await snapshotPowerRankings(leagueId, seasonNumber, weekNumber).catch((err) => {
      console.error("[ERROR] snapshotPowerRankings failed after weekly score prelog (non-fatal):", err);
    });
  }

  return { seasonNumber, weekNumber, logged, skipped };
}
