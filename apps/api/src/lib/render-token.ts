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

// Same idiom, reused for the Player of the Week render (apps/site's chromeless
// /render/player-of-week/:storyId route + apps/api/src/lib/player-of-week-render.ts) -- a
// distinct message prefix ("potw:") keeps this token type from ever being interchangeable
// with a matchup render token even if the two ids collided.
export function signPlayerOfWeekRenderToken(storyId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sig = createHmac("sha256", renderSecret()).update(`potw:${storyId}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${sig}`;
}

export function verifyPlayerOfWeekRenderToken(storyId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAtRaw, sig] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !sig || !Number.isFinite(expiresAt)) return false;
  if (Math.floor(Date.now() / 1000) > expiresAt) return false;

  const expected = createHmac("sha256", renderSecret()).update(`potw:${storyId}.${expiresAt}`).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Same idiom again for the NFL playoff bracket render (apps/site's chromeless
// /render/nfl-playoff-bracket/:leagueId route + apps/api/src/lib/nfl-playoff-bracket-render.ts),
// used for the Discord playoff-picture announcement image instead of a plain text link.
export function signNflPlayoffBracketRenderToken(leagueId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sig = createHmac("sha256", renderSecret()).update(`bracket:${leagueId}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${sig}`;
}

export function verifyNflPlayoffBracketRenderToken(leagueId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAtRaw, sig] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !sig || !Number.isFinite(expiresAt)) return false;
  if (Math.floor(Date.now() / 1000) > expiresAt) return false;

  const expected = createHmac("sha256", renderSecret()).update(`bracket:${leagueId}.${expiresAt}`).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
