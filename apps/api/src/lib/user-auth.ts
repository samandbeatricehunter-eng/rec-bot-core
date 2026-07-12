import type { FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { classifyGuildRoleNames } from "@rec/shared";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";
import { requireInternalApiKey } from "./auth.js";
import { getGuildMemberRoleNames, hasAdministratorOrManageGuild, resolveMemberPermissionBits } from "./discord-guild.js";

// Per-user auth for the Discord Activity (apps/web) — sits beside the existing
// requireInternalApiKey (../lib/auth.ts), which is untouched and still guards every
// bot-to-API call exactly as before.

export type UserSession = { discordId: string; guildId: string };

function getActivityJwtSecret(): Uint8Array {
  if (!env.ACTIVITY_JWT_SECRET) throw new ApiError(500, "Activity auth is not configured (ACTIVITY_JWT_SECRET missing).");
  return new TextEncoder().encode(env.ACTIVITY_JWT_SECRET);
}

export async function requireUserSession(request: FastifyRequest): Promise<UserSession> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) throw new ApiError(401, "Missing or invalid session");
  try {
    const { payload } = await jwtVerify(token, getActivityJwtSecret());
    const discordId = payload.discordId;
    const guildId = payload.guildId;
    if (typeof discordId !== "string" || typeof guildId !== "string") throw new Error("malformed session payload");
    return { discordId, guildId };
  } catch {
    throw new ApiError(401, "Missing or invalid session");
  }
}

export type GuildPermission = "member" | "co_commissioner" | "commissioner";

// Mirrors apps/bot/src/lib/admin.ts's isFullLeagueAdminInteraction/isCoCommissionerInteraction:
// role-name match OR Administrator/ManageGuild permission bits OR guild ownership (folded
// into resolveMemberPermissionBits) counts as commissioner-level; co-commissioner adds the
// co-commissioner role names on top of that same fallback.
export async function assertGuildPermission(guildId: string, discordId: string, required: GuildPermission): Promise<void> {
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
  const header = request.headers["x-rec-api-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (env.REC_INTERNAL_API_KEY && provided === env.REC_INTERNAL_API_KEY) {
    return { mode: "bot" };
  }
  const session = await requireUserSession(request);
  return { mode: "user", ...session };
}

// Combined guard for routes reachable by both the bot and the Activity where the request
// itself claims a guildId (in the body on POST routes, in URL params on some GET routes) —
// that claim must match the session's own guildId, and the permission check (if any) runs
// against it.
export async function requireBotOrUserSession(
  request: FastifyRequest,
  options: { resolveGuildId: (request: FastifyRequest) => string; permission?: GuildPermission },
): Promise<{ mode: "bot" } | ({ mode: "user" } & UserSession)> {
  const auth = await resolveBotOrUserAuth(request);
  if (auth.mode === "bot") return auth;

  const claimedGuildId = options.resolveGuildId(request);
  if (claimedGuildId !== auth.guildId) throw new ApiError(403, "Guild mismatch");
  if (options.permission) await assertGuildPermission(auth.guildId, auth.discordId, options.permission);
  return auth;
}

// Re-exported so route files that need the plain bot-only guard can still get it from one
// place alongside the combined guard, without importing two different lib files.
export { requireInternalApiKey };
