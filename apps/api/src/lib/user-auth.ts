import type { FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { classifyGuildRoleNames } from "@rec/shared";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";
import { hasValidInternalApiKey, requireInternalApiKey } from "./auth.js";
import { getGuildMemberRoleNames, hasAdministratorOrManageGuild, resolveMemberPermissionBits } from "./discord-guild.js";
import { supabase } from "./supabase.js";
import { verifySupabaseAccessToken } from "./supabase-jwt.js";
import {
  getCurrentLeagueContext,
  isSiteOnlyDiscordId,
  isSiteOnlyGuildId,
  recUserIdFromSiteOnlyDiscordId,
  siteOnlyDiscordId,
  SITE_ONLY_PREFIX,
} from "../modules/league-context/league-context.service.js";

export { isSiteOnlyDiscordId, siteOnlyDiscordId };

// Per-browser auth for hub APIs — Discord Activity JWT and/or site Supabase session.
// Bot-to-API calls still use requireInternalApiKey / x-rec-api-key unchanged.

export type UserSession = { discordId: string; guildId: string };

function getActivityJwtSecret(): Uint8Array {
  if (!env.ACTIVITY_JWT_SECRET) throw new ApiError(500, "Activity auth is not configured (ACTIVITY_JWT_SECRET missing).");
  return new TextEncoder().encode(env.ACTIVITY_JWT_SECRET);
}

const supabaseAuth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

function guildIdFromHeader(request: FastifyRequest): string | null {
  const header = request.headers["x-rec-guild-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function tryActivitySession(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, getActivityJwtSecret());
    const discordId = payload.discordId;
    const guildId = payload.guildId;
    if (typeof discordId !== "string" || typeof guildId !== "string") return null;
    return { discordId, guildId };
  } catch {
    return null;
  }
}

async function trySiteDiscordSession(token: string): Promise<{ discordId: string } | null> {
  // Local JWKS verification first (no network call); fall back to the network-verified
  // getUser() only when local verification fails, so a valid session is never rejected.
  const verified = await verifySupabaseAccessToken(token);
  const authUserId = verified?.userId ?? (await supabaseAuth.auth.getUser(token)).data.user?.id ?? null;
  if (!authUserId) return null;

  const user = await supabase
    .from("rec_users")
    .select("id")
    .eq("supabase_auth_user_id", authUserId)
    .maybeSingle();
  if (user.error || !user.data?.id) return null;

  const account = await supabase
    .from("rec_discord_accounts")
    .select("discord_id")
    .eq("user_id", user.data.id)
    .maybeSingle();
  if (account.error) return null;
  // No Discord linked — still a valid site session. Fall back to a stable synthetic discordId
  // so this user resolves through the same discordId-keyed hub plumbing every other session
  // type already uses, instead of failing the whole session.
  return { discordId: account.data?.discord_id ?? siteOnlyDiscordId(user.data.id) };
}

export async function requireUserSession(request: FastifyRequest): Promise<UserSession> {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, "Missing or invalid session");

  const activity = await tryActivitySession(token);
  if (activity) return activity;

  const site = await trySiteDiscordSession(token);
  if (!site) throw new ApiError(401, "Missing or invalid session");

  // Site sessions bind guild via request body (requireBotOrUserSession) or x-rec-guild-id.
  return { discordId: site.discordId, guildId: guildIdFromHeader(request) ?? "" };
}

// WebSocket-flavored variant of requireUserSession — the upgrade handshake has no place for a
// Bearer header (browsers can't set custom headers on the WebSocket constructor), so the token
// travels as a query param instead. Same two verification paths (Activity JWT, site Supabase
// session), just sourced from a raw string instead of a FastifyRequest's headers.
export async function resolveUserSessionFromToken(token: string, guildIdHint: string | null): Promise<UserSession | null> {
  const activity = await tryActivitySession(token);
  if (activity) return activity;

  const site = await trySiteDiscordSession(token);
  if (!site) return null;
  if (!guildIdHint) return null;
  return { discordId: site.discordId, guildId: guildIdHint };
}

export type GuildPermission = "member" | "co_commissioner" | "commissioner";

// A league with no linked Discord server has no guild roles to check — permission comes from
// our own membership/ownership data instead. Mirrors the role semantics already used by
// site-leagues.service.ts's league list (owner or role='commissioner' -> head commissioner,
// role='co_commissioner' -> co, active membership -> member).
async function assertSiteNativePermission(leagueId: string, discordId: string, required: GuildPermission): Promise<void> {
  const userId = isSiteOnlyDiscordId(discordId)
    ? recUserIdFromSiteOnlyDiscordId(discordId)
    : (await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle()).data?.user_id ?? null;
  if (!userId) throw new ApiError(403, "Not a member of this league");

  const league = await supabase.from("rec_leagues").select("owner_user_id").eq("id", leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
  const isOwner = league.data?.owner_user_id === userId;

  const membership = await supabase
    .from("rec_league_memberships")
    .select("role,status")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const role = membership.data?.role ?? null;
  const isCommissioner = isOwner || role === "commissioner";
  const isCoCommissioner = role === "co_commissioner";

  if (required === "member") {
    if (!isOwner && !membership.data) throw new ApiError(403, "Not a member of this league");
    return;
  }
  if (required === "commissioner") {
    if (!isCommissioner) throw new ApiError(403, "Insufficient permission");
    return;
  }
  if (!isCommissioner && !isCoCommissioner) throw new ApiError(403, "Insufficient permission");
}

// Mirrors apps/bot/src/lib/admin.ts's isFullLeagueAdminInteraction/isCoCommissionerInteraction:
// role-name match OR Administrator/ManageGuild permission bits OR guild ownership (folded
// into resolveMemberPermissionBits) counts as commissioner-level; co-commissioner adds the
// co-commissioner role names on top of that same fallback.
export async function assertGuildPermission(guildId: string, discordId: string, required: GuildPermission): Promise<void> {
  if (isSiteOnlyGuildId(guildId)) {
    return assertSiteNativePermission(guildId.slice(SITE_ONLY_PREFIX.length), discordId, required);
  }

  const roleNames = await getGuildMemberRoleNames(guildId, discordId);
  if (roleNames === null) throw new ApiError(403, "Not a member of this guild");
  if (required === "member") return;

  const { isCommissioner, isCoCommissioner } = classifyGuildRoleNames(roleNames);
  const permissionBits = await resolveMemberPermissionBits(guildId, discordId);
  const isFullAdmin = isCommissioner || hasAdministratorOrManageGuild(permissionBits);
  if (required === "commissioner") {
    if (!isFullAdmin) throw new ApiError(403, "Insufficient permission");
    return;
  }
  // co_commissioner: full admins already qualify, or a dedicated co-commissioner role.
  if (!isFullAdmin && !isCoCommissioner) throw new ApiError(403, "Insufficient permission");
}

// Lowest-level branch: is this the bot (server-to-server, unchanged trust model) or a
// user session? No guildId matching or permission check — for routes whose body/params
// have no natural guildId to compare against (e.g. keyed by a submissionId instead), which
// must do their own scoping check after fetching the record. Routes that DO have a
// guildId should use requireBotOrUserSession below instead.
export async function resolveBotOrUserAuth(request: FastifyRequest): Promise<{ mode: "bot" } | ({ mode: "user" } & UserSession)> {
  if (hasValidInternalApiKey(request)) {
    return { mode: "bot" };
  }
  const session = await requireUserSession(request);
  return { mode: "user", ...session };
}

// Combined guard for routes reachable by both the bot and the browser hub where the request
// itself claims a guildId (in the body on POST routes, in URL params on some GET routes) —
// that claim must match the session's own guildId (Activity JWT), or for site sessions the
// claim is adopted after verifying Discord guild membership.
export async function requireBotOrUserSession(
  request: FastifyRequest,
  options: { resolveGuildId: (request: FastifyRequest) => string; permission?: GuildPermission },
): Promise<{ mode: "bot" } | ({ mode: "user" } & UserSession)> {
  const auth = await resolveBotOrUserAuth(request);
  if (auth.mode === "bot") return auth;

  const claimedGuildId = options.resolveGuildId(request);

  if (auth.guildId) {
    if (claimedGuildId !== auth.guildId) throw new ApiError(403, "Guild mismatch");
    if (options.permission) await assertGuildPermission(auth.guildId, auth.discordId, options.permission);
    return auth;
  }

  // Site Supabase session: bind to the request's guildId after membership check.
  const permission = options.permission ?? "member";
  await assertGuildPermission(claimedGuildId, auth.discordId, permission);
  return { mode: "user", discordId: auth.discordId, guildId: claimedGuildId };
}

/** Resolve the canonical REC league for an authenticated browser session. */
export async function resolveCanonicalLeagueId(
  auth: { mode: "bot" } | ({ mode: "user" } & UserSession),
): Promise<string | null> {
  if (auth.mode === "bot") return null;
  const context = await getCurrentLeagueContext(auth.guildId);
  return context.leagueId;
}

// Re-exported so route files that need the plain bot-only guard can still get it from one
// place alongside the combined guard, without importing two different lib files.
export { requireInternalApiKey };
