import type { RecManagedRoleKey } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { addMemberRole, ensureManagedRoleId, listGuildMembers, removeMemberRole } from "../../lib/discord-guild.js";

export async function listRoleMgmtMembers(guildId: string) {
  const members = await listGuildMembers(guildId);
  return { members: members.filter((m) => !m.isBot).sort((a, b) => a.displayName.localeCompare(b.displayName)) };
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
