import { GuildMember, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";

function hasCommissionerRole(member: GuildMember): boolean {
  return member.roles.cache.some((role) => {
    const normalized = role.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalized === "commissioner" || normalized === "commissioners" || normalized === "co commissioner";
  });
}

export function isDiscordAdminInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return false;
  return hasCommissionerRole(member) || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}
