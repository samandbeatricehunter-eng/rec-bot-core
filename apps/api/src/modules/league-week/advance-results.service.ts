import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { setLeagueWeek } from "./league-week.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

type AdvanceGameResultInput = {
  gameId: string;
  outcome: "home" | "away" | "tie";
};

function phaseForWeek(weekNumber: number) {
  if (weekNumber <= 18) return "regular_season";
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  if (weekNumber === 22) return "super_bowl";
  return "postseason";
}

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];

export async function getAdvanceWeekGames(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", currentWeek);
  if (error) throw new ApiError(500, "Failed to load week schedule.", error);

  const [results, boxScores] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("id,external_game_id,home_team_id,away_team_id,source")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", currentWeek),
    supabase
      .from("rec_box_score_submissions")
      .select("id,game_id,status")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", currentWeek)
      .eq("status", "approved"),
  ]);

  if (results.error) throw new ApiError(500, "Failed to load existing game results.", results.error);
  if (boxScores.error) throw new ApiError(500, "Failed to load box score submissions.", boxScores.error);

  const boxScoreGameIds = new Set((boxScores.data ?? []).map((row) => String(row.game_id)).filter(Boolean));
  const resultByMatchup = new Map(
    (results.data ?? []).map((row) => [`${row.home_team_id}:${row.away_team_id}`, row.source ?? null]),
  );

  const mapped = (games ?? []).map((game: any) => {
    const hasBoxScore = boxScoreGameIds.has(String(game.id));
    const existingSource = resultByMatchup.get(`${game.home_team_id}:${game.away_team_id}`) ?? null;
    const hasOfficialResult = existingSource != null && BOX_SCORE_SOURCES.includes(String(existingSource));
    const needsInput = !hasBoxScore && !hasOfficialResult;
    return {
      gameId: game.id,
      weekNumber: game.week_number,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeUserId: game.home_user_id,
      awayUserId: game.away_user_id,
      homeTeamName: formatTeamDisplayName(game.home_team) ?? game.home_team?.name ?? "Home",
      awayTeamName: formatTeamDisplayName(game.away_team) ?? game.away_team?.name ?? "Away",
      hasBoxScore,
      existingResultSource: existingSource,
      needsInput,
      isCpuGame: !(game.home_user_id && game.away_user_id),
      isH2h: Boolean(game.home_user_id && game.away_user_id),
    };
  });

  return {
    league: context.rec_leagues,
    seasonNumber,
    currentWeek,
    currentStage,
    games: mapped,
    gamesNeedingInput: mapped.filter((game) => game.needsInput),
  };
}

export async function completeAdvanceWeek(input: {
  guildId: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  advancedByDiscordId: string;
  results: AdvanceGameResultInput[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const now = new Date().toISOString();

  for (const result of input.results) {
    const game = await supabase
      .from("rec_games")
      .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id")
      .eq("id", result.gameId)
      .eq("league_id", context.leagueId)
      .maybeSingle();
    if (game.error) throw new ApiError(500, "Failed to load game for advance result.", game.error);
    if (!game.data) throw new ApiError(404, "Scheduled game not found.");

    const homeScore = result.outcome === "home" ? 1 : 0;
    const awayScore = result.outcome === "away" ? 1 : 0;
    const isTie = result.outcome === "tie";
    const winningUserId = isTie ? null : result.outcome === "home" ? game.data.home_user_id : game.data.away_user_id;
    const losingUserId = isTie ? null : result.outcome === "home" ? game.data.away_user_id : game.data.home_user_id;
    const winningTeamId = isTie ? null : result.outcome === "home" ? game.data.home_team_id : game.data.away_team_id;
    const losingTeamId = isTie ? null : result.outcome === "home" ? game.data.away_team_id : game.data.home_team_id;
    const recordsApplyKey = `advance:${context.leagueId}:${seasonNumber}:${game.data.week_number ?? currentWeek}:${game.data.home_team_id}:${game.data.away_team_id}`;

    await supabase.from("rec_game_results").upsert(
      {
        league_id: context.leagueId,
        season_number: seasonNumber,
        week_number: game.data.week_number ?? currentWeek,
        game_type: game.data.phase ?? phaseForWeek(currentWeek),
        external_game_id: game.data.external_game_id ?? null,
        home_team_id: game.data.home_team_id,
        away_team_id: game.data.away_team_id,
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
        is_playoff: (game.data.week_number ?? currentWeek) > 18,
        source: "commissioner_advance",
        records_apply_key: recordsApplyKey,
        updated_at: now,
      },
      { onConflict: "records_apply_key", ignoreDuplicates: false },
    );
  }

  await rebuildSeasonDisplayRecords(context.leagueId, seasonNumber);

  return setLeagueWeek({
    guildId: input.guildId,
    weekNumber: input.nextWeekNumber,
    seasonStage: input.nextSeasonStage,
    seasonNumber,
  });
}
