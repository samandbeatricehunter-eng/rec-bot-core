import { env } from "../config/env.js";
import { REC_MANAGED_ROLES, classifyGuildRoleNames, type RecManagedRoleKey } from "@rec/shared";
import { bestEffort } from "./best-effort.js";
import { ApiError } from "./errors.js";
import { supabase } from "./supabase.js";
import { isTransientGameSchedulingMessage, type DiscordCleanupMessage } from "../modules/scheduling/scheduling-guardrails.js";

export { isTransientGameSchedulingMessage } from "../modules/scheduling/scheduling-guardrails.js";

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

// Entries only ever get overwritten on next access to the same key, never proactively removed —
// every distinct guildId / guildId:discordId this process has ever seen otherwise stays resident
// for the life of the process. Sweep all the module-level caches on an interval so a long-running
// process doesn't grow unbounded with usage; registered once, unref'd so it never keeps the
// process alive on its own.
const SWEEP_INTERVAL_MS = 5 * 60_000;
function sweepExpiredEntries(...caches: Array<Map<string, CacheEntry<any>>>) {
  const now = Date.now();
  for (const cache of caches) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt < now) cache.delete(key);
    }
  }
}

// HTTP headers are Latin1/ByteString only — any reason string containing a non-ASCII
// character (em dash, curly quotes, etc., all common in our own hand-written audit reasons)
// throws when the runtime tries to set it as a raw header value. Discord's API expects this
// header URL-encoded anyway, so encoding here is both the fix and the documented-correct form.
function auditReason(reason: string): string {
  return encodeURIComponent(reason.slice(0, 480));
}

export async function discordBotFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!env.DISCORD_TOKEN) throw new ApiError(500, "DISCORD_TOKEN is not configured — required for Activity guild role lookups.");
  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15_000),
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, ...(init?.headers ?? {}) },
  });
}

/** Whether the bot has actually joined this guild yet — distinct from "is this guild linked
 * to a league in our DB" (registerServer/ensurePrimaryServerLeagueLink happen the moment a
 * commissioner picks a server, before they've clicked the invite link at all). */
export async function isBotInGuild(guildId: string): Promise<boolean> {
  const botId = await getBotUserId();
  const res = await discordBotFetch(`/guilds/${guildId}/members/${botId}`);
  return res.ok;
}

export async function getBotUserId(): Promise<string> {
  if (botUserIdCache && botUserIdCache.expiresAt > Date.now()) return botUserIdCache.value;
  const res = await discordBotFetch("/users/@me");
  if (!res.ok) throw new ApiError(502, `Discord rejected the bot identity request (${res.status}).`);
  const user = await res.json() as { id: string };
  botUserIdCache = { value: user.id, expiresAt: Date.now() + 10 * 60_000 };
  return user.id;
}

let applicationIdCache: CacheEntry<string> | undefined;
async function getApplicationId(): Promise<string> {
  if (applicationIdCache && applicationIdCache.expiresAt > Date.now()) return applicationIdCache.value;
  const res = await discordBotFetch("/oauth2/applications/@me");
  if (!res.ok) throw new ApiError(502, `Discord rejected the application lookup (${res.status}).`);
  const app = await res.json() as { id: string };
  applicationIdCache = { value: app.id, expiresAt: Date.now() + 10 * 60_000 };
  return app.id;
}

// Mirrors apps/bot/src/commands.ts's static `commands` array — kept as plain JSON here (not
// discord.js SlashCommandBuilder) because apps/api has no discord.js dependency. Every guild
// command PUT replaces the guild's ENTIRE command set, so this always has to be re-sent in
// full alongside whatever conditional commands (e.g. /draft) apply right now — there's no
// partial "add one command" call. If the base command list in apps/bot/src/commands.ts ever
// changes, update this to match or guilds will silently lose whichever command was dropped.
const BASE_GUILD_COMMANDS_JSON = [
  { name: "openteams", description: "View open and claimed teams in this league." },
  { name: "matchup", description: "Show your current-week matchup." },
  { name: "schedule", description: "Show your team's full season schedule." },
  { name: "viewleague", description: "Get a link to this league's public status page." },
  { name: "highlights", description: "Get a link to upload a highlight for an eligible week." },
  { name: "linkleague", description: "Link one of your unclaimed REC leagues to this Discord server." },
  { name: "standings", description: "Show current season standings." },
  { name: "wallet", description: "Check your coin balance and savings." },
  { name: "powerrankings", description: "Show current power rankings." },
  { name: "rules", description: "Browse this league's rules." },
];
const DRAFT_COMMAND_JSON = { name: "draft", description: "Check in for the fantasy draft." };

/**
 * Registers this guild's full command set — the base commands plus /draft only when
 * `includeDraft` is true. /draft is meant to only be visible within ~1hr of a scheduled
 * fantasy draft or while one is live; see fantasy-draft.service.ts's schedule/commence/
 * conclude/skip-to-end for the call sites that flip this.
 */
export async function syncGuildCommands(guildId: string, includeDraft: boolean): Promise<void> {
  const appId = await getApplicationId();
  const body = includeDraft ? [...BASE_GUILD_COMMANDS_JSON, DRAFT_COMMAND_JSON] : BASE_GUILD_COMMANDS_JSON;
  const res = await discordBotFetch(`/applications/${appId}/guilds/${guildId}/commands`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(502, `Discord rejected the guild command sync (${res.status}).`);
}

const BOXSCORE_COMMAND_JSON = { name: "boxscore", description: "Get a link to upload a box score for an eligible week." };

/**
 * Adds or removes /boxscore from this guild's command set without touching anything else
 * currently registered (including /draft, whose visibility is driven by its own independent
 * timer-based state in fantasy-draft.service.ts — reusing syncGuildCommands here would require
 * knowing /draft's current desired state too, which this call site has no reason to track).
 * Reads the guild's actual current commands first so this stays correct regardless of what
 * else is/isn't visible right now. Called whenever a league's data mode changes to/from
 * "box_scores" — see league-week/data-mode.service.ts.
 */
export async function syncBoxScoreCommandVisibility(guildId: string, includeBoxScore: boolean): Promise<void> {
  const appId = await getApplicationId();
  const current = await discordBotFetch(`/applications/${appId}/guilds/${guildId}/commands`);
  if (!current.ok) throw new ApiError(502, `Failed to read this guild's current commands (${current.status}).`);
  const existing = (await current.json()) as Array<{ name: string; description: string }>;
  const withoutBoxscore = existing.filter((command) => command.name !== "boxscore").map((command) => ({ name: command.name, description: command.description }));
  const next = includeBoxScore ? [...withoutBoxscore, BOXSCORE_COMMAND_JSON] : withoutBoxscore;
  const res = await discordBotFetch(`/applications/${appId}/guilds/${guildId}/commands`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!res.ok) throw new ApiError(502, `Discord rejected the guild command sync (${res.status}).`);
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
  if (!isDiscordSnowflake(guildId)) return [];
  const res = await discordBotFetch(`/guilds/${guildId}/channels`);
  if (!res.ok) {
    // Bot left the guild, stale link, or invalid snowflake — degrade to empty so channel
    // pickers and server-config pages stay usable instead of 502ing the whole admin view.
    if (res.status === 400 || res.status === 404) return [];
    throw new ApiError(502, `Discord rejected the channel list request (${res.status}).`);
  }
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

function isDiscordSnowflake(value: unknown): boolean {
  return /^\d{15,}$/.test(String(value ?? "").trim());
}

/** Prefer a real Discord handle over a snowflake placeholder left at link time. */
export function pickDiscordHandle(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value && !isDiscordSnowflake(value)) return value;
  }
  return null;
}

/** Fetch Discord username/global_name and persist when our stored values are snowflake placeholders. */
export async function resolveDiscordAccountHandle(input: {
  discordAccountId: string;
  discordId: string;
  username?: string | null;
  globalName?: string | null;
}): Promise<string | null> {
  const existing = pickDiscordHandle(input.username, input.globalName);
  if (existing) return existing;
  if (!env.DISCORD_TOKEN || !input.discordId) return null;
  try {
    const res = await discordBotFetch(`/users/${input.discordId}`);
    if (!res.ok) return null;
    const user = await res.json() as { username?: string; global_name?: string | null };
    const resolved = pickDiscordHandle(user.username, user.global_name);
    if (!resolved) return null;
    const { supabase } = await import("./supabase.js");
    await supabase
      .from("rec_discord_accounts")
      .update({
        username: resolved,
        global_name: pickDiscordHandle(user.global_name, resolved) ?? resolved,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.discordAccountId);
    return resolved;
  } catch {
    return null;
  }
}

export async function sendDiscordDirectMessage(discordId: string, content: string): Promise<void> {
  await sendDiscordDirectMessagePayload(discordId, { content, allowed_mentions: { parse: [] } });
}

export async function sendDiscordDirectMessagePayload(
  discordId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string } | null> {
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
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!sent.ok) throw new Error(`Failed to send Discord DM (${sent.status})`);
  return (await sent.json()) as { id: string };
}

// Generic message post (embeds/components/content) — the REST equivalent of a discord.js
// TextChannel#send(), used by server-driven flows (advance completion, game/league chat
// forwarding) that need to post to a channel without a live bot gateway client. Returns the
// created message id. Chat-driven traffic is frequent enough to draw 429s that the old
// low-volume embed posts never did, so this goes through the same retry/backoff as the guild
// role lookups below.
export async function postDiscordChannelMessage(channelId: string, payload: Record<string, unknown>): Promise<({ id: string } & Record<string, any>) | null> {
  const path = `/channels/${channelId}/messages`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
  const sent = await retryAfterRateLimit(path, await discordBotFetch(path, init), init);
  if (!sent.ok) {
    // A silent null return here used to leave callers with no way to tell "Discord rejected
    // this payload" (e.g. an embed over the 6000-char total limit) from "nothing needed to
    // change" — log the real reason so a stuck/stale message is diagnosable.
    const body = await bestEffort("discord.parse_error_body", () => sent.clone().json(), { entityId: channelId }) as { code?: number; message?: string } | null | undefined;
    console.error(`[WARN] Discord rejected postDiscordChannelMessage to channel ${channelId} (${sent.status}): ${body?.message ?? "unknown error"}${body?.code != null ? ` (code ${body.code})` : ""}`);
    return null;
  }
  return (await sent.json()) as { id: string } & Record<string, any>;
}

// Same as postDiscordChannelMessage but attaches a file (the Playwright-rendered matchup-card
// PNG) alongside the embed/components JSON. Discord's multipart endpoint wants the JSON payload
// under a "payload_json" field and each file under "files[n]" -- deliberately NOT setting a
// content-type header ourselves so fetch's native FormData/Blob handling generates the correct
// multipart boundary (setting content-type: application/json like the sibling function above
// would break this).
export async function postDiscordChannelMessageWithFile(
  channelId: string,
  payload: Record<string, unknown>,
  file: { buffer: Buffer; name: string; contentType?: string },
): Promise<({ id: string } & Record<string, any>) | null> {
  const path = `/channels/${channelId}/messages`;
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  form.set("files[0]", new Blob([new Uint8Array(file.buffer)], { type: file.contentType ?? "image/png" }), file.name);
  const init: RequestInit = { method: "POST", body: form };
  const sent = await retryAfterRateLimit(path, await discordBotFetch(path, init), init);
  if (!sent.ok) {
    const body = await bestEffort("discord.parse_error_body", () => sent.clone().json(), { entityId: channelId }) as { code?: number; message?: string } | null | undefined;
    console.error(`[WARN] Discord rejected postDiscordChannelMessageWithFile to channel ${channelId} (${sent.status}): ${body?.message ?? "unknown error"}${body?.code != null ? ` (code ${body.code})` : ""}`);
    return null;
  }
  return (await sent.json()) as { id: string } & Record<string, any>;
}

export async function deleteDiscordMessage(channelId: string, messageId: string): Promise<void> {
  await bestEffort("discord.delete_message", () => discordBotFetch(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" }), { entityId: messageId });
}

/** Remove recent action prompts for one game while preserving ordinary channel chat. */
export async function deleteDiscordComponentMessagesForGame(channelId: string, gameId: string): Promise<number> {
  const res = await discordBotFetch(`/channels/${channelId}/messages?limit=100`);
  if (!res.ok) return 0;
  const messages = await res.json() as Array<{ id: string; components?: Array<{ components?: Array<{ custom_id?: string }> }> }>;
  const targets = messages.filter((message) => (message.components ?? []).some((row) =>
    (row.components ?? []).some((component) => component.custom_id?.includes(gameId)),
  ));
  await Promise.all(targets.map((message) => deleteDiscordMessage(channelId, message.id)));
  return targets.length;
}

/** Remove REC's transient pings and scheduling offer/response messages from a game channel,
 * without touching user chat or the original bot-authored embeds. */
export async function deleteTransientGameSchedulingMessages(channelId: string): Promise<number> {
  const [botUserId, res] = await Promise.all([
    getBotUserId(),
    discordBotFetch(`/channels/${channelId}/messages?limit=100`),
  ]);
  if (!res.ok) return 0;
  const messages = await res.json() as DiscordCleanupMessage[];
  const targets = messages.filter((message) => isTransientGameSchedulingMessage(message, botUserId));
  await Promise.all(targets.map((message) => deleteDiscordMessage(channelId, message.id)));
  return targets.length;
}

/** Edit a previously posted bot message (embeds/components/content) via REST. Used to keep
 * live status embeds (e.g. the fantasy-draft check-in board) in sync when a change comes
 * from a non-gateway source like the website. Returns false on any non-OK response (a
 * deleted/expired message is non-fatal to the caller). */
export async function editDiscordMessage(channelId: string, messageId: string, payload: Record<string, unknown>): Promise<boolean> {
  const path = `/channels/${channelId}/messages/${messageId}`;
  const init: RequestInit = { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
  const sent = await retryAfterRateLimit(path, await discordBotFetch(path, init), init);
  if (!sent.ok) {
    const body = await bestEffort("discord.parse_error_body", () => sent.clone().json(), { entityId: channelId }) as { code?: number; message?: string } | null | undefined;
    console.error(`[WARN] Discord rejected editDiscordMessage on channel ${channelId} message ${messageId} (${sent.status}): ${body?.message ?? "unknown error"}${body?.code != null ? ` (code ${body.code})` : ""}`);
  }
  return sent.ok;
}

export async function banDiscordGuildMember(guildId: string, discordId: string, reason: string): Promise<void> {
  const response = await discordBotFetch(`/guilds/${guildId}/bans/${discordId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-audit-log-reason": encodeURIComponent(reason.slice(0, 480)) },
    body: JSON.stringify({ delete_message_seconds: 0 }),
  });
  if (!response.ok) throw new ApiError(502, `Discord rejected the server ban (${response.status}).`);
}

export async function unbanDiscordGuildMember(guildId: string, discordId: string, reason: string): Promise<void> {
  const response = await discordBotFetch(`/guilds/${guildId}/bans/${discordId}`, {
    method: "DELETE",
    headers: { "x-audit-log-reason": encodeURIComponent(reason.slice(0, 480)) },
  });
  if (!response.ok && response.status !== 404) throw new ApiError(502, `Discord rejected the server unban (${response.status}).`);
}

export async function kickDiscordGuildMember(guildId: string, discordId: string, reason: string): Promise<void> {
  const response = await discordBotFetch(`/guilds/${guildId}/members/${discordId}`, {
    method: "DELETE",
    headers: { "x-audit-log-reason": encodeURIComponent(reason.slice(0, 480)) },
  });
  if (!response.ok && response.status !== 404) throw new ApiError(502, `Discord rejected the server kick (${response.status}).`);
}

/**
 * Fetches one message's raw Discord payload — used to read its `reactions` array
 * (each entry is `{ emoji: { id, name }, count, me }`) without needing a live
 * gateway-cached discord.js Client. `me` reflects the REC bot's own account, so
 * subtracting 1 when `me` is true excludes the bot's own seed reaction the same
 * way the old client-cache-based tally did.
 */
export async function getDiscordMessage(channelId: string, messageId: string): Promise<{ reactions?: Array<{ emoji: { id: string | null; name: string | null }; count: number; me: boolean }>; author?: { id: string } } | null> {
  const res = await bestEffort("discord.get_message", () => discordBotFetch(`/channels/${channelId}/messages/${messageId}`), { entityId: messageId }) ?? null;
  if (!res || !res.ok) return null;
  return res.json() as any;
}

/** Fetch the full Discord message payload including embeds (used for editing embeds in-place). */
export async function getDiscordMessagePayload(channelId: string, messageId: string): Promise<{ embeds?: Array<Record<string, any>> } | null> {
  const res = await bestEffort("discord.get_message_payload", () => discordBotFetch(`/channels/${channelId}/messages/${messageId}`), { entityId: messageId }) ?? null;
  if (!res || !res.ok) return null;
  return res.json() as any;
}

export type DiscordPollAnswerCount = { id: number; count: number; me_voted: boolean };
export type DiscordPollResult = { question: string; answers: Array<{ id: number; text: string }>; isFinalized: boolean; answerCounts: DiscordPollAnswerCount[] } | null;

// Reads a native Discord poll's live tallies straight off the message object (Discord embeds
// `results.answer_counts` on the poll even while it's still open, no separate per-voter fetch
// needed — commissioner polls only need counts, unlike EOS award polls' DM-the-winner flow
// which needs actual voter ids).
export async function getDiscordPollResults(channelId: string, messageId: string): Promise<DiscordPollResult> {
  const res = await bestEffort("discord.get_poll_results", () => discordBotFetch(`/channels/${channelId}/messages/${messageId}`), { entityId: messageId }) ?? null;
  if (!res || !res.ok) return null;
  const message = (await res.json()) as any;
  const poll = message?.poll;
  if (!poll) return null;
  return {
    question: String(poll.question?.text ?? ""),
    answers: (poll.answers ?? []).map((a: any) => ({ id: a.answer_id, text: String(a.poll_media?.text ?? "") })),
    isFinalized: Boolean(poll.results?.is_finalized),
    answerCounts: (poll.results?.answer_counts ?? []).map((c: any) => ({ id: c.id, count: Number(c.count ?? 0), me_voted: Boolean(c.me_voted) })),
  };
}

function staleCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  return entry && entry.expiresAt + STALE_AUTH_CACHE_MS > Date.now() ? entry.value : undefined;
}

// A single retry wasn't enough — a burst of concurrent hub loads across guilds (e.g. right
// after a deploy, with every in-memory cache cold) could draw two 429s in a row from
// Discord and still surface as a hard 503. Retries up to 3 times, honoring Discord's
// requested backoff each time, before giving up. `init` is re-sent as-is on retry (needed for
// POSTs like postDiscordChannelMessage; GET callers below omit it).
async function retryAfterRateLimit(path: string, response: Response, init?: RequestInit, attempt = 1): Promise<Response> {
  if (response.status !== 429 || attempt > 3) return response;
  const payload = await response.clone().json().catch(() => ({})) as { retry_after?: number };
  const headerSeconds = Number(response.headers.get("retry-after") ?? 0);
  const delayMs = Math.min(5_000, Math.max(100, Math.ceil(Number(payload.retry_after ?? headerSeconds ?? 1) * 1000)));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const retried = await discordBotFetch(path, init);
  return retryAfterRateLimit(path, retried, init, attempt + 1);
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
  const res = await discordBotFetch(`/channels/${channelId}`, { method: "DELETE", headers: { "X-Audit-Log-Reason": auditReason(reason) } });
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
      // 404/400 here means the bot isn't in this guild or the guild id is invalid — every
      // sub-resource request fails uniformly in that case. Degrading to an empty role list
      // keeps callers (permission checks, role dropdowns) working instead of 502ing the page.
      if (res.status === 404 || res.status === 400) {
        const empty = new Map<string, { name: string; permissions: bigint }>();
        toCache(roleListCache, guildId, empty);
        return empty;
      }
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
  if (!res.ok) throw new ApiError(502, `Failed to fetch guild (${res.status}) — the bot may no longer be in this Discord server.`);
  const guild = (await res.json()) as { owner_id: string };
  toCache(guildOwnerCache, guildId, guild.owner_id);
  return guild.owner_id;
}

// DB-backed fallback for when the bot can't be asked directly (it's left the server, a
// transient Discord API error, etc.) — mirrors league-context.service.ts's site-only-guild
// ownership check, but for a real guild whose Discord link has gone stale. rec_leagues.
// owner_user_id is set at league creation and doesn't depend on the bot still being present.
async function isGuildOwnerByRecord(guildId: string, discordId: string): Promise<boolean> {
  const server = await supabase.from("rec_discord_servers").select("id").eq("guild_id", guildId).maybeSingle();
  if (server.error || !server.data) return false;
  const link = await supabase.from("rec_server_league_links").select("league_id").eq("server_id", server.data.id).eq("is_primary", true).maybeSingle();
  if (link.error || !link.data) return false;
  const league = await supabase.from("rec_leagues").select("owner_user_id").eq("id", link.data.league_id).maybeSingle();
  if (league.error || !league.data?.owner_user_id) return false;
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error || !account.data) return false;
  return account.data.user_id === league.data.owner_user_id;
}

// "Head commissioner" — the Discord guild's actual owner. Same source
// resolveMemberPermissionBits already special-cases internally (owner → Administrator);
// exposed here as its own boolean for callers that need an owner-specific gate rather than
// a general commissioner-level permission check (e.g. Delete League). Falls back to the DB
// record if Discord can't answer (bot no longer in the server) rather than hard-failing —
// a stale/broken Discord link should never be the reason a commissioner can't delete their
// own league.
export async function isGuildOwner(guildId: string, discordId: string): Promise<boolean> {
  try {
    const ownerId = await getGuildOwnerId(guildId);
    return discordId === ownerId;
  } catch (error) {
    const fallback = await isGuildOwnerByRecord(guildId, discordId);
    if (fallback) return true;
    throw error;
  }
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

const sweepInterval = setInterval(
  () => sweepExpiredEntries(roleListCache, guildOwnerCache, memberRoleIdsCache, mentionableCache, guildMemberListCache),
  SWEEP_INTERVAL_MS,
);
sweepInterval.unref();

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
// ensureRole). Freshly created roles land wherever Discord happens to insert them (usually
// the bottom of the list) — ensureManagedRolesPositioned pushes it as high as the bot's own
// role allows, best-effort, so newly-linked members' highest role stays below the bot's and
// nickname/role changes don't start silently failing the moment a new managed role appears.
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
  await bestEffort("discord.ensure_managed_roles_positioned", () => ensureManagedRolesPositioned(guildId), { guildId });
  return created.id;
}

// REST equivalent of apps/bot/src/lib/role-sync.ts's orderRecRoles — moves the four REC
// managed roles as high as the bot's own top role allows. A bot can only ever reposition
// roles up to (never above) its own highest role's current position; if a human placed the
// bot's role below some other manually-created role, no API call — Administrator or not —
// can move it higher than that. This just makes sure the bot uses all the headroom it does
// have, instead of leaving newly-created managed roles wherever Discord happened to insert
// them (usually the very bottom).
export async function ensureManagedRolesPositioned(guildId: string): Promise<void> {
  const botId = await getBotUserId();
  const [roleIds, roles] = await Promise.all([getMemberRoleIds(guildId, botId), getGuildRoles(guildId)]);
  if (!roleIds) return;
  const positionsRes = await discordBotFetch(`/guilds/${guildId}/roles`);
  if (!positionsRes.ok) return;
  const allRoles = (await positionsRes.json()) as Array<{ id: string; name: string; position: number }>;
  const botHighestPosition = Math.max(0, ...allRoles.filter((r) => roleIds.includes(r.id)).map((r) => r.position));
  if (botHighestPosition <= 0) return;

  const byName = new Map(allRoles.map((r) => [r.name, r]));
  const order: RecManagedRoleKey[] = ["commissioner", "compCommittee", "member", "discordOnly"];
  const updates: Array<{ id: string; position: number }> = [];
  let nextPosition = botHighestPosition - 1;
  for (const key of order) {
    const role = byName.get(REC_MANAGED_ROLES[key].name);
    if (!role || nextPosition <= 0) continue;
    if (role.position !== nextPosition) updates.push({ id: role.id, position: nextPosition });
    nextPosition -= 1;
  }
  if (!updates.length) return;
  await bestEffort("discord.patch_managed_role_positions", () => discordBotFetch(`/guilds/${guildId}/roles`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Audit-Log-Reason": auditReason("REC managed role hierarchy sync") },
    body: JSON.stringify(updates),
  }), { guildId });
  roleListCache.delete(guildId);
}

export async function addMemberRole(guildId: string, discordId: string, roleId: string, reason: string): Promise<void> {
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "PUT",
    headers: { "X-Audit-Log-Reason": auditReason(reason) },
  });
  memberRoleIdsCache.delete(`${guildId}:${discordId}`);
  if (!res.ok && res.status !== 204) {
    const body = await bestEffort("discord.parse_error_body", () => res.json(), { guildId, userId: discordId }) as { code?: number; message?: string } | null | undefined;
    throw new Error(`Failed to add role: ${body?.message ? `${body.message}${body.code != null ? ` (Discord code ${body.code})` : ""}` : `HTTP ${res.status}`}`);
  }
}

export async function removeMemberRole(guildId: string, discordId: string, roleId: string, reason: string): Promise<void> {
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { "X-Audit-Log-Reason": auditReason(reason) },
  });
  memberRoleIdsCache.delete(`${guildId}:${discordId}`);
  if (!res.ok && res.status !== 204) {
    const body = await bestEffort("discord.parse_error_body", () => res.json(), { guildId, userId: discordId }) as { code?: number; message?: string } | null | undefined;
    throw new Error(`Failed to remove role: ${body?.message ? `${body.message}${body.code != null ? ` (Discord code ${body.code})` : ""}` : `HTTP ${res.status}`}`);
  }
}

/** Create a short-lived, single-use server invite for an approved league member. */
export async function createDiscordChannelInvite(channelId: string): Promise<string | null> {
  const response = await bestEffort("discord.create_channel_invite", () => discordBotFetch(`/channels/${channelId}/invites`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-audit-log-reason": "REC approved league team request",
    },
    body: JSON.stringify({ max_age: 7 * 24 * 60 * 60, max_uses: 1, unique: true }),
  }), { entityId: channelId }) ?? null;
  if (!response?.ok) return null;
  const invite = await response.json() as { code?: string };
  return invite.code ? `https://discord.gg/${invite.code}` : null;
}

export async function setGuildMemberNickname(guildId: string, discordId: string, nickname: string, reason: string): Promise<void> {
  const res = await discordBotFetch(`/guilds/${guildId}/members/${discordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Audit-Log-Reason": auditReason(reason) },
    body: JSON.stringify({ nick: nickname.slice(0, 32) }),
  });
  guildMemberListCache.delete(guildId);
  if (!res.ok) {
    // Surface Discord's actual error body, not just the HTTP status — a bare "403" collapses
    // "target is the guild owner" (code 50013, Discord blocks this for any bot unconditionally)
    // and "bot's role sits below the target's" (also 50013, but fixable by reordering roles)
    // into the same unreadable message. Distinguishing them requires the real payload.
    const body = await bestEffort("discord.parse_error_body", () => res.json(), { guildId, userId: discordId }) as { code?: number; message?: string } | null | undefined;
    const detail = body?.message ? `${body.message}${body.code != null ? ` (Discord code ${body.code})` : ""}` : `HTTP ${res.status}`;
    throw new Error(`Failed to update nickname: ${detail}`);
  }
}
