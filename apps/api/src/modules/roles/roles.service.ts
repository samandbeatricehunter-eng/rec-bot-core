import type { RecManagedRoleKey } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { addMemberRole, ensureManagedRoleId, listGuildMembers, removeMemberRole } from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export async function listRoleMgmtMembers(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const assignments = await supabase.from("rec_team_assignments").select("user_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load linked users.", assignments.error);
  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id))];
  const accounts = userIds.length ? await supabase.from("rec_discord_accounts").select("discord_id").in("user_id", userIds) : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load linked Discord accounts.", accounts.error);
  const linkedIds = new Set((accounts.data ?? []).map((row) => row.discord_id));
  const members = await listGuildMembers(guildId);
  return { members: members.filter((m) => !m.isBot && linkedIds.has(m.discordId)).map((m) => ({ ...m, managedRole: m.managedRole ?? "member" })).sort((a, b) => a.displayName.localeCompare(b.displayName)) };
}

export async function setMemberRole(input: { guildId: string; discordId: string; roleKey: RecManagedRoleKey; actingDiscordId: string }) {
  if (input.discordId === input.actingDiscordId && input.roleKey !== "commissioner") throw new ApiError(400, "You can't remove your own Commissioner role from here.");
  try {
    const keys: RecManagedRoleKey[] = ["member", "compCommittee", "commissioner"];
    const ids = await Promise.all(keys.map(async (key) => [key, await ensureManagedRoleId(input.guildId, key)] as const));
    for (const [key, id] of ids) {
      if (key === input.roleKey) await addMemberRole(input.guildId, input.discordId, id, `REC League Mgmt role set by ${input.actingDiscordId}`);
      else await removeMemberRole(input.guildId, input.discordId, id, `REC League Mgmt role set by ${input.actingDiscordId}`);
    }
    return { ok: true, roleKey: input.roleKey };
  } catch (error) { throw new ApiError(502, "Discord rejected this role change — check the bot role hierarchy.", error); }
}

export async function updateMemberRole(input: {
  guildId: string;
  discordId: string;
  roleKey: RecManagedRoleKey;
  action: "add" | "remove";
  actingDiscordId: string;
}) {
  // A commissioner revoking their own Commissioner role would lock themselves out of every
  // full-commissioner-gated action on this dashboard with no way back in from here — the
  // Discord-native flow has no such guard (per code review), but there's no reason not to
  // add one on this newer surface.
  if (input.action === "remove" && input.roleKey === "commissioner" && input.discordId === input.actingDiscordId) {
    throw new ApiError(400, "You can't remove your own Commissioner role from here — have another commissioner do it, or use Discord.");
  }

  try {
    const roleId = await ensureManagedRoleId(input.guildId, input.roleKey);
    const reason = `REC League Mgmt Roles by ${input.actingDiscordId}`;
    if (input.action === "add") {
      await addMemberRole(input.guildId, input.discordId, roleId, reason);
    } else {
      await removeMemberRole(input.guildId, input.discordId, roleId, reason);
    }
    return { ok: true };
  } catch (error) {
    // Most likely cause: the bot's own role isn't positioned above the REC managed roles
    // in this guild's hierarchy anymore, so Discord rejects the add/remove outright.
    throw new ApiError(502, "Discord rejected this role change — the bot may need its role moved above the REC League roles in Server Settings > Roles.", error);
  }
}
