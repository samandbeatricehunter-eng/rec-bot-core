import { type LeagueGame, type RecEndSeasonPayoutDefinition } from "@rec/shared";

function num(value: unknown) {
  return Number(value) || 0;
}

function jsonNum(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object") return 0;
  return num((raw as Record<string, unknown>)[key]);
}

/** "16:22" -> 982 seconds; a plain jsonNum() would misparse this (strips the colon, giving 1622). */
function jsonClockSeconds(raw: unknown, key: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  const m = value != null ? String(value).match(/^(\d+):(\d{2})$/) : null;
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** "9-12" -> [9, 12]. Falls back to [made-only, null] if the attempts half wasn't recoverable. */
function jsonMadeAttempts(raw: unknown, key: string): [number, number | null] {
  if (!raw || typeof raw !== "object") return [0, null];
  const value = (raw as Record<string, unknown>)[key];
  const m = value != null ? String(value).match(/^(-?\d+)-(-?\d+)$/) : null;
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [num(value), null];
}

// A team's per-game-rate composite (rb_workhorse_score, defense_identity_score) is too
// noisy to trust on a handful of box scores — a single big or bad game swings the whole
// average. Stepped against a full CFB regular season (12 games across 14 weeks, byes
// included): >=6 games logged (half a season) is enough of a sample to trust in full;
// 4-5 games gets a mild discount; 3 or fewer (a game or two) gets a heavy one, since one
// fluke performance can otherwise carry the whole average.
function coverageMultiplier(games: number, _game: LeagueGame) {
  if (games >= 6) return 1;
  if (games > 3) return 0.75;
  return 0.4;
}

export function evalTeamStat(statKey: string, rows: any[], game: LeagueGame) {
  const games = rows.length;
  const sum = (key: string) => rows.reduce((total, row) => total + num(row[key]), 0);
  const jsonSum = (sourceKey: string, key: string) => rows.reduce((total, row) => total + jsonNum(row[sourceKey], key), 0);
  if (statKey === "points_per_game") return games ? sum("points_for") / games : 0;
  if (statKey === "points_allowed_per_game") return games ? sum("points_against") / games : 0;
  // CFB box scores: a team's defensive INTs = its opponent's interceptions_thrown,
  // which recordTeamGameStats already mirrors into this team's defensive_stats JSONB.
  // Madden import: the team's own defIntsRec is stored as team_interceptions.
  // Per-game so teams are comparable regardless of how many games are logged.
  if (statKey === "team_interceptions") {
    const imported = jsonSum("defensive_stats", "team_interceptions");
    const boxed = jsonSum("defensive_stats", "interceptions_thrown");
    return games ? (imported || boxed) / games : 0;
  }
  // Per-game rates keep teams comparable while box scores are logged at uneven rates.
  // A team whose opponents' yardage was never parsed reads as 0 for every game; treat
  // an all-zero season as missing rather than an (impossible) flawless defense.
  if (statKey === "total_yards_allowed") {
    const values = rows.map((row) => num(row.yards_allowed));
    return games && values.some((value) => value > 0) ? values.reduce((total, value) => total + value, 0) / games : Number.POSITIVE_INFINITY;
  }
  if (statKey === "turnover_differential") return games ? (sum("generated_turnovers") - sum("turnovers_committed")) / games : 0;
  if (statKey === "total_offense_yards") {
    const offense = sum("off_yards_gained");
    const total = sum("total_yards_gained");
    return games ? (offense || total) / games : 0;
  }
  if (statKey === "red_zone_td_rate") {
    const values = rows.map((row) => row.red_zone_off_percentage).filter((value) => value != null).map(num);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  if (statKey === "red_zone_td_rate_allowed") {
    const values = rows.map((row) => row.red_zone_def_percentage).filter((value) => value != null).map(num);
    // No tracked red-zone data must never read as a 0% allowed (perfect) rate — that would
    // hand teams with missing OCR data the S tier. Report a value that can't qualify instead.
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : Number.POSITIVE_INFINITY;
  }
  if (statKey === "avg_time_of_possession_seconds") {
    const values = rows.map((row) => jsonClockSeconds(row.offensive_stats, "time_of_possession")).filter((v): v is number => v != null);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  // Per-game so teams are comparable regardless of games logged. A team whose box scores
  // never recorded penalties reads as 0 every game; treat an all-zero season as missing
  // rather than a (suspicious) flawless record.
  if (statKey === "total_penalties") {
    const values = rows.map((row) => jsonNum(row.offensive_stats, "penalties"));
    return games && values.some((value) => value > 0) ? values.reduce((total, value) => total + value, 0) / games : Number.POSITIVE_INFINITY;
  }
  if (statKey === "red_zone_td_finish_rate") {
    const tds = jsonSum("offensive_stats", "red_zone_tds");
    const fgs = jsonSum("offensive_stats", "red_zone_fgs");
    return tds + fgs > 0 ? (tds / (tds + fgs)) * 100 : 0;
  }
  if (statKey === "rb_workhorse_score") {
    const attempts = jsonSum("offensive_stats", "off_rush_attempts");
    const tds = jsonSum("offensive_stats", "off_rush_tds");
    const yardsPerRushValues = rows.map((row) => jsonNum(row.offensive_stats, "yards_per_rush")).filter((v) => v > 0);
    const avgYardsPerRush = yardsPerRushValues.length ? yardsPerRushValues.reduce((total, v) => total + v, 0) / yardsPerRushValues.length : 0;
    if (!games) return 0;
    // "Workhorse" means carries (usage), not just per-carry efficiency — the old weights
    // (attempts/games/25 vs avgYardsPerRush*8) made volume nearly worthless: a 28-carry/game
    // grinder scored ~1 point for that workload while a single 16-yard-per-carry outlier game
    // scored 130+. Attempts/games is now the dominant term; ypr and TDs still matter but can no
    // longer let one huge game outscore genuine bell-cow usage. Coverage-penalized below.
    const raw = (attempts / games) * 2 + avgYardsPerRush * 3 + (tds / games) * 8;
    return raw * coverageMultiplier(games, game);
  }
  if (statKey === "defense_identity_score") {
    const redZoneDefPct = (() => {
      const values = rows.map((row) => row.red_zone_def_percentage).filter((value) => value != null).map(num);
      return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
    })();
    const oppIntsThrown = jsonSum("defensive_stats", "interceptions_thrown");
    const oppFumblesLost = jsonSum("defensive_stats", "fumbles_lost");
    let oppThirdMade = 0, oppThirdAttempts = 0;
    for (const row of rows) {
      const [tm, ta] = jsonMadeAttempts(row.defensive_stats, "third_down_conversions");
      // A game whose OCR only recovered the makes (no "X-Y" attempts format, e.g. a bare "3")
      // must be excluded entirely, not just from the attempts side — counting its makes into
      // the numerator while dropping its attempts from the denominator inflates the opponent's
      // conversion rate, understating the defense (this silently zeroed real S-tier defenses).
      if (ta != null) { oppThirdMade += tm; oppThirdAttempts += ta; }
    }
    // No recoverable attempts data must never read as a 0% (perfect) allowed rate —
    // that would reward missing OCR data with the max bonus. Skip the term instead.
    const oppThirdPct = oppThirdAttempts > 0 ? (oppThirdMade / oppThirdAttempts) * 100 : null;

    // Points/yards allowed give missing OCR data the same "skip the term, don't reward it"
    // treatment as the rate-based terms above — an all-zero season reads as no data, not a
    // flawless defense.
    const pointsAllowedPerGame = games ? sum("points_against") / games : 0;
    const yardsAllowedValues = rows.map((row) => num(row.yards_allowed));
    const hasYardsData = yardsAllowedValues.some((value) => value > 0);
    const yardsAllowedPerGame = games && hasYardsData ? yardsAllowedValues.reduce((total, value) => total + value, 0) / games : null;

    // 0-100 composite (recalibrated 2026-08-05); five terms of 20 points each, replacing the
    // old four-of-25 split that had no yards/points-allowed signal at all despite those being
    // core defensive-dominance stats. Takeaway weight increased so 3+ forced turnovers/game
    // alone can carry most of a tier on its own, per design intent that a high-turnover
    // defense should be a major driver here. 4th-down stops dropped — too low-sample per game
    // to reliably carry a fifth of the score. Scales mirror the opp_ppg_allowed (16-28) and
    // team_def_yards_allowed (300-500) categories so this stays internally consistent with
    // the rest of the payout ladder.
    const redZoneTerm = redZoneDefPct > 0 ? Math.min(20, Math.max(0, ((95 - redZoneDefPct) * 20) / 45)) : 0;
    const takeawayTerm = games ? Math.min(20, ((oppIntsThrown + oppFumblesLost) / games) * 14) : 0;
    const thirdDownTerm = oppThirdPct != null ? Math.min(20, Math.max(0, 65 - oppThirdPct)) : 0;
    const pointsAllowedTerm = pointsAllowedPerGame > 0 ? Math.min(20, Math.max(0, (20 * (28 - pointsAllowedPerGame)) / 12)) : 0;
    const yardsAllowedTerm = yardsAllowedPerGame != null ? Math.min(20, Math.max(0, (20 * (500 - yardsAllowedPerGame)) / 200)) : 0;
    const raw = redZoneTerm + takeawayTerm + thirdDownTerm + pointsAllowedTerm + yardsAllowedTerm;
    return raw * coverageMultiplier(games, game);
  }
  return 0;
}

const PLAYER_STAT_ALIASES: Record<string, string[]> = {
  rush_attempts: ["rushAtt", "rush_attempts"],
  rush_yards: ["rushYds", "rush_yards"],
  rush_tds: ["rushTDs", "rush_tds"],
  broken_tackles: ["rushBrokenTackles", "broken_tackles"],
  rush_yards_after_contact: ["rushYdsAfterContact", "rush_yards_after_contact", "rush_yac"],
  fg_50_attempts: ["fG50PlusAtt", "fg_50_attempts"],
  fg_50_made: ["fG50PlusMade", "fg_50_made"],
};

export function playerStatTotal(stats: Record<string, unknown> | null | undefined, canonical: string): number {
  if (!stats) return 0;
  if (stats[canonical] != null) return num(stats[canonical]);
  for (const alias of PLAYER_STAT_ALIASES[canonical] ?? []) {
    if (alias !== canonical && stats[alias] != null) return num(stats[alias]);
  }
  return 0;
}

export function mergePlayerWeekStats(rows: Array<{ stats?: Record<string, unknown> | null }>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const stats = row.stats ?? {};
    for (const canonical of Object.keys(PLAYER_STAT_ALIASES)) {
      totals[canonical] = (totals[canonical] ?? 0) + playerStatTotal(stats, canonical);
    }
  }
  return totals;
}

export type ImportPlayerBonusResult = {
  qualified: boolean;
  value: number;
  met: number;
  needed: number;
  detail: Record<string, number>;
};

export function evaluateImportPlayerBonus(definition: RecEndSeasonPayoutDefinition, stats: Record<string, number>, position: string | null): ImportPlayerBonusResult {
  const allowed = (definition.eligiblePositions ?? []).map((item) => item.toUpperCase());
  if (allowed.length && !allowed.includes(String(position ?? "").toUpperCase())) {
    return { qualified: false, value: 0, met: 0, needed: Object.keys(definition.minimums ?? {}).length, detail: {} };
  }
  if (definition.key === "king_of_the_swing") {
    const att = stats.fg_50_attempts ?? 0;
    const made = stats.fg_50_made ?? 0;
    const qualified = att >= 2 && made === att;
    return { qualified, value: qualified ? 1 : 0, met: qualified ? 1 : att >= 2 && made > 0 ? 0 : 0, needed: 1, detail: { fg_50_attempts: att, fg_50_made: made } };
  }
  const minimums = definition.minimums ?? {};
  const keys = Object.keys(minimums);
  const detail: Record<string, number> = {};
  let met = 0;
  for (const key of keys) {
    const current = stats[key] ?? 0;
    detail[key] = current;
    if (current >= (minimums[key] ?? 0)) met += 1;
  }
  const qualified = keys.length > 0 && met === keys.length;
  return { qualified, value: qualified ? 1 : 0, met, needed: keys.length, detail };
}

