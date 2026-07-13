// @ts-nocheck
import { canonicalConferenceName, isRegularSeasonWeek, regularSeasonGamesPerTeam } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { listScheduleSeason, listScheduleTeams } from "./schedule.service.js";
import { loadResultsAndPendingSubmissions } from "./team-schedule.service.js";

export type TeamManagementSummaryRow = {
  id: string;
  name: string;
  abbreviation: string | null;
  displayCity: string | null;
  displayNick: string | null;
  displayAbbr: string | null;
  conference: string;
  division: string | null;
  isRelocated: boolean;
  linkedUser: { userId: string; discordId: string | null; displayName: string | null } | null;
  scheduleStatus: "empty" | "partial" | "complete";
  gamesScheduled: number;
  gamesExpected: number;
  /** Confirmed regular-season games at or before the league's current week with no result and no pending box-score submission. */
  missingBoxScoreCount: number;
  /** Confirmed regular-season games with a pending box-score submission awaiting review. */
  awaitingReviewCount: number;
  record: { wins: number; losses: number; ties: number };
};

export type TeamManagementSummary = {
  league: { id: string; name: string | null; game: string | null; seasonNumber: number; currentWeek: number; gamesExpectedPerTeam: number };
  teams: TeamManagementSummaryRow[];
};

// Powers the Manage League hub's list view: one call gets every team's ownership,
// schedule-completion, and box-score-health status so the commissioner can see what needs
// attention without opening each team individually. Six queries total regardless of team
// count (teams, assignments, discord accounts, season games, results, pending submissions)
// — no N+1 per-team fan-out.
export async function getTeamManagementSummary(guildId: string, seasonNumber?: number | null): Promise<TeamManagementSummary> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const game = context.rec_leagues.game ?? null;
  const resolvedSeasonNumber = resolveSeasonNumber(context, seasonNumber);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);

  const teamsRes = await listScheduleTeams(guildId);
  const teamRows = teamsRes.teams;

  const assignmentsRes = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id,user:rec_users(id,display_name)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load team assignments.", assignmentsRes.error);
  const assignmentByTeam = new Map(
    (assignmentsRes.data ?? []).map((row: any) => [row.team_id, { userId: row.user_id, displayName: row.user?.display_name ?? null }]),
  );

  const userIds = [...new Set([...assignmentByTeam.values()].map((a) => a.userId).filter(Boolean))];
  const accountsRes = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [], error: null };
  if (accountsRes.error) throw new ApiError(500, "Failed to load Discord accounts.", accountsRes.error);
  const discordByUser = new Map((accountsRes.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  const season = await listScheduleSeason(guildId, resolvedSeasonNumber);
  const regularSeasonGames = season.weeks.flatMap((w: any) => w.games).filter((g: any) => isRegularSeasonWeek(g.week_number, game));

  const gamesByTeam = new Map<string, any[]>();
  for (const g of regularSeasonGames) {
    if (g.home_team_id) {
      if (!gamesByTeam.has(g.home_team_id)) gamesByTeam.set(g.home_team_id, []);
      gamesByTeam.get(g.home_team_id)!.push(g);
    }
    if (g.away_team_id) {
      if (!gamesByTeam.has(g.away_team_id)) gamesByTeam.set(g.away_team_id, []);
      gamesByTeam.get(g.away_team_id)!.push(g);
    }
  }

  const resultsAndSubmissions = await loadResultsAndPendingSubmissions(
    leagueId,
    resolvedSeasonNumber,
    regularSeasonGames.map((g: any) => ({ id: g.id, weekNumber: g.week_number, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id })),
  );
  const gamesExpected = regularSeasonGamesPerTeam(game);

  const teams: TeamManagementSummaryRow[] = teamRows.map((team: any) => {
    const teamGames = gamesByTeam.get(team.id) ?? [];
    const gamesScheduled = teamGames.length;
    const scheduleStatus: "empty" | "partial" | "complete" = gamesScheduled === 0 ? "empty" : gamesScheduled >= gamesExpected ? "complete" : "partial";

    let missingBoxScoreCount = 0;
    let awaitingReviewCount = 0;
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const g of teamGames) {
      const extra = resultsAndSubmissions.get(g.id);
      if (extra?.result) {
        if (extra.result.isTie) {
          ties++;
        } else {
          const isHome = g.home_team_id === team.id;
          const won = isHome ? extra.result.homeScore > extra.result.awayScore : extra.result.awayScore > extra.result.homeScore;
          if (won) wins++;
          else losses++;
        }
      } else if (extra?.pendingBoxScoreSubmissionId) {
        awaitingReviewCount++;
      } else if (g.week_number <= currentWeek) {
        // Only a game whose week has already been reached counts as "missing" — a
        // confirmed-but-future matchup just hasn't been played yet, that's not the same
        // thing as a commissioner forgetting to enter a result.
        missingBoxScoreCount++;
      }
    }

    const assignment = assignmentByTeam.get(team.id);
    return {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation ?? null,
      displayCity: team.display_city ?? null,
      displayNick: team.display_nick ?? null,
      displayAbbr: team.display_abbr ?? null,
      conference: canonicalConferenceName(team.conference, team.division),
      division: team.division ?? null,
      isRelocated: Boolean(team.is_relocated),
      linkedUser: assignment
        ? { userId: assignment.userId, discordId: discordByUser.get(assignment.userId) ?? null, displayName: assignment.displayName }
        : null,
      scheduleStatus,
      gamesScheduled,
      gamesExpected,
      missingBoxScoreCount,
      awaitingReviewCount,
      record: { wins, losses, ties },
    };
  });

  return {
    league: {
      id: leagueId,
      name: context.rec_leagues.name ?? null,
      game,
      seasonNumber: resolvedSeasonNumber,
      currentWeek,
      gamesExpectedPerTeam: gamesExpected,
    },
    teams,
  };
}
