// Auto-derives wager lines & odds for a scheduled game from data we already have:
// power-ranking scores (moneyline + spread) and season stat averages (totals).
// A game is "human-involved" when at least one side has a linked coach — only then
// do box-score-stat markets (yards, turnovers, red-zone %) appear.

import {
  WAGER_MARKETS,
  marketsForGame,
  moneylineOddsFromProb,
  spreadOrTotalOdds,
  type WagerMarket,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";

// Relocated/custom teams keep the original `abbreviation`; the custom abbr lives in
// `display_abbr`. Prefer the display abbr so wager labels match the rest of the bot.
function teamDisplayAbbr(team?: { display_abbr?: string | null; abbreviation?: string | null; name?: string | null } | null): string {
  if (!team) return "TBD";
  return (team.display_abbr ?? "").trim() || (team.abbreviation ?? "").trim() || (team.name ?? "").trim() || "TBD";
}

const SPREAD_SCALE = 45;   // power-rank score edge → points
const MAX_SPREAD = 24;
// Standard sportsbook home-field baseline — an otherwise-even matchup still lines the home
// team as a small favorite (e.g. -3), not a pick'em, same as real books.
const HOME_FIELD_ADVANTAGE = 3;
// A turnovers O/U line can't legitimately be 0 — "under 0" isn't a real bet. Floor it at 1
// (Over 1 / Under 1) even when both teams' actual averages round down near zero.
const MIN_TURNOVER_LINE = 1;
const LEAGUE_BASELINE_PPG = 24;
const LEAGUE_BASELINE = {
  total_yards: 350,
  rush_yards: 120,
  pass_yards: 230,
  turnovers: 1.5,
  redzone_off: 55,
  redzone_def: 55,
};

export type WagerSideOption = { pick: string; label: string; odds: number };
export type WagerMarketOption = {
  market: string;
  label: string;
  kind: WagerMarket["kind"];
  line: number | null;
  unit?: string;
  sides: WagerSideOption[];
};

export type GameWagerOptions = {
  gameId: string;
  weekNumber: number;
  seasonNumber: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeLabel: string;
  awayLabel: string;
  humanInvolved: boolean;
  markets: WagerMarketOption[];
};

type TeamRow = { id: string; name: string | null; abbreviation: string | null; display_abbr: string | null; display_city: string | null; display_nick: string | null; is_relocated: boolean | null };

function num(v: unknown) {
  return Number(v) || 0;
}

// Every offensive stat this model uses has a matching "allowed/forced" defensive stat on
// the same table — this is what makes a line matchup-aware instead of just each team's
// isolated season average. redzone_off/redzone_def are each other's counterpart since
// they're both already a single team's own percentage (unlike the others, which come in
// separate "committed" vs "allowed" flavors of the same underlying stat).
const DEFENSE_COUNTERPART: Record<string, string> = {
  points: "points_against",
  total_yards: "yards_allowed",
  rush_yards: "rush_yards_allowed",
  pass_yards: "pass_yards_allowed",
  turnovers: "turnovers_forced",
  redzone_off: "redzone_def",
  redzone_def: "redzone_off",
};

function averageStatsFromRows(rows: any[]) {
  const n = rows.length;
  const avg = (key: string) => rows.reduce((s, r: any) => s + num(r[key]), 0) / n;
  return {
    points: avg("points_for"),
    points_against: avg("points_against"),
    total_yards: avg("total_yards_gained") || avg("off_yards_gained"),
    yards_allowed: avg("yards_allowed"),
    rush_yards: avg("off_rush_yards"),
    rush_yards_allowed: avg("rush_yards_allowed"),
    pass_yards: avg("off_pass_yards"),
    pass_yards_allowed: avg("pass_yards_allowed"),
    turnovers: avg("turnovers_committed"),
    turnovers_forced: avg("generated_turnovers"),
    redzone_off: avg("red_zone_off_percentage"),
    redzone_def: avg("red_zone_def_percentage"),
  };
}

// One query for both sides of the matchup instead of two separate round-trips.
async function seasonAveragesForTeams(leagueId: string, seasonNumber: number, teamIds: (string | null)[]) {
  const ids = [...new Set(teamIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, ReturnType<typeof averageStatsFromRows>>();
  if (!ids.length) return result;
  const { data } = await supabase
    .from("rec_team_game_stats")
    .select("team_id,points_for,points_against,total_yards_gained,off_yards_gained,off_rush_yards,off_pass_yards,turnovers_committed,generated_turnovers,yards_allowed,rush_yards_allowed,pass_yards_allowed,red_zone_off_percentage,red_zone_def_percentage")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("team_id", ids);
  const rowsByTeam = new Map<string, any[]>();
  for (const row of data ?? []) {
    const list = rowsByTeam.get(row.team_id) ?? [];
    list.push(row);
    rowsByTeam.set(row.team_id, list);
  }
  for (const [teamId, rows] of rowsByTeam) {
    if (rows.length) result.set(teamId, averageStatsFromRows(rows));
  }
  return result;
}

/** A team's expected output for a stat this game — blended half from their own season
 * average, half from this specific opponent's average at allowing/forcing it. Falls back
 * to whichever side is actually available, then the league baseline. */
function matchupExpected(ownAvg: number | null | undefined, opponentAllowedAvg: number | null | undefined, baseline: number): number {
  if (ownAvg == null && opponentAllowedAvg == null) return baseline;
  if (ownAvg == null) return opponentAllowedAvg!;
  if (opponentAllowedAvg == null) return ownAvg;
  return (ownAvg + opponentAllowedAvg) / 2;
}

function totalLine(statKey: string, homeAvg: any, awayAvg: any): number {
  const baseline = (LEAGUE_BASELINE as any)[statKey] ?? 0;
  const defenseKey = DEFENSE_COUNTERPART[statKey];
  // Each side's expectation accounts for who they're actually playing, not just their own
  // isolated average — e.g. a team's expected passing yards leans on both their own
  // pass offense AND this opponent's pass defense, not their offense alone.
  const h = matchupExpected(homeAvg?.[statKey], awayAvg?.[defenseKey], baseline);
  const a = matchupExpected(awayAvg?.[statKey], homeAvg?.[defenseKey], baseline);
  // Percentage markets average the two sides; counting markets sum them.
  if (statKey === "redzone_off" || statKey === "redzone_def") return Math.round(((h + a) / 2) * 10) / 10;
  if (statKey === "turnovers") return Math.max(MIN_TURNOVER_LINE, Math.round((h + a) * 2) / 2); // nearest 0.5, floored at 1
  return Math.round(h + a);
}

// Same matchup-adjusted expectation as totalLine, but for a single team's side of it
// instead of the combined game total — powers the team_total markets (e.g. "Yellow
// Jackets Over/Under 24.5").
function teamTotalLine(statKey: string, homeAvg: any, awayAvg: any, team: "home" | "away"): number {
  const baseline = (LEAGUE_BASELINE as any)[statKey] ?? 0;
  const defenseKey = DEFENSE_COUNTERPART[statKey];
  const expected =
    team === "home"
      ? matchupExpected(homeAvg?.[statKey], awayAvg?.[defenseKey], baseline)
      : matchupExpected(awayAvg?.[statKey], homeAvg?.[defenseKey], baseline);
  if (statKey === "redzone_off" || statKey === "redzone_def") return Math.round(expected * 10) / 10;
  if (statKey === "turnovers") return Math.max(MIN_TURNOVER_LINE, Math.round(expected * 2) / 2);
  return Math.round(expected);
}

export async function getGameWagerOptions(guildId: string, gameId: string): Promise<GameWagerOptions> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const { data: game, error } = await supabase
    .from("rec_games")
    .select("id,week_number,status,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated)")
    .eq("league_id", leagueId)
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load game for wager options.", error);
  if (!game) throw new ApiError(404, "Scheduled game not found.");
  if (game.status !== "scheduled") throw new ApiError(409, "Wagering is closed for this game.");
  if (!(game.home_user_id && game.away_user_id)) throw new ApiError(409, "Wagering is only available for head-to-head (human vs. human) games.");

  const home = game.home_team as unknown as TeamRow | null;
  const away = game.away_team as unknown as TeamRow | null;
  const homeLabel = teamDisplayAbbr(home);
  const awayLabel = teamDisplayAbbr(away);
  const humanInvolved = Boolean(game.home_user_id) || Boolean(game.away_user_id);

  // Power-ranking scores → moneyline probabilities + spread.
  const rankings = await computePowerRankings(guildId).catch(() => null);
  const scoreByTeam = new Map<string, number>();
  for (const t of (rankings?.teams ?? []) as any[]) scoreByTeam.set(t.teamId, Number(t.score ?? 0));
  const homeScore = scoreByTeam.get(game.home_team_id ?? "") ?? 0.5;
  const awayScore = scoreByTeam.get(game.away_team_id ?? "") ?? 0.5;
  const total = homeScore + awayScore || 1;
  const homeProb = homeScore / total;
  const awayProb = awayScore / total;
  const rawSpread = Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, Math.round(((homeScore - awayScore) * SPREAD_SCALE + HOME_FIELD_ADVANTAGE) * 2) / 2));

  const averagesByTeam = await seasonAveragesForTeams(leagueId, seasonNumber, [game.home_team_id, game.away_team_id]);
  const homeAvg = averagesByTeam.get(game.home_team_id ?? "") ?? null;
  const awayAvg = averagesByTeam.get(game.away_team_id ?? "") ?? null;

  const markets: WagerMarketOption[] = [];
  for (const def of marketsForGame(humanInvolved)) {
    if (def.kind === "moneyline") {
      markets.push({
        market: def.key, label: def.label, kind: def.kind, line: null,
        sides: [
          { pick: game.away_team_id ?? "away", label: awayLabel, odds: moneylineOddsFromProb(awayProb) },
          { pick: game.home_team_id ?? "home", label: homeLabel, odds: moneylineOddsFromProb(homeProb) },
        ],
      });
    } else if (def.kind === "spread") {
      // rawSpread > 0 ⇒ home favored. Favorite lays the points, dog takes them.
      const homeLine = -rawSpread;
      const awayLine = rawSpread;
      markets.push({
        market: def.key, label: def.label, kind: def.kind, line: rawSpread, unit: def.unit,
        sides: [
          { pick: game.away_team_id ?? "away", label: `${awayLabel} ${awayLine > 0 ? "+" : ""}${awayLine}`, odds: spreadOrTotalOdds() },
          { pick: game.home_team_id ?? "home", label: `${homeLabel} ${homeLine > 0 ? "+" : ""}${homeLine}`, odds: spreadOrTotalOdds() },
        ],
      });
    } else if (def.kind === "team_total") {
      const line = teamTotalLine(def.statKey ?? "points", homeAvg, awayAvg, def.team ?? "home");
      const teamLabel = def.team === "away" ? awayLabel : homeLabel;
      markets.push({
        market: def.key, label: `${teamLabel} Total Points O/U`, kind: def.kind, line, unit: def.unit,
        sides: [
          { pick: "over", label: `Over ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
          { pick: "under", label: `Under ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
        ],
      });
    } else {
      const line = totalLine(def.statKey ?? "points", homeAvg, awayAvg);
      markets.push({
        market: def.key, label: def.label, kind: def.kind, line, unit: def.unit,
        sides: [
          { pick: "over", label: `Over ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
          { pick: "under", label: `Under ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
        ],
      });
    }
  }

  return {
    gameId, weekNumber: Number(game.week_number ?? 0), seasonNumber,
    homeTeamId: game.home_team_id, awayTeamId: game.away_team_id,
    homeLabel, awayLabel, humanInvolved, markets,
  };
}

export type WeekWagerLine = {
  gameId: string;
  homeLabel: string;
  awayLabel: string;
  moneyline: { homeOdds: number; awayOdds: number } | null;
  spread: { line: number; odds: number } | null;
  total: { line: number; odds: number } | null;
};

/** Compact moneyline/spread/total_points line for every H2H game in a week — one shared
 * power-rankings fetch and one batched season-averages query, instead of calling
 * getGameWagerOptions per game (which recomputes rankings every time). Used for the inline
 * "lines at a glance" list on the Wagers page; the full per-game markets (including
 * box-score-gated stat props) still come from getGameWagerOptions when a wager is opened. */
export async function listWeekWagerLines(guildId: string, weekNumber: number): Promise<WeekWagerLine[]> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled");
  if (error) throw new ApiError(500, "Failed to load games for wager lines.", error);
  const h2hGames = (games ?? []).filter((g) => g.home_user_id && g.away_user_id);
  if (!h2hGames.length) return [];

  const rankings = await computePowerRankings(guildId).catch(() => null);
  const scoreByTeam = new Map<string, number>();
  for (const t of (rankings?.teams ?? []) as any[]) scoreByTeam.set(t.teamId, Number(t.score ?? 0));

  const teamIds = h2hGames.flatMap((g) => [g.home_team_id, g.away_team_id]);
  const averagesByTeam = await seasonAveragesForTeams(leagueId, seasonNumber, teamIds);

  return h2hGames.map((game) => {
    const home = game.home_team as unknown as TeamRow | null;
    const away = game.away_team as unknown as TeamRow | null;
    const homeLabel = teamDisplayAbbr(home);
    const awayLabel = teamDisplayAbbr(away);

    const homeScore = scoreByTeam.get(game.home_team_id ?? "") ?? 0.5;
    const awayScore = scoreByTeam.get(game.away_team_id ?? "") ?? 0.5;
    const total = homeScore + awayScore || 1;
    const homeProb = homeScore / total;
    const awayProb = awayScore / total;
    const rawSpread = Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, Math.round(((homeScore - awayScore) * SPREAD_SCALE + HOME_FIELD_ADVANTAGE) * 2) / 2));

    const homeAvg = averagesByTeam.get(game.home_team_id ?? "") ?? null;
    const awayAvg = averagesByTeam.get(game.away_team_id ?? "") ?? null;
    const line = totalLine("points", homeAvg, awayAvg);

    return {
      gameId: game.id,
      homeLabel,
      awayLabel,
      moneyline: { homeOdds: moneylineOddsFromProb(homeProb), awayOdds: moneylineOddsFromProb(awayProb) },
      spread: { line: rawSpread, odds: spreadOrTotalOdds() },
      total: { line, odds: spreadOrTotalOdds() },
    };
  });
}

export { WAGER_MARKETS };
