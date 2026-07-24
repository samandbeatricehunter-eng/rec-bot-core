import { REC_MANAGED_ROLES, type RecManagedRoleKey } from "@rec/shared";
import type { GuildMember, PartialGuildMember } from "discord.js";
import { recApi } from "../lib/rec-api.js";

export async function syncManagedRoleFromDiscord(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
  if (oldMember.roles.cache.map((role) => role.id).sort().join(",") === newMember.roles.cache.map((role) => role.id).sort().join(",")) return;
  const roleNames = new Set(newMember.roles.cache.map((role) => role.name));
  const roleKey: RecManagedRoleKey = roleNames.has(REC_MANAGED_ROLES.commissioner.name)
    ? "commissioner"
    : roleNames.has(REC_MANAGED_ROLES.compCommittee.name)
      ? "compCommittee"
      : "member";
  await recApi.syncDiscordMemberRole({ guildId: newMember.guild.id, discordId: newMember.id, roleKey });
}
