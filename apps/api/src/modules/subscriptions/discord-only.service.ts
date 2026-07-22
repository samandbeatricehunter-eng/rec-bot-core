import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

/** Discord-only = rec_users row with no linked site account (no supabase_auth_user_id). */
export async function isDiscordOnlyUser(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("rec_users")
    .select("supabase_auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load user account status.", error);
  if (!data) throw new ApiError(404, "User not found.");
  return !data.supabase_auth_user_id;
}

const ECONOMY_SITE_REQUIRED_MESSAGE =
  "Link your Discord to a REC Leagues site account to use the coin economy (wagers, store, wallet transfers, and payout eligibility). Open the site and connect Discord from your account settings.";

export async function assertSiteAccountForEconomy(userId: string): Promise<void> {
  if (await isDiscordOnlyUser(userId)) {
    throw new ApiError(403, ECONOMY_SITE_REQUIRED_MESSAGE);
  }
}