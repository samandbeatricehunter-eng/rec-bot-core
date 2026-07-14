import { eq } from "drizzle-orm";
import { stageLabel } from "@rec/shared";
import { getDrizzleDb } from "../../db/client.js";
import { recDiscordServers, recLeagues, recServerLeagueLinks, recServerRoutes } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { toSnakeRow } from "../../lib/case.js";
import { supabase } from "../../lib/supabase.js";
import { isGuildOwner } from "../../lib/discord-guild.js";
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

export async function findCurrentLeagueContext(guildId: string): Promise<CurrentLeagueContext | null> {
  const db = getDrizzleDb();
  const server = await db.query.recDiscordServers.findFirst({
    where: eq(recDiscordServers.guildId, guildId)
  });
  if (!server?.id) return null;

  const link = await db.query.recServerLeagueLinks.findFirst({
    where: (table, { and, eq }) => and(eq(table.serverId, server.id), eq(table.isPrimary, true))
  });
  if (!link?.leagueId) return null;

  const [league, routes] = await Promise.all([
    db.query.recLeagues.findFirst({ where: eq(recLeagues.id, link.leagueId) }),
    db.query.recServerRoutes.findFirst({ where: eq(recServerRoutes.serverId, server.id) })
  ]);
  if (!league?.id) return null;

  return {
    serverId: server.id,
    leagueId: league.id,
    server,
    league,
    link,
    routes: routes ? toSnakeRow(routes) : null,
    rec_discord_servers: toSnakeRow(server),
    rec_leagues: toSnakeRow(league)
  };
}

export async function getCurrentLeagueContext(guildId: string): Promise<CurrentLeagueContext> {
  const context = await findCurrentLeagueContext(guildId);
  if (!context) throw new ApiError(404, "No current REC league is linked to this Discord server.");
  return context;
}

// A REC league can never have more than 32 real coaches, regardless of the game's team
// catalog size — Madden's is naturally capped at 32 (one per NFL team), and CFB leagues
// carry that same policy even though the CFB catalog itself has 136 teams (mostly
// CPU-controlled). The header shows "linked / 32", not "linked / catalog size".
const MAX_LINKED_USERS = 32;

export type LeagueHeaderSummary = {
  league: { name: string; game: string; leaguePassword: string | null; seasonNumber: number; currentWeek: number | null; weekLabel: string };
  teams: { linked: number; cap: number; availableTeams: number };
  isGuildOwner: boolean;
};

// Powers the web dashboard's header bar — deliberately lightweight (three cheap counts, no
// per-team rows) since it runs on every page load for every member, unlike the heavier,
// commissioner-gated team-management-summary used by the Manage League hub itself.
export async function getLeagueHeaderSummary(guildId: string, discordId: string): Promise<LeagueHeaderSummary> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;

  const [totalRes, linkedRes, isOwner] = await Promise.all([
    supabase.from("rec_teams").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
    supabase
      .from("rec_team_assignments")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
    isGuildOwner(guildId, discordId),
  ]);
  if (totalRes.error) throw new ApiError(500, "Failed to count league teams.", totalRes.error);
  if (linkedRes.error) throw new ApiError(500, "Failed to count linked teams.", linkedRes.error);

  const currentWeek = context.rec_leagues.current_week != null ? Number(context.rec_leagues.current_week) : null;
  const seasonStage = String(context.rec_leagues.season_stage ?? "preseason");
  return {
    league: {
      name: context.rec_leagues.name ?? "",
      game: String(context.rec_leagues.game ?? "cfb_27"),
      leaguePassword: context.rec_leagues.league_password ?? null,
      seasonNumber: Number(context.rec_leagues.season_number ?? 1),
      currentWeek,
      // "Week N" only makes sense once games are actually being played — preseason/draft/
      // free agency/etc. show their own stage name instead (stageLabel already knows this).
      weekLabel: stageLabel(seasonStage, currentWeek ?? 1, context.rec_leagues.game ?? null),
    },
    teams: {
      linked: linkedRes.count ?? 0,
      cap: MAX_LINKED_USERS,
      availableTeams: Math.max(0, (totalRes.count ?? 0) - (linkedRes.count ?? 0)),
    },
    isGuildOwner: isOwner,
  };
}
