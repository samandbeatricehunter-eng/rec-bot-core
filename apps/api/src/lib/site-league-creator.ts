import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { requireSiteUserSession } from "./site-auth.js";
import { supabase } from "./supabase.js";

// Hardcoded allowlist, same pattern as site-admin.ts — "Create League" from the public site
// (no Discord server required yet) is a brand-new, unreviewed surface, so it starts locked to
// one account while it gets exercised, before opening up to everyone. Keyed on the linked
// Discord account's username (the real Discord handle), not rec_users.username (a separate
// site-chosen display handle that could differ).
const SITE_LEAGUE_CREATOR_DISCORD_USERNAMES = new Set(["mrsixonthesticks"]);

export async function resolveSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string; discordUsername: string | null } | null> {
  const session = await requireSiteUserSession(request);
  const user = await supabase.from("rec_users").select("id").eq("supabase_auth_user_id", session.authUserId).maybeSingle();
  if (user.error || !user.data?.id) return null;
  const account = await supabase.from("rec_discord_accounts").select("username").eq("user_id", user.data.id).maybeSingle();
  return { userId: user.data.id, discordUsername: account.data?.username ?? null };
}

export function isAllowedLeagueCreator(discordUsername: string | null | undefined): boolean {
  if (!discordUsername) return false;
  return SITE_LEAGUE_CREATOR_DISCORD_USERNAMES.has(discordUsername.trim().toLowerCase());
}

export async function requireSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string }> {
  const resolved = await resolveSiteLeagueCreator(request);
  if (!resolved || !isAllowedLeagueCreator(resolved.discordUsername)) {
    throw new ApiError(403, "League creation from the site isn't open to your account yet.");
  }
  return { userId: resolved.userId };
}
