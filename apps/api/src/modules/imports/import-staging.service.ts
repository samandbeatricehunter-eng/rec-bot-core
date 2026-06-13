import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

type JsonObject = Record<string, unknown>;

export type StagedTeamInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  cityName?: string | null;
  nickName?: string | null;
  abbrName?: string | null;
  conference?: string | null;
  divisionName?: string | null;
  userName?: string | null;
  isHuman?: boolean;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

export type StagedRosterInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  playerExternalId?: string | null;
  playerName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
  jerseyNumber?: number | null;
  overallRating?: number | null;
  age?: number | null;
  devTrait?: string | null;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

export type StagedGameInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  seasonStage?: string;
  weekNumber?: number | null;
  externalGameId?: string | null;
  homeTeamExternalId?: string | null;
  awayTeamExternalId?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  gameStatus?: string;
  playedAt?: string | null;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

export type StagedStandingInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  seasonStage?: string;
  weekNumber?: number | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

export type StagedTeamStatInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  seasonStage?: string;
  weekNumber?: number | null;
  statCategory?: string | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  stats?: JsonObject;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

export type StagedPlayerStatInput = {
  importJobId: string;
  leagueId: string;
  eaLeagueId?: number | null;
  seasonNumber: number;
  seasonIndex?: number | null;
  seasonStage?: string;
  weekNumber?: number | null;
  statCategory?: string | null;
  sourceStatId?: string | null;
  sourceScheduleId?: string | null;
  playerExternalId?: string | null;
  playerName?: string | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  position?: string | null;
  stats?: JsonObject;
  normalized?: JsonObject;
  rawPayload?: JsonObject;
};

function nowIso() {
  return new Date().toISOString();
}

function ensureRequiredExternalId(value: string | null | undefined, fallback: string) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized.length > 0 ? normalized : fallback;
}

function dedupeBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(keyFn(row), row);
  return [...map.values()];
}

function chunks<T>(rows: T[], size: number) {
  const output: T[][] = [];
  for (let i = 0; i < rows.length; i += size) output.push(rows.slice(i, i + size));
  return output;
}

export async function stageTeams(teams: StagedTeamInput[]) {
  if (teams.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_teams")
    .upsert(
      teams.map((team, index) => ({
        import_job_id: team.importJobId,
        league_id: team.leagueId,
        ea_league_id: team.eaLeagueId ?? null,
        season_number: team.seasonNumber,
        season_index: team.seasonIndex ?? null,
        team_external_id: ensureRequiredExternalId(team.teamExternalId, `unknown-team-${index}`),
        team_name: team.teamName ?? null,
        city_name: team.cityName ?? null,
        nick_name: team.nickName ?? null,
        abbr_name: team.abbrName ?? null,
        conference: team.conference ?? null,
        division_name: team.divisionName ?? null,
        user_name: team.userName ?? null,
        is_human: team.isHuman ?? false,
        normalized: team.normalized ?? {},
        raw_payload: team.rawPayload ?? {},
        updated_at: nowIso()
      })),
      { onConflict: "import_job_id,team_external_id" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported teams.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stageRosters(rosters: StagedRosterInput[]) {
  if (rosters.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_rosters")
    .upsert(
      rosters.map((player, index) => ({
        import_job_id: player.importJobId,
        league_id: player.leagueId,
        ea_league_id: player.eaLeagueId ?? null,
        season_number: player.seasonNumber,
        season_index: player.seasonIndex ?? null,
        team_external_id: player.teamExternalId ?? null,
        team_name: player.teamName ?? null,
        player_external_id: ensureRequiredExternalId(player.playerExternalId, `unknown-player-${index}`),
        player_name: player.playerName ?? null,
        first_name: player.firstName ?? null,
        last_name: player.lastName ?? null,
        position: player.position ?? null,
        jersey_number: player.jerseyNumber ?? null,
        overall_rating: player.overallRating ?? null,
        age: player.age ?? null,
        dev_trait: player.devTrait ?? null,
        normalized: player.normalized ?? {},
        raw_payload: player.rawPayload ?? {},
        updated_at: nowIso()
      })),
      { onConflict: "import_job_id,player_external_id" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported rosters.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stageGames(games: StagedGameInput[]) {
  if (games.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_games")
    .upsert(
      games.map((game, index) => ({
        import_job_id: game.importJobId,
        league_id: game.leagueId,
        ea_league_id: game.eaLeagueId ?? null,
        season_number: game.seasonNumber,
        season_index: game.seasonIndex ?? null,
        season_stage: game.seasonStage ?? "regular_season",
        week_number: game.weekNumber ?? null,
        external_game_id: ensureRequiredExternalId(game.externalGameId, `unknown-game-${game.weekNumber ?? "na"}-${index}`),
        home_team_external_id: game.homeTeamExternalId ?? null,
        away_team_external_id: game.awayTeamExternalId ?? null,
        home_team_name: game.homeTeamName ?? null,
        away_team_name: game.awayTeamName ?? null,
        home_score: game.homeScore ?? null,
        away_score: game.awayScore ?? null,
        game_status: game.gameStatus ?? "staged",
        played_at: game.playedAt ?? null,
        normalized: game.normalized ?? {},
        raw_payload: game.rawPayload ?? {}
      })),
      { onConflict: "import_job_id,external_game_id" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported games.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stageStandings(standings: StagedStandingInput[]) {
  if (standings.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_standings")
    .upsert(
      standings.map((standing, index) => ({
        import_job_id: standing.importJobId,
        league_id: standing.leagueId,
        ea_league_id: standing.eaLeagueId ?? null,
        season_number: standing.seasonNumber,
        season_index: standing.seasonIndex ?? null,
        season_stage: standing.seasonStage ?? "regular_season",
        week_number: standing.weekNumber ?? null,
        team_external_id: ensureRequiredExternalId(standing.teamExternalId, `unknown-standing-team-${index}`),
        team_name: standing.teamName ?? null,
        wins: standing.wins ?? 0,
        losses: standing.losses ?? 0,
        ties: standing.ties ?? 0,
        points_for: standing.pointsFor ?? 0,
        points_against: standing.pointsAgainst ?? 0,
        normalized: standing.normalized ?? {},
        raw_payload: standing.rawPayload ?? {}
      })),
      { onConflict: "import_job_id,team_external_id" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported standings.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stageTeamStats(teamStats: StagedTeamStatInput[]) {
  if (teamStats.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_team_stats")
    .upsert(
      teamStats.map((team, index) => ({
        import_job_id: team.importJobId,
        league_id: team.leagueId,
        ea_league_id: team.eaLeagueId ?? null,
        season_number: team.seasonNumber,
        season_index: team.seasonIndex ?? null,
        season_stage: team.seasonStage ?? "regular_season",
        week_number: team.weekNumber ?? null,
        stat_category: team.statCategory ?? "team",
        team_external_id: ensureRequiredExternalId(team.teamExternalId, `unknown-team-stat-${team.weekNumber ?? "na"}-${index}`),
        team_name: team.teamName ?? null,
        stats: team.stats ?? {},
        normalized: team.normalized ?? {},
        raw_payload: team.rawPayload ?? {}
      })),
      { onConflict: "import_job_id,team_external_id,week_number,stat_category" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported team stats.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stagePlayerStats(playerStats: StagedPlayerStatInput[]) {
  if (playerStats.length === 0) return { count: 0, rows: [] };

  const mapped = playerStats.map((player, index) => {
    const playerExternalId = ensureRequiredExternalId(player.playerExternalId, `unknown-player-stat-${player.weekNumber ?? "na"}-${index}`);
    const statCategory = player.statCategory ?? "unknown";
    const sourceStatId = player.sourceStatId ?? `week:${player.weekNumber ?? "na"}:cat:${statCategory}:player:${playerExternalId}`;
    const sourceScheduleId = player.sourceScheduleId ?? `week:${player.weekNumber ?? "na"}`;
    return {
      import_job_id: player.importJobId,
      league_id: player.leagueId,
      ea_league_id: player.eaLeagueId ?? null,
      season_number: player.seasonNumber,
      season_index: player.seasonIndex ?? null,
      season_stage: player.seasonStage ?? "regular_season",
      week_number: player.weekNumber ?? null,
      stat_category: statCategory,
      source_stat_id: sourceStatId,
      source_schedule_id: sourceScheduleId,
      player_external_id: playerExternalId,
      player_name: player.playerName ?? null,
      team_external_id: player.teamExternalId ?? null,
      team_name: player.teamName ?? null,
      position: player.position ?? null,
      stats: player.stats ?? {},
      normalized: player.normalized ?? {},
      raw_payload: player.rawPayload ?? {}
    };
  });
  const deduped = dedupeBy(mapped, (row) => [
    row.import_job_id,
    row.player_external_id,
    row.week_number ?? "",
    row.stat_category,
    row.source_stat_id,
    row.source_schedule_id
  ].join("|"));

  const rows: any[] = [];
  for (const chunk of chunks(deduped, 500)) {
    const result = await supabase
      .from("rec_import_staging_player_stats")
      .upsert(chunk, { onConflict: "import_job_id,player_external_id,week_number,stat_category,source_stat_id,source_schedule_id" })
      .select("*");

    if (result.error) {
      throw new ApiError(500, "Failed to stage imported player stats.", {
        ...result.error,
        attemptedRows: mapped.length,
        dedupedRows: deduped.length,
        chunkRows: chunk.length
      });
    }
    rows.push(...(result.data ?? []));
  }

  return { count: rows.length, rows };
}
