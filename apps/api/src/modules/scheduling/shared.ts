import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";

// Shared by every scheduling service — resolves a discordId (real or the synthetic "site:"
// form used by Discord-less site accounts, see league-context.service.ts) to the canonical
// rec_users.id everything in this system is keyed on.
export async function userIdFromDiscordId(discordId: string): Promise<string> {
  if (isSiteOnlyDiscordId(discordId)) return recUserIdFromSiteOnlyDiscordId(discordId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "REC account not found.");
  return String(account.data.user_id);
}

export async function logSchedulingEvent(input: { gameId: string; userId?: string | null; eventType: string; payload?: Record<string, unknown> }) {
  await supabase.from("rec_game_scheduling_events").insert({
    game_id: input.gameId,
    user_id: input.userId ?? null,
    event_type: input.eventType,
    payload: input.payload ?? {},
  }).then(({ error }) => {
    if (error) console.error("[ERROR] Failed to log scheduling event (non-fatal):", error);
  });
}
