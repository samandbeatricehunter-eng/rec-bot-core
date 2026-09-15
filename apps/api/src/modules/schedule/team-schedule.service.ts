import { maxSeasonWeek, NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { listScheduleSeason } from "./schedule.service.js";
import { formatTeamDisplayName, resolveTeamNick } from "../users/user-profile-stats.service.js";
import { loadGameRivalries } from "../rivalries/rivalries.service.js";

type ConfirmedWeek = {
  gameId: string;
  weekNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeUserId: string | null;
  awayUserId: string | null;
  opponentTeamId: string;
  opponentName: string;
  homeAway: "home" | "away";
  matchupType: "h2h" | "cpu";
  postseasonRound: string | null;
};

// Used by the web dashboard's manual schedule preview (getTeamScheduleManualState) — a
// team+week already has a confirmed matchup (from either side of the game, from any source) if
// a rec_games row already covers it.
function buildConfirmedByWeekMap(season: { weeks: Array<{ weekNumber: number; games: any[] }> }, teamId: string): Map<number, ConfirmedWeek> {
  const confirmedByWeek = new Map<number, ConfirmedWeek>();
  for (const week of season.weeks) {
    for (const game of week.games) {
      const isAway = game.away_team_id === teamId;
      const isHome = game.home_team_id === teamId;
      if (!isAway && !isHome) continue;
      const opponent = isAway ? game.home_team : game.away_team;
      const opponentUserId = isAway ? game.home_user_id : game.away_user_id;
      confirmedByWeek.set(week.weekNumber, {
        gameId: game.id,
        weekNumber: week.weekNumber,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeUserId: game.home_user_id ?? null,
        awayUserId: game.away_user_id ?? null,
        opponentTeamId: isAway ? game.home_team_id : game.away_team_id,
        opponentName: formatTeamDisplayName(opponent) ?? opponent?.name ?? opponent?.abbreviation ?? "Team",
        homeAway: isAway ? "away" : "home",
        matchupType: opponentUserId ? "h2h" : "cpu",
        postseasonRound: game.postseason_round ?? null,
      });
    }
  }
  return confirmedByWeek;
}

// The web dashboard's schedule builder is also where final scores get manually recorded —
// every week row needs to know whether this game already has a result, so the UI can show
// the right actions instead of asking the commissioner to open each game to check.
type GameResultAndSubmission = {
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
};

export type GameResultLookupDescriptor = { id: string; weekNumber: number; homeTeamId: string; awayTeamId: string };

// Exported so the bulk team-management-summary aggregation (team-schedule-summary.service.ts)
// can reuse this instead of duplicating the result query per team.
//
// rec_game_results has no game_id column — a result is a standalone row correlated to a
// scheduled matchup by (league_id, season_number, week_number, home_team_id, away_team_id),
// same as manual-scores.service.ts's listManualScoreGames.
export async function loadResultsAndPendingSubmissions(
  leagueId: string,
  seasonNumber: number,
  games: GameResultLookupDescriptor[],
): Promise<Map<string, GameResultAndSubmission>> {
  const byGameId = new Map<string, GameResultAndSubmission>();
  if (!games.length) return byGameId;
  const weekNumbers = [...new Set(games.map((g) => g.weekNumber))];

  const resultsRes = await supabase
    .from("rec_game_results")
    .select("week_number,home_team_id,away_team_id,home_score,away_score,is_tie,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("week_number", weekNumbers);
  if (resultsRes.error) throw new ApiError(500, "Failed to load existing game results.", resultsRes.error);

  const resultByMatchup = new Map<string, any>(
    (resultsRes.data ?? []).map((row: any) => [`${row.week_number}:${row.home_team_id}:${row.away_team_id}`, row]),
  );

  for (const g of games) {
    const row = resultByMatchup.get(`${g.weekNumber}:${g.homeTeamId}:${g.awayTeamId}`);
    byGameId.set(g.id, {
      result: row ? { homeScore: row.home_score, awayScore: row.away_score, isTie: row.is_tie, source: row.source } : null,
    });
  }
  return byGameId;
}

// The web dashboard's schedule builder — the commissioner fills in every week directly in the
// UI, plus each week's existing result/pending-submission so the builder can show (and act on)
// final scores inline instead of starting from blank.
export type TeamScheduleManualWeek = {
  weekNumber: number;
  matchupCard: any | null;
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  confirmedMatchupType: "h2h" | "cpu" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  byeType: "regular_season" | "cfp_first_round";
  postseasonRound: string | null;
  rivalry: { enabled: boolean; optedOut: boolean; details: any | null };
  /** Persisted from rec_team_byes — stays checked across reloads until the commissioner unchecks and re-saves. */
  isBye: boolean;
};

export async function getTeamScheduleManualState(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);

  // teams and season are independent (leagueId/seasonNumber already known) -- previously
  // sequential. byeRows only needs leagueId/seasonNumber/teamId, also already known, but used
  // to be fetched dead last after everything else -- started concurrently here instead, and
  // awaited further down at the point it's actually used.
  const teamsP = supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr,display_city,display_nick,conference,is_relocated,primary_color,logo_url,original_abbreviation")
    .eq("league_id", leagueId);
  const seasonP = listScheduleSeason(input.guildId, seasonNumber);
  const byeRowsP = supabase.from("rec_team_byes").select("week_number,bye_type").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", input.teamId);

  const [teams, season] = await Promise.all([teamsP, seasonP]);
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);
  const teamRows = teams.data ?? [];
  const team = teamRows.find((t: any) => t.id === input.teamId);
  if (!team) throw new ApiError(404, "Team was not found in the current league.");

  const confirmedByWeek = buildConfirmedByWeekMap(season, input.teamId);
  const gameDescriptors = [...confirmedByWeek.values()].map((c) => ({ id: c.gameId, weekNumber: c.weekNumber, homeTeamId: c.homeTeamId, awayTeamId: c.awayTeamId }));
  // resultsAndSubmissions/rivalries are mutually independent -- each only needs
  // gameDescriptors, just computed above.
  const [resultsAndSubmissions, rivalries] = await Promise.all([
    loadResultsAndPendingSubmissions(leagueId, seasonNumber, gameDescriptors),
    loadGameRivalries(gameDescriptors.map((game) => game.id)),
  ]);
  const teamById = new Map<string, any>(teamRows.map((row: any) => [row.id, row]));
  const catalogColorFor = (row: any) => {
    if (row?.primary_color && String(row.primary_color).toUpperCase() !== "#FFFFFF") return row.primary_color;
    return NFL_TEAM_PRIMARY_COLORS[String(row?.abbreviation ?? "").toUpperCase()] ?? row?.primary_color ?? "#FFFFFF";
  };
  const cardLogo = (row: any) => {
    if (!row) return { abbr: null as string | null, logoUrl: null as string | null };
    if (row.logo_url) return { abbr: null, logoUrl: row.logo_url };
    return { abbr: row.is_relocated ? row.original_abbreviation ?? row.abbreviation ?? null : row.abbreviation ?? null, logoUrl: null };
  };

  const byeRows = await byeRowsP;
  if (byeRows.error) throw new ApiError(500, "Failed to load bye weeks.", byeRows.error);
  const byeByWeek = new Map((byeRows.data ?? []).map((row: any) => [row.week_number, row.bye_type ?? "regular_season"]));

  const lastWeek = maxSeasonWeek(context.rec_leagues.game);
  const firstWeek = 1;
  const weeks: TeamScheduleManualWeek[] = [];
  for (let weekNumber = firstWeek; weekNumber <= lastWeek; weekNumber++) {
    const confirmed = confirmedByWeek.get(weekNumber);
    const extra = confirmed ? resultsAndSubmissions.get(confirmed.gameId) : undefined;
    const homeRow = confirmed ? teamById.get(confirmed.homeTeamId) : null;
    const awayRow = confirmed ? teamById.get(confirmed.awayTeamId) : null;
    const isFinal = Boolean(extra?.result);
    const matchupCard = confirmed ? {
      gameId: confirmed.gameId,
      weekNumber,
      matchupType: confirmed.matchupType === "h2h" ? "h2h" as const : "human_cpu" as const,
      involvesMe: true,
      viewerSide: confirmed.homeAway,
      isGameOfWeek: false,
      gotw: null,
      homeTeamId: confirmed.homeTeamId,
      awayTeamId: confirmed.awayTeamId,
      homeTeamName: formatTeamDisplayName(homeRow) ?? homeRow?.name ?? "Home",
      awayTeamName: formatTeamDisplayName(awayRow) ?? awayRow?.name ?? "Away",
      homeTeamMascot: resolveTeamNick(homeRow) ?? homeRow?.name ?? "Home",
      awayTeamMascot: resolveTeamNick(awayRow) ?? awayRow?.name ?? "Away",
      homeTeamColor: catalogColorFor(homeRow),
      awayTeamColor: catalogColorFor(awayRow),
      homeTeamAbbr: cardLogo(homeRow).abbr,
      awayTeamAbbr: cardLogo(awayRow).abbr,
      homeTeamLogoUrl: cardLogo(homeRow).logoUrl,
      awayTeamLogoUrl: cardLogo(awayRow).logoUrl,
      homeTeamRank: null,
      awayTeamRank: null,
      homeTeamRecord: null,
      awayTeamRecord: null,
      rivalryName: rivalries.get(confirmed.gameId)?.details?.rivalry_name ?? null,
      homeConference: homeRow?.conference ?? null,
      awayConference: awayRow?.conference ?? null,
      homeScore: extra?.result?.homeScore ?? null,
      awayScore: extra?.result?.awayScore ?? null,
      isFinal,
      hasPreliminaryScore: !isFinal && extra?.result != null,
      displayStatus: isFinal ? "final" as const : "scheduled" as const,
      scheduledFor: null,
      forceWinSide: null,
      wageringOpen: false,
      winnerTeamId: null,
      reactionCounts: { love: 0, like: 0, goty: 0, dislike: 0, poop: 0 },
      myReactions: [] as Array<"love" | "like" | "goty" | "dislike" | "poop">,
      streams: [] as never[],
    } : null;
    weeks.push({
      weekNumber,
      matchupCard,
      alreadyConfirmed: Boolean(confirmed),
      confirmedOpponentTeamId: confirmed?.opponentTeamId ?? null,
      confirmedOpponentName: confirmed?.opponentName ?? null,
      confirmedHomeAway: confirmed?.homeAway ?? null,
      confirmedMatchupType: confirmed?.matchupType ?? null,
      gameId: confirmed?.gameId ?? null,
      result: extra?.result ?? null,
      isBye: !confirmed && byeByWeek.has(weekNumber),
      byeType: (byeByWeek.get(weekNumber) ?? (weekNumber === 16 ? "cfp_first_round" : "regular_season")) as "regular_season" | "cfp_first_round",
      postseasonRound: confirmed?.postseasonRound ?? null,
      rivalry: confirmed ? (rivalries.get(confirmed.gameId) ?? { enabled: false, optedOut: false, details: null }) : { enabled: false, optedOut: false, details: null },
    });
  }

  return {
    team: { id: team.id, name: team.name, abbreviation: team.abbreviation },
    seasonNumber,
    game: context.rec_leagues.game,
    weeks,
  };
}

