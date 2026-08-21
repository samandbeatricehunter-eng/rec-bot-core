// Cross-position roster matchup calculator (Madden leagues). Compares each team's
// offensive units against the opponent's matching defensive units (WR1 vs CB1, HB vs
// MLB, QB vs secondary + pass rush, ...) using player overall ratings plus ability and
// x-factor bonuses. Produces a net edge per unit and an overall game edge that the odds
// service folds into moneyline probabilities, the spread, and the total line.
//
// Design notes:
//  - `overall_rating` is the primary signal; abilities/x-factors add a small bonus and a
//    best-effort `speed` lookup nudges skill positions (falls back silently when the EA
//    payload uses unknown attribute key spellings).
//  - Rosters are loaded once per league/team-set and reduced to a compact unit-value map,
//    so week-wide line generation shares a single query instead of N+1 per game.
//  - CFB leagues (no imported rosters) are skipped by callers; an empty roster yields a
//    neutral 0.5 edge either way.

import { isMadden, type LeagueGame } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

const XFACTOR_BONUS = 5;
const ABILITY_BONUS = 2;
const SPEED_TIP = 90; // above 90, each speed point is worth half a rating point
const NET_TO_PROB = 80; // rating-point net that maps to ~±1 in win-probability delta

const POS = {
  QB: new Set(["QB"]),
  WR: new Set(["WR"]),
  HB: new Set(["HB", "RB", "FB"]),
  TE: new Set(["TE"]),
  CB: new Set(["CB", "DB"]),
  SAFETY: new Set(["FS", "SS", "S"]),
  MLB: new Set(["MLB", "ILB", "MIKE", "WILL", "SAM"]),
  LB: new Set(["MLB", "ILB", "OLB", "LB", "MIKE", "WILL", "SAM", "LOLB", "ROLB"]),
  DL: new Set(["DT", "NT", "LE", "RE", "DE", "DL", "EDGE"]),
  EDGE: new Set(["LE", "RE", "DE", "EDGE", "LEDGE", "REDGE", "LEDG", "REDG"]),
  OL: new Set(["LT", "LG", "C", "RG", "RT", "OL"]),
};

type UnitDef = {
  key: string;
  label: string;
  weight: number;
  offense: keyof OffenseUnits;
  defense: keyof DefenseUnits;
};

const UNITS: UnitDef[] = [
  { key: "qb", label: "QB vs secondary/pass rush", weight: 0.25, offense: "qb", defense: "passDef" },
  { key: "wr1", label: "WR1 vs CB1", weight: 0.2, offense: "wr1", defense: "cb1" },
  { key: "wr2", label: "WR2 vs CB2", weight: 0.15, offense: "wr2", defense: "cb2" },
  { key: "wr3", label: "WR3 vs nickel", weight: 0.1, offense: "wr3", defense: "cb3" },
  { key: "hb", label: "HB vs LB core", weight: 0.1, offense: "hb", defense: "lbCore" },
  { key: "te", label: "TE vs 2nd LB", weight: 0.1, offense: "te", defense: "lb2" },
  { key: "ol", label: "OL vs DL", weight: 0.1, offense: "ol", defense: "dl" },
];

export type OffenseUnits = {
  qb: number;
  wr1: number;
  wr2: number;
  wr3: number;
  hb: number;
  te: number;
  ol: number;
};

export type DefenseUnits = {
  passDef: number;
  cb1: number;
  cb2: number;
  cb3: number;
  lbCore: number;
  lb2: number;
  dl: number;
};

export type MatchupRoster = OffenseUnits & DefenseUnits;

export type MatchupUnitResult = {
  key: string;
  label: string;
  weight: number;
  /** home offense − away defense for this lane (positive = home wins the lane). */
  edge: number;
  homeOffenseRating: number;
  awayDefenseRating: number;
  awayOffenseRating: number;
  homeDefenseRating: number;
};

export type MatchupScores = {
  /** Weighted offensive matchup edge for the home team (positive = home offense better). */
  homeOffScore: number;
  /** Weighted offensive matchup edge for the away team (positive = away offense better). */
  awayOffScore: number;
  /** Net home−away edge in rating points (−80..+80 typical). */
  net: number;
  /** Home win probability implied purely by the roster matchup (0.05..0.95). */
  homeProb: number;
  awayProb: number;
  /** Combined defensive strength vs the league-typical ~84 OVR (positive = stingier D). */
  defEdge: number;
  units: MatchupUnitResult[];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function attribute(attrs: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!attrs) return null;
  for (const key of keys) {
    const raw = attrs[key];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function playerValue(p: any): number {
  const ovr = num(p.overall_rating);
  const bonus = (p.is_xfactor ? XFACTOR_BONUS : 0) + Math.max(0, num(p.ability_count)) * ABILITY_BONUS;
  const speed = attribute(p.attributes, ["speed", "spd", "Speed", "SPD", "speedRating", "SPEED"]);
  const speedBonus = speed != null ? Math.max(0, speed - SPEED_TIP) * 0.5 : 0;
  return ovr + bonus + speedBonus;
}

function avgValues(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/** Reduce a team's active roster to compact per-unit values. Players with no OVR are
 *  ignored (they carry no signal); a roster with no useful players yields neutral zeros. */
function reduceRoster(players: any[]): MatchupRoster | null {
  const useful = (players ?? []).filter((p) => num(p.overall_rating) > 0);
  if (!useful.length) return null;

  const byPos = (set: Set<string>) => useful.filter((p) => set.has(String(p.position ?? "").toUpperCase()));
  const ranked = (list: any[]) => [...list].sort((a, b) => playerValue(b) - playerValue(a));
  const best = (list: any[]) => (list.length ? playerValue(list[0]) : 0);

  const qbs = ranked(byPos(POS.QB));
  const wrs = ranked(byPos(POS.WR));
  const hbs = ranked(byPos(POS.HB));
  const tes = ranked(byPos(POS.TE));
  const cbs = ranked(byPos(POS.CB));
  const safeties = byPos(POS.SAFETY);
  const lbs = ranked(byPos(POS.LB));
  const mlbs = ranked(byPos(POS.MLB));
  const ols = byPos(POS.OL);
  const dls = byPos(POS.DL);
  const edges = byPos(POS.EDGE);

  const secondary = avgValues([...cbs, ...safeties].map(playerValue));
  const passRush = avgValues(edges.map(playerValue));
  const dl = avgValues(dls.map(playerValue));
  const mlb = best(mlbs);
  const lbCore = 0.6 * mlb + 0.4 * dl;
  // 2nd LB = next best non-MLB backer (or just the 2nd best LB overall).
  const nonMlbBackers = lbs.filter((p) => !POS.MLB.has(String(p.position ?? "").toUpperCase()));
  const lb2 = nonMlbBackers.length ? playerValue(nonMlbBackers[0]) : (lbs[1] ? playerValue(lbs[1]) : mlb * 0.7);

  return {
    qb: best(qbs),
    wr1: best(wrs),
    wr2: wrs[1] ? playerValue(wrs[1]) : 0,
    wr3: wrs[2] ? playerValue(wrs[2]) : 0,
    hb: best(hbs),
    te: best(tes),
    ol: avgValues(ols.map(playerValue)),
    passDef: 0.5 * secondary + 0.5 * passRush,
    cb1: best(cbs),
    cb2: cbs[1] ? playerValue(cbs[1]) : 0,
    cb3: cbs[2] ? playerValue(cbs[2]) : 0,
    lbCore,
    lb2,
    dl,
  };
}

export function computeMatchupFromRosters(home: MatchupRoster, away: MatchupRoster): MatchupScores {
  let homeOffScore = 0;
  let awayOffScore = 0;
  const units: MatchupUnitResult[] = [];
  for (const unit of UNITS) {
    const homeEdge = (home[unit.offense] as number) - (away[unit.defense] as number);
    const awayEdge = (away[unit.offense] as number) - (home[unit.defense] as number);
    homeOffScore += unit.weight * homeEdge;
    awayOffScore += unit.weight * awayEdge;
    units.push({
      key: unit.key,
      label: unit.label,
      weight: unit.weight,
      edge: Math.round(homeEdge * 10) / 10,
      homeOffenseRating: Math.round((home[unit.offense] as number) * 10) / 10,
      awayDefenseRating: Math.round((away[unit.defense] as number) * 10) / 10,
      awayOffenseRating: Math.round((away[unit.offense] as number) * 10) / 10,
      homeDefenseRating: Math.round((home[unit.defense] as number) * 10) / 10,
    });
  }
  const net = homeOffScore - awayOffScore;
  const homeProb = clamp(0.5 + net / NET_TO_PROB, 0.05, 0.95);
  const defEdge = ((home as DefenseUnits).dl + (away as DefenseUnits).dl) / 2 - 84;
  return {
    homeOffScore: Math.round(homeOffScore * 10) / 10,
    awayOffScore: Math.round(awayOffScore * 10) / 10,
    net: Math.round(net * 10) / 10,
    homeProb,
    awayProb: 1 - homeProb,
    defEdge: Math.round(defEdge * 10) / 10,
    units,
  };
}

/** Load compact matchup rosters for every requested team in one query. */
export async function loadMatchupRosters(leagueId: string, teamIds: (string | null)[]): Promise<Map<string, MatchupRoster>> {
  const ids = [...new Set(teamIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, MatchupRoster>();
  if (!ids.length) return result;

  const { data, error } = await supabase
    .from("rec_players")
    .select("team_id,position,overall_rating,is_xfactor,ability_count,attributes")
    .eq("league_id", leagueId)
    .in("team_id", ids)
    .in("roster_status", ["active", "transferred_in"]);
  if (error) throw new ApiError(500, "We couldn't load rosters for the matchup. Please try again.", error);

  const byTeam = new Map<string, any[]>();
  for (const row of data ?? []) {
    const list = byTeam.get(row.team_id) ?? [];
    list.push(row);
    byTeam.set(row.team_id, list);
  }
  for (const [teamId, rows] of byTeam) {
    const roster = reduceRoster(rows);
    if (roster) result.set(teamId, roster);
  }
  return result;
}

/** Single-game convenience wrapper around loadMatchupRosters. */
export async function computeMatchupScores(
  leagueId: string,
  homeTeamId: string | null,
  awayTeamId: string | null,
): Promise<MatchupScores | null> {
  if (!homeTeamId || !awayTeamId) return null;
  const rosters = await loadMatchupRosters(leagueId, [homeTeamId, awayTeamId]);
  const home = rosters.get(homeTeamId);
  const away = rosters.get(awayTeamId);
  if (!home || !away) return null;
  return computeMatchupFromRosters(home, away);
}

/** Whether the roster-based matchup calculator applies to this league (Madden only). */
export function matchupCalculatorEnabled(game: LeagueGame | null | undefined): boolean {
  return isMadden(game);
}

export { UNITS };
