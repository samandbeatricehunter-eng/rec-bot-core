import { EmbedBuilder, type ButtonInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { buildScheduleEmbed, buildScheduleRows } from "../ui/menu.js";

export async function renderScheduleMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule").setDescription("Open /menu inside a REC Discord server to view league schedules.")],
      components: buildScheduleRows()
    });
  }

  const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId);
  return interaction.editReply({
    embeds: [
      buildScheduleEmbed({
        leagueName: schedule?.league?.name ?? null,
        teamName: schedule?.team?.name ?? null,
        isLinked: Boolean(schedule?.isLinked),
        games: schedule?.games ?? []
      })
    ],
    components: buildScheduleRows()
  });
}

export async function renderSchedulePlaceholder(interaction: ButtonInteraction, title: string, description: string) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description)],
    ephemeral: true
  });
}
