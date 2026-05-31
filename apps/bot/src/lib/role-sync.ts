import { Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import type { RecTeamAuthority } from "@rec/shared";

export const REC_MANAGED_ROLES = {
  member: { name: "REC League Member", color: 0x87ceeb },
  compCommittee: { name: "REC League Comp. Committee", color: 0x0b2f6b },
  commissioner: { name: "REC League Commissioner", color: 0xd4af37 }
} as const;

export function buildTeamNickname(teamName: string, authority: RecTeamAuthority) {
  if (authority === "commissioner") return `${teamName} (Commissioner)`;
  if (authority === "co_commissioner") return `${teamName} (Co-Commissioner)`;
  return teamName;
}

async function ensureRole(guild: Guild, input: { name: string; color: number }) {
  const existing = guild.roles.cache.find((role) => role.name === input.name);

  if (existing) {
    if (
      existing.color !== input.color &&
      guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)
    ) {
      await existing.edit({ color: input.color }).catch(() => undefined);
    }

    return existing;
  }

  return guild.roles.create({
    name: input.name,
    color: input.color,
    reason: "REC Core role sync"
  });
}

export async function ensureRecBaseRoles(guild: Guild) {
  return {
    member: await ensureRole(guild, REC_MANAGED_ROLES.member),
    compCommittee: await ensureRole(guild, REC_MANAGED_ROLES.compCommittee),
    commissioner: await ensureRole(guild, REC_MANAGED_ROLES.commissioner)
  };
}

export async function syncMemberForTeam(input: {
  member: GuildMember;
  teamName: string;
  authority: RecTeamAuthority;
}) {
  const roles = await ensureRecBaseRoles(input.member.guild);
  const rolesToAdd: Role[] = [roles.member];

  if (input.authority === "co_commissioner" || input.authority === "commissioner") {
    rolesToAdd.push(roles.compCommittee);
  }

  if (input.authority === "commissioner") {
    rolesToAdd.push(roles.commissioner);
  }

  await input.member.roles.add(rolesToAdd, "REC team ownership link").catch(() => undefined);

  const nickname = buildTeamNickname(input.teamName, input.authority);
  await input.member.setNickname(nickname, "REC team ownership link").catch(() => undefined);

  return {
    nickname,
    roleNames: rolesToAdd.map((role) => role.name)
  };
}

export async function clearBaseRecRoles(guild: Guild) {
  const managedRoleNames = Object.values(REC_MANAGED_ROLES).map((role) => role.name);
  const managedRoleNameSet = new Set<string>(managedRoleNames);
  const managedRoles = guild.roles.cache.filter((role) => managedRoleNameSet.has(role.name));

  await guild.members.fetch();

  let changedMembers = 0;

  for (const member of guild.members.cache.values()) {
    const rolesToRemove = member.roles.cache.filter((role) => managedRoles.has(role.id));

    if (rolesToRemove.size > 0) {
      await member.roles
        .remove([...rolesToRemove.values()], "REC admin clear active roles")
        .catch(() => undefined);
      changedMembers += 1;
    }
  }

  return {
    changedMembers,
    removedRoleNames: [...managedRoles.values()].map((role) => role.name)
  };
}
