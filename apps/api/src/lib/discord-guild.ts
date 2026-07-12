import { env } from "../config/env.js";

// Server-side guild role/permission lookups for the Discord Activity's per-user auth —
// the bot has a cached discord.js GuildMember for free on every interaction; a browser
// session has neither, so this hits Discord's REST API directly with the bot's own token.
// Scoped narrowly to what assertGuildPermission (../lib/user-auth.ts) needs, not a
// general-purpose Discord API client.

const DISCORD_API_BASE = "https://discord.com/api/v10";

// Discord permission bit flags (see Discord's Permissions documentation) — hardcoded here
// rather than pulling discord.js into apps/api just for two constants. Permissions exceed
// 32 bits, hence bigint.
const PERMISSION_ADMINISTRATOR = 1n << 3n;
const PERMISSION_MANAGE_GUILD = 1n << 5n;

type CacheEntry<T> = { value: T; expiresAt: number };
const CACHE_TTL_MS = 60_000;
const roleListCache = new Map<string, CacheEntry<Map<string, { name: string; permissions: bigint }>>>();
const guildOwnerCache = new Map<string, CacheEntry<string>>();
const memberRoleIdsCache = new Map<string, CacheEntry<string[] | null>>();

function fromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function toCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function discordBotFetch(path: string): Promise<Response> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured — required for Activity guild role lookups.");
  return fetch(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
}

async function getGuildRoles(guildId: string): Promise<Map<string, { name: string; permissions: bigint }>> {
  const cached = fromCache(roleListCache, guildId);
  if (cached) return cached;
  const res = await discordBotFetch(`/guilds/${guildId}/roles`);
  if (!res.ok) throw new Error(`Failed to fetch guild roles (${res.status})`);
  const roles = (await res.json()) as Array<{ id: string; name: string; permissions: string }>;
  const map = new Map(roles.map((r) => [r.id, { name: r.name, permissions: BigInt(r.permissions) }]));
  toCache(roleListCache, guildId, map);
  return map;
}

async function getGuildOwnerId(guildId: string): Promise<string> {
  const cached = fromCache(guildOwnerCache, guildId);
  if (cached) return cached;
  const res = await discordBotFetch(`/guilds/${guildId}`);
  if (!res.ok) throw new Error(`Failed to fetch guild (${res.status})`);
  const guild = (await res.json()) as { owner_id: string };
  toCache(guildOwnerCache, guildId, guild.owner_id);
  return guild.owner_id;
}

// Returns the member's role IDs, or null if the Discord user isn't a member of this guild.
async function getMemberRoleIds(guildId: string, discordId: string): Promise<string[] | null> {
  const cacheKey = `${guildId}:${discordId}`;
  const cached = fromCache(memberRoleIdsCache, cacheKey);
  if (cached !== undefined) return cached;
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}`);
  if (res.status === 404) {
    toCache(memberRoleIdsCache, cacheKey, null);
    return null;
  }
  if (!res.ok) throw new Error(`Failed to fetch guild member (${res.status})`);
  const member = (await res.json()) as { roles: string[] };
  toCache(memberRoleIdsCache, cacheKey, member.roles);
  return member.roles;
}

// Role names for classifyGuildRoleNames (@rec/shared) — the same name-matching the bot
// uses against a cached GuildMember. Returns null if the user isn't a guild member.
export async function getGuildMemberRoleNames(guildId: string, discordId: string): Promise<string[] | null> {
  const [roleIds, roles] = await Promise.all([getMemberRoleIds(guildId, discordId), getGuildRoles(guildId)]);
  if (roleIds === null) return null;
  return roleIds.map((id) => roles.get(id)?.name).filter((name): name is string => Boolean(name));
}

// Mirrors the bot's isFullLeagueAdminInteraction fallback: Administrator/ManageGuild
// permission bits (via any held role, OR'd together) or being the guild owner, in
// addition to role-name matching (handled separately via classifyGuildRoleNames).
// Returns 0n if the user isn't a guild member.
export async function resolveMemberPermissionBits(guildId: string, discordId: string): Promise<bigint> {
  const [roleIds, roles, ownerId] = await Promise.all([
    getMemberRoleIds(guildId, discordId),
    getGuildRoles(guildId),
    getGuildOwnerId(guildId),
  ]);
  if (roleIds === null) return 0n;
  if (discordId === ownerId) return PERMISSION_ADMINISTRATOR;
  // @everyone's role ID is always the guild ID itself, and isn't included in a member's
  // `roles` array — its permissions still apply as the baseline for every member.
  let bits = roles.get(guildId)?.permissions ?? 0n;
  for (const roleId of roleIds) {
    const role = roles.get(roleId);
    if (role) bits |= role.permissions;
  }
  return bits;
}

export function hasAdministratorOrManageGuild(permissionBits: bigint): boolean {
  return (permissionBits & PERMISSION_ADMINISTRATOR) !== 0n || (permissionBits & PERMISSION_MANAGE_GUILD) !== 0n;
}
