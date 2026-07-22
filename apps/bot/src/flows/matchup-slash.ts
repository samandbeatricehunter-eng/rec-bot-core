import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

export async function handleMatchupSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "Matchup is only available inside a league Discord server.", flags: MessageFlags.Ephemeral });
  }

  try {
    const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId);
    const embed = new EmbedBuilder().setTitle("Current Matchup").setColor(COLORS.gold);

    if (!schedule?.isLinked) {
      return interaction.reply({
        embeds: [embed.setDescription("You are not linked to a team in this league. Run **/openteams** and use **Request Team**.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!schedule.hasLoggedSchedule) {
      return interaction.reply({
        embeds: [embed.setDescription(`You are linked to **${schedule.team?.name ?? "your team"}**, but no schedule has been logged for this season yet.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const currentWeek = Number(schedule.league?.currentWeek ?? schedule.league?.current_week ?? 0);
    const weekGame = (schedule.games ?? []).find((g: any) => Number(g.weekNumber) === currentWeek) ?? null;
    const matchup = schedule.currentMatchup ?? null;

    if ((!matchup && !weekGame) || (weekGame?.isBye && !matchup)) {
      if (weekGame?.isBye || (!matchup && currentWeek > 0)) {
        return interaction.reply({
          embeds: [embed.setDescription(`**Week ${currentWeek || "?"}** — BYE`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        embeds: [embed.setDescription("No matchup found for the current week.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const isHome = Boolean(matchup?.isHome ?? weekGame?.isHome);
    const opponent =
      matchup?.opponentLabel
      ?? weekGame?.opponentLabel
      ?? (isHome
        ? (matchup?.awayTeamName ?? weekGame?.awayTeamName)
        : (matchup?.homeTeamName ?? weekGame?.homeTeamName))
      ?? "Opponent";
    const myTeam = schedule.team?.name ?? "Your team";
    const homeScore = weekGame?.homeScore ?? null;
    const awayScore = weekGame?.awayScore ?? null;
    const completed = Boolean(weekGame?.isCompleted && homeScore != null && awayScore != null);

    const lines = [
      `**Week ${currentWeek || matchup?.weekNumber || "?"}**`,
      `**${myTeam}** ${isHome ? "vs" : "@"} ${opponent}`,
      isHome ? "Home" : "Away",
    ];

    if (completed) {
      const mine = Number(isHome ? homeScore : awayScore);
      const theirs = Number(isHome ? awayScore : homeScore);
      const result = mine > theirs ? "W" : mine < theirs ? "L" : "TIE";
      lines.push(`**${result}** ${awayScore}-${homeScore}`);
    } else {
      lines.push("Not yet played");
    }

    return interaction.reply({
      embeds: [embed.setDescription(lines.join("\n"))],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    return interaction.reply({ content: userFacingError(error), flags: MessageFlags.Ephemeral });
  }
}