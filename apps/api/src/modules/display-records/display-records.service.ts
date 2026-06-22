import { supabase } from "../../lib/supabase.js";

type GameResultRow = {
  home_user_id?: string | null;
  away_user_id?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  winning_user_id?: string | null;
};

function applyResult(
  aggregate: Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; teamId: string | null }>,
  userId: string,
  teamId: string | null,
  pointsFor: number,
  pointsAgainst: number,
  outcome: "win" | "loss" | "tie",
) {
  const current = aggregate.get(userId) ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, teamId };
  if (outcome === "win") current.wins += 1;
  else if (outcome === "loss") current.losses += 1;
  else current.ties += 1;
  current.pointsFor += pointsFor;
  current.pointsAgainst += pointsAgainst;
  if (teamId) current.teamId = teamId;
  aggregate.set(userId, current);
}

function ingestResultRow(
  aggregate: Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; teamId: string | null }>,
  row: GameResultRow & { is_tie?: boolean | null },
) {
  const homeScore = Number(row.home_score ?? 0);
  const awayScore = Number(row.away_score ?? 0);
  if (!row.home_user_id && !row.away_user_id) return;

  const isTie = row.is_tie === true || homeScore === awayScore;

  if (row.home_user_id) {
    const outcome = isTie ? "tie" : homeScore > awayScore ? "win" : "loss";
    applyResult(aggregate, row.home_user_id, row.home_team_id ?? null, homeScore, awayScore, outcome);
  }
  if (row.away_user_id) {
    const outcome = isTie ? "tie" : awayScore > homeScore ? "win" : "loss";
    applyResult(aggregate, row.away_user_id, row.away_team_id ?? null, awayScore, homeScore, outcome);
  }
}

export async function rebuildSeasonDisplayRecords(leagueId: string, seasonNumber: number) {
  const { data: results, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,winning_user_id,is_tie,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("source", ["box_score", "box_score_screenshot", "commissioner_advance"]);

  if (error) throw error;

  const aggregate = new Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; teamId: string | null }>();
  for (const row of results ?? []) ingestResultRow(aggregate, row);

  const now = new Date().toISOString();
  for (const [userId, stats] of aggregate.entries()) {
    const gamesPlayed = stats.wins + stats.losses + stats.ties;
    await supabase.from("rec_season_user_display_records").upsert(
      {
        league_id: leagueId,
        season_number: seasonNumber,
        user_id: userId,
        team_id: stats.teamId,
        wins: stats.wins,
        losses: stats.losses,
        ties: stats.ties,
        points_for: stats.pointsFor,
        points_against: stats.pointsAgainst,
        point_differential: stats.pointsFor - stats.pointsAgainst,
        games_played: gamesPlayed,
        updated_at: now,
      },
      { onConflict: "league_id,season_number,user_id" },
    );
  }

  return { usersUpdated: aggregate.size };
}
