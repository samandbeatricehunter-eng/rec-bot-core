import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export async function getUserBaselineByDiscordId(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id, discord_id, username, global_name").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account", account.error);
  if (!account.data) throw new ApiError(404, "Discord account not found in REC Core");
  const [user, globalRecord, wallet, legacyBaseline] = await Promise.all([
    supabase.from("rec_users").select("*").eq("id", account.data.user_id).single(),
    supabase.from("rec_global_user_records").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_wallets").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_legacy_user_baselines").select("*").eq("user_id", account.data.user_id).maybeSingle()
  ]);
  if (user.error) throw new ApiError(500, "Failed to load REC user", user.error);
  if (globalRecord.error) throw new ApiError(500, "Failed to load global record", globalRecord.error);
  if (wallet.error) throw new ApiError(500, "Failed to load wallet", wallet.error);
  if (legacyBaseline.error) throw new ApiError(500, "Failed to load legacy baseline", legacyBaseline.error);
  return { user: user.data, discord: account.data, globalRecord: globalRecord.data, wallet: wallet.data, legacyBaseline: legacyBaseline.data };
}
export async function getWalletByDiscordId(discordId: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);
  return { user: baseline.user, discord: baseline.discord, wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 } };
}
