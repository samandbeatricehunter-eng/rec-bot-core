import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type StagedGameInput = {
  importJobId: string;
  leagueId: string;
  seasonNumber: number;
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
  rawPayload?: Record<string, unknown>;
};

export type StagedStandingInput = {
  importJobId: string;
  leagueId: string;
  seasonNumber: number;
  seasonStage?: string;
  weekNumber?: number | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  rawPayload?: Record<string, unknown>;
};

export type StagedTeamStatInput = {
  importJobId: string;
  leagueId: string;
  seasonNumber: number;
  seasonStage?: string;
  weekNumber?: number | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  stats?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
};

export type StagedPlayerStatInput = {
  importJobId: string;
  leagueId: string;
  seasonNumber: number;
  seasonStage?: string;
  weekNumber?: number | null;
  playerExternalId?: string | null;
  playerName?: string | null;
  teamExternalId?: string | null;
  teamName?: string | null;
  position?: string | null;
  stats?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
};

export async function stageGames(games: StagedGameInput[]) {
  if (games.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_games")
    .upsert(
      games.map((game) => ({
        import_job_id: game.importJobId,
        league_id: game.leagueId,
        season_number: game.seasonNumber,
        season_stage: game.seasonStage ?? "regular_season",
        week_number: game.weekNumber ?? null,
        external_game_id: game.externalGameId ?? null,
        home_team_external_id: game.homeTeamExternalId ?? null,
        away_team_external_id: game.awayTeamExternalId ?? null,
        home_team_name: game.homeTeamName ?? null,
        away_team_name: game.awayTeamName ?? null,
        home_score: game.homeScore ?? null,
        away_score: game.awayScore ?? null,
        game_status: game.gameStatus ?? "staged",
        played_at: game.playedAt ?? null,
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
      standings.map((standing) => ({
        import_job_id: standing.importJobId,
        league_id: standing.leagueId,
        season_number: standing.seasonNumber,
        season_stage: standing.seasonStage ?? "regular_season",
        week_number: standing.weekNumber ?? null,
        team_external_id: standing.teamExternalId ?? null,
        team_name: standing.teamName ?? null,
        wins: standing.wins ?? 0,
        losses: standing.losses ?? 0,
        ties: standing.ties ?? 0,
        points_for: standing.pointsFor ?? 0,
        points_against: standing.pointsAgainst ?? 0,
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
      teamStats.map((team) => ({
        import_job_id: team.importJobId,
        league_id: team.leagueId,
        season_number: team.seasonNumber,
        season_stage: team.seasonStage ?? "regular_season",
        week_number: team.weekNumber ?? null,
        team_external_id: team.teamExternalId ?? null,
        team_name: team.teamName ?? null,
        stats: team.stats ?? {},
        raw_payload: team.rawPayload ?? {}
      })),
      { onConflict: "import_job_id,team_external_id,week_number" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported team stats.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}

export async function stagePlayerStats(playerStats: StagedPlayerStatInput[]) {
  if (playerStats.length === 0) return { count: 0, rows: [] };

  const result = await supabase
    .from("rec_import_staging_player_stats")
    .upsert(
      playerStats.map((player) => ({
        import_job_id: player.importJobId,
        league_id: player.leagueId,
        season_number: player.seasonNumber,
        season_stage: player.seasonStage ?? "regular_season",
        week_number: player.weekNumber ?? null,
        player_external_id: player.playerExternalId ?? null,
        player_name: player.playerName ?? null,
        team_external_id: player.teamExternalId ?? null,
        team_name: player.teamName ?? null,
        position: player.position ?? null,
        stats: player.stats ?? {},
        raw_payload: player.rawPayload ?? {}
      })),
      { onConflict: "import_job_id,player_external_id,week_number" }
    )
    .select("*");

  if (result.error) {
    throw new ApiError(500, "Failed to stage imported player stats.", result.error);
  }

  return { count: result.data?.length ?? 0, rows: result.data ?? [] };
}
