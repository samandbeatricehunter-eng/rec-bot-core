// Matchup Preview - per-team season breakdown plus a predicted outcome (win probability
// and a projected score line) for a single game's matchup page. Works for both H2H and
// human-vs-CPU games: the season aggregation reads rec_game_results directly (every team,
// human or CPU, has result rows), and human teams are additionally enriched with their
// Coach Rating / power-rank for display flavor.
//
// Prediction model: each side's standalone strength is a Pythagorean win expectation from
// season points-for / points-against (blended 50/50 with Coach Rating when the team is a
// rated human), combined head-to-head with the log5 formula and a small home-field edge.
// The projected score blends each offense's scoring rate against the other defense's
// concession rate, then tilts toward the favored side so the line agrees with the odds.
import { isCfb } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { computeCoachRatings } from "../league-week/ratings.service.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };

const LEAGUE_NEUTRAL_PPG = 21; // fallback scoring level before any games are logged
const PYTHAG_EXPONENT = 2.37;  // standard football Pythagorean exponent
const HOME_EDGE = 0.025;       // ~2.5% home-field bump to win probability
const HOME_POINTS = 1.5;       // projected home-field points added to the host

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
  pointsAllowedPerGame: number;
  pointDifferential: number;
  avgMargin: number;
  last5: ("W" | "L" | "T")[];
  streak: string;
  winPct: number;
  coachRating: number | null;
  coachGrade: string | null;
  powerRank: number | null;
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
  wins: number; losses: number; ties: number;
  pf: number; pa: number; scored: number;
  history: { week: number; outcome: "W" | "L" | "T" }[];
};
const emptyAgg = (): TeamSeasonAgg => ({ wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, scored: 0, history: [] });

// Aggregate a season's completed results for the two teams in a single pass.
async function aggregateForTeams(leagueId: string, seasonNumber: number, teamIds: string[]): Promise<Map<string, TeamSeasonAgg>> {
  const wanted = new Set(teamIds.filter(Boolean));
  const map = new Map<string, TeamSeasonAgg>();
  for (const id of wanted) map.set(id, emptyAgg());
  if (!wanted.size) return map;

  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,is_tie,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("week_number", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load results for matchup preview.", error);

  for (const g of (data ?? []) as any[]) {
    for (const teamId of [g.home_team_id, g.away_team_id] as (string | null)[]) {
      if (!teamId || !wanted.has(teamId)) continue;
      const agg = map.get(teamId)!;
      const isHome = teamId === g.home_team_id;
      const pf = isHome ? g.home_score : g.away_score;
      const pa = isHome ? g.away_score : g.home_score;
      let outcome: "W" | "L" | "T";
      if (g.is_tie) { agg.ties++; outcome = "T"; }
      else if (g.winning_team_id === teamId) { agg.wins++; outcome = "W"; }
      else { agg.losses++; outcome = "L"; }
      if (pf != null && pa != null) { agg.pf += pf; agg.pa += pa; agg.scored++; }
      agg.history.push({ week: Number(g.week_number ?? 0), outcome });
    }
  }
  return map;
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
  coach: { rating: number; grade: string; rank: number } | null,
): MatchupTeamBreakdown {
  const gamesPlayed = agg.wins + agg.losses + agg.ties;
  const winPct = gamesPlayed > 0 ? (agg.wins + 0.5 * agg.ties) / gamesPlayed : 0;
  const ppg = agg.scored > 0 ? agg.pf / agg.scored : 0;
  const papg = agg.scored > 0 ? agg.pa / agg.scored : 0;
  return {
    teamId: team.id,
    teamName: formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? "Team",
    abbr: team?.display_abbr ?? team?.abbreviation ?? null,
    primaryColor: team?.primary_color ?? "#FFFFFF",
    conference: team?.conference ?? null,
    isHuman,
    record: agg.ties > 0 ? `${agg.wins}-${agg.losses}-${agg.ties}` : `${agg.wins}-${agg.losses}`,
    wins: agg.wins,
    losses: agg.losses,
    ties: agg.ties,
    gamesPlayed,
    pointsPerGame: round(ppg, 1),
    pointsAllowedPerGame: round(papg, 1),
    pointDifferential: round(agg.pf - agg.pa, 0),
    avgMargin: agg.scored > 0 ? round((agg.pf - agg.pa) / agg.scored, 1) : 0,
    last5: agg.history.slice(-5).map((h) => h.outcome),
    streak: streakLabel(agg.history),
    winPct: round(winPct, 3),
    coachRating: coach ? round(coach.rating, 1) : null,
    coachGrade: coach ? coach.grade : null,
    powerRank: coach ? coach.rank : null,
  };
}

export async function getMatchupPreview(input: { guildId: string; discordId: string; gameId: string }): Promise<MatchupPreview> {
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
  if (gameRes.error) throw new ApiError(500, "Failed to load matchup preview.", gameRes.error);
  if (!gameRes.data) throw new ApiError(404, "Matchup not found.");
  const game = gameRes.data as any;
  const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
  const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
  if (!homeTeam || !awayTeam) throw new ApiError(400, "Matchup preview needs both teams assigned.");

  const isHomeHuman = Boolean(game.home_user_id);
  const isAwayHuman = Boolean(game.away_user_id);
  const matchupType: MatchupPreview["matchupType"] =
    isHomeHuman && isAwayHuman ? "h2h" : isHomeHuman || isAwayHuman ? "human_cpu" : "cpu";

  const [aggs, coach] = await Promise.all([
    aggregateForTeams(leagueId, seasonNumber, [homeTeam.id, awayTeam.id]),
    computeCoachRatings(input.guildId).catch(() => null),
  ]);
  const coachByTeam = new Map((coach?.teams ?? []).map((t: any) => [t.teamId, t]));
  const homeAgg = aggs.get(homeTeam.id) ?? emptyAgg();
  const awayAgg = aggs.get(awayTeam.id) ?? emptyAgg();

  const homeCoach = isHomeHuman ? (coachByTeam.get(homeTeam.id) ?? null) : null;
  const awayCoach = isAwayHuman ? (coachByTeam.get(awayTeam.id) ?? null) : null;
  const home = buildBreakdown(homeTeam, homeAgg, isHomeHuman, homeCoach);
  const away = buildBreakdown(awayTeam, awayAgg, isAwayHuman, awayCoach);

  const hasSeasonData = home.gamesPlayed > 0 || away.gamesPlayed > 0;

  // Standalone strength: Pythagorean expectation, blended with Coach Rating for rated humans.
  const homeStrength = homeCoach ? clamp(0.5 * expectedWinRate(homeAgg) + 0.5 * (homeCoach.rating / 100), 0.02, 0.98) : expectedWinRate(homeAgg);
  const awayStrength = awayCoach ? clamp(0.5 * expectedWinRate(awayAgg) + 0.5 * (awayCoach.rating / 100), 0.02, 0.98) : expectedWinRate(awayAgg);

  let homeWin = log5(homeStrength, awayStrength);
  if (hasSeasonData) homeWin = clamp(homeWin + HOME_EDGE, 0.02, 0.98);
  const homeWinPct = round(homeWin * 100, 0);
  const awayWinPct = 100 - homeWinPct;

  // Projected score: each offense's rate vs the other defense's concession rate.
  const homePpg = home.pointsPerGame > 0 ? home.pointsPerGame : LEAGUE_NEUTRAL_PPG;
  const homePapg = home.pointsAllowedPerGame > 0 ? home.pointsAllowedPerGame : LEAGUE_NEUTRAL_PPG;
  const awayPpg = away.pointsPerGame > 0 ? away.pointsPerGame : LEAGUE_NEUTRAL_PPG;
  const awayPapg = away.pointsAllowedPerGame > 0 ? away.pointsAllowedPerGame : LEAGUE_NEUTRAL_PPG;
  const tilt = (homeWin - 0.5) * 6; // let the line agree with the odds
  const predictedHomeScore = Math.max(0, round((homePpg + awayPapg) / 2 + HOME_POINTS + tilt, 0));
  const predictedAwayScore = Math.max(0, round((awayPpg + homePapg) / 2 - tilt, 0));

  const favoredSide: MatchupPrediction["favoredSide"] = homeWinPct > awayWinPct ? "home" : awayWinPct > homeWinPct ? "away" : "even";
  const favoredName = favoredSide === "home" ? home.teamName : favoredSide === "away" ? away.teamName : null;
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
