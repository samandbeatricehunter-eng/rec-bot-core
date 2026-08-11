// Cross-league recruiting-board interactions: the "League Settings" and "Request Team" buttons
// on each league's live-edited ad in the management guild's league-post channels. Both open a
// paginated ephemeral browser — Discord modals can only hold up to 5 text-input fields (no
// buttons, no select menus, no scrolling), so a real "browse this, then pick one" flow has to be
// an ephemeral message with Prev/Next buttons, not a modal. The requester is NOT necessarily in
// the advertised league's own Discord server (that's the point of the ad), so everything here is
// scoped by an explicit leagueId embedded in the customId rather than interaction.guildId.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

export const RECRUITING_BOARD_CUSTOM_IDS = {
  settingsPagePrefix: "rec:board:settings",
  requestPagePrefix: "rec:board:reqpage",
  requestPickPrefix: "rec:board:reqpick",
} as const;

function parseLeagueAndPage(customId: string, prefix: string): { leagueId: string; page: number } {
  const rest = customId.slice(`${prefix}:`.length);
  const parts = rest.split(":");
  return { leagueId: parts[0]!, page: Number(parts[1] ?? 0) || 0 };
}

function navRow(prefix: string, leagueId: string, page: number, pageCount: number): ActionRowBuilder<ButtonBuilder>[] {
  if (pageCount <= 1) return [];
  const prev = (page - 1 + pageCount) % pageCount;
  const next = (page + 1) % pageCount;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}:${leagueId}:${prev}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${prefix}:${leagueId}:${next}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function handleRecruitingBoardSettings(interaction: ButtonInteraction) {
  const { leagueId, page } = parseLeagueAndPage(interaction.customId, RECRUITING_BOARD_CUSTOM_IDS.settingsPagePrefix);
  const isFirstOpen = !interaction.replied && !interaction.deferred;
  try {
    const data = await recApi.getRecruitingBoardLeagueSettings(leagueId);
    const pageCount = data.pages.length;
    const current = data.pages[Math.min(page, pageCount - 1)]!;
    const embed = new EmbedBuilder()
      .setTitle(`${data.leagueName} — League Settings`)
      .setDescription(current.lines.join("\n"))
      .setFooter({ text: `${current.title} · Page ${Math.min(page, pageCount - 1) + 1}/${pageCount}` });
    const payload = { embeds: [embed], components: navRow(RECRUITING_BOARD_CUSTOM_IDS.settingsPagePrefix, leagueId, page, pageCount) };
    if (isFirstOpen) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.update(payload);
  } catch (error) {
    const content = userFacingError(error);
    if (isFirstOpen) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    else await interaction.update({ content, embeds: [], components: [] });
  }
}

export async function handleRecruitingBoardRequestPage(interaction: ButtonInteraction) {
  const { leagueId, page } = parseLeagueAndPage(interaction.customId, RECRUITING_BOARD_CUSTOM_IDS.requestPagePrefix);
  const isFirstOpen = !interaction.replied && !interaction.deferred;
  try {
    const data = await recApi.getRecruitingBoardGroupedTeams(leagueId);
    if (!data.groups.length) {
      const content = "No teams found for this league.";
      if (isFirstOpen) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      else await interaction.update({ content, embeds: [], components: [] });
      return;
    }
    const pageCount = data.groups.length;
    const group = data.groups[Math.min(page, pageCount - 1)]!;
    const lines = group.teams.map((team) => (team.open ? team.name : `~~${team.name}~~`));
    const embed = new EmbedBuilder()
      .setTitle(`${data.leagueName} — Request Team`)
      .setDescription(lines.join("\n") || "No teams in this group.")
      .setFooter({ text: `${group.groupLabel} · Page ${Math.min(page, pageCount - 1) + 1}/${pageCount}` });
    const openTeams = group.teams.filter((team) => team.open);
    const components = [...navRow(RECRUITING_BOARD_CUSTOM_IDS.requestPagePrefix, leagueId, page, pageCount)];
    if (openTeams.length) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${RECRUITING_BOARD_CUSTOM_IDS.requestPickPrefix}:${leagueId}`)
            .setPlaceholder(`Request an open team in ${group.groupLabel}`)
            .addOptions(openTeams.slice(0, 25).map((team) => new StringSelectMenuOptionBuilder().setLabel(team.name.slice(0, 100)).setValue(team.id))),
        ) as ActionRowBuilder<any>,
      );
    }
    const payload = { embeds: [embed], components };
    if (isFirstOpen) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.update(payload);
  } catch (error) {
    const content = userFacingError(error);
    if (isFirstOpen) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    else await interaction.update({ content, embeds: [], components: [] });
  }
}

export async function handleRecruitingBoardRequestPick(interaction: StringSelectMenuInteraction) {
  const leagueId = interaction.customId.slice(`${RECRUITING_BOARD_CUSTOM_IDS.requestPickPrefix}:`.length);
  const teamId = interaction.values[0]!;
  await interaction.deferUpdate();
  try {
    const created = await recApi.createRecruitingBoardTeamRequest({ leagueId, discordId: interaction.user.id, teamId });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Sent")
          .setDescription(`Your request for **${created.teamName}** in **${created.leagueName}** was sent to that league's commissioners. You'll be notified once it's reviewed.`),
      ],
      components: [],
    });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error), embeds: [], components: [] });
  }
}
