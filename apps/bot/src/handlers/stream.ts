import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction, type TextChannel } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { buildStreamLinkModal, buildStreamRows, STREAM_CUSTOM_IDS } from "../ui/menu.js";

function serviceLabel(service: string) {
  if (service === "discord") return "Discord Live Stream";
  if (service === "youtube") return "YouTube";
  return service.charAt(0).toUpperCase() + service.slice(1);
}

function scheduleMatchup(schedule: any) {
  const leagueWeek = Number(schedule?.league?.current_week ?? 0);
  // Prefer the server-computed current matchup (resolves playoff weeks too).
  // Fall back to the regular-season games array by current week — but never to
  // games[0], which would mislabel the stream with Week 1's matchup.
  const game = schedule?.currentMatchup
    ?? (schedule?.games ?? []).find((row: any) => Number(row.weekNumber ?? 0) === leagueWeek);
  if (!game) return null;
  return {
    weekNumber: game.weekNumber ?? leagueWeek,
    awayTeamName: game.awayTeamName ?? "Away",
    homeTeamName: game.homeTeamName ?? "Home",
    matchupType: game.isH2h ? "H2H" : "CPU",
    userTeamName: schedule?.team?.name ?? null
  };
}

function matchupTitle(matchup: any) {
  if (!matchup) return "Week ? - Stream";
  return `Week ${matchup.weekNumber ?? "?"} - ${matchup.awayTeamName} VS ${matchup.homeTeamName} (${matchup.matchupType ?? "CPU"})`;
}

function boldUserTeam(matchup: any) {
  if (!matchup) return null;
  const userTeam = matchup.userTeamName;
  const away = userTeam && matchup.awayTeamName === userTeam ? `**${matchup.awayTeamName}**` : matchup.awayTeamName;
  const home = userTeam && matchup.homeTeamName === userTeam ? `**${matchup.homeTeamName}**` : matchup.homeTeamName;
  return `${away} VS ${home} (${matchup.matchupType ?? "CPU"})`;
}

async function getStreamsChannel(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  if (!interaction.guildId || !interaction.guild) return null;
  const config = await recApi.getEconomyConfig(interaction.guildId).catch(() => null);
  const channelId = config?.routes?.streams_channel_id;
  if (!channelId) return null;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel as TextChannel : null;
}

async function postPendingReview(interaction: StringSelectMenuInteraction | ModalSubmitInteraction, streamResult: any, matchup: any) {
  if (!interaction.guild || !streamResult?.needsReview || !streamResult.pendingPayoutsChannelId) return;
  const channel = await interaction.guild.channels.fetch(streamResult.pendingPayoutsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const mentions = [streamResult.commissionerRoleId, streamResult.compCommitteeRoleId].filter(Boolean).map((id: string) => `<@&${id}>`).join(" ");
  const matchupLine = boldUserTeam(streamResult.matchup ?? matchup) ?? matchupTitle(matchup);
  await channel.send({
    content: mentions || undefined,
    embeds: [new EmbedBuilder()
      .setTitle("STREAM PAYOUT REVIEW")
      .setDescription([
        `## ${matchupLine}`,
        "",
        `<@${interaction.user.id}> requested a stream payout.`,
        "Approve to issue the **$50** stream payout if they did stream their game. Otherwise, deny the request."
      ].join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rec:stream_review:approve:${streamResult.review?.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rec:stream_review:deny:${streamResult.review?.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { roles: [streamResult.commissionerRoleId, streamResult.compCommitteeRoleId].filter(Boolean) }
  }).catch(() => undefined);
}

export async function handleStreamMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Stream").setDescription([
      "Submit a stream for the current league week.",
      "",
      "A posted stream creates a commissioner payout review for **$50**. Only one stream payout can be pending, approved, or issued for you per game week.",
      "",
      "Choose **Discord Live Stream** if you are going live in Discord, or choose a service to paste a stream link."
    ].join("\n"))],
    components: buildStreamRows()
  });
}

export async function handleStreamServiceSelect(interaction: StringSelectMenuInteraction) {
  const service = interaction.values[0] ?? "other";
  if (service !== "discord") return interaction.showModal(buildStreamLinkModal(service));
  await interaction.deferUpdate();
  return submitStream(interaction, service, null);
}

export async function handleStreamLinkModal(interaction: ModalSubmitInteraction) {
  await interaction.deferUpdate();
  const service = interaction.customId.split(":").pop() ?? "other";
  const link = interaction.fields.getTextInputValue(STREAM_CUSTOM_IDS.linkInput).trim();
  if (!/^https?:\/\/\S+/i.test(link)) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Invalid Link").setDescription("Please submit a valid stream link beginning with http:// or https://.")],
      components: buildStreamRows()
    });
  }
  return submitStream(interaction, service, link);
}

async function submitStream(interaction: StringSelectMenuInteraction | ModalSubmitInteraction, service: string, link: string | null) {
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Submitting Stream...").setDescription("Posting your stream and checking weekly payout eligibility.")],
    components: []
  }).catch(() => undefined);
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stream").setDescription("This must be used inside a league server.")], components: buildStreamRows() });
  }
  const channel = await getStreamsChannel(interaction);
  if (!channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stream").setDescription("No streams channel is configured for this league.")], components: buildStreamRows() });
  }
  const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId).catch(() => null);
  if (!schedule?.isLinked) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stream").setDescription("You must be linked to a team before submitting a stream.")], components: buildStreamRows() });
  }
  const matchup = scheduleMatchup(schedule);
  if (!matchup) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stream").setDescription("No current matchup was found for your team.")], components: buildStreamRows() });
  }
  const title = matchupTitle(matchup);
  const publicMessage = await channel.send({
    content: "@everyone",
    embeds: [new EmbedBuilder()
      .setTitle(title)
      .setDescription([
        `Streamer: <@${interaction.user.id}>`,
        `Service: **${serviceLabel(service)}**`,
        link ? `[Watch Stream](${link})` : "Streaming live on Discord."
      ].join("\n"))],
    allowedMentions: { parse: ["everyone"] }
  });

  const streamResult = await recApi.recordStreamPost({
    guildId: interaction.guildId,
    discordId: interaction.user.id,
    discordChannelId: publicMessage.channelId,
    discordMessageId: publicMessage.id,
    messageUrl: link ?? publicMessage.url,
    content: link ? `${serviceLabel(service)} ${link}` : "Discord Live Stream",
    service,
    submissionType: link ? "link" : "discord_live"
  }).catch((error) => ({ recorded: false, reason: error instanceof Error ? error.message : String(error) }));

  await postPendingReview(interaction, streamResult, matchup);

  const status = streamResult?.alreadyPaid
    ? "Your stream was posted. You already have a stream payout pending or paid for this game week, so this one won't trigger another."
    : streamResult?.needsReview
      ? "Your stream was posted and sent to commissioners for a **$50** payout review. You'll be paid and notified once it's approved."
      : "Your stream was posted.";

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Stream Submitted").setDescription(status)],
    components: []
  });
}
