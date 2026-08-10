// Cross-league recruiting-board interactions: the "Open Teams" button and "Request Team"
// select menu on each league's live-edited ad in the management guild's league-post channels.
// The requester is NOT necessarily in the advertised league's own Discord server (that's the
// point of the ad) — everything here is scoped by an explicit leagueId embedded in the customId
// rather than interaction.guildId.
import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

export const RECRUITING_BOARD_CUSTOM_IDS = {
  openPrefix: "rec:board:open",
  requestPrefix: "rec:board:request",
} as const;

function parseLeagueId(customId: string, prefix: string) {
  return customId.slice(`${prefix}:`.length);
}

export async function handleRecruitingBoardOpenTeams(interaction: ButtonInteraction) {
  const leagueId = parseLeagueId(interaction.customId, RECRUITING_BOARD_CUSTOM_IDS.openPrefix);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const data = await recApi.getRecruitingBoardOpenTeams(leagueId);
    if (!data.openTeams.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(data.leagueName).setDescription("Every team in this league is already taken or has a pending request.")] });
      return;
    }
    const byConference = new Map<string, string[]>();
    for (const team of data.openTeams) {
      const key = team.conference || "Open Teams";
      const list = byConference.get(key) ?? [];
      list.push(team.division ? `${team.name} (${team.division})` : team.name);
      byConference.set(key, list);
    }
    const embed = new EmbedBuilder()
      .setTitle(`${data.leagueName} — Open Teams`)
      .setDescription("Use the Request Team dropdown on the league post to claim one.");
    for (const [conference, teams] of byConference) {
      embed.addFields({ name: conference, value: teams.slice(0, 25).join("\n").slice(0, 1024) || "—", inline: true });
    }
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}

export async function handleRecruitingBoardRequestSelect(interaction: StringSelectMenuInteraction) {
  const leagueId = parseLeagueId(interaction.customId, RECRUITING_BOARD_CUSTOM_IDS.requestPrefix);
  const teamId = interaction.values[0]!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const created = await recApi.createRecruitingBoardTeamRequest({ leagueId, discordId: interaction.user.id, teamId });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Sent")
          .setDescription(`Your request for **${created.teamName}** in **${created.leagueName}** was sent to that league's commissioners. You'll be notified once it's reviewed.`),
      ],
    });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}
