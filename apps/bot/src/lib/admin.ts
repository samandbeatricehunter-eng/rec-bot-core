import { GuildMember, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";

type AdminInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

function normalizedRoleName(roleName: string) {
  return roleName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasFullCommissionerRole(member: GuildMember): boolean {
  return member.roles.cache.some((role) => {
    const normalized = normalizedRoleName(role.name);
    return normalized === "commissioner" || normalized === "commissioners" || normalized === "rec league commissioner";
  });
}

function hasCoCommissionerRole(member: GuildMember): boolean {
  return member.roles.cache.some((role) => {
    const normalized = normalizedRoleName(role.name);
    return [
      "co commissioner",
      "co commissioners",
      "co commish",
      "co commishes",
      "rec league co commissioner",
      "rec league co commish",
      "rec league comp committee",
      "comp committee",
      "competition committee",
    ].includes(normalized);
  });
}

function getGuildMember(interaction: AdminInteraction) {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member;
  return member instanceof GuildMember ? member : false;
}

export function isFullLeagueAdminInteraction(interaction: AdminInteraction): boolean {
  const member = getGuildMember(interaction);
  if (!member) return false;
  return hasFullCommissionerRole(member) || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export function isCoCommissionerInteraction(interaction: AdminInteraction): boolean {
  const member = getGuildMember(interaction);
  if (!member) return false;
  return !isFullLeagueAdminInteraction(interaction) && hasCoCommissionerRole(member);
}

export function isDiscordAdminInteraction(interaction: AdminInteraction): boolean {
  return isFullLeagueAdminInteraction(interaction) || isCoCommissionerInteraction(interaction);
}
