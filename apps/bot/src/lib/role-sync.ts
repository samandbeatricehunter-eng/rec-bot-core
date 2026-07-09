import { Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import type { RecTeamAuthority } from "@rec/shared";

export const REC_MANAGED_ROLES = {
  member: { name: "REC League Member", color: 0x87ceeb },
  compCommittee: { name: "REC League Comp. Committee", color: 0xc27c0e },
  commissioner: { name: "REC League Commissioner", color: 0xd4af37 }
} as const;

export function formatTeamDisplayName(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
}, isCfb = false) {
  if (isCfb) return resolveCfbFullName(team);
  if (team.is_relocated && team.display_city && team.display_nick) {
    return `${team.display_city} ${team.display_nick}`;
  }
  return team.name ?? team.display_nick ?? "Team";
}

// CFB's "University Mascot" combo (e.g. "Arkansas State Red Wolves") — display_city/display_nick
// are populated for every CFB team at seed time (not just relocated/custom ones; see
// createDefaultTeamsForGuild), so the university always comes from display_city when present,
// falling back to name for older rows that predate that field.
function resolveCfbFullName(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
}): string {
  const university = (team.display_city ?? team.name ?? "").trim();
  const mascot = (team.display_nick ?? "").trim();
  const combined = mascot ? `${university} ${mascot}`.trim() : university;
  return combined || "Team";
}

/** Discord @nickname base: mascot only for Madden (never the city); "University Mascot" for CFB. */
export function resolveTeamNick(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
}, isCfb = false) {
  if (isCfb) return resolveCfbFullName(team);
  if (team.is_relocated && team.display_nick?.trim()) {
    return team.display_nick.trim();
  }
  return teamNickFromName(String(team.name ?? team.display_nick ?? "Team"));
}

// Nicknames use just the team name (e.g. "Cleveland Browns" -> "Browns"), not the city.
// NFL nicknames are the last word of the full name; single-word inputs pass through unchanged.
function teamNickFromName(teamName: string): string {
  const parts = teamName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : teamName.trim();
}

const DISCORD_NICKNAME_MAX_LENGTH = 32;

export function buildTeamNickname(teamName: string, authority: RecTeamAuthority) {
  return buildTeamNicknameFromNick(teamNickFromName(teamName), authority);
}

export function buildTeamNicknameFromNick(nick: string, authority: RecTeamAuthority) {
  const suffix = authority === "commissioner" ? " (Commissioner)" : authority === "co_commissioner" ? " (Co-Commissioner)" : "";
  // Truncate the base nick (not the whole result) so the authority suffix never gets cut off —
  // CFB's "University Mascot" nicknames can run long enough to hit Discord's 32-char nickname
  // limit, and setNickname() silently fails outright (caught upstream) if the string is too long.
  const maxNickLength = Math.max(0, DISCORD_NICKNAME_MAX_LENGTH - suffix.length);
  const trimmedNick = nick.length > maxNickLength ? nick.slice(0, maxNickLength).trim() : nick;
  return `${trimmedNick}${suffix}`;
}

export function buildTeamNicknameFromTeam(
  team: {
    name?: string | null;
    display_city?: string | null;
    display_nick?: string | null;
    is_relocated?: boolean | null;
  },
  authority: RecTeamAuthority,
  isCfb = false,
) {
  return buildTeamNicknameFromNick(resolveTeamNick(team, isCfb), authority);
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

async function orderRecRoles(guild: Guild, roles: { member: Role; compCommittee: Role; commissioner: Role }) {
  const botMember = guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return;
  }

  const botHighestPosition = botMember.roles.highest.position;
  const targetBasePosition = Math.min(botHighestPosition - 1, guild.roles.highest.position);

  if (targetBasePosition <= 0) {
    return;
  }

  await roles.commissioner
    .setPosition(targetBasePosition, { reason: "REC authority role hierarchy" })
    .catch(() => undefined);

  await roles.compCommittee
    .setPosition(Math.max(1, targetBasePosition - 1), { reason: "REC authority role hierarchy" })
    .catch(() => undefined);

  await roles.member
    .setPosition(Math.max(1, targetBasePosition - 2), { reason: "REC authority role hierarchy" })
    .catch(() => undefined);
}

export async function ensureRecBaseRoles(guild: Guild) {
  const roles = {
    member: await ensureRole(guild, REC_MANAGED_ROLES.member),
    compCommittee: await ensureRole(guild, REC_MANAGED_ROLES.compCommittee),
    commissioner: await ensureRole(guild, REC_MANAGED_ROLES.commissioner)
  };

  await orderRecRoles(guild, roles);
  return roles;
}

export async function syncMemberForTeam(input: {
  member: GuildMember;
  teamName: string;
  authority: RecTeamAuthority;
  team?: {
    name?: string | null;
    display_city?: string | null;
    display_nick?: string | null;
    is_relocated?: boolean | null;
  } | null;
  /** CFB nicknames show "University Mascot"; Madden nicknames show the mascot alone. */
  isCfb?: boolean;
}) {
  const roles = await ensureRecBaseRoles(input.member.guild);
  const rolesToAdd: Role[] = [roles.member];
  const rolesToRemove = [roles.member, roles.compCommittee, roles.commissioner]
    .filter((role) => input.member.roles.cache.has(role.id));

  if (input.authority === "co_commissioner" || input.authority === "commissioner") {
    rolesToAdd.push(roles.compCommittee);
  }

  if (input.authority === "commissioner") {
    rolesToAdd.push(roles.commissioner);
  }

  if (rolesToRemove.length) {
    await input.member.roles.remove(rolesToRemove, "REC team ownership role sync").catch(() => undefined);
  }
  await input.member.roles.add(rolesToAdd, "REC team ownership link").catch(() => undefined);

  const nickname = input.team
    ? buildTeamNicknameFromTeam(input.team, input.authority, input.isCfb)
    : buildTeamNickname(input.teamName, input.authority);
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
