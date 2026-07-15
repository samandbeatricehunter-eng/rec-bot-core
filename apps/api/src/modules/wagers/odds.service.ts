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

async function seasonAveragesForTeam(leagueId: string, seasonNumber: number, teamId: string | null) {
  if (!teamId) return null;
  const { data } = await supabase
    .from("rec_team_game_stats")
    .select("points_for,total_yards_gained,off_yards_gained,off_rush_yards,off_pass_yards,turnovers_committed,red_zone_off_percentage,red_zone_def_percentage")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("team_id", teamId);
  if (!data?.length) return null;
  const n = data.length;
  const avg = (key: string) => data.reduce((s, r: any) => s + num(r[key]), 0) / n;
  return {
    points: avg("points_for"),
    total_yards: avg("total_yards_gained") || avg("off_yards_gained"),
    rush_yards: avg("off_rush_yards"),
    pass_yards: avg("off_pass_yards"),
    turnovers: avg("turnovers_committed"),
    redzone_off: avg("red_zone_off_percentage"),
    redzone_def: avg("red_zone_def_percentage"),
  };
}

function totalLine(statKey: string, homeAvg: any, awayAvg: any): number {
  const baseline = (LEAGUE_BASELINE as any)[statKey];
  const h = homeAvg?.[statKey] ?? baseline ?? 0;
  const a = awayAvg?.[statKey] ?? baseline ?? 0;
  // Percentage markets average the two sides; counting markets sum them.
  if (statKey === "redzone_off" || statKey === "redzone_def") return Math.round(((h + a) / 2) * 10) / 10;
  if (statKey === "turnovers") return Math.round((h + a) * 2) / 2; // nearest 0.5
  return Math.round(h + a);
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
  const rawSpread = Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, Math.round((homeScore - awayScore) * SPREAD_SCALE * 2) / 2));

  const [homeAvg, awayAvg] = await Promise.all([
    seasonAveragesForTeam(leagueId, seasonNumber, game.home_team_id),
    seasonAveragesForTeam(leagueId, seasonNumber, game.away_team_id),
  ]);

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

export { WAGER_MARKETS };
