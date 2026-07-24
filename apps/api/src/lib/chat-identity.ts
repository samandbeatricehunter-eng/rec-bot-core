import { ApiError } from "./errors.js";
import { supabase } from "./supabase.js";

type UserIdentityRow = { username?: string | null; display_name?: string | null; supabase_auth_user_id?: string | null } | null;
type DiscordIdentityRow = { username?: string | null; global_name?: string | null } | null;

// Precedence already established in hub.service.ts/user.service.ts: unique site username first,
// then live Discord name, then the (often placeholder) rec_users.display_name. "Registered"
// means linked to a Supabase Auth account, independent of whether a username is set yet.
export function resolveChatDisplay(user: UserIdentityRow, discord: DiscordIdentityRow) {
  const displayName = user?.username || discord?.global_name || discord?.username || user?.display_name || "REC Member";
  const isRegistered = Boolean(user?.supabase_auth_user_id);
  return { displayName, isRegistered };
}

export type ChatAuthor = { userId: string | null; displayName: string; isDiscordOnly: boolean };

// Shared author-resolution for league chat and game chat sends/ingests — two lookups (Discord
// account, then linked rec_users row) rather than a single embedded select, so the join shape
// never depends on guessing postgrest's FK-embed resolution.
export async function resolveChatAuthor(discordId: string): Promise<ChatAuthor> {
  const discordRes = await supabase.from("rec_discord_accounts").select("user_id,username,global_name").eq("discord_id", discordId).maybeSingle();
  if (discordRes.error) throw new ApiError(500, "Failed to load Discord account.", discordRes.error);
  const userId: string | null = discordRes.data?.user_id ?? null;

  let userRow: UserIdentityRow = null;
  if (userId) {
    const userRes = await supabase.from("rec_users").select("username,display_name,supabase_auth_user_id").eq("id", userId).maybeSingle();
    if (userRes.error) throw new ApiError(500, "Failed to load user identity.", userRes.error);
    userRow = userRes.data ?? null;
  }

  const { displayName, isRegistered } = resolveChatDisplay(userRow, discordRes.data ?? null);
  return { userId, displayName, isDiscordOnly: !isRegistered };
}
