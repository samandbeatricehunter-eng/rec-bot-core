import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { TeamGameFact, TeamStanding } from "./nfl-tiebreakers.js";

/** Regular-season-only per-team game log + aggregate W-L-T-PF-PA, joined against the league's
 *  rec_teams conference/division (the authoritative per-league source of truth -- not the
 *  static nfl-teams.ts catalog, since a league can have relocated teams/custom division names).
 *  A single straight read of rec_game_results, independent of power-rankings.service.ts's
 *  aggregateTeams() (that function's Agg shape is power-ranking-specific and would need
 *  stripping down anyway; two small independent reads of the same table beat sharing a
 *  differently-shaped aggregator). */
export async function loadTeamGameLog(
  leagueId: string,
  seasonNumber: number,
): Promise<{ standings: Map<string, TeamStanding>; games: Map<string, TeamGameFact[]> }> {
  const teamsResult = await supabase
    .from("rec_teams")
    .select("id,conference,division")
    .eq("league_id", leagueId);
  if (teamsResult.error) throw new ApiError(500, "Failed to load teams for standings.", teamsResult.error);

  const teamMeta = new Map<string, { conference: string; division: string }>(
    (teamsResult.data ?? []).map((row: any) => [
      String(row.id),
      { conference: String(row.conference ?? ""), division: String(row.division ?? "") },
    ]),
  );

  const gamesResult = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,is_playoff,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false);
  if (gamesResult.error) throw new ApiError(500, "Failed to load results for standings.", gamesResult.error);

  const standings = new Map<string, TeamStanding>();
  const games = new Map<string, TeamGameFact[]>();

  const ensureStanding = (teamId: string): TeamStanding => {
    let s = standings.get(teamId);
    if (!s) {
      const meta = teamMeta.get(teamId) ?? { conference: "", division: "" };
      s = {
        teamId,
        conference: meta.conference,
        division: meta.division,
        wins: 0,
        losses: 0,
        ties: 0,
        pf: 0,
        pa: 0,
        gamesPlayed: 0,
        winPct: 0,
      };
      standings.set(teamId, s);
    }
    return s;
  };

  // Seed every league team, even ones with no games yet, so downstream grouping/seeding never
  // silently drops a winless/schedule-not-started team.
  for (const teamId of teamMeta.keys()) ensureStanding(teamId);

  for (const row of gamesResult.data ?? []) {
    const homeId = row.home_team_id ? String(row.home_team_id) : null;
    const awayId = row.away_team_id ? String(row.away_team_id) : null;
    const homeScore = row.home_score != null ? Number(row.home_score) : null;
    const awayScore = row.away_score != null ? Number(row.away_score) : null;
    const isTie = Boolean(row.is_tie);
    const winningTeamId = row.winning_team_id ? String(row.winning_team_id) : null;
    const weekNumber = row.week_number != null ? Number(row.week_number) : 0;
    if (!homeId || !awayId || homeScore == null || awayScore == null) continue;

    for (const [teamId, opponentId, isHome, pf, pa] of [
      [homeId, awayId, true, homeScore, awayScore],
      [awayId, homeId, false, awayScore, homeScore],
    ] as const) {
      if (!teamMeta.has(teamId)) continue;
      const standing = ensureStanding(teamId);
      const won = !isTie && winningTeamId === teamId;
      if (isTie) standing.ties++;
      else if (won) standing.wins++;
      else standing.losses++;
      standing.pf += pf;
      standing.pa += pa;
      standing.gamesPlayed++;

      const opponentMeta = teamMeta.get(opponentId) ?? { conference: "", division: "" };
      const fact: TeamGameFact = {
        teamId,
        opponentTeamId: opponentId,
        weekNumber,
        isHome,
        pointsFor: pf,
        pointsAgainst: pa,
        isTie,
        won,
        opponentConference: opponentMeta.conference,
        opponentDivision: opponentMeta.division,
      };
      const list = games.get(teamId) ?? [];
      list.push(fact);
      games.set(teamId, list);
    }
  }

  for (const standing of standings.values()) {
    standing.winPct = standing.gamesPlayed > 0 ? (standing.wins + standing.ties * 0.5) / standing.gamesPlayed : 0;
  }

  return { standings, games };
}
