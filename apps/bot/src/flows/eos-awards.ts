import { EmbedBuilder, MessageFlags, type ActionRowBuilder, type ButtonBuilder, type ButtonInteraction, type Client, type Guild } from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel, getVotingPollsChannel } from "../lib/route-channels.js";

type EosAwardFlowContext = {
  buildRows: () => Array<ActionRowBuilder<ButtonBuilder>>;
  loadRouteChannels: (guildId: string) => Promise<Record<string, string | null | undefined>>;
};

function awardAnswerLabel(nominee: any) {
  return String(nominee.teamName ?? "Team").slice(0, 55);
}

function replyFullAdminOnly(interaction: ButtonInteraction, action: string) {
  const content = `Only Commissioners, Co-Commissioners, League Managers, or Discord Administrators can ${action}.`;
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function handleEosAwards(interaction: ButtonInteraction, context: EosAwardFlowContext) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run EOS awards");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Posting EOS Award Polls...").setDescription("Building award nominees from season stats, results, and linked user teams.")], components: [] });
  const routes = await context.loadRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Awards").setDescription("No voting polls channel is configured.")], components: context.buildRows() });
  }

  const cancelled = await recApi.cancelOpenEosAwardPolls({ guildId: interaction.guildId }).then((r) => r.cancelled ?? []).catch(() => []);
  let deletedOldPolls = 0;
  for (const poll of cancelled) {
    if (!poll.discord_channel_id || !poll.discord_message_id) continue;
    const pollChannel = await interaction.guild.channels.fetch(poll.discord_channel_id).catch(() => null);
    if (!pollChannel?.isTextBased()) continue;
    const pollMessage = await pollChannel.messages.fetch(poll.discord_message_id).catch(() => null);
    if (!pollMessage) continue;
    await pollMessage.delete().then(() => { deletedOldPolls += 1; }).catch(() => undefined);
  }

  const prepared = await recApi.prepareEosAwardNominees({ guildId: interaction.guildId });
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const posted: string[] = [];
  const skipped: string[] = [];
  for (const award of prepared.awards ?? []) {
    const nominees = award.nominees ?? [];
    if (!nominees.length) {
      skipped.push(`${award.label}: no nominees`);
      continue;
    }
    const msg = await channel.send({
      content: "@everyone",
      poll: {
        question: { text: `${award.label} - Season ${prepared.league?.seasonNumber ?? ""}`.slice(0, 300) },
        answers: nominees.map((nominee: any) => ({ text: awardAnswerLabel(nominee) })),
        duration: 24,
        allowMultiselect: false,
      },
      allowedMentions: { parse: ["everyone"] },
    } as any).catch(() => null);
    if (!msg) {
      skipped.push(`${award.label}: Discord post failed`);
      continue;
    }
    const recorded = await recApi.recordEosAwardPoll({
      guildId: interaction.guildId,
      categoryKey: award.key,
      discordChannelId: msg.channelId,
      discordMessageId: msg.id,
      closesAt,
      nominees,
    }).catch(() => null);
    if (recorded?.poll) {
      scheduleEosAwardSettlement(interaction.client, context, { ...recorded.poll, guildId: interaction.guildId });
      posted.push(award.label);
    } else {
      skipped.push(`${award.label}: DB record failed`);
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("EOS Award Polls Posted").setDescription([
      posted.length ? `Posted: ${posted.join(", ")}` : "Posted: none",
      skipped.length ? `Skipped: ${skipped.join("; ")}` : "Skipped: none",
      cancelled.length ? `Reissued: cancelled ${cancelled.length} previous open poll${cancelled.length === 1 ? "" : "s"} and deleted ${deletedOldPolls} old Discord message${deletedOldPolls === 1 ? "" : "s"}.` : "Reissued: no previous open polls found.",
      "Polls close in 24 hours. Winners are paid and announced automatically."
    ].join("\n"))],
    components: context.buildRows(),
  });
}

function scheduleEosAwardSettlement(client: Client, context: EosAwardFlowContext, poll: any) {
  if (!poll?.id || !poll.guildId || !poll.discord_channel_id || !poll.discord_message_id) return;
  const delay = Math.max(0, new Date(poll.closes_at ?? Date.now()).getTime() - Date.now());
  setTimeout(() => {
    settleEosAwardPoll(client, context, {
      pollId: poll.id,
      guildId: poll.guildId,
      channelId: poll.discord_channel_id,
      messageId: poll.discord_message_id,
    }).catch((error) => console.error("[ERROR] EOS award settlement failed:", error));
  }, Math.min(delay, 24 * 60 * 60 * 1000));
}

export async function recoverOpenEosAwardPolls(client: Client, context: EosAwardFlowContext) {
  const polls = await recApi.listOpenEosAwardPolls().then((r) => r.polls ?? []).catch((error) => {
    console.error("[ERROR] Failed to load open EOS award polls:", error);
    return [];
  });
  for (const poll of polls) scheduleEosAwardSettlement(client, context, poll);
}

async function settleEosAwardPoll(client: Client, context: EosAwardFlowContext, input: { pollId: string; guildId: string; channelId: string; messageId: string }) {
  const guild = await client.guilds.fetch(input.guildId).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(input.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(input.messageId).catch(() => null);
  if (!message?.poll) return;
  const poll = await (message.poll as any).end().catch(() => message.poll as any);
  const voteCounts: Record<string, number> = {};
  const voterDiscordIds: Record<string, string[]> = {};
  for (let index = 0; index < 10; index += 1) {
    const answer = poll.answers?.get(index + 1);
    if (!answer) continue;
    const voters = await answer.fetchVoters().catch(() => null);
    voteCounts[String(index)] = voters?.size ?? 0;
    voterDiscordIds[String(index)] = voters ? [...voters.values()].map((voter: any) => voter.id) : [];
  }
  const settled = await recApi.settleEosAwardPoll({ pollId: input.pollId, voteCounts, voterDiscordIds, discordMessageId: input.messageId });
  if (!settled?.alreadySettled && !settled?.skipped) await maybePostSeasonAwardsAnnouncement(guild, context, input.guildId);
}

async function maybePostSeasonAwardsAnnouncement(guild: Guild, context: EosAwardFlowContext, guildId: string) {
  const settled = await recApi.listSettledEosAwards({ guildId }).catch(() => null);
  const awards = settled?.awards ?? [];
  if (awards.length < 6) return;
  const routes = await context.loadRouteChannels(guildId);
  const channel = await getAnnouncementsChannel(guild, routes);
  if (!channel) return;
  const order = ["mvp", "best_passing_game", "best_rushing_game", "best_defense", "best_user_skills", "most_heart"];
  const lines = order.map((key) => {
    const award = awards.find((row: any) => row.category_key === key);
    const nominees = Array.isArray(award?.nominee_payloads) ? award.nominee_payloads : [];
    const winner = nominees.find((nominee: any) => nominee.userId === award?.winner_user_id);
    return `**${award?.category_label ?? key}:** ${winner?.discordId ? `<@${winner.discordId}>` : winner?.teamName ?? "Unknown"} (${winner?.teamName ?? "Team"})`;
  });
  await channel.send({
    content: "@everyone",
    embeds: [new EmbedBuilder().setTitle("Season Awards").setDescription(lines.join("\n")).setColor(COLORS.warning)],
    allowedMentions: { parse: ["everyone", "users"] },
  }).catch(() => undefined);
}
