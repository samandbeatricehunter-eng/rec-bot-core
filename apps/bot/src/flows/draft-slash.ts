import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

// /draft is registered per-guild only within ~1hr of the scheduled draft (or while it's
// live) — see apps/api/src/lib/discord-guild.ts syncGuildCommands and
// fantasy-draft.service.ts's schedule/commence/conclude/skip-to-end call sites. This is the
// only way to check in/out — the public live embed in announcements is read-only status,
// posted with an @everyone ping telling everyone to use this command.
const DRAFT_SLASH_CUSTOM_IDS = { toggle: "rec:draft_slash:toggle" } as const;

function buildEmbed(teamName: string, checkedIn: boolean) {
  return new EmbedBuilder()
    .setTitle("Fantasy Draft Check-In")
    .setColor(0xd9a521)
    .setDescription(
      checkedIn
        ? `You're checked in as **${teamName}** — your pick won't be skipped.`
        : `You are **NOT checked in** as **${teamName}**. Check in so your pick isn't skipped when it comes up.`,
    );
}

function buildComponents(checkedIn: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(DRAFT_SLASH_CUSTOM_IDS.toggle)
      .setStyle(checkedIn ? ButtonStyle.Danger : ButtonStyle.Success)
      .setLabel(checkedIn ? "Check Out" : "Check In"),
  );
}

export async function handleDraftSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const status = await recApi.getFantasyDraftSelfCheckinStatus(interaction.guildId, interaction.user.id);
    await interaction.editReply({ embeds: [buildEmbed(status.teamName, status.checkedIn)], components: [buildComponents(status.checkedIn)] });
  } catch (error) {
    await interaction.editReply({ content: `Couldn't load your check-in status: ${error instanceof Error ? error.message : String(error)}` });
  }
}

export async function handleDraftSlashToggleButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  try {
    const status = await recApi.getFantasyDraftSelfCheckinStatus(interaction.guildId, interaction.user.id);
    const result = await recApi.setFantasyDraftSelfCheckin(interaction.guildId, interaction.user.id, !status.checkedIn);
    await interaction.editReply({ embeds: [buildEmbed(status.teamName, result.checkedIn)], components: [buildComponents(result.checkedIn)] });
  } catch (error) {
    await interaction.followUp({ content: `Check-in failed: ${error instanceof Error ? error.message : String(error)}`, flags: MessageFlags.Ephemeral });
  }
}

export { DRAFT_SLASH_CUSTOM_IDS };
