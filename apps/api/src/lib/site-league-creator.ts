import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { requireSiteUserSession } from "./site-auth.js";
import { supabase } from "./supabase.js";

// Hardcoded allowlist, same pattern as site-admin.ts — "Create League" from the public site
// (no Discord server required yet) is a brand-new, unreviewed surface, so it starts locked to
// one account while it gets exercised, before opening up to everyone. Keyed on the site
// account's login email (stable, same anchor site-admin.ts uses) rather than any username —
// this was previously keyed on the linked Discord account's username, which didn't match the
// site username "MrSixOnTheSticks" and silently locked the creator out of their own feature.
const SITE_LEAGUE_CREATOR_EMAILS = new Set(["samuelpatrickhunter@icloud.com"]);

export async function resolveSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string; email: string | null } | null> {
  const session = await requireSiteUserSession(request);
  const user = await supabase.from("rec_users").select("id").eq("supabase_auth_user_id", session.authUserId).maybeSingle();
  if (user.error || !user.data?.id) return null;
  return { userId: user.data.id, email: session.email ?? null };
}

export function isAllowedLeagueCreator(email: string | null | undefined): boolean {
  if (!email) return false;
  return SITE_LEAGUE_CREATOR_EMAILS.has(email.trim().toLowerCase());
}

export async function requireSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string }> {
  const resolved = await resolveSiteLeagueCreator(request);
  if (!resolved || !isAllowedLeagueCreator(resolved.email)) {
    throw new ApiError(403, "League creation from the site isn't open to your account yet.");
  }
  return { userId: resolved.userId };
}
