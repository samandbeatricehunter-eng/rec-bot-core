// @ts-nocheck
import { canonicalConferenceName, isRegularSeasonWeek, regularSeasonGamesPerTeam } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { isSchedulePlaceholderTeam, listScheduleSeason, listScheduleTeams } from "./schedule.service.js";
import { loadResultsAndPendingSubmissions } from "./team-schedule.service.js";
import { computePowerRankings } from "./power-rankings.service.js";
import { getGuildMemberDisplayNameMap } from "../../lib/discord-guild.js";

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
  /** Confirmed H2H regular-season games at or before the league's current week with no result and no pending box-score submission. */
  missingBoxScoreCount: number;
  /** Confirmed H2H regular-season games with a pending box-score submission awaiting review. */
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
  const teamRows = teamsRes.teams.filter((team: any) => !isSchedulePlaceholderTeam(team));

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
  // rec_users.display_name can be a stale placeholder (some accounts were auto-provisioned
  // with their raw Discord ID as the name) — prefer the live Discord nickname/username when
  // available, falling back to the stored value only if the live lookup fails.
  const liveDiscordNames = await getGuildMemberDisplayNameMap(guildId).catch(() => new Map<string, string>());

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
      const isH2hGame = Boolean(g.home_user_id && g.away_user_id);
      if (extra?.result) {
        if (extra.result.isTie) {
          ties++;
        } else {
          const isHome = g.home_team_id === team.id;
          const won = isHome ? extra.result.homeScore > extra.result.awayScore : extra.result.awayScore > extra.result.homeScore;
          if (won) wins++;
          else losses++;
        }
      } else if (isH2hGame && extra?.pendingBoxScoreSubmissionId) {
        awaitingReviewCount++;
      } else if (isH2hGame && g.week_number <= currentWeek) {
        // Only a game whose week has already been reached counts as "missing" — a
        // confirmed-but-future matchup just hasn't been played yet. CPU/filler games
        // can be entered manually, so they don't create missing box-score work.
        missingBoxScoreCount++;
      }
    }

    const assignment = assignmentByTeam.get(team.id);
    const assignmentDiscordId = assignment ? discordByUser.get(assignment.userId) ?? null : null;
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
        ? {
            userId: assignment.userId,
            discordId: assignmentDiscordId,
            displayName: (assignmentDiscordId && liveDiscordNames.get(assignmentDiscordId)) ?? assignment.displayName,
          }
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

export type LinkedRosterEntry = {
  teamId: string;
  teamName: string;
  userDisplayName: string;
  record: { wins: number; losses: number; ties: number };
  /** 1 = best. Null if power rankings haven't been computed for this team yet (e.g. zero games played). */
  powerRank: number | null;
  /** Rank movement since the last snapshot: positive = moved up, negative = moved down, null if there's no prior snapshot yet. */
  rankChange: number | null;
};

// Home page's "who's linked to what team, and how's their season going" panel — public
// roster info, not admin tooling, so this is exposed at member permission (broader than the
// co_commissioner-gated summary it wraps). Trims that summary down instead of duplicating
// its query logic. Ordered by power ranking (computePowerRankings already computes rank +
// week-over-week change — reused as-is, not re-derived).
export async function getLinkedRoster(guildId: string): Promise<{ entries: LinkedRosterEntry[] }> {
  const [summary, rankings] = await Promise.all([
    getTeamManagementSummary(guildId),
    computePowerRankings(guildId).catch(() => null),
  ]);
  const rankByTeam = new Map((rankings?.teams ?? []).map((t: any) => [t.teamId, { rank: t.rank, change: t.change }]));

  const entries: LinkedRosterEntry[] = summary.teams
    .filter((t) => t.linkedUser)
    .map((t) => {
      const ranking = rankByTeam.get(t.id);
      return {
        teamId: t.id,
        teamName: t.name,
        userDisplayName: t.linkedUser!.displayName ?? "Unknown",
        record: t.record,
        powerRank: ranking?.rank ?? null,
        rankChange: ranking?.change ?? null,
      };
    })
    .sort((a, b) => {
      if (a.powerRank == null && b.powerRank == null) return 0;
      if (a.powerRank == null) return 1;
      if (b.powerRank == null) return -1;
      return a.powerRank - b.powerRank;
    });
  return { entries };
}
