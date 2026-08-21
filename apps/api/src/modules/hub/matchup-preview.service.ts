// Matchup Preview - per-team season breakdown plus a predicted outcome (win probability
// and a projected score line) for a single game's matchup page. Works for both H2H and
// human-vs-CPU games: the season aggregation reads rec_game_results directly (every team,
// human or CPU, has result rows), and human teams are additionally enriched with their
// User Rating for display flavor.
//
// Prediction model: each side's standalone strength is a Pythagorean win expectation from
// season points-for / points-against (blended 50/50 with User Rating when the team is
// linked to a rated user), combined head-to-head with the log5 formula and a small
// home-field edge. The projected score blends each offense's scoring rate against the
// other defense's concession rate, then tilts toward the favored side so the line agrees
// with the odds.
import { isCfb } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { computeUserRatings } from "../league-week/ratings.service.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 0) => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};

const LEAGUE_NEUTRAL_PPG = 21; // fallback scoring level before any games are logged
const PYTHAG_EXPONENT = 2.37; // standard football Pythagorean exponent
const HOME_EDGE = 0.025; // ~2.5% home-field bump to win probability
const HOME_POINTS = 1.5; // projected home-field points added to the host

export type MatchupTeamBreakdown = {
  teamId: string;
  teamName: string;
  abbr: string | null;
  primaryColor: string;
  conference: string | null;
  isHuman: boolean;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  pointsPerGame: number;
  pointsPerGameRank: number | null;
  pointsAllowedPerGame: number;
  pointsAllowedPerGameRank: number | null;
  pointDifferential: number;
  pointDifferentialRank: number | null;
  passingYardsPerGame: number;
  passingYardsRank: number | null;
  passingYardsAllowedPerGame: number;
  passingYardsAllowedRank: number | null;
  rushingYardsPerGame: number;
  rushingYardsRank: number | null;
  rushingYardsAllowedPerGame: number;
  rushingYardsAllowedRank: number | null;
  turnoverDifferential: number;
  turnoverDifferentialRank: number | null;
  avgMargin: number;
  last5: ("W" | "L" | "T")[];
  streak: string;
  winPct: number;
  userRating: number | null;
  userGrade: string | null;
  userRank: number | null;
};

export type MatchupPrediction = {
  awayWinProbability: number;
  homeWinProbability: number;
  favoredSide: "home" | "away" | "even";
  predictedAwayScore: number;
  predictedHomeScore: number;
  summary: string;
};

export type MatchupPreview = {
  gameId: string;
  weekNumber: number;
  matchupType: "h2h" | "human_cpu" | "cpu";
  displayAsGrade: boolean;
  hasSeasonData: boolean;
  away: MatchupTeamBreakdown;
  home: MatchupTeamBreakdown;
  prediction: MatchupPrediction;
};

type TeamSeasonAgg = {
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  scored: number;
  history: { week: number; outcome: "W" | "L" | "T" }[];
};

type TeamComparisonStats = {
  pointsPerGameRank: number | null;
  pointsAllowedPerGameRank: number | null;
  passingYardsPerGame: number;
  passingYardsRank: number | null;
  passingYardsAllowedPerGame: number;
  passingYardsAllowedRank: number | null;
  rushingYardsPerGame: number;
  rushingYardsRank: number | null;
  rushingYardsAllowedPerGame: number;
  rushingYardsAllowedRank: number | null;
  pointDifferentialRank: number | null;
  turnoverDifferential: number;
  turnoverDifferentialRank: number | null;
};

const emptyAgg = (): TeamSeasonAgg => ({
  wins: 0,
  losses: 0,
  ties: 0,
  pf: 0,
  pa: 0,
  scored: 0,
  history: [],
});

// Aggregate a season's completed results for the two teams in a single pass.
async function aggregateForTeams(
  leagueId: string,
  seasonNumber: number,
  teamIds: string[],
): Promise<Map<string, TeamSeasonAgg>> {
  const wanted = new Set(teamIds.filter(Boolean));
  const map = new Map<string, TeamSeasonAgg>();
  for (const id of wanted) map.set(id, emptyAgg());

  const { data, error } = await supabase
    .from("rec_game_results")
    .select(
      "home_team_id,away_team_id,home_score,away_score,winning_team_id,is_tie,week_number",
    )
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("week_number", { ascending: true });
  if (error)
    throw new ApiError(500, "We couldn't load results for the matchup preview. Please try again.", error);

  // Dedupe duplicate rec_game_results rows by matchup-week.
  const uniqueResults = new Map<string, any>();
  for (const g of (data ?? []) as any[]) {
    const key = `${Number(g.week_number ?? 0)}:${g.home_team_id ?? ""}:${g.away_team_id ?? ""}`;
    if (!uniqueResults.has(key)) uniqueResults.set(key, g);
  }

  for (const g of uniqueResults.values()) {
    for (const teamId of [g.home_team_id, g.away_team_id] as (string | null)[]) {
      if (!teamId) continue;
      if (!map.has(teamId)) map.set(teamId, emptyAgg());
      const agg = map.get(teamId)!;
      const isHome = teamId === g.home_team_id;
      const pf = isHome ? g.home_score : g.away_score;
      const pa = isHome ? g.away_score : g.home_score;
      let outcome: "W" | "L" | "T";
      if (g.is_tie) {
        agg.ties++;
        outcome = "T";
      } else if (g.winning_team_id === teamId) {
        agg.wins++;
        outcome = "W";
      } else {
        agg.losses++;
        outcome = "L";
      }
      if (pf != null && pa != null) {
        agg.pf += pf;
        agg.pa += pa;
        agg.scored++;
      }
      agg.history.push({ week: Number(g.week_number ?? 0), outcome });
    }
  }
  return map;
}

async function comparisonStatsForLeague(leagueId: string, seasonNumber: number): Promise<Map<string, TeamComparisonStats>> {
  const { data, error } = await supabase
    .from("rec_team_game_stats")
    .select("id,game_id,submission_id,team_id,points_for,points_against,off_pass_yards,pass_yards_allowed,off_rush_yards,rush_yards_allowed,turnovers_committed,generated_turnovers")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "We couldn't load team comparisons for the matchup preview. Please try again.", error);

  const unique = new Map<string, any>();
  for (const row of (data ?? []) as any[]) {
    if (!row.team_id) continue;
    const source = row.game_id ?? row.submission_id ?? row.id;
    unique.set(`${row.team_id}:${source}`, row);
  }

  const totals = new Map<string, { games: number; passFor: number; passAllowed: number; rushFor: number; rushAllowed: number; pointDiff: number; turnoverDiff: number }>();
  for (const row of unique.values()) {
    const current = totals.get(row.team_id) ?? { games: 0, passFor: 0, passAllowed: 0, rushFor: 0, rushAllowed: 0, pointDiff: 0, turnoverDiff: 0 };
    current.games += 1;
    current.passFor += Number(row.off_pass_yards ?? 0);
    current.passAllowed += Number(row.pass_yards_allowed ?? 0);
    current.rushFor += Number(row.off_rush_yards ?? 0);
    current.rushAllowed += Number(row.rush_yards_allowed ?? 0);
    current.pointDiff += Number(row.points_for ?? 0) - Number(row.points_against ?? 0);
    current.turnoverDiff += Number(row.generated_turnovers ?? 0) - Number(row.turnovers_committed ?? 0);
    totals.set(row.team_id, current);
  }

  const values = [...totals.entries()].map(([teamId, item]) => ({
    teamId,
    pointsFor: item.games ? item.pointDiff / item.games : 0,
    pointsAllowed: 0,
    passFor: item.games ? item.passFor / item.games : 0,
    passAllowed: item.games ? item.passAllowed / item.games : 0,
    rushFor: item.games ? item.rushFor / item.games : 0,
    rushAllowed: item.games ? item.rushAllowed / item.games : 0,
    pointDiff: item.pointDiff,
    turnoverDiff: item.turnoverDiff,
  }));
  const points = new Map<string, { for: number; against: number }>();
  for (const row of unique.values()) {
    const current = points.get(row.team_id) ?? { for: 0, against: 0 };
    current.for += Number(row.points_for ?? 0);
    current.against += Number(row.points_against ?? 0);
    points.set(row.team_id, current);
  }
  for (const item of values) {
    const teamPoints = points.get(item.teamId) ?? { for: 0, against: 0 };
    const games = totals.get(item.teamId)?.games ?? 0;
    item.pointsFor = games ? teamPoints.for / games : 0;
    item.pointsAllowed = games ? teamPoints.against / games : 0;
  }
  const rank = (value: number, key: "pointsFor" | "pointsAllowed" | "passFor" | "passAllowed" | "rushFor" | "rushAllowed" | "pointDiff" | "turnoverDiff", lowerIsBetter = false) =>
    1 + values.filter((item) => lowerIsBetter ? item[key] < value : item[key] > value).length;

  return new Map(values.map((item) => [item.teamId, {
    pointsPerGameRank: rank(item.pointsFor, "pointsFor"),
    pointsAllowedPerGameRank: rank(item.pointsAllowed, "pointsAllowed", true),
    passingYardsPerGame: round(item.passFor, 1),
    passingYardsRank: rank(item.passFor, "passFor"),
    passingYardsAllowedPerGame: round(item.passAllowed, 1),
    passingYardsAllowedRank: rank(item.passAllowed, "passAllowed", true),
    rushingYardsPerGame: round(item.rushFor, 1),
    rushingYardsRank: rank(item.rushFor, "rushFor"),
    rushingYardsAllowedPerGame: round(item.rushAllowed, 1),
    rushingYardsAllowedRank: rank(item.rushAllowed, "rushAllowed", true),
    pointDifferentialRank: rank(item.pointDiff, "pointDiff"),
    turnoverDifferential: round(item.turnoverDiff, 0),
    turnoverDifferentialRank: rank(item.turnoverDiff, "turnoverDiff"),
  }]));
}

function streakLabel(history: { outcome: "W" | "L" | "T" }[]): string {
  if (!history.length) return "-";
  const latest = history[history.length - 1].outcome;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].outcome === latest) count++;
    else break;
  }
  return `${latest}${count}`;
}

// Pythagorean expected win rate from season scoring; falls back to raw win% (or a neutral
// 0.5) when a team has not logged any scored games yet.
function expectedWinRate(agg: TeamSeasonAgg): number {
  const gp = agg.wins + agg.losses + agg.ties;
  const rawWinPct = gp > 0 ? (agg.wins + 0.5 * agg.ties) / gp : 0.5;
  if (agg.scored === 0 || agg.pf + agg.pa === 0) return rawWinPct;
  const pf = agg.pf ** PYTHAG_EXPONENT;
  const pa = agg.pa ** PYTHAG_EXPONENT;
  return clamp(pf / (pf + pa), 0.02, 0.98);
}

// log5 head-to-head probability that A beats B given each side's standalone win rate.
function log5(eA: number, eB: number): number {
  const denom = eA + eB - 2 * eA * eB;
  if (denom <= 0) return 0.5;
  return clamp((eA - eA * eB) / denom, 0.02, 0.98);
}

function buildBreakdown(
  team: any,
  agg: TeamSeasonAgg,
  isHuman: boolean,
  user: { rating: number; grade: string; rank: number } | null,
  comparison: TeamComparisonStats | null,
  scoringRanks: { pointsFor: number | null; pointsAgainst: number | null; pointDifferential: number | null },
): MatchupTeamBreakdown {
  const gamesPlayed = agg.wins + agg.losses + agg.ties;
  const winPct = gamesPlayed > 0 ? (agg.wins + 0.5 * agg.ties) / gamesPlayed : 0;
  const ppg = agg.scored > 0 ? agg.pf / agg.scored : 0;
  const papg = agg.scored > 0 ? agg.pa / agg.scored : 0;
  return {
    teamId: team.id,
    teamName:
      formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? "Team",
    abbr: team?.display_abbr ?? team?.abbreviation ?? null,
    primaryColor: team?.primary_color ?? "#FFFFFF",
    conference: team?.conference ?? null,
    isHuman,
    record:
      agg.ties > 0
        ? `${agg.wins}-${agg.losses}-${agg.ties}`
        : `${agg.wins}-${agg.losses}`,
    wins: agg.wins,
    losses: agg.losses,
    ties: agg.ties,
    gamesPlayed,
    pointsPerGame: round(ppg, 1),
    pointsPerGameRank: scoringRanks.pointsFor,
    pointsAllowedPerGame: round(papg, 1),
    pointsAllowedPerGameRank: scoringRanks.pointsAgainst,
    pointDifferential: round(agg.pf - agg.pa, 0),
    pointDifferentialRank: scoringRanks.pointDifferential,
    passingYardsPerGame: comparison?.passingYardsPerGame ?? 0,
    passingYardsRank: comparison?.passingYardsRank ?? null,
    passingYardsAllowedPerGame: comparison?.passingYardsAllowedPerGame ?? 0,
    passingYardsAllowedRank: comparison?.passingYardsAllowedRank ?? null,
    rushingYardsPerGame: comparison?.rushingYardsPerGame ?? 0,
    rushingYardsRank: comparison?.rushingYardsRank ?? null,
    rushingYardsAllowedPerGame: comparison?.rushingYardsAllowedPerGame ?? 0,
    rushingYardsAllowedRank: comparison?.rushingYardsAllowedRank ?? null,
    turnoverDifferential: comparison?.turnoverDifferential ?? 0,
    turnoverDifferentialRank: comparison?.turnoverDifferentialRank ?? null,
    avgMargin: agg.scored > 0 ? round((agg.pf - agg.pa) / agg.scored, 1) : 0,
    last5: agg.history.slice(-5).map((h) => h.outcome),
    streak: streakLabel(agg.history),
    winPct: round(winPct, 3),
    userRating: user ? round(user.rating, 1) : null,
    userGrade: user ? user.grade : null,
    userRank: user ? user.rank : null,
  };
}

export async function getMatchupPreview(input: {
  guildId: string;
  discordId: string;
  gameId: string;
}): Promise<MatchupPreview> {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const gameRes = await supabase
    .from("rec_games")
    .select(
      "id,week_number,home_user_id,away_user_id,home_team_id,away_team_id," +
        "home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated,primary_color,conference)," +
        "away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated,primary_color,conference)",
    )
    .eq("id", input.gameId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (gameRes.error)
    throw new ApiError(500, "We couldn't load the matchup preview. Please try again.", gameRes.error);
  if (!gameRes.data) throw new ApiError(404, "Matchup not found.");
  const game = gameRes.data as any;
  const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
  const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
  if (!homeTeam || !awayTeam)
    throw new ApiError(400, "Matchup preview needs both teams assigned.");

  const isHomeHuman = Boolean(game.home_user_id);
  const isAwayHuman = Boolean(game.away_user_id);
  const matchupType: MatchupPreview["matchupType"] =
    isHomeHuman && isAwayHuman
      ? "h2h"
      : isHomeHuman || isAwayHuman
        ? "human_cpu"
        : "cpu";

  const [aggs, comparisons, userRatings] = await Promise.all([
    aggregateForTeams(leagueId, seasonNumber, [homeTeam.id, awayTeam.id]),
    comparisonStatsForLeague(leagueId, seasonNumber),
    bestEffort("matchup_preview.user_ratings", () => computeUserRatings(input.guildId), { guildId: input.guildId }).then((v) => v ?? null),
  ]);
  const ratingByUser = new Map((userRatings?.users ?? []).map((u: any) => [u.userId, u]));
  const homeAgg = aggs.get(homeTeam.id) ?? emptyAgg();
  const awayAgg = aggs.get(awayTeam.id) ?? emptyAgg();

  const homeUser = isHomeHuman ? (ratingByUser.get(game.home_user_id) ?? null) : null;
  const awayUser = isAwayHuman ? (ratingByUser.get(game.away_user_id) ?? null) : null;
  const scoringRows = [...aggs.entries()].filter(([, agg]) => agg.scored > 0).map(([teamId, agg]) => ({
    teamId,
    pointsFor: agg.pf / agg.scored,
    pointsAgainst: agg.pa / agg.scored,
    pointDifferential: agg.pf - agg.pa,
  }));
  const scoringRanksFor = (teamId: string) => {
    const row = scoringRows.find((item) => item.teamId === teamId);
    if (!row) return { pointsFor: null, pointsAgainst: null, pointDifferential: null };
    return {
      pointsFor: 1 + scoringRows.filter((item) => item.pointsFor > row.pointsFor).length,
      pointsAgainst: 1 + scoringRows.filter((item) => item.pointsAgainst < row.pointsAgainst).length,
      pointDifferential: 1 + scoringRows.filter((item) => item.pointDifferential > row.pointDifferential).length,
    };
  };
  const home = buildBreakdown(homeTeam, homeAgg, isHomeHuman, homeUser, comparisons.get(homeTeam.id) ?? null, scoringRanksFor(homeTeam.id));
  const away = buildBreakdown(awayTeam, awayAgg, isAwayHuman, awayUser, comparisons.get(awayTeam.id) ?? null, scoringRanksFor(awayTeam.id));

  const hasSeasonData = home.gamesPlayed > 0 || away.gamesPlayed > 0;

  // Standalone strength: Pythagorean expectation, blended with User Rating for rated humans.
  const homeStrength = homeUser
    ? clamp(
        0.5 * expectedWinRate(homeAgg) + 0.5 * (homeUser.rating / 100),
        0.02,
        0.98,
      )
    : expectedWinRate(homeAgg);
  const awayStrength = awayUser
    ? clamp(
        0.5 * expectedWinRate(awayAgg) + 0.5 * (awayUser.rating / 100),
        0.02,
        0.98,
      )
    : expectedWinRate(awayAgg);

  let homeWin = log5(homeStrength, awayStrength);
  if (hasSeasonData) homeWin = clamp(homeWin + HOME_EDGE, 0.02, 0.98);
  const homeWinPct = round(homeWin * 100, 0);
  const awayWinPct = 100 - homeWinPct;

  // Projected score: each offense's rate vs the other defense's concession rate.
  const homePpg = home.pointsPerGame > 0 ? home.pointsPerGame : LEAGUE_NEUTRAL_PPG;
  const homePapg =
    home.pointsAllowedPerGame > 0
      ? home.pointsAllowedPerGame
      : LEAGUE_NEUTRAL_PPG;
  const awayPpg = away.pointsPerGame > 0 ? away.pointsPerGame : LEAGUE_NEUTRAL_PPG;
  const awayPapg =
    away.pointsAllowedPerGame > 0
      ? away.pointsAllowedPerGame
      : LEAGUE_NEUTRAL_PPG;
  const tilt = (homeWin - 0.5) * 6; // let the line agree with the odds
  let predictedHomeScore = Math.max(
    0,
    round((homePpg + awayPapg) / 2 + HOME_POINTS + tilt, 0),
  );
  let predictedAwayScore = Math.max(
    0,
    round((awayPpg + homePapg) / 2 - tilt, 0),
  );

  if (predictedHomeScore === predictedAwayScore) {
    // Never project a tie: nudge the higher-win-probability side up by 1.
    // If exactly 50/50, break toward the home side.
    if (homeWin >= 0.5) predictedHomeScore += 1;
    else predictedAwayScore += 1;
  }

  const favoredSide: MatchupPrediction["favoredSide"] =
    homeWinPct > awayWinPct ? "home" : awayWinPct > homeWinPct ? "away" : "even";
  const favoredName =
    favoredSide === "home"
      ? home.teamName
      : favoredSide === "away"
        ? away.teamName
        : null;
  const favoredPct = Math.max(homeWinPct, awayWinPct);
  const summary = !hasSeasonData
    ? "Not enough games played yet - projection is a season-neutral estimate."
    : favoredName
      ? `${favoredName} favored ${favoredPct}% | projected ${away.abbr ?? "Away"} ${predictedAwayScore}-${predictedHomeScore} ${home.abbr ?? "Home"}`
      : `Even matchup | projected ${away.abbr ?? "Away"} ${predictedAwayScore}-${predictedHomeScore} ${home.abbr ?? "Home"}`;

  return {
    gameId: game.id,
    weekNumber: Number(game.week_number),
    matchupType,
    displayAsGrade: isCfb(context.rec_leagues.game),
    hasSeasonData,
    away,
    home,
    prediction: {
      awayWinProbability: awayWinPct,
      homeWinProbability: homeWinPct,
      favoredSide,
      predictedAwayScore,
      predictedHomeScore,
      summary,
    },
  };
}
