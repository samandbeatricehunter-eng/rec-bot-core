// Shared "career/season stat line" formatter for a single player's totals, keyed by canonical
// stat key (see packages/shared/src/stats/stat-definitions.ts). Reused by both the HOF
// Milestones (career scope) and Pro Tracker (season scope) auto-posts -- same field set and
// formatting for either, just pointed at a different `getLeagueStatsForLeagueId` scope.
import { isImmortalityOffensePosition } from "@rec/shared";

function num(totals: Record<string, unknown>, key: string): number {
  return Number(totals[key] ?? 0) || 0;
}

function fmt(totals: Record<string, unknown>, key: string, digits = 1): string {
  const value = totals[key];
  return value == null ? "—" : Number(value).toFixed(digits).replace(/\.0$/, "");
}

/** QB: attempts, completions, comp%, yards, TDs, INTs, passer rating, then the rushing line. */
function qbStatLines(totals: Record<string, unknown>): string[] {
  return [
    `${num(totals, "pass_completions")}/${num(totals, "pass_attempts")} (${fmt(totals, "completion_pct")}%), ${num(totals, "pass_yards")} YDS, ${num(totals, "pass_tds")} TD, ${num(totals, "interceptions_thrown")} INT`,
    `Passer Rating: ${fmt(totals, "passer_rating")}`,
    `Rushing: ${num(totals, "rush_attempts")} ATT, ${num(totals, "rush_yards")} YDS, ${num(totals, "rush_tds")} TD, ${num(totals, "rushing_fumbles")} FUM`,
  ];
}

/** HB/WR/TE and other offensive skill positions: rushing line, then receiving line. */
function skillStatLines(totals: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const rushAtt = num(totals, "rush_attempts");
  if (rushAtt > 0) lines.push(`Rushing: ${rushAtt} ATT, ${num(totals, "rush_yards")} YDS, ${num(totals, "rush_tds")} TD, ${num(totals, "rushing_fumbles")} FUM`);
  const receptions = num(totals, "receptions");
  if (receptions > 0) lines.push(`Receiving: ${receptions} REC, ${num(totals, "receiving_yards")} YDS, ${num(totals, "receiving_tds")} TD`);
  return lines.length ? lines : ["No offensive production logged."];
}

/** CB/FS/SS/MIKE/other defensive positions. */
function defenseStatLines(totals: Record<string, unknown>): string[] {
  return [
    `${num(totals, "tackles")} TKL, ${num(totals, "tackles_for_loss")} TFL, ${num(totals, "sacks")} SACK`,
    `${num(totals, "interceptions")} INT, ${num(totals, "forced_fumbles")} FF, ${num(totals, "fumble_recoveries")} FR, ${num(totals, "defensive_tds")} DEF TD`,
  ];
}

export function statLinesForPosition(position: string, totals: Record<string, unknown>): string[] {
  const upper = position.toUpperCase();
  if (upper === "QB") return qbStatLines(totals);
  if (isImmortalityOffensePosition(upper)) return skillStatLines(totals);
  return defenseStatLines(totals);
}
