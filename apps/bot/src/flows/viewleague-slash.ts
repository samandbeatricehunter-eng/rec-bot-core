import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { env } from "../config/env.js";
import { recApi } from "../lib/rec-api.js";

// Replaces the old /app dashboard hand-off for anyone who just wants a quick, shareable
// look at the league — no REC account or Discord link required to view the page itself.
export async function handleViewLeagueSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");
  let slug = interaction.guildId;
  try {
    slug = (await recApi.getPublicLeagueSnapshot(interaction.guildId)).league.slug;
  } catch (error) {
    console.error(`Failed to resolve league slug for /viewleague in guild ${interaction.guildId} (falling back to guild ID):`, error);
  }
  const url = `${base}/league/${slug}`;
  const embed = new EmbedBuilder()
    .setTitle("View This League")
    .setColor(0xd9a521)
    .setDescription(`[Open the public league page](${url})\n\nStatus, this week's matchups, linked teams, and season standings — no login required.`);
  await interaction.editReply({ embeds: [embed] });
}
