import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";

function changeArrow(change: number | null): string {
  if (change == null) return "";
  if (change === 0) return " —";
  return change > 0 ? ` ▲${change}` : ` ▼${Math.abs(change)}`;
}

// Ephemeral by request — this is a quick personal check, not something meant to spam the channel.
export async function handlePowerRankingsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await recApi.getPowerRankings(interaction.guildId, interaction.user.id);
    const teams = (result.teams ?? []) as Array<{ teamName: string; rank: number; prevRank: number | null; change: number | null; ownerLabel?: string | null }>;
    if (!teams.length) {
      await interaction.editReply({ content: "No power rankings available yet." });
      return;
    }
    const lines = teams.map((team) => `${team.rank}. **${team.teamName}**${team.ownerLabel ? ` — ${team.ownerLabel}` : ""}${changeArrow(team.change)}`);
    const embed = new EmbedBuilder()
      .setTitle(`${result.league?.name ?? "League"} — Power Rankings`)
      .setColor(0xd9a521)
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Week ${result.currentWeek ?? "?"}` });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load power rankings." });
  }
}
