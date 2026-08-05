import { ApiError } from "./errors.js";

// User-token Discord API calls (the guild picker) — distinct from discord-guild.ts, which
// exclusively uses the bot's own token. GET /users/@me/guilds requires the "guilds" OAuth
// scope on the calling user's access token, not the bot's.
const DISCORD_API_BASE = "https://discord.com/api/v10";
const PERMISSION_ADMINISTRATOR = 1n << 3n;
const PERMISSION_MANAGE_GUILD = 1n << 5n;

export type DiscordOAuthGuild = {
  id: string;
  name: string;
  icon: string | null;
};

/** Guilds the OAuth token's owner can install the bot into — owner, or has Administrator /
 * Manage Server. providerToken is the short-lived Discord access token Supabase hands back
 * right after a "guilds"-scoped OAuth completion (session.provider_token); it isn't persisted
 * or refreshed, so this only works immediately after that OAuth round-trip. */
export async function listInstallableDiscordGuilds(providerToken: string): Promise<DiscordOAuthGuild[]> {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  if (res.status === 401) {
    throw new ApiError(401, "Your Discord permission grant expired — reconnect Discord and try again.");
  }
  if (!res.ok) {
    throw new ApiError(502, `Discord returned an error listing your servers (${res.status}).`);
  }
  const guilds = (await res.json()) as Array<{
    id: string;
    name: string;
    icon: string | null;
    owner?: boolean;
    permissions?: string;
  }>;
  return guilds
    .filter((guild) => {
      if (guild.owner) return true;
      const bits = BigInt(guild.permissions ?? "0");
      return (bits & PERMISSION_ADMINISTRATOR) !== 0n || (bits & PERMISSION_MANAGE_GUILD) !== 0n;
    })
    .map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
