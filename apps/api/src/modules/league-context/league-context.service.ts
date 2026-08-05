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
  // null for a standalone league with no linked Discord server (see isSiteOnlyGuildId) — several
  // tables' server_id columns are nullable uuid FKs for exactly this case, so this must stay a
  // real uuid-or-null, never a synthetic "site:" string (which isn't valid uuid input).
  serverId: string | null;
  leagueId: string;
  server: RecDiscordServer | null;
  league: RecLeague;
  link: RecServerLeagueLink | null;
  routes: Record<string, unknown> | null;
  rec_discord_servers: any;
  rec_leagues: any;
};

// Prefix marking a synthetic identity for a league/user with no real Discord counterpart —
// Discord is an optional add-on, not the identity backbone, so the hub must resolve a league
// (and a user, see user-auth.ts) purely from site data when neither is Discord-linked. Mirrors
// the same "site:" convention already used in site-leagues.service.ts's requestSiteLeagueTeam.
export const SITE_ONLY_PREFIX = "site:";

export function isSiteOnlyGuildId(guildId: string): boolean {
  return guildId.startsWith(SITE_ONLY_PREFIX);
}

export function siteOnlyGuildId(leagueId: string): string {
  return `${SITE_ONLY_PREFIX}${leagueId}`;
}

// Same convention for the per-user side (see lib/user-auth.ts) — lives here rather than there
// to keep this the single source of truth for the "site:" prefix and avoid a circular import
// between league-context.service.ts and user-auth.ts.
export function isSiteOnlyDiscordId(discordId: string): boolean {
  return discordId.startsWith(SITE_ONLY_PREFIX);
}

export function siteOnlyDiscordId(recUserId: string): string {
  return `${SITE_ONLY_PREFIX}${recUserId}`;
}

export function recUserIdFromSiteOnlyDiscordId(discordId: string): string {
  return discordId.slice(SITE_ONLY_PREFIX.length);
}

async function findStandaloneLeagueContext(guildId: string): Promise<CurrentLeagueContext | null> {
  const leagueId = guildId.slice(SITE_ONLY_PREFIX.length);
  const db = getDrizzleDb();
  const league = await db.query.recLeagues.findFirst({ where: eq(recLeagues.id, leagueId) });
  if (!league?.id) return null;

  // No real server/link row — null all the way through (see the CurrentLeagueContext comment).
  // Every Discord-specific feature (bot messages, channel routes) already gates on routes being
  // configured, and routes stays null here exactly like an unconfigured real server, so those
  // features no-op the same way for a standalone site-only league.
  return {
    serverId: null,
    leagueId: league.id,
    server: null,
    league,
    link: null,
    routes: null,
    rec_discord_servers: null,
    rec_leagues: toSnakeRow(league),
  };
}

export async function findCurrentLeagueContext(guildId: string): Promise<CurrentLeagueContext | null> {
  if (isSiteOnlyGuildId(guildId)) return findStandaloneLeagueContext(guildId);

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

// Reverse of findCurrentLeagueContext — callers that only have a leagueId (e.g. the
// box-score-intelligence pipeline, which runs off a submission row, not a Discord
// interaction) use this to find the guild + configured channel routes for posting back
// to Discord. Returns null for a league with no primary server link (a standalone,
// non-Discord-linked league).
export async function findServerRoutesForLeague(leagueId: string): Promise<{ guildId: string; routes: Record<string, unknown> | null } | null> {
  const db = getDrizzleDb();
  const link = await db.query.recServerLeagueLinks.findFirst({
    where: (table, { and, eq }) => and(eq(table.leagueId, leagueId), eq(table.isPrimary, true)),
  });
  if (!link?.serverId) return null;

  const [server, routes] = await Promise.all([
    db.query.recDiscordServers.findFirst({ where: eq(recDiscordServers.id, link.serverId) }),
    db.query.recServerRoutes.findFirst({ where: eq(recServerRoutes.serverId, link.serverId) }),
  ]);
  if (!server?.guildId) return null;

  return { guildId: server.guildId, routes: routes ? toSnakeRow(routes) : null };
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

  // A synthetic guildId has no real Discord guild to ask — "owner" here means the league's
  // owner_user_id instead (site-native equivalent of Discord server ownership).
  const ownerCheck = isSiteOnlyGuildId(guildId)
    ? Promise.resolve(context.rec_leagues.owner_user_id === (isSiteOnlyDiscordId(discordId) ? recUserIdFromSiteOnlyDiscordId(discordId) : null))
    : isGuildOwner(guildId, discordId);

  const [totalRes, linkedRes, isOwner] = await Promise.all([
    supabase.from("rec_teams").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
    supabase
      .from("rec_team_assignments")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
    ownerCheck,
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
