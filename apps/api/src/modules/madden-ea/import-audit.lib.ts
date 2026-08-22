import { seasonWeekLabel } from "./ea-weeks.js";

export type ImportAuditIssueKind =
  | "missing_score"
  | "missing_result"
  | "missing_team_stats"
  | "missing_player_stats";

export type ImportAuditIssue = {
  kind: ImportAuditIssueKind;
  gameId: string | null;
  label: string;
};

export type ImportAuditWeek = {
  weekNumber: number;
  label: string;
  scheduledGames: number;
  completedGames: number;
  unplayedGames: number;
  issues: ImportAuditIssue[];
};

export type ImportAuditReport = {
  leagueId: string;
  currentWeek: number;
  seasonStage: string;
  weeks: ImportAuditWeek[];
  issueCount: number;
};

export type ImportAuditGame = {
  game_id: string;
  week_number: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  phase: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_team_name: string;
  away_team_name: string;
  has_score: boolean;
  has_result: boolean;
  team_stat_rows: number;
  week_has_player_stats: boolean;
};

function gameHasBothTeams(row: ImportAuditGame) {
  if (row.home_team_id === null || row.away_team_id === null) return false;
  return true;
}

function gameIsCompleted(row: ImportAuditGame) {
  const status = String(row.status ?? "").toLowerCase();
  if (status === "completed" || status === "final") return true;
  return row.has_score && status !== "scheduled";
}

function matchupLabel(row: ImportAuditGame) {
  return `${row.away_team_name} at ${row.home_team_name}`;
}

export function buildImportAuditWeeks(input: {
  currentWeek: number;
  seasonStage: string;
  games: ImportAuditGame[];
}): ImportAuditWeek[] {
  const currentWeek = Math.max(1, input.currentWeek || 1);
  const byWeek = new Map<number, ImportAuditGame[]>();
  for (let week = 1; week <= currentWeek; week += 1) {
    if (week === 22) continue;
    byWeek.set(week, []);
  }
  for (const game of input.games) {
    if (!gameHasBothTeams(game)) continue;
    const list = byWeek.get(game.week_number);
    if (list) list.push(game);
  }

  const weeks: ImportAuditWeek[] = [];
  for (const [weekNumber, games] of byWeek) {
    const completed = games.filter(gameIsCompleted);
    const unplayed = games.filter((game) => !gameIsCompleted(game));
    const issues: ImportAuditIssue[] = [];
    const pastWeek = weekNumber < currentWeek;

    for (const game of games) {
      const label = matchupLabel(game);
      if (!gameIsCompleted(game) && pastWeek) {
        issues.push({ kind: "missing_score", gameId: game.game_id, label: `${label} — no score imported` });
        continue;
      }
      if (!gameIsCompleted(game)) continue;
      if (!game.has_result) {
        issues.push({ kind: "missing_result", gameId: game.game_id, label: `${label} — score present, official result missing` });
      }
      if (game.team_stat_rows < 2) {
        issues.push({
          kind: "missing_team_stats",
          gameId: game.game_id,
          label: `${label} — team stats missing (${game.team_stat_rows}/2 sides)`,
        });
      }
    }

    if (completed.length > 0 && games.some((game) => !game.week_has_player_stats)) {
      issues.push({
        kind: "missing_player_stats",
        gameId: null,
        label: `${completed.length} completed game${completed.length === 1 ? "" : "s"} with no player weekly stats`,
      });
    }

    weeks.push({
      weekNumber,
      label: seasonWeekLabel(weekNumber),
      scheduledGames: games.length,
      completedGames: completed.length,
      unplayedGames: unplayed.length,
      issues,
    });
  }
  return weeks;
}
