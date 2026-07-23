import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { ensureRecUserForAuthUser } from "../subscriptions/entitlements.service.js";
import type { ExchangeAppHandoffInput, MintWebSessionInput } from "./web-session.schemas.js";

const WEB_SESSION_TTL_SECONDS = 30 * 60;
const APP_HANDOFF_TTL_SECONDS = 10 * 60;
const APP_HANDOFF_PURPOSE = "app_handoff";

async function resolveOrProvisionUserId(input: MintWebSessionInput): Promise<string> {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to check Discord account.", account.error);
  if (account.data?.user_id) return account.data.user_id;

  const displayName = input.globalName ?? input.username;
  const user = await supabase
    .from("rec_users")
    .insert({ display_name: displayName, status: "active" })
    .select("id")
    .single();
  if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);

  const created = await supabase
    .from("rec_discord_accounts")
    .insert({ user_id: user.data.id, discord_id: input.discordId, username: input.username, global_name: input.globalName ?? null })
    .select("user_id")
    .single();
  if (created.error) throw new ApiError(500, "Failed to create Discord account link.", created.error);
  return created.data.user_id;
}

function requireJwtSecret(): string {
  if (!env.ACTIVITY_JWT_SECRET) throw new ApiError(500, "Web session auth is not configured (ACTIVITY_JWT_SECRET missing).");
  return env.ACTIVITY_JWT_SECRET;
}

function jwtKey() {
  return new TextEncoder().encode(requireJwtSecret());
}

async function signWebSessionToken(input: { discordId: string; guildId: string }) {
  return new SignJWT({ discordId: input.discordId, guildId: input.guildId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${WEB_SESSION_TTL_SECONDS}s`)
    .sign(jwtKey());
}

/** Build a browser hub URL for an already-linked Discord user + guild. */
export async function buildWebHubUrl(input: {
  discordId: string;
  guildId: string;
  /** Hash route after `#`, e.g. `/?section=league&subTab=buzz` */
  hashPath?: string;
  embed?: boolean;
}): Promise<{ hubUrl: string; token: string; expiresInSeconds: number }> {
  if (!env.WEB_APP_URL) {
    throw new ApiError(500, "WEB_APP_URL is not configured on the API.");
  }
  const token = await signWebSessionToken({
    discordId: input.discordId,
    guildId: input.guildId,
  });
  const hubBase = env.WEB_APP_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ token });
  if (input.embed) params.set("embed", "1");
  const hash = (input.hashPath ?? "/").replace(/^#/, "");
  const hubUrl = `${hubBase}/?${params.toString()}#${hash.startsWith("/") ? hash : `/${hash}`}`;
  return { hubUrl, token, expiresInSeconds: WEB_SESSION_TTL_SECONDS };
}

export async function mintWebSession(input: MintWebSessionInput) {
  await resolveOrProvisionUserId(input);
  const token = await signWebSessionToken({ discordId: input.discordId, guildId: input.guildId });
  return { token, expiresInSeconds: WEB_SESSION_TTL_SECONDS };
}

/** Short-lived Discord to site bridge token. Bot embeds this in /open-app?handoff= */
export async function mintAppHandoff(input: MintWebSessionInput) {
  requireJwtSecret();
  const token = await new SignJWT({
    purpose: APP_HANDOFF_PURPOSE,
    discordId: input.discordId,
    guildId: input.guildId,
    username: input.username,
    globalName: input.globalName ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${APP_HANDOFF_TTL_SECONDS}s`)
    .sign(jwtKey());

  return { token, expiresInSeconds: APP_HANDOFF_TTL_SECONDS };
}

type HandoffPayload = {
  purpose?: string;
  discordId?: string;
  guildId?: string;
  username?: string;
  globalName?: string | null;
};

async function verifyAppHandoff(handoff: string): Promise<{
  discordId: string;
  guildId: string;
  username: string;
  globalName: string | null;
}> {
  let payload: HandoffPayload;
  try {
    const verified = await jwtVerify(handoff, jwtKey());
    payload = verified.payload as HandoffPayload;
  } catch {
    throw new ApiError(401, "This Open my league link expired or is invalid. Run /app again in Discord.");
  }
  if (payload.purpose !== APP_HANDOFF_PURPOSE) {
    throw new ApiError(401, "Invalid Open my league link. Run /app again in Discord.");
  }
  if (typeof payload.discordId !== "string" || typeof payload.guildId !== "string") {
    throw new ApiError(401, "Invalid Open my league link. Run /app again in Discord.");
  }
  return {
    discordId: payload.discordId,
    guildId: payload.guildId,
    username: typeof payload.username === "string" ? payload.username : payload.discordId,
    globalName: typeof payload.globalName === "string" ? payload.globalName : null,
  };
}

/** Resolve the primary league linked to a Discord guild, if any. */
async function leagueIdForGuild(guildId: string): Promise<string | null> {
  const result = await getPgPool().query(
    `
      select link.league_id
      from rec_server_league_links link
      inner join rec_discord_servers s on s.id = link.server_id
      where s.guild_id = $1
      order by link.is_primary desc, link.created_at asc
      limit 1
    `,
    [guildId],
  );
  return (result.rows[0] as { league_id: string } | undefined)?.league_id ?? null;
}

async function userHasLeagueAccess(recUserId: string, leagueId: string): Promise<boolean> {
  const result = await getPgPool().query(
    `
      select 1
      where exists (
        select 1
        from rec_team_assignments ta
        where ta.user_id = $1
          and ta.league_id = $2
          and ta.assignment_status = 'active'
          and ta.ended_at is null
      )
      or exists (
        select 1
        from rec_league_memberships m
        where m.user_id = $1
          and m.league_id = $2
      )
      limit 1
    `,
    [recUserId, leagueId],
  );
  return Boolean(result.rows[0]);
}

/**
 * Exchange Discord /app handoff for a site deep-link (stays on rec-leagues.com).
 * No longer redirects into the Discord-JWT webapp.
 */
export async function exchangeAppHandoff(
  input: ExchangeAppHandoffInput & { authUserId: string; email: string | null },
) {
  const handoff = await verifyAppHandoff(input.handoff);
  const siteUserId = await ensureRecUserForAuthUser(input.authUserId, input.email);

  const siteDiscord = await supabase
    .from("rec_discord_accounts")
    .select("discord_id")
    .eq("user_id", siteUserId)
    .maybeSingle();
  if (siteDiscord.error) throw new ApiError(500, "Failed to load linked Discord account.", siteDiscord.error);
  if (siteDiscord.data?.discord_id && siteDiscord.data.discord_id !== handoff.discordId) {
    throw new ApiError(
      403,
      "Your REC Leagues account is linked to a different Discord user. Sign in with the matching account, or run /app from that Discord account.",
    );
  }

  const handoffDiscord = await supabase
    .from("rec_discord_accounts")
    .select("user_id, discord_id, user:rec_users(supabase_auth_user_id)")
    .eq("discord_id", handoff.discordId)
    .maybeSingle();
  if (handoffDiscord.error) throw new ApiError(500, "Failed to resolve Discord handoff.", handoffDiscord.error);

  if (handoffDiscord.data) {
    if (handoffDiscord.data.user_id !== siteUserId) {
      const linkedAuth = (handoffDiscord.data.user as { supabase_auth_user_id?: string | null } | null)
        ?.supabase_auth_user_id;
      if (linkedAuth) {
        throw new ApiError(403, "That Discord account is already linked to another REC Leagues account.");
      }
      return {
        status: "need_setup" as const,
        reason: "link_identity" as const,
        message: "Link your Discord identity on Account, then open your league again from Discord.",
      };
    }
  } else {
    const created = await supabase.from("rec_discord_accounts").insert({
      user_id: siteUserId,
      discord_id: handoff.discordId,
      username: handoff.username,
      global_name: handoff.globalName,
    });
    if (created.error) throw new ApiError(500, "Failed to link Discord account.", created.error);
  }

  const user = await supabase
    .from("rec_users")
    .select("username")
    .eq("id", siteUserId)
    .maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load REC profile.", user.error);
  if (!user.data?.username) {
    return {
      status: "need_setup" as const,
      reason: "username" as const,
      message: "Choose a username on Account to finish setup, then open your league again from Discord.",
    };
  }

  const leagueId = await leagueIdForGuild(handoff.guildId);
  if (leagueId && (await userHasLeagueAccess(siteUserId, leagueId))) {
    return {
      status: "ready" as const,
      sitePath: `/l/${leagueId}/buzz`,
      leagueId,
      guildId: handoff.guildId,
    };
  }

  return {
    status: "ready" as const,
    sitePath: "/home",
    leagueId: null,
    guildId: handoff.guildId,
  };
}