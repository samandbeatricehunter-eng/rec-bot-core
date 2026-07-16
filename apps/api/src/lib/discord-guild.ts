import { env } from "../config/env.js";
import { REC_MANAGED_ROLES, classifyGuildRoleNames, type RecManagedRoleKey } from "@rec/shared";
import { ApiError } from "./errors.js";

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
const PERMISSION_ADD_REACTIONS = 1n << 6n;
const PERMISSION_VIEW_CHANNEL = 1n << 10n;
const PERMISSION_SEND_MESSAGES = 1n << 11n;
const PERMISSION_EMBED_LINKS = 1n << 14n;
const PERMISSION_ATTACH_FILES = 1n << 15n;
const PERMISSION_MANAGE_MESSAGES = 1n << 13n;
const PERMISSION_CREATE_PUBLIC_THREADS = 1n << 35n;
const PERMISSION_CREATE_PRIVATE_THREADS = 1n << 36n;
const PERMISSION_USE_EXTERNAL_STICKERS = 1n << 37n;
const PERMISSION_SEND_MESSAGES_IN_THREADS = 1n << 38n;

type CacheEntry<T> = { value: T; expiresAt: number };
const CACHE_TTL_MS = 60_000;
const roleListCache = new Map<string, CacheEntry<Map<string, { name: string; permissions: bigint }>>>();
const guildOwnerCache = new Map<string, CacheEntry<string>>();
const memberRoleIdsCache = new Map<string, CacheEntry<string[] | null>>();
const roleListInflight = new Map<string, Promise<Map<string, { name: string; permissions: bigint }>>>();
const memberRoleIdsInflight = new Map<string, Promise<string[] | null>>();
let botUserIdCache: CacheEntry<string> | undefined;
const STALE_AUTH_CACHE_MS = 10 * 60_000;

function fromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) return undefined;
  return entry.value;
}

function toCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function discordBotFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!env.DISCORD_TOKEN) throw new ApiError(500, "DISCORD_TOKEN is not configured — required for Activity guild role lookups.");
  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, ...(init?.headers ?? {}) },
  });
}

async function getBotUserId(): Promise<string> {
  if (botUserIdCache && botUserIdCache.expiresAt > Date.now()) return botUserIdCache.value;
  const res = await discordBotFetch("/users/@me");
  if (!res.ok) throw new ApiError(502, `Discord rejected the bot identity request (${res.status}).`);
  const user = await res.json() as { id: string };
  botUserIdCache = { value: user.id, expiresAt: Date.now() + 10 * 60_000 };
  return user.id;
}

async function putChannelPermissionOverwrite(channelId: string, overwriteId: string, type: 0 | 1, allow: bigint, deny: bigint) {
  const res = await discordBotFetch(`/channels/${channelId}/permissions/${overwriteId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-audit-log-reason": "REC Guide channel permissions" },
    body: JSON.stringify({ type, allow: allow.toString(), deny: deny.toString() }),
  });
  if (!res.ok && res.status !== 204) throw new ApiError(502, `Discord rejected channel permission update (${res.status}).`);
}

export async function lockRecGuideChannel(guildId: string, channelId: string): Promise<void> {
  await putChannelPermissionOverwrite(
    channelId,
    guildId,
    0,
    PERMISSION_VIEW_CHANNEL | PERMISSION_ADD_REACTIONS,
    PERMISSION_SEND_MESSAGES | PERMISSION_CREATE_PUBLIC_THREADS | PERMISSION_CREATE_PRIVATE_THREADS | PERMISSION_SEND_MESSAGES_IN_THREADS | PERMISSION_ATTACH_FILES | PERMISSION_USE_EXTERNAL_STICKERS,
  );
  await putChannelPermissionOverwrite(
    channelId,
    await getBotUserId(),
    1,
    PERMISSION_VIEW_CHANNEL | PERMISSION_SEND_MESSAGES | PERMISSION_EMBED_LINKS | PERMISSION_ATTACH_FILES | PERMISSION_MANAGE_MESSAGES | PERMISSION_ADD_REACTIONS,
    0n,
  );
}

export async function listGuildChannels(guildId: string) {
  const res = await discordBotFetch(`/guilds/${guildId}/channels`);
  if (!res.ok) throw new ApiError(502, `Discord rejected the channel list request (${res.status}).`);
  const channels = await res.json() as Array<{ id: string; name: string; type: number; parent_id?: string | null; position?: number }>;
  return channels.filter((c) => c.type === 0 || c.type === 5 || c.type === 4).map((c) => ({ id: c.id, name: c.name, type: c.type === 4 ? "category" : "text", parentId: c.parent_id ?? null, position: c.position ?? 0 })).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export async function createGuildChannel(guildId: string, input: { name: string; type: "text" | "category"; templateChannelId?: string | null; parentChannelId?: string | null }) {
  let permissionOverwrites: unknown[] | undefined;
  let parentId: string | null | undefined = input.parentChannelId;
  if (input.templateChannelId) {
    const template = await discordBotFetch(`/channels/${input.templateChannelId}`);
    if (template.ok) {
      const row = await template.json() as { permission_overwrites?: unknown[]; parent_id?: string | null };
      permissionOverwrites = row.permission_overwrites;
      parentId ??= row.parent_id;
    }
  }
  const res = await discordBotFetch(`/guilds/${guildId}/channels`, { method: "POST", headers: { "content-type": "application/json", "x-audit-log-reason": "REC League Management channel setup" }, body: JSON.stringify({ name: input.name, type: input.type === "category" ? 4 : 0, permission_overwrites: permissionOverwrites, parent_id: input.type === "text" ? parentId : undefined }) });
  if (!res.ok) throw new ApiError(502, `Discord rejected channel creation (${res.status}). Check Manage Channels permission.`);
  const channel = await res.json() as { id: string; name: string; type: number };
  return { id: channel.id, name: channel.name, type: channel.type === 4 ? "category" : "text" };
}

export async function sendDiscordDirectMessage(discordId: string, content: string): Promise<void> {
  const dm = await discordBotFetch("/users/@me/channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!dm.ok) throw new Error(`Failed to open Discord DM (${dm.status})`);
  const channel = await dm.json() as { id: string };
  const sent = await discordBotFetch(`/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!sent.ok) throw new Error(`Failed to send Discord DM (${sent.status})`);
}

export async function sendDiscordAdvanceAnnouncement(channelId: string, destinationLabel: string): Promise<void> {
  const sent = await discordBotFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "@everyone",
      embeds: [{ title: "📣 League Advanced", color: 0xd9a521, description: `The league has advanced to **${destinationLabel}**.\n\nNavigate to **/hub** for league options and details.` }],
      allowed_mentions: { parse: ["everyone"] },
    }),
  });
  if (!sent.ok) throw new ApiError(502, `Discord rejected the advance announcement (${sent.status}).`);
}

// Generic message post (embeds/components/content) — the REST equivalent of a discord.js
// TextChannel#send(), used by server-driven flows (advance completion) that need to post to
// a channel without a live bot gateway client. Returns the created message id.
export async function postDiscordChannelMessage(channelId: string, payload: Record<string, unknown>): Promise<{ id: string } | null> {
  const sent = await discordBotFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!sent.ok) return null;
  return (await sent.json()) as { id: string };
}

export async function deleteDiscordMessage(channelId: string, messageId: string): Promise<void> {
  await discordBotFetch(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" }).catch(() => undefined);
}

/**
 * Fetches one message's raw Discord payload — used to read its `reactions` array
 * (each entry is `{ emoji: { id, name }, count, me }`) without needing a live
 * gateway-cached discord.js Client. `me` reflects the REC bot's own account, so
 * subtracting 1 when `me` is true excludes the bot's own seed reaction the same
 * way the old client-cache-based tally did.
 */
export async function getDiscordMessage(channelId: string, messageId: string): Promise<{ reactions?: Array<{ emoji: { id: string | null; name: string | null }; count: number; me: boolean }>; author?: { id: string } } | null> {
  const res = await discordBotFetch(`/channels/${channelId}/messages/${messageId}`).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json() as any;
}

function staleCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  return entry && entry.expiresAt + STALE_AUTH_CACHE_MS > Date.now() ? entry.value : undefined;
}

async function retryAfterRateLimit(path: string, response: Response): Promise<Response> {
  if (response.status !== 429) return response;
  const payload = await response.clone().json().catch(() => ({})) as { retry_after?: number };
  const headerSeconds = Number(response.headers.get("retry-after") ?? 0);
  const delayMs = Math.min(5_000, Math.max(100, Math.ceil(Number(payload.retry_after ?? headerSeconds ?? 1) * 1000)));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return discordBotFetch(path);
}

export async function getDiscordReactionUserIds(channelId: string, messageId: string, emojiId: string): Promise<string[]> {
  const res = await discordBotFetch(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emojiId)}?limit=100`).catch(() => null);
  if (!res || !res.ok) return [];
  return ((await res.json()) as Array<{ id: string }>).map((user) => user.id);
}

// Clears a channel's recent history the same way the bot's purgeChannelMessages does —
// bulk-delete (2-100 at a time) for messages under 14 days old, individual deletes beyond
// that. Capped at 200 fetched messages so a very chatty channel can't turn advance
// completion into a long-running purge.
export async function purgeDiscordChannelMessages(channelId: string): Promise<{ purged: number }> {
  const fourteenDaysAgoMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let purged = 0;
  let before: string | undefined;
  for (let page = 0; page < 2; page++) {
    const res = await discordBotFetch(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    if (!res.ok) break;
    const messages = (await res.json()) as Array<{ id: string; timestamp: string }>;
    if (!messages.length) break;
    before = messages[messages.length - 1].id;

    const bulkable = messages.filter((m) => new Date(m.timestamp).getTime() > fourteenDaysAgoMs).map((m) => m.id);
    const singles = messages.filter((m) => new Date(m.timestamp).getTime() <= fourteenDaysAgoMs).map((m) => m.id);

    for (let i = 0; i < bulkable.length; i += 100) {
      const chunk = bulkable.slice(i, i + 100);
      if (chunk.length === 1) {
        await deleteDiscordMessage(channelId, chunk[0]);
        purged += 1;
      } else if (chunk.length > 1) {
        const bulk = await discordBotFetch(`/channels/${channelId}/messages/bulk-delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: chunk }),
        });
        if (bulk.ok) purged += chunk.length;
      }
    }
    for (const id of singles.slice(0, 50)) {
      await deleteDiscordMessage(channelId, id);
      purged += 1;
    }
    if (messages.length < 100) break;
  }
  return { purged };
}

export async function deleteGuildChannel(channelId: string, reason: string): Promise<boolean> {
  const res = await discordBotFetch(`/channels/${channelId}`, { method: "DELETE", headers: { "X-Audit-Log-Reason": reason } });
  return res.ok;
}

async function getGuildRoles(guildId: string): Promise<Map<string, { name: string; permissions: bigint }>> {
  const cached = fromCache(roleListCache, guildId);
  if (cached) return cached;
  const active = roleListInflight.get(guildId);
  if (active) return active;
  const pending = (async () => {
    const path = `/guilds/${guildId}/roles`;
    const res = await retryAfterRateLimit(path, await discordBotFetch(path));
    if (!res.ok) {
      const stale = staleCacheValue(roleListCache, guildId);
      if (res.status === 429 && stale) return stale;
      throw new ApiError(res.status === 429 ? 503 : 502, `Failed to fetch guild roles (${res.status})`);
    }
    const roles = (await res.json()) as Array<{ id: string; name: string; permissions: string }>;
    const map = new Map(roles.map((r) => [r.id, { name: r.name, permissions: BigInt(r.permissions) }]));
    toCache(roleListCache, guildId, map);
    return map;
  })();
  roleListInflight.set(guildId, pending);
  try { return await pending; } finally { roleListInflight.delete(guildId); }
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

// "Head commissioner" — the Discord guild's actual owner. Same source
// resolveMemberPermissionBits already special-cases internally (owner → Administrator);
// exposed here as its own boolean for callers that need an owner-specific gate rather than
// a general commissioner-level permission check (e.g. Delete League).
export async function isGuildOwner(guildId: string, discordId: string): Promise<boolean> {
  const ownerId = await getGuildOwnerId(guildId);
  return discordId === ownerId;
}

// Returns the member's role IDs, or null if the Discord user isn't a member of this guild.
async function getMemberRoleIds(guildId: string, discordId: string): Promise<string[] | null> {
  const cacheKey = `${guildId}:${discordId}`;
  const cached = fromCache(memberRoleIdsCache, cacheKey);
  if (cached !== undefined) return cached;
  const active = memberRoleIdsInflight.get(cacheKey);
  if (active) return active;
  const pending = (async () => {
    const path = `/guilds/${guildId}/members/${discordId}`;
    const res = await retryAfterRateLimit(path, await discordBotFetch(path));
    if (res.status === 404) {
      toCache(memberRoleIdsCache, cacheKey, null);
      return null;
    }
    if (!res.ok) {
      const stale = staleCacheValue(memberRoleIdsCache, cacheKey);
      if (res.status === 429 && stale !== undefined) return stale;
      throw new ApiError(res.status === 429 ? 503 : 502, `Failed to fetch guild member (${res.status})`);
    }
    const member = (await res.json()) as { roles: string[] };
    toCache(memberRoleIdsCache, cacheKey, member.roles);
    return member.roles;
  })();
  memberRoleIdsInflight.set(cacheKey, pending);
  try { return await pending; } finally { memberRoleIdsInflight.delete(cacheKey); }
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

// --- Role grant/revoke (Phase 2: Roles web port) -----------------------------------------
// Everything below hits Discord's REST API directly with the bot's own token, equivalent in
// privilege to the bot doing it via discord.js (member.roles.add/remove() is itself a thin
// wrapper over these same PUT/DELETE calls) — no need to proxy through the running bot
// process. Same role-hierarchy constraint applies: the bot can only grant/revoke roles
// positioned below its own highest role in the guild.

export type DiscordGuildMemberSummary = { discordId: string; displayName: string; username: string; isBot: boolean; managedRole: RecManagedRoleKey | null };

// Discord caps a single members-list page at 1000; loop with the `after` cursor for guilds
// larger than that (uncommon for a REC league, but not worth hardcoding a limit).
export async function listGuildMembers(guildId: string): Promise<DiscordGuildMemberSummary[]> {
  const members: DiscordGuildMemberSummary[] = [];
  const roles = await getGuildRoles(guildId);
  const managedById = new Map<string, RecManagedRoleKey>();
  for (const [id, role] of roles) {
    const match = (Object.entries(REC_MANAGED_ROLES) as Array<[RecManagedRoleKey, { name: string }]>).find(([, definition]) => definition.name === role.name);
    if (match) managedById.set(id, match[0]);
  }
  let after = "0";
  for (;;) {
    const res = await discordBotFetch(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!res.ok) throw new Error(`Failed to fetch guild members (${res.status})`);
    const page = (await res.json()) as Array<{ user: { id: string; username: string; bot?: boolean }; nick: string | null; roles: string[] }>;
    for (const row of page) {
      members.push({
        discordId: row.user.id,
        displayName: row.nick ?? row.user.username,
        username: row.user.username,
        isBot: Boolean(row.user.bot),
        managedRole: row.roles.map((id) => managedById.get(id)).filter((role): role is RecManagedRoleKey => Boolean(role)).sort((a, b) => ["member", "compCommittee", "commissioner"].indexOf(b) - ["member", "compCommittee", "commissioner"].indexOf(a))[0] ?? null,
      });
    }
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return members;
}

export type MentionableCommissioner = { discordId: string; displayName: string };
export type MentionableRole = { key: "commissioner" | "coCommissioner"; roleId: string; name: string };
export type MentionableList = { members: MentionableCommissioner[]; roles: MentionableRole[] };

const mentionableCache = new Map<string, CacheEntry<MentionableList>>();

// Powers the commissioner chat's @-mention autocomplete — commissioners/co-commissioners
// individually, plus the two managed role tags themselves (tagging "@Co-Commissioner" pings
// the whole group in Discord's own mention format, same as tagging a person). Cached
// alongside the other lookups in this file; a 60s staleness window is fine for an
// autocomplete list.
export async function getMentionableCommissioners(guildId: string): Promise<MentionableList> {
  const cached = fromCache(mentionableCache, guildId);
  if (cached) return cached;

  const roles = await getGuildRoles(guildId);
  const roleNameById = new Map([...roles].map(([id, r]) => [id, r.name]));

  const members: MentionableCommissioner[] = [];
  let after = "0";
  for (;;) {
    const res = await discordBotFetch(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!res.ok) throw new Error(`Failed to fetch guild members (${res.status})`);
    const page = (await res.json()) as Array<{ user: { id: string; username: string; bot?: boolean }; nick: string | null; roles: string[] }>;
    for (const row of page) {
      if (row.user.bot) continue;
      const roleNames = row.roles.map((id) => roleNameById.get(id)).filter((n): n is string => Boolean(n));
      const { isCommissioner, isCoCommissioner } = classifyGuildRoleNames(roleNames);
      if (isCommissioner || isCoCommissioner) {
        members.push({ discordId: row.user.id, displayName: row.nick ?? row.user.username });
      }
    }
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }

  const commissionerRoleId = [...roles].find(([, r]) => r.name === REC_MANAGED_ROLES.commissioner.name)?.[0];
  const coCommissionerRoleId = [...roles].find(([, r]) => r.name === REC_MANAGED_ROLES.compCommittee.name)?.[0];
  const roleTags: MentionableRole[] = [];
  if (commissionerRoleId) roleTags.push({ key: "commissioner", roleId: commissionerRoleId, name: REC_MANAGED_ROLES.commissioner.name });
  if (coCommissionerRoleId) roleTags.push({ key: "coCommissioner", roleId: coCommissionerRoleId, name: REC_MANAGED_ROLES.compCommittee.name });

  const result: MentionableList = { members, roles: roleTags };
  toCache(mentionableCache, guildId, result);
  return result;
}

const guildMemberListCache = new Map<string, CacheEntry<DiscordGuildMemberSummary[]>>();

// Cached wrapper around listGuildMembers for callers that just need a discordId -> live
// Discord display name (nickname, or username as fallback) lookup and can tolerate a ~60s
// staleness window — e.g. resolving commissioner chat message authors, or linked-team
// display names. Avoids hitting Discord's members endpoint on every 5s chat poll.
export async function getGuildMemberDisplayNameMap(guildId: string): Promise<Map<string, string>> {
  const cached = fromCache(guildMemberListCache, guildId);
  const members = cached ?? (await listGuildMembers(guildId));
  if (!cached) toCache(guildMemberListCache, guildId, members);
  return new Map(members.map((m) => [m.discordId, m.displayName]));
}

// Find-or-create a REC managed role by name (mirrors apps/bot/src/lib/role-sync.ts's
// ensureRole, minus hierarchy positioning — a guild only reaches the web dashboard after
// the bot has already run there at least once, so orderRecRoles will already have placed
// these roles sensibly; re-ordering them isn't worth porting for this path).
export async function ensureManagedRoleId(guildId: string, roleKey: RecManagedRoleKey): Promise<string> {
  const definition = REC_MANAGED_ROLES[roleKey];
  const roles = await getGuildRoles(guildId);
  for (const [id, role] of roles) {
    if (role.name === definition.name) return id;
  }
  const res = await discordBotFetch(`/guilds/${guildId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: definition.name, color: definition.color, reason: "REC Core role sync" }),
  });
  if (!res.ok) throw new Error(`Failed to create role "${definition.name}" (${res.status})`);
  const created = (await res.json()) as { id: string };
  roleListCache.delete(guildId);
  return created.id;
}

export async function addMemberRole(guildId: string, discordId: string, roleId: string, reason: string): Promise<void> {
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "PUT",
    headers: { "X-Audit-Log-Reason": reason },
  });
  memberRoleIdsCache.delete(`${guildId}:${discordId}`);
  if (!res.ok && res.status !== 204) throw new Error(`Failed to add role (${res.status})`);
}

export async function removeMemberRole(guildId: string, discordId: string, roleId: string, reason: string): Promise<void> {
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { "X-Audit-Log-Reason": reason },
  });
  memberRoleIdsCache.delete(`${guildId}:${discordId}`);
  if (!res.ok && res.status !== 204) throw new Error(`Failed to remove role (${res.status})`);
}
