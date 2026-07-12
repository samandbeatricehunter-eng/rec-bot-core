import { GuildMember, MessageFlags, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type PrimaryEntryPointCommandInteraction, type StringSelectMenuInteraction } from "discord.js";
import { classifyGuildRoleNames } from "@rec/shared";

type AdminInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | PrimaryEntryPointCommandInteraction;

function hasFullCommissionerRole(member: GuildMember): boolean {
  return classifyGuildRoleNames(member.roles.cache.map((role) => role.name)).isCommissioner;
}

function hasCoCommissionerRole(member: GuildMember): boolean {
  return classifyGuildRoleNames(member.roles.cache.map((role) => role.name)).isCoCommissioner;
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

export function replyFullAdminOnly(interaction: { reply: (options: any) => Promise<any> }, action: string) {
  return interaction.reply({
    content: `Only commissioners or server admins can ${action}.`,
    flags: MessageFlags.Ephemeral,
  });
}
