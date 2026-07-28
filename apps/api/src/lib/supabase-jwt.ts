import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

// Verifies a Supabase Auth access token locally against the project's cached JWKS instead of
// calling supabase.auth.getUser(), which hits Supabase's Auth server over the network on
// every single call (site logs showed /auth/v1/user firing roughly every minute, often three
// times at once, across the site's polling components). createRemoteJWKSet caches the key set
// in-process and re-fetches only on a signing-key-id it hasn't seen before, so the steady-state
// cost is zero network calls.
//
// Trade-off (matches Supabase's own getClaims()-over-getUser() guidance): this only verifies
// the token's signature and claims (iss/exp/sub), not live revocation — a token from a session
// the user explicitly signed out of stays locally "valid" until its own (short) expiry. Any
// caller that genuinely needs the freshest Auth record (e.g. detecting a just-revoked session)
// should still call supabase.auth.getUser() directly.
const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`));
const issuer = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;

export type VerifiedSupabaseUser = { userId: string; email: string | null };

/** Returns the verified user, or null on any failure (expired, bad signature, JWKS fetch error, etc.) so the caller can fall back to a network-verified check. */
export async function verifySupabaseAccessToken(token: string): Promise<VerifiedSupabaseUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    const email = typeof payload.email === "string" ? payload.email : null;
    return { userId, email };
  } catch {
    return null;
  }
}
