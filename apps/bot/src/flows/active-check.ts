import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type Client,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getRouteChannels, getVotingPollsChannel } from "../lib/route-channels.js";

export const ACTIVE_CHECK_CUSTOM_IDS = {
  bootPrefix: "rec:active_check:boot:",
  editPrefix: "rec:active_check:edit:",
  editSelectPrefix: "rec:active_check:edit_select:",
  editPagePrefix: "rec:active_check:edit_page:",
} as const;

export async function handleActiveCheck(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run active checks");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Posting Active Check...").setDescription("Finding the voting channel and preparing the active-check poll.")], components: [] });
  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Active Check").setDescription("No voting polls channel is configured.")], components: buildAdvanceRows() });
  }
  const pollMessage = await channel.send({
    content: "@everyone Active check: you have 24 hours to respond to this poll or risk being removed from the league.",
    poll: {
      question: { text: "REC Active Check" },
      answers: [
        { text: "I'm Active" },
        { text: "Kick Me" },
      ],
      duration: 24,
      allowMultiselect: false,
    },
    allowedMentions: { parse: ["everyone"] }
  } as any);
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const created = await recApi.createActiveCheck({
    guildId: interaction.guildId,
    discordChannelId: pollMessage.channelId,
    discordMessageId: pollMessage.id,
    createdByDiscordId: interaction.user.id,
    closesAt,
  });
  const eventId = created.event.id;

  scheduleActiveCheckSettlement(interaction.client as Client, {
    id: eventId,
    guildId: interaction.guildId,
    discord_channel_id: pollMessage.channelId,
    discord_message_id: pollMessage.id,
    closes_at: closesAt,
  });

  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Active Check Posted").setDescription("The native Discord poll has been posted to the voting polls channel for 24 hours.")], components: buildAdvanceRows() });
}

function scheduleActiveCheckSettlement(client: Client, event: any) {
  if (!event?.id || !event.guildId || !event.discord_channel_id || !event.discord_message_id) return;
  const delay = Math.max(0, new Date(event.closes_at ?? Date.now()).getTime() - Date.now());
  setTimeout(() => {
    settleActiveCheckPoll(client, {
      eventId: event.id,
      guildId: event.guildId,
      channelId: event.discord_channel_id,
      messageId: event.discord_message_id,
    }).catch((error) => console.error("[ERROR] Active check settlement failed:", error));
  }, Math.min(delay, 24 * 60 * 60 * 1000));
}

export async function recoverOpenActiveChecks(client: Client) {
  const events = await recApi.listOpenActiveChecks().then((r) => r.events ?? []).catch((error) => {
    console.error("[ERROR] Failed to load open active checks:", error);
    return [];
  });
  for (const event of events) scheduleActiveCheckSettlement(client, event);
}

async function settleActiveCheckPoll(client: Client, input: { eventId: string; guildId: string; channelId: string; messageId: string }) {
  const guild = await client.guilds.fetch(input.guildId).catch(() => null);
  if (!guild) return;
  const routes = await getRouteChannels(input.guildId);
  const pollChannel = await guild.channels.fetch(input.channelId).catch(() => null);
  const commissionerChannelId = routes.commissioner_office_channel_id ?? routes.commissionerOfficeChannelId;
  const commissionerChannel = commissionerChannelId ? await guild.channels.fetch(commissionerChannelId).catch(() => null) : null;
  if (!pollChannel?.isTextBased()) {
    await recApi.markActiveCheckNeedsReview({ eventId: input.eventId, reason: "Poll channel was not fetchable." }).catch(() => undefined);
    if (commissionerChannel?.isTextBased()) await commissionerChannel.send({ embeds: [new EmbedBuilder().setTitle("Active Check Needs Review").setDescription("The persisted active-check poll channel could not be fetched after restart. Review Discord manually before booting users.")] }).catch(() => undefined);
    return;
  }
  const message = await pollChannel.messages.fetch(input.messageId).catch(() => null);
  if (!message?.poll) {
    await recApi.markActiveCheckNeedsReview({ eventId: input.eventId, reason: "Poll message was not fetchable." }).catch(() => undefined);
    if (commissionerChannel?.isTextBased()) await commissionerChannel.send({ embeds: [new EmbedBuilder().setTitle("Active Check Needs Review").setDescription("The persisted active-check poll message could not be fetched after restart. Review Discord manually before booting users.")] }).catch(() => undefined);
    return;
  }

  // Poll#end() resolves to the updated Message, not a Poll — unwrap .poll from it.
  const ended = await (message.poll as any).end().catch(() => null);
  const poll = ended?.poll ?? message.poll;
  const activeAnswer = poll.answers?.get(1);
  const kickAnswer = poll.answers?.get(2);
  const activeVoters = activeAnswer ? await activeAnswer.fetchVoters().catch(() => null) : null;
  const kickVoters = kickAnswer ? await kickAnswer.fetchVoters().catch(() => null) : null;
  const activeDiscordIds = [...(activeVoters?.values() ?? [])].map((user: any) => user.id);
  const kickMeDiscordIds = [...(kickVoters?.values() ?? [])].map((user: any) => user.id);
  const review = await recApi.settleActiveCheck({ eventId: input.eventId, activeDiscordIds, kickMeDiscordIds });

  if (!commissionerChannel?.isTextBased()) return;
  await commissionerChannel.send(buildActiveCheckReviewPayload(input.eventId, review.inactive ?? [], review.kickMe ?? []));
}

function listActiveCheckRows(rows: Array<{ label: string }>) {
  return rows.length ? rows.slice(0, 20).map((row) => `- ${row.label}`).join("\n") : "None";
}

function buildActiveCheckReviewPayload(eventId: string, inactive: Array<{ label: string }>, kickMe: Array<{ label: string }>) {
  const bootCount = inactive.length + kickMe.length;
  return {
    embeds: [new EmbedBuilder()
      .setTitle("Active Check Results")
      .setDescription([
        "**No response:**",
        listActiveCheckRows(inactive),
        "",
        "**Asked to be removed:**",
        listActiveCheckRows(kickMe),
      ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.bootPrefix}${eventId}`).setLabel(`Boot Listed (${bootCount})`).setStyle(ButtonStyle.Danger).setDisabled(bootCount === 0),
        new ButtonBuilder().setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.editPrefix}${eventId}:0`).setLabel("Edit Boot List").setStyle(ButtonStyle.Secondary).setDisabled(bootCount === 0),
      )
    ],
  };
}

export async function handleActiveCheckReviewButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "review active checks");
  const isBoot = interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.bootPrefix);
  const isPage = interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.editPagePrefix);
  const raw = interaction.customId.slice((isBoot ? ACTIVE_CHECK_CUSTOM_IDS.bootPrefix : isPage ? ACTIVE_CHECK_CUSTOM_IDS.editPagePrefix : ACTIVE_CHECK_CUSTOM_IDS.editPrefix).length);
  const [eventId, pageRaw] = raw.split(":");
  const page = Math.max(0, Number(pageRaw ?? 0) || 0);
  const review = await recApi.getActiveCheckReview(eventId).catch(() => null);
  if (!review) return interaction.reply({ content: "Active check review expired.", flags: MessageFlags.Ephemeral });

  if (!isBoot) {
    const allCandidates = [...(review.inactive ?? []), ...(review.kickMe ?? [])];
    const totalPages = Math.max(1, Math.ceil(allCandidates.length / 25));
    const safePage = Math.min(page, totalPages - 1);
    const candidates = allCandidates.slice(safePage * 25, safePage * 25 + 25);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("Edit Boot List").setDescription("Select users to keep. They will be removed from the boot list.")],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.editSelectPrefix}${eventId}`)
            .setPlaceholder(`Select users to keep (${safePage + 1}/${totalPages})`)
            .setMinValues(1)
            .setMaxValues(Math.max(1, candidates.length))
            .addOptions(...(candidates.length ? candidates.map((row: any) =>
              new StringSelectMenuOptionBuilder().setLabel(String(row.label).replace(/<@|>/g, "").slice(0, 100)).setValue(row.discordId)
            ) : [new StringSelectMenuOptionBuilder().setLabel("No users on this page").setValue("none")]))
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.editPagePrefix}${eventId}:${Math.max(0, safePage - 1)}`).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
          new ButtonBuilder().setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.editPagePrefix}${eventId}:${safePage + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
        )
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  const bootList = [...(review.inactive ?? []), ...(review.kickMe ?? [])];
  let unlinked = 0;
  for (const row of bootList as any[]) {
    await recApi.unlinkTeam({ guildId: interaction.guildId, teamId: row.teamId, requestedByDiscordId: interaction.user.id })
      .then(() => { unlinked += 1; })
      .catch(() => undefined);
  }
  await recApi.markActiveCheckBooted({ eventId, discordIds: bootList.map((row: any) => row.discordId).filter(Boolean) }).catch(() => undefined);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Active Check Boot Complete").setDescription(`Unlinked **${unlinked}** team user(s).`)],
    components: [],
  });
}

export async function handleActiveCheckEditSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "edit active check boot lists");
  const eventId = interaction.customId.slice(ACTIVE_CHECK_CUSTOM_IDS.editSelectPrefix.length);
  const keep = interaction.values.filter((value) => value !== "none");
  if (keep.length) await recApi.keepActiveCheckUsers({ eventId, discordIds: keep });
  await interaction.update({ content: "Boot list updated.", embeds: [], components: [] });
}
