import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
} from "discord.js";
import { isRegularSeasonWeek, stageLabel } from "@rec/shared";
import { isFullLeagueAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getRouteChannels, getVotingPollsChannel } from "../lib/route-channels.js";
import { MENU_CUSTOM_IDS } from "../ui/menu.js";

export const GOTW_CUSTOM_IDS = {
  select: "rec:advance:gotw_select",
  confirmPrefix: "rec:advance:gotw_confirm",
} as const;

export function teamDisplay(team: any) {
  if (!team) return "TBD";
  if (team.display_city || team.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return team.display_abbr ?? team.abbreviation ?? team.name ?? "Team";
}

// Nickname only (no city) — used for game channel names, e.g. "frost-bite-vs-cowboys".
export function teamNick(team: any) {
  if (!team) return "TBD";
  return team.display_nick ?? team.name ?? team.display_abbr ?? team.abbreviation ?? "Team";
}

export async function currentSchedule(interaction: ButtonInteraction) {
  const week = await recApi.viewLeagueWeek(interaction.guildId!);
  const seasonNumber = Number(week?.league?.season_number ?? week?.league?.display_season_number ?? 1);
  const currentWeek = Number(week?.league?.current_week ?? 1);
  const stage = String(week?.league?.season_stage ?? "regular_season");
  const game = week?.league?.game ?? null;
  const schedule = await recApi.listScheduleSeason({ guildId: interaction.guildId!, seasonNumber });
  const page = (schedule?.weeks ?? []).find((row: any) => Number(row.weekNumber) === currentWeek);
  const games = page?.games ?? [];
  return { seasonNumber, currentWeek, stage, game, games };
}

export async function handleGotwPollsMenu(interaction: ButtonInteraction, buildAdvanceBackRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "manage GOTW polls");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("GOTW Polls")
      .setDescription([
        "**Set GOTW** lets commissioners pick the current week's GOTW matchup.",
        "**Rerun Poll(s)** reposts current-week polls. In playoffs, it reruns every scheduled playoff game poll."
      ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetGotw).setLabel("Set GOTW").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtRerunGotw).setLabel("Rerun Poll(s)").setStyle(ButtonStyle.Danger),
      ),
      ...buildAdvanceBackRows(),
    ],
  });
}

export async function handleSetGotw(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading GOTW Matchups...").setDescription("Checking the active week's logged schedule for games where both teams have linked users.")], components: [] });
  const { currentWeek, stage, game, games } = await currentSchedule(interaction);
  const h2h = games.filter((g: any) => g.away_discord_id && g.home_discord_id);
  if (!h2h.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription(`No H2H matchups are scheduled for ${stageLabel(stage, currentWeek, game)}.`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary))]
    });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Select the current-week H2H matchup to post as Game of the Week.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(GOTW_CUSTOM_IDS.select)
          .setPlaceholder("Select GOTW matchup")
          .addOptions(h2h.slice(0, 25).map((game: any) => ({
            label: `${teamDisplay(game.away_team)} at ${teamDisplay(game.home_team)}`.slice(0, 100),
            value: game.id,
            description: `Week ${currentWeek}`.slice(0, 100)
          })))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary))
    ]
  });
}

export async function handleGotwSelect(interaction: any, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  // Selecting a matchup does NOT post immediately. Discord only fires this
  // interaction when the selected value changes, so re-picking the same option
  // would silently do nothing. We render an explicit Confirm step instead, which
  // also guards against accidentally publishing an @everyone poll.
  await interaction.deferUpdate();
  const selectedGameId = interaction.values[0];
  const { currentWeek, stage, game: leagueGame, games } = await currentSchedule(interaction as any);
  const game = games.find((g: any) => g.id === selectedGameId);
  if (!game) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("That matchup is no longer available. Reopen **Set GOTW** and try again.")], components: buildAdvanceRows() });
  }
  const awayLabel = teamDisplay(game.away_team);
  const homeLabel = teamDisplay(game.home_team);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Confirm Game of the Week").setDescription([
      `**${awayLabel} at ${homeLabel}**`,
      stageLabel(stage, currentWeek, leagueGame),
      "",
      "Confirming posts an @everyone poll to the voting polls channel asking members to pick the winner.",
    ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${GOTW_CUSTOM_IDS.confirmPrefix}:${selectedGameId}`).setLabel("Confirm & Post GOTW").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetGotw).setLabel("Pick Different Matchup").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// Posts one native Discord GOTW poll (away vs home) to the voting-polls channel
// and records it so the advance can settle it. Shared by the manual Set GOTW
// flow and the postseason auto-create. Returns true on success.
export async function postGotwPollForGame(args: { guildId: string; channel: any; game: any; weekNumber: number }): Promise<boolean> {
  const { guildId, channel, game, weekNumber } = args;
  const gameId = game.id;
  const awayTeamId = game.away_team?.id ?? game.away_team_id;
  const homeTeamId = game.home_team?.id ?? game.home_team_id;
  if (!gameId || !awayTeamId || !homeTeamId) return false;
  const awayLabel = teamDisplay(game.away_team).slice(0, 55);
  const homeLabel = teamDisplay(game.home_team).slice(0, 55);
  const pollDurationHours = 8;
  const expiresAt = new Date(Date.now() + pollDurationHours * 60 * 60 * 1000).toISOString();
  const pollMsg = await channel.send({
    content: "@everyone",
    poll: {
      question: { text: `Who will win this week's GOTW? ${awayLabel} at ${homeLabel}`.slice(0, 300) },
      answers: [
        { text: awayLabel },  // answer_id 1 = away
        { text: homeLabel },  // answer_id 2 = home
      ],
      duration: pollDurationHours,
      allowMultiselect: false,
    },
    allowedMentions: { parse: ["everyone"] },
  } as any).catch((err: unknown) => { console.error("[ERROR] Failed to post GOTW poll:", err); return null; });
  if (!pollMsg) return false;
  // Create DB record so the advance can settle this poll and pay out correct guessers.
  await recApi.createGotwPoll({
    guildId,
    gameId,
    awayTeamId,
    homeTeamId,
    awayUserId: game.away_user_id ?? null,
    homeUserId: game.home_user_id ?? null,
    awayTeamName: awayLabel,
    homeTeamName: homeLabel,
    discordChannelId: channel.id,
    discordMessageId: pollMsg.id,
    weekNumber,
    expiresAt,
  }).catch((err: unknown) => console.error("[ERROR] Failed to create GOTW poll record (non-fatal):", err));
  return true;
}

export async function handleGotwConfirm(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  await interaction.deferUpdate();
  const selectedGameId = interaction.customId.slice(`${GOTW_CUSTOM_IDS.confirmPrefix}:`.length);
  const { currentWeek, stage, game: leagueGame, games } = await currentSchedule(interaction as any);
  const game = games.find((g: any) => g.id === selectedGameId);
  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!game || !channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Unable to post GOTW poll. Check the selected game and voting polls channel.")], components: buildAdvanceRows() });
  }
  const posted = await postGotwPollForGame({ guildId: interaction.guildId, channel, game, weekNumber: currentWeek });
  if (!posted) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Unable to post GOTW poll. Check the selected game and voting polls channel.")], components: buildAdvanceRows() });
  }
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("GOTW Posted").setDescription(`Posted GOTW poll to the voting polls channel for ${stageLabel(stage, currentWeek, leagueGame)}.`)], components: buildAdvanceRows() });
}

export async function handleRerunGotwPolls(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "rerun GOTW polls");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rerunning GOTW Polls...").setDescription("Clearing old current-week GOTW poll records and preparing replacements.")], components: [] });

  const { currentWeek, stage, game: leagueGame, games } = await currentSchedule(interaction);
  const h2h = games.filter((g: any) => g.away_discord_id && g.home_discord_id);
  const cleared = await recApi.clearGotwPollsForWeek({ guildId: interaction.guildId, weekNumber: currentWeek }).catch(() => ({ cleared: 0, polls: [] as any[] }));
  let deletedMessages = 0;
  for (const poll of cleared.polls ?? []) {
    const channelId = poll.discord_channel_id;
    const messageId = poll.discord_message_id;
    if (!channelId || !messageId) continue;
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("messages" in channel)) continue;
    const deleted = await channel.messages.delete(messageId).then(() => true).catch(() => false);
    if (deleted) deletedMessages += 1;
  }

  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rerun GOTW Polls").setDescription("No voting polls channel is configured.")], components: buildAdvanceRows() });
  }

  const isPlayoff = !isRegularSeasonWeek(currentWeek, leagueGame);
  const oldGameIds = new Set((cleared.polls ?? []).map((poll: any) => poll.game_id).filter(Boolean));
  const gamesToPost = isPlayoff
    ? h2h
    : h2h.filter((game: any) => oldGameIds.has(game.id) || (oldGameIds.size === 0 && h2h.length === 1));

  if (!gamesToPost.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("Rerun GOTW Polls")
        .setDescription([
          `Cleared **${cleared.cleared ?? 0}** old poll record(s) and deleted **${deletedMessages}** Discord poll message(s).`,
          "",
          "No replacement poll was posted because there was no existing GOTW game to rerun. Use **Set GOTW** to pick the matchup."
        ].join("\n"))],
      components: buildAdvanceRows(),
    });
  }

  let posted = 0;
  const skipped: string[] = [];
  for (const game of gamesToPost) {
    const ok = await postGotwPollForGame({ guildId: interaction.guildId, channel, game, weekNumber: currentWeek });
    if (ok) posted += 1;
    else skipped.push(`${teamDisplay(game.away_team)} at ${teamDisplay(game.home_team)}`);
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("GOTW Polls Rerun")
      .setDescription([
        `Week: **${stageLabel(stage, currentWeek, leagueGame)}**`,
        `Cleared DB records: **${cleared.cleared ?? 0}**`,
        `Deleted old Discord messages: **${deletedMessages}**`,
        `Posted replacement polls: **${posted}**`,
        skipped.length ? `Skipped: ${skipped.join(", ")}` : "Skipped: none",
      ].join("\n"))],
    components: buildAdvanceRows(),
  });
}
