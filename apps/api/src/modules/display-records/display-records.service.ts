import { supabase } from "../../lib/supabase.js";
import { DISPLAY_ADVANCE_SOURCE, OFFICIAL_RESULT_SOURCES } from "../official-records/official-records.service.js";

type GameResultRow = {
  home_user_id?: string | null;
  away_user_id?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  winning_user_id?: string | null;
  week_number?: number | null;
  source?: string | null;
  is_tie?: boolean | null;
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
  row: GameResultRow,
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

function matchupKey(row: GameResultRow) {
  return `${row.week_number ?? 0}:${row.home_team_id ?? ""}:${row.away_team_id ?? ""}`;
}

function isOfficialSource(source?: string | null) {
  return OFFICIAL_RESULT_SOURCES.includes(String(source ?? "") as typeof OFFICIAL_RESULT_SOURCES[number]);
}

/** Display W-L uses commissioner advance when no box score exists; box scores override when present. */
function mergeDisplayResults(rows: GameResultRow[]) {
  const byMatchup = new Map<string, GameResultRow>();

  for (const row of rows) {
    const source = String(row.source ?? "");
    if (source !== DISPLAY_ADVANCE_SOURCE && !isOfficialSource(source)) continue;

    const key = matchupKey(row);
    const existing = byMatchup.get(key);
    if (!existing) {
      byMatchup.set(key, row);
      continue;
    }

    const existingOfficial = isOfficialSource(existing.source);
    const incomingOfficial = isOfficialSource(source);
    if (incomingOfficial && !existingOfficial) byMatchup.set(key, row);
  }

  return [...byMatchup.values()];
}

export async function rebuildSeasonDisplayRecords(leagueId: string, seasonNumber: number) {
  const { data: results, error } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,winning_user_id,is_tie,source,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("source", [...OFFICIAL_RESULT_SOURCES, DISPLAY_ADVANCE_SOURCE]);

  if (error) throw error;

  const displayRows = mergeDisplayResults(results ?? []);
  const aggregate = new Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; teamId: string | null }>();
  for (const row of displayRows) ingestResultRow(aggregate, row);

  const now = new Date().toISOString();
  const rows = [...aggregate.entries()].map(([userId, stats]) => ({
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
    games_played: stats.wins + stats.losses + stats.ties,
    updated_at: now,
  }));

  if (rows.length) {
    const { error: upsertError } = await supabase
      .from("rec_season_user_display_records")
      .upsert(rows, { onConflict: "league_id,season_number,user_id" });
    if (upsertError) throw upsertError;
  }

  return { usersUpdated: aggregate.size };
}
