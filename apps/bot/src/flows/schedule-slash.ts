import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { isRegularSeasonWeek, stageForWeek, stageLabel } from "@rec/shared";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import type { TeamScheduleGame } from "../ui/menu.js";

function formatScheduleStage(weekNumber: number | null | undefined, game: string | null) {
  if (weekNumber == null) return "Week ?";
  if (isRegularSeasonWeek(weekNumber, game)) return `Week ${weekNumber}`;
  return stageLabel(stageForWeek(weekNumber, game), weekNumber, game);
}

/** Slash /schedule row: completed games use strikethrough opponent + bold W/L/TIE + score. */
function formatSlashScheduleLine(game: TeamScheduleGame, leagueGame: string | null) {
  if (game.line) return game.line;
  if (game.isBye) return `${formatScheduleStage(game.weekNumber, leagueGame)}: BYE`;

  const completed = Boolean(game.isCompleted && game.homeScore != null && game.awayScore != null);
  const prefix = game.isHome ? "vs" : "@";
  const opponent = String(game.opponentLabel ?? (game.isHome ? game.awayTeamName : game.homeTeamName) ?? "Team").trim();

  if (completed) {
    const mine = Number(game.isHome ? game.homeScore : game.awayScore);
    const theirs = Number(game.isHome ? game.awayScore : game.homeScore);
    const result = mine > theirs ? "W" : mine < theirs ? "L" : "TIE";
    return `${formatScheduleStage(game.weekNumber, leagueGame)}: ~~${prefix} ${opponent}~~ **${result}** ${game.awayScore}-${game.homeScore}`;
  }

  return `${formatScheduleStage(game.weekNumber, leagueGame)}: ${prefix} ${opponent}`;
}

function chunkLines(lines: string[], maxLen = 3900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ["No schedule entries found for your team."];
}

export async function handleScheduleSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "Schedule is only available inside a league Discord server.", flags: MessageFlags.Ephemeral });
  }

  try {
    const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId);
    const leagueGame = schedule?.league?.game ?? null;
    const teamName = schedule?.team?.name ?? null;

    if (!schedule?.isLinked) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Schedule")
            .setColor(COLORS.gold)
            .setDescription("You are not linked to a team in this league. Run **/openteams** and use **Request Team**."),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!schedule.hasLoggedSchedule) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(teamName ? `${teamName} Schedule` : "Schedule")
            .setColor(COLORS.gold)
            .setDescription(`You are linked to **${teamName ?? "your team"}**, but no schedule has been logged for this season yet.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = (schedule.games ?? []).map((game: TeamScheduleGame) => formatSlashScheduleLine(game, leagueGame));
    const chunks = chunkLines(lines);
    const embeds = chunks.slice(0, 10).map((chunk, index) => {
      const embed = new EmbedBuilder()
        .setColor(COLORS.gold)
        .setDescription(chunk.slice(0, 4096));
      if (index === 0) {
        embed.setTitle(teamName ? `${teamName} Schedule` : "Schedule");
        if (schedule.league?.name) embed.setFooter({ text: String(schedule.league.name) });
      } else {
        embed.setTitle(`Schedule (cont. ${index + 1})`);
      }
      return embed;
    });

    return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  } catch (error) {
    return interaction.reply({ content: userFacingError(error), flags: MessageFlags.Ephemeral });
  }
}