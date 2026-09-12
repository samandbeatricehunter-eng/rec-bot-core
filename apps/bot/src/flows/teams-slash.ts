import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { buildTeamsMenuEmbed, buildTeamsMenuRows, MENU_CUSTOM_IDS, type TeamsMenuPage } from "../ui/menu.js";

// Team directory, per MATCHUPS_DISCORD_RULES.md's /teams spec: conference grouping,
// claimed/open state, owner, record/OVR where appropriate, with Open Teams/Request
// Team/Waitlist/View Rosters actions. Reuses the same conference data and embed/button
// builders as the main menu's "Teams" button (rosters.ts's renderTeamsMenu) since both
// need the identical claimed/open team directory -- only the entry point differs.
export async function handleTeamsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
    const conferences: any[] = confData?.conferences ?? [];
    const hasTeams = conferences.some((c) => (c.divisions ?? []).some((d: any) => (d.teams ?? []).length));
    if (!hasTeams) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("No teams found for this league yet.")] });
      return;
    }

    const page = conferences.some((c) => c.conference === "NFC") ? "NFC" : String(conferences[0]?.conference ?? "Teams");
    const rows = [
      ...buildTeamsMenuRows(page as TeamsMenuPage, conferences),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.viewUserProfiles).setLabel("View Rosters").setStyle(ButtonStyle.Secondary),
      ),
    ];

    await interaction.editReply({
      embeds: [buildTeamsMenuEmbed(conferences, page as TeamsMenuPage)],
      components: rows,
    });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load teams." });
  }
}
