import { SignJWT } from "jose";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { MintWebSessionInput } from "./web-session.schemas.js";

const WEB_SESSION_TTL_SECONDS = 30 * 60;

// Auto-provisions a bare rec_users/rec_discord_accounts row on first mint (mirrors the
// inline pattern already used by team-ownership.service.ts's linkUserToTeam) — no team
// assignment is implied or created here; that still goes through the existing
// request/commissioner-approval flow.
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

// Mints a short-lived session for the web dashboard. Called by the bot only (guarded by
// the internal API key, same as every other bot-to-API route) after it has already
// verified the click via a real Discord interaction — that interaction is itself proof of
// guild membership, and the commissioner/co-commissioner permission check already ran
// before the bot decided to offer the button at all. No OAuth round-trip is needed: the
// bot already knows exactly who clicked and where.
export async function mintWebSession(input: MintWebSessionInput) {
  await resolveOrProvisionUserId(input);

  const token = await new SignJWT({ discordId: input.discordId, guildId: input.guildId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${WEB_SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(requireJwtSecret()));

  return { token, expiresInSeconds: WEB_SESSION_TTL_SECONDS };
}

function requireJwtSecret(): string {
  if (!env.ACTIVITY_JWT_SECRET) throw new ApiError(500, "Web session auth is not configured (ACTIVITY_JWT_SECRET missing).");
  return env.ACTIVITY_JWT_SECRET;
}
