import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { RecDiscordServer, RecLeague, RecServerLeagueLink } from "../../db/schema.js";

export type CurrentLeagueContext = {
  serverId: string;
  leagueId: string;
  server: RecDiscordServer;
  league: RecLeague;
  link: RecServerLeagueLink;
  routes: Record<string, unknown> | null;
  rec_discord_servers: any;
  rec_leagues: any;
};

function toServer(row: any): RecDiscordServer {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    setupStatus: row.setup_status,
    setupMode: row.setup_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toLeague(row: any): RecLeague {
  return {
    id: row.id,
    name: row.name,
    leagueType: row.league_type,
    displaySeasonNumber: row.display_season_number,
    currentPhase: row.current_phase,
    currentWeek: row.current_week,
    fantasyDraftStatus: row.fantasy_draft_status,
    trustMode: row.trust_mode,
    appAccountRequired: row.app_account_required,
    seasonNumber: row.season_number,
    seasonStage: row.season_stage,
    nextAdvanceAt: row.next_advance_at,
    nextAdvanceTimezone: row.next_advance_timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toLink(row: any): RecServerLeagueLink {
  return {
    id: row.id,
    serverId: row.server_id,
    leagueId: row.league_id,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function findCurrentLeagueContext(guildId: string): Promise<CurrentLeagueContext | null> {
  const serverResult = await supabase
    .from("rec_discord_servers")
    .select("id,guild_id,name,setup_status,setup_mode,created_at,updated_at")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (serverResult.error) throw new ApiError(500, "Failed to load Discord server context.", serverResult.error);
  if (!serverResult.data?.id) return null;

  const linkResult = await supabase
    .from("rec_server_league_links")
    .select("*")
    .eq("server_id", serverResult.data.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (linkResult.error) throw new ApiError(500, "Failed to load primary league link.", linkResult.error);
  if (!linkResult.data?.league_id) return null;

  const [leagueResult, routesResult] = await Promise.all([
    supabase.from("rec_leagues").select("*").eq("id", linkResult.data.league_id).maybeSingle(),
    supabase.from("rec_server_routes").select("*").eq("server_id", serverResult.data.id).maybeSingle()
  ]);

  if (leagueResult.error) throw new ApiError(500, "Failed to load current REC league.", leagueResult.error);
  if (!leagueResult.data?.id) return null;
  if (routesResult.error) throw new ApiError(500, "Failed to load server route configuration.", routesResult.error);

  const server = toServer(serverResult.data);
  const league = toLeague(leagueResult.data);
  const link = toLink(linkResult.data);

  return {
    serverId: server.id,
    leagueId: league.id,
    server,
    league,
    link,
    routes: routesResult.data ?? null,
    rec_discord_servers: serverResult.data,
    rec_leagues: leagueResult.data
  };
}

export async function getCurrentLeagueContext(guildId: string): Promise<CurrentLeagueContext> {
  const context = await findCurrentLeagueContext(guildId);
  if (!context) throw new ApiError(404, "No current REC league is linked to this Discord server.");
  return context;
}
