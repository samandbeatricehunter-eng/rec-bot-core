import { GuildMember, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
export function isDiscordAdminInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}
