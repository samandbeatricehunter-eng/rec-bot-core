import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";

// Reuses the same guildId-only snapshot /viewleague already fetches (apps/api/src/modules/
// public-league/public-league.service.ts getPublicLeagueSnapshot) — its `standings` field is
// exactly this: claimed teams, sorted by win% then wins, one flat list (not split by
// conference/division — /viewleague's own page doesn't split it either).
export async function handleStandingsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply();

  try {
    const snapshot = await recApi.getPublicLeagueSnapshot(interaction.guildId);
    const rows = (snapshot.standings ?? []) as Array<{ teamName: string; wins: number; losses: number; ties: number }>;
    if (!rows.length) {
      await interaction.editReply({ content: "No standings yet — no completed games this season." });
      return;
    }
    const lines = rows.map((row: any, index: number) => {
      const record = row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
      return `${index + 1}. **${row.teamName}** — ${record}`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`${snapshot.league.name} — Standings`)
      .setColor(0xd9a521)
      .setDescription(lines.join("\n"));
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load standings." });
  }
}
