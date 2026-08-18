import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { requireSiteUserSession } from "./site-auth.js";
import { supabase } from "./supabase.js";
import { getEntitlementSummary } from "../modules/subscriptions/entitlements.service.js";

export async function resolveSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string; email: string | null } | null> {
  const session = await requireSiteUserSession(request);
  const user = await supabase.from("rec_users").select("id").eq("supabase_auth_user_id", session.authUserId).maybeSingle();
  if (user.error || !user.data?.id) return null;
  return { userId: user.data.id, email: session.email ?? null };
}

// "Create League" from the public site (no Discord server required) launched locked to a
// single hardcoded email while the surface got exercised. Opened up 2026-08 to the real gate
// the Help page's FAQ always claimed: any account with an active Platinum subscription.
export async function isAllowedLeagueCreator(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const entitlements = await getEntitlementSummary(userId);
  return entitlements.tier === "platinum";
}

export async function requireSiteLeagueCreator(request: FastifyRequest): Promise<{ userId: string }> {
  const resolved = await resolveSiteLeagueCreator(request);
  if (!resolved || !(await isAllowedLeagueCreator(resolved.userId))) {
    throw new ApiError(403, "League creation from the site requires an active Platinum subscription.");
  }
  return { userId: resolved.userId };
}
