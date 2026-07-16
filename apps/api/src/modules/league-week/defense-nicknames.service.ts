// "This Defense Needs a Name" EOS payout category — see economy.ts's
// defense_needs_a_name definition. Nicknames persist across seasons as long as a
// team keeps requalifying; retired (not deleted) the first season they don't, so
// the same slot reactivates (with a fresh name choice) if they earn it again later.

import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { sendDiscordDirectMessage } from "../../lib/discord-guild.js";

/** Call right after a "defense_needs_a_name" EOS payout item is issued for a team. */
export async function qualifyDefenseNickname(input: { leagueId: string; teamId: string; userId: string; seasonNumber: number }): Promise<void> {
  const existing = await supabase
    .from("rec_team_defense_nicknames")
    .select("*")
    .eq("league_id", input.leagueId)
    .eq("team_id", input.teamId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load defense nickname record.", existing.error);

  const now = new Date().toISOString();
  const wasInactiveOrNew = !existing.data || !existing.data.is_active;

  if (!existing.data) {
    const inserted = await supabase.from("rec_team_defense_nicknames").insert({
      league_id: input.leagueId, team_id: input.teamId, nickname: null,
      first_earned_season: input.seasonNumber, last_qualified_season: input.seasonNumber,
      is_active: true, updated_at: now,
    });
    if (inserted.error) throw new ApiError(500, "Failed to create defense nickname record.", inserted.error);
  } else {
    const updated = await supabase.from("rec_team_defense_nicknames").update({
      last_qualified_season: input.seasonNumber,
      is_active: true,
      // Reactivating after a retirement means a fresh name choice, not the old one back.
      nickname: wasInactiveOrNew && !existing.data.is_active ? null : existing.data.nickname,
      updated_at: now,
    }).eq("id", existing.data.id);
    if (updated.error) throw new ApiError(500, "Failed to update defense nickname record.", updated.error);
  }

  // Only DM when a fresh name is actually needed (brand new, or reactivated after retirement).
  // A team that already has an active name and just requalified keeps it silently.
  if (wasInactiveOrNew) {
    const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.userId).maybeSingle();
    if (account.data?.discord_id) {
      await sendDiscordDirectMessage(
        account.data.discord_id,
        "**Your defense earned \"This Defense Needs a Name\"!**\n\nHead to the Hub's My Team page to give your defense a nickname — it'll show up in headlines and articles about your team's defense until it stops qualifying.",
      ).catch((error) => console.error("[ERROR] Failed to DM defense-naming prompt (non-fatal):", error));
    }
  }
}

/** Call once when the league advances into the offseason — retires any nickname that didn't requalify this season. */
export async function retireStaleDefenseNicknames(leagueId: string, seasonNumber: number): Promise<void> {
  const { error } = await supabase
    .from("rec_team_defense_nicknames")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("is_active", true)
    .lt("last_qualified_season", seasonNumber);
  if (error) throw new ApiError(500, "Failed to retire stale defense nicknames.", error);
}

export async function setDefenseNickname(input: { guildId: string; discordId: string; teamId: string; nickname: string }): Promise<{ nickname: string }> {
  const trimmed = input.nickname.trim().slice(0, 60);
  if (!trimmed) throw new ApiError(400, "Nickname cannot be empty.");
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!account.data?.user_id) throw new ApiError(404, "Discord account not linked.");

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("team_id", input.teamId)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (!assignment.data) throw new ApiError(403, "You don't control this team.");

  const record = await supabase
    .from("rec_team_defense_nicknames")
    .select("id,team_id,is_active")
    .eq("team_id", input.teamId)
    .eq("is_active", true)
    .maybeSingle();
  if (record.error) throw new ApiError(500, "Failed to load defense nickname record.", record.error);
  if (!record.data) throw new ApiError(404, "This team doesn't currently qualify for a defense nickname.");

  const updated = await supabase.from("rec_team_defense_nicknames").update({ nickname: trimmed, updated_at: new Date().toISOString() }).eq("id", record.data.id);
  if (updated.error) throw new ApiError(500, "Failed to save defense nickname.", updated.error);
  return { nickname: trimmed };
}

/** Active nickname for a team, if any — used by the headline/story generator. */
export async function loadActiveDefenseNickname(teamId: string): Promise<string | null> {
  const { data } = await supabase.from("rec_team_defense_nicknames").select("nickname").eq("team_id", teamId).eq("is_active", true).maybeSingle();
  return data?.nickname ?? null;
}

/** Drives the "Name Your Defense" prompt on the My Team page. */
export async function getMyDefenseNicknameStatus(guildId: string, discordId: string): Promise<{ teamId: string; nickname: string | null; needsName: boolean } | null> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (!account.data?.user_id) return null;
  const assignment = await supabase.from("rec_team_assignments").select("team_id,league_id").eq("user_id", account.data.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.team_id) return null;
  const record = await supabase.from("rec_team_defense_nicknames").select("nickname,is_active").eq("team_id", assignment.data.team_id).eq("is_active", true).maybeSingle();
  if (!record.data) return null;
  return { teamId: assignment.data.team_id, nickname: record.data.nickname, needsName: !record.data.nickname };
}
