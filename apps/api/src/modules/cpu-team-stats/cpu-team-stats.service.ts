import { supabase } from "../../lib/supabase.js";
import { aggregateBoxScoreStats } from "../users/user-profile-stats.service.js";

function recordFromStats(
  leagueId: string,
  seasonNumber: number,
  teamId: string,
  rows: any[],
) {
  const stats = aggregateBoxScoreStats(rows);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const row of rows) {
    if (row.result === "win") wins += 1;
    else if (row.result === "loss") losses += 1;
    else if (row.result === "tie") ties += 1;
  }

  return {
    league_id: leagueId,
    season_number: seasonNumber,
    team_id: teamId,
    games_logged: stats.gamesLogged,
    box_scores_logged: stats.boxScoresUploaded,
    wins,
    losses,
    ties,
    total_yards: stats.totalYards,
    passing_yards: stats.passingYards,
    rushing_yards: stats.rushingYards,
    first_downs: stats.firstDowns,
    turnovers_generated: stats.turnoversGenerated,
    turnovers_committed: stats.turnoversCommitted,
    turnover_differential: stats.turnoverDifferential,
    red_zone_off_pct_avg: stats.redZoneOffPctAvg,
    red_zone_def_pct_avg: stats.redZoneDefPctAvg,
    active_streak: stats.activeStreak,
    updated_at: new Date().toISOString(),
  };
}

export async function rebuildCpuTeamSeasonStats(
  leagueId: string,
  seasonNumber: number,
  teamIds?: string[],
) {
  let query = supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .is("user_id", null);

  if (teamIds?.length) {
    query = query.in("team_id", teamIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const byTeam = new Map<string, any[]>();
  for (const row of data ?? []) {
    if (!row.team_id) continue;
    const existing = byTeam.get(row.team_id) ?? [];
    existing.push(row);
    byTeam.set(row.team_id, existing);
  }

  const targets = teamIds?.length ? teamIds : [...byTeam.keys()];
  for (const teamId of targets) {
    const rows = byTeam.get(teamId) ?? [];
    if (!rows.length) {
      await supabase
        .from("rec_cpu_team_season_stats")
        .delete()
        .eq("league_id", leagueId)
        .eq("season_number", seasonNumber)
        .eq("team_id", teamId);
      continue;
    }

    await supabase
      .from("rec_cpu_team_season_stats")
      .upsert(recordFromStats(leagueId, seasonNumber, teamId, rows), {
        onConflict: "league_id,season_number,team_id",
      });
  }
}

export async function syncCpuTeamsAfterBoxScoreApproval(sub: {
  league_id: string;
  season_number: number;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_user_id?: string | null;
  away_user_id?: string | null;
}) {
  const teamIds: string[] = [];
  if (sub.home_team_id && !sub.home_user_id) teamIds.push(sub.home_team_id);
  if (sub.away_team_id && !sub.away_user_id) teamIds.push(sub.away_team_id);
  if (!teamIds.length) return;
  await rebuildCpuTeamSeasonStats(sub.league_id, sub.season_number, teamIds);
}

export async function wipeCpuTeamSeasonStats(leagueId: string, seasonNumber: number) {
  const { error } = await supabase
    .from("rec_cpu_team_season_stats")
    .delete()
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw error;
}
