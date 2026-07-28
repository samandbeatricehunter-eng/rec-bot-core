import type { FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";
import { verifySupabaseAccessToken } from "./supabase-jwt.js";

export type SiteUserSession = {
  authUserId: string;
  email: string | null;
};

const supabaseAuth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export async function requireSiteUserSession(
  request: FastifyRequest,
): Promise<SiteUserSession> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) throw new ApiError(401, "Missing or invalid site session.");

  // Local JWKS-based verification (no network call) covers the overwhelming majority of
  // requests; only fall back to the network-verified getUser() call when local verification
  // fails, so a valid session is never incorrectly rejected.
  const verified = await verifySupabaseAccessToken(token);
  if (verified) return { authUserId: verified.userId, email: verified.email };

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user?.id) {
    throw new ApiError(401, "Missing or invalid site session.");
  }
  return {
    authUserId: data.user.id,
    email: data.user.email ?? null,
  };
}
