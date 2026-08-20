// Signs/verifies the short-lived token the Playwright matchup-card render pipeline uses so
// apps/site's chromeless /render/matchup/:gameId route can fetch render data with no signed-in
// viewer. Same createHmac("sha256", secret).digest("hex") idiom as
// verifyStreamWebhookSignature (cloudflare-stream.ts), just with our own message format.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const TOKEN_TTL_SECONDS = 60;

function renderSecret(): string {
  const secret = env.MATCHUP_RENDER_SECRET?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("No secret available to sign matchup render tokens.");
  return secret;
}

export function signMatchupRenderToken(gameId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sig = createHmac("sha256", renderSecret()).update(`${gameId}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${sig}`;
}

export function verifyMatchupRenderToken(gameId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAtRaw, sig] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !sig || !Number.isFinite(expiresAt)) return false;
  if (Math.floor(Date.now() / 1000) > expiresAt) return false;

  const expected = createHmac("sha256", renderSecret()).update(`${gameId}.${expiresAt}`).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
