import { SignJWT } from "jose";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getGuildMemberRoleNames } from "../../lib/discord-guild.js";
import type { ExchangeActivityAuthInput } from "./activity-auth.schemas.js";

const ACTIVITY_SESSION_TTL_SECONDS = 30 * 60;

type DiscordTokenResponse = { access_token: string; token_type: string };
type DiscordUser = { id: string; username: string; global_name: string | null };

async function exchangeDiscordCode(code: string): Promise<string> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    throw new ApiError(500, "Activity auth is not configured (DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET missing).");
  }
  // Activities' authorize() flow is SDK-mediated, not a browser redirect — no redirect_uri
  // is sent or expected here, unlike a traditional OAuth2 authorization-code exchange.
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
  });
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new ApiError(401, "Failed to exchange Discord authorization code.", await res.text().catch(() => undefined));
  const data = (await res.json()) as DiscordTokenResponse;
  return data.access_token;
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(401, "Failed to fetch Discord user identity.");
  return (await res.json()) as DiscordUser;
}

// Auto-provisions a bare rec_users/rec_discord_accounts row on first login (mirrors the
// inline pattern already used by team-ownership.service.ts's linkUserToTeam) — no team
// assignment is implied or created here; that still goes through the existing
// request/commissioner-approval flow.
async function resolveOrProvisionUserId(discordUser: DiscordUser): Promise<string> {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordUser.id)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to check Discord account.", account.error);
  if (account.data?.user_id) return account.data.user_id;

  const displayName = discordUser.global_name ?? discordUser.username;
  const user = await supabase
    .from("rec_users")
    .insert({ display_name: displayName, status: "active" })
    .select("id")
    .single();
  if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);

  const created = await supabase
    .from("rec_discord_accounts")
    .insert({ user_id: user.data.id, discord_id: discordUser.id, username: discordUser.username, global_name: discordUser.global_name })
    .select("user_id")
    .single();
  if (created.error) throw new ApiError(500, "Failed to create Discord account link.", created.error);
  return created.data.user_id;
}

export async function exchangeActivityAuthCode(input: ExchangeActivityAuthInput) {
  const accessToken = await exchangeDiscordCode(input.code);
  const discordUser = await fetchDiscordUser(accessToken);

  const roleNames = await getGuildMemberRoleNames(input.guildId, discordUser.id);
  if (roleNames === null) throw new ApiError(403, "You aren't a member of this Discord server.");

  await resolveOrProvisionUserId(discordUser);

  const token = await new SignJWT({ discordId: discordUser.id, guildId: input.guildId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ACTIVITY_SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(requireJwtSecret()));

  return {
    token,
    discordId: discordUser.id,
    guildId: input.guildId,
    username: discordUser.username,
    globalName: discordUser.global_name,
  };
}

function requireJwtSecret(): string {
  if (!env.ACTIVITY_JWT_SECRET) throw new ApiError(500, "Activity auth is not configured (ACTIVITY_JWT_SECRET missing).");
  return env.ACTIVITY_JWT_SECRET;
}
