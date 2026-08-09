import { stageLabel } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

// Backs /viewleague — a single unauthenticated read for the public league snapshot page.
// Deliberately simple: status, this week's matchups, linked teams, and a season standings
// table. No auth/session required (guildId alone), so nothing sensitive (wallets, purchase
// history, chat, admin controls) is exposed here.
export async function getPublicLeagueSnapshot(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? "regular_season");

  const [teamsResult, assignmentsResult, weekGamesResult, seasonGamesResult] = await Promise.all([
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_nick,display_city,is_relocated").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_games").select("id,home_team_id,away_team_id,home_score,away_score,status")
      .eq("league_id", leagueId).eq("season_id", seasonId).eq("week_number", currentWeek),
    supabase.from("rec_games").select("home_team_id,away_team_id,home_score,away_score")
      .eq("league_id", leagueId).eq("season_id", seasonId).eq("status", "completed"),
  ]);
  if (teamsResult.error) throw new ApiError(500, "Failed to load teams.", teamsResult.error);
  if (assignmentsResult.error) throw new ApiError(500, "Failed to load team assignments.", assignmentsResult.error);
  if (weekGamesResult.error) throw new ApiError(500, "Failed to load this week's games.", weekGamesResult.error);
  if (seasonGamesResult.error) throw new ApiError(500, "Failed to load season results.", seasonGamesResult.error);

  const teamById = new Map<string, { id: string; name: string | null; display_city: string | null; display_nick: string | null; is_relocated: boolean | null }>((teamsResult.data ?? []).map((t: any) => [t.id, t]));
  const userIdByTeam = new Map((assignmentsResult.data ?? []).map((a: any) => [a.team_id, a.user_id as string]));
  const userIds = [...new Set([...userIdByTeam.values()])];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,username,global_name").in("user_id", userIds)
    : { data: [] as any[], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load coach identities.", accounts.error);
  const identityByUser = new Map((accounts.data ?? []).map((a: any) => [a.user_id, a.global_name ?? a.username ?? "Coach"]));

  const teamName = (id: string) => formatTeamDisplayName(teamById.get(id)) ?? teamById.get(id)?.name ?? "Unknown";

  const linkedTeams = (teamsResult.data ?? [])
    .map((t: any) => ({ teamId: t.id, teamName: teamName(t.id), coachName: userIdByTeam.has(t.id) ? identityByUser.get(userIdByTeam.get(t.id)!) ?? "Coach" : null }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  const matchups = (weekGamesResult.data ?? []).map((g: any) => ({
    homeTeam: teamName(g.home_team_id),
    awayTeam: teamName(g.away_team_id),
    homeScore: g.status === "completed" ? g.home_score : null,
    awayScore: g.status === "completed" ? g.away_score : null,
    status: g.status,
  }));

  // Season standings: wins/losses/ties derived from every completed game this season.
  const recordByTeam = new Map<string, { wins: number; losses: number; ties: number }>();
  function record(teamId: string) {
    if (!recordByTeam.has(teamId)) recordByTeam.set(teamId, { wins: 0, losses: 0, ties: 0 });
    return recordByTeam.get(teamId)!;
  }
  for (const g of seasonGamesResult.data ?? []) {
    const home = g.home_score ?? 0;
    const away = g.away_score ?? 0;
    if (home === away) { record(g.home_team_id).ties++; record(g.away_team_id).ties++; }
    else if (home > away) { record(g.home_team_id).wins++; record(g.away_team_id).losses++; }
    else { record(g.away_team_id).wins++; record(g.home_team_id).losses++; }
  }
  const standings = (teamsResult.data ?? [])
    .map((t: any) => {
      const r = recordByTeam.get(t.id) ?? { wins: 0, losses: 0, ties: 0 };
      return { teamId: t.id, teamName: teamName(t.id), wins: r.wins, losses: r.losses, ties: r.ties };
    })
    .sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.wins - a.wins);

  return {
    league: {
      name: context.rec_leagues.name ?? "REC League",
      game: context.rec_leagues.game ?? null,
      seasonNumber,
      currentWeek,
      seasonStage,
      statusLabel: stageLabel(seasonStage, currentWeek, context.rec_leagues.game ?? null),
    },
    matchups,
    linkedTeams,
    standings,
  };
}
