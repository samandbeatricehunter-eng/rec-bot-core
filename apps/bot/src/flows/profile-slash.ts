import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { formatCoins } from "@rec/shared";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";

// Ephemeral personal summary, per MATCHUPS_DISCORD_RULES.md's /profile spec: team, record,
// current matchup, Coins/Savings, progression, availability completeness. Badges/RTI
// identities are deliberately omitted -- the achievement badge system was removed from the
// repo (dead tables, dead CSS, dead assets) with no replacement, so there is nothing to show.
export async function handleProfileSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const profile = await recApi.getMenuProfile(interaction.user.id, interaction.guildId);
    const display = profile?.display ?? {};

    const embed = new EmbedBuilder()
      .setTitle(display.displayName ?? "Your Profile")
      .setColor(COLORS.info)
      .setThumbnail(interaction.user.displayAvatarURL());

    if (display.teamName) {
      embed.addFields({
        name: "Team",
        value: display.schoolName ? `${display.teamName} (${display.schoolName})` : display.teamName,
        inline: true,
      });
    } else {
      embed.addFields({ name: "Team", value: "No team linked", inline: true });
    }

    embed.addFields(
      { name: "Season Record", value: display.leagueSeasonRecordText ?? "—", inline: true },
      { name: "Role", value: display.highestRole ?? "Member", inline: true },
      { name: "Current Matchup", value: display.currentMatchupText ?? "None", inline: false },
    );

    if (display.opponentName) {
      embed.addFields({
        name: "Opponent",
        value: `${display.opponentName} (${display.opponentRecordText ?? "—"})${display.matchupType ? ` · ${display.matchupType}` : ""}`,
        inline: false,
      });
    }

    if (display.gotwStatus && display.gotwStatus !== "No") {
      embed.addFields({ name: "Game of the Week", value: display.gotwStatus, inline: false });
    }

    embed.addFields(
      { name: "Coins", value: formatCoins(display.wallet ?? 0), inline: true },
      { name: "Savings", value: formatCoins(display.savings ?? 0), inline: true },
      { name: "Streak", value: display.userStreakText ?? "—", inline: true },
    );

    embed.addFields(
      { name: "All-Time Record", value: display.globalRecordText ?? "—", inline: true },
      { name: "Championships", value: String(display.globalChampionships ?? 0), inline: true },
      { name: "GOTW Voting", value: display.gotwVotingRecordText ?? "No votes yet", inline: true },
    );

    embed.addFields({
      name: "Account",
      value: display.accountComplete
        ? "Complete — linked to a REC Leagues site account"
        : profile?.discord
          ? "Incomplete — link your site account for full features"
          : "Incomplete",
      inline: false,
    });

    embed.setFooter({ text: `${display.leagueName ?? "League"} · Season ${display.seasonNumber ?? 1}, Week ${display.currentWeek ?? 1}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load your profile." });
  }
}
