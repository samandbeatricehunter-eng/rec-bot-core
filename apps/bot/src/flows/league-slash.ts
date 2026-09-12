import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { COLORS } from "../lib/colors.js";
import { env } from "../config/env.js";
import { recApi } from "../lib/rec-api.js";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "Not scheduled";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

// Compact league state, per MATCHUPS_DISCORD_RULES.md's /league spec: league, season/week/
// stage, advance status, GOTW, leaders, EA sync health, with deep links to the site's
// Overview/News/Matchups/Standings/Stats pages.
export async function handleLeagueSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const summary = await recApi.getLeagueSummary(interaction.guildId);
    const { league, advance, gotw, leaders, eaSync } = summary;

    const embed = new EmbedBuilder()
      .setTitle(league.name)
      .setColor(COLORS.info)
      .addFields(
        { name: "Season", value: `Season ${league.seasonNumber}, Week ${league.currentWeek}`, inline: true },
        { name: "Stage", value: league.seasonStageLabel ?? league.seasonStage, inline: true },
      );

    embed.addFields({
      name: "Advance Status",
      value: advance.nextAdvanceAt
        ? `Next advance ${formatTimestamp(advance.nextAdvanceAt)}`
        : advance.lastAdvanceAt
          ? `Last advance ${formatTimestamp(advance.lastAdvanceAt)}. Next advance not scheduled.`
          : "No advance scheduled yet.",
      inline: false,
    });

    embed.addFields({
      name: "Game of the Week",
      value: gotw ? `${gotw.matchupTitle}${gotw.strengthRating != null ? ` (${gotw.strengthRating.toFixed(1)} rating)` : ""}` : "Not selected yet",
      inline: false,
    });

    if (leaders.length) {
      embed.addFields({
        name: "Leaders",
        value: leaders
          .map((t: any) => `${t.rank}. **${t.teamName}**${t.ownerLabel ? ` — ${t.ownerLabel}` : ""} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""})`)
          .join("\n"),
        inline: false,
      });
    }

    embed.addFields({
      name: "EA Sync Health",
      value: eaSync.lastSyncedAt ? `Last roster sync ${formatTimestamp(eaSync.lastSyncedAt)}` : "No roster import found yet.",
      inline: false,
    });

    const siteBase = env.SITE_PUBLIC_URL.replace(/\/$/, "");
    const handoff = await recApi.mintAppHandoff({
      guildId: interaction.guildId,
      discordId: interaction.user.id,
      username: interaction.user.username,
      globalName: interaction.user.globalName ?? null,
    }).catch(() => null);

    const components = [];
    if (handoff?.token) {
      const linkFor = (dest?: string) => `${siteBase}/open-app?handoff=${encodeURIComponent(handoff.token)}${dest ? `&dest=${dest}` : ""}`;
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(linkFor()).setLabel("League Home"),
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(linkFor("news")).setLabel("League Headlines"),
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(linkFor("matchups")).setLabel("Game Day"),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(linkFor("standings")).setLabel("Division Standings"),
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(linkFor("stats")).setLabel("League Stats"),
        ),
      );
    }

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load league status." });
  }
}
