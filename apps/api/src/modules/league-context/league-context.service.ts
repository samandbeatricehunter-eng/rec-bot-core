import { eq } from "drizzle-orm";
import { getDrizzleDb } from "../../db/client.js";
import { recDiscordServers, recLeagues, recServerLeagueLinks, recServerRoutes } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { toSnakeRow } from "../../lib/case.js";
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
