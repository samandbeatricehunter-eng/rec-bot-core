import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type Message, type TextChannel } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

export const HIGHLIGHT_REVIEW_PREFIX = "rec:highlight_review:";

export const HIGHLIGHT_VOTE_EMOJIS = {
  TOTY: { label: "Throw of the Year", name: "TOTYMadden", id: "1518679624370880603" },
  COTY: { label: "Catch of the Year", name: "COTYMadden", id: "1518679314927714355" },
  ROTY: { label: "Run of the Year", name: "ROTYMadden", id: "1518680040265482373" },
  IOTY: { label: "Interception of the Year", name: "IOTYMadden", id: "1518680268578357488" },
  HOTY: { label: "Hit of the Year", name: "HOTYMadden", id: "1518680557553451069" },
} as const;

const VOTE_GUIDE = Object.values(HIGHLIGHT_VOTE_EMOJIS)
  .map((emoji) => `<:${emoji.name}:${emoji.id}> = ${emoji.label}`)
  .join("\n");

const CLIP_URL_RE = /https?:\/\/\S+/gi;

function emojiResolvable(emoji: { name: string; id: string }) {
  return `${emoji.name}:${emoji.id}`;
}

function mediaAttachments(message: Message) {
  return [...message.attachments.values()].filter((attachment) => {
    const contentType = attachment.contentType ?? "";
    const name = attachment.name ?? "";
    return contentType.startsWith("video/") ||
      contentType.startsWith("image/") ||
      /\.(mp4|mov|webm|mkv|avi|png|jpe?g|gif|webp)$/i.test(name);
  });
}

function clipCount(message: Message) {
  return mediaAttachments(message).length + ((message.content.match(CLIP_URL_RE) ?? []).length);
}

async function getHighlightsChannelId(guildId: string) {
  const config = await recApi.getEconomyConfig(guildId).catch(() => null);
  return config?.routes?.highlights_channel_id ?? null;
}

async function postPendingReview(message: Message, result: any) {
  if (!message.guild || !result?.review || !result.pendingPayoutsChannelId) return;
  const channel = await message.guild.channels.fetch(result.pendingPayoutsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const mentions = [result.commissionerRoleId, result.compCommitteeRoleId].filter(Boolean).map((id: string) => `<@&${id}>`).join(" ");
  await (channel as TextChannel).send({
    content: mentions || undefined,
    embeds: [new EmbedBuilder()
      .setTitle("HIGHLIGHT PAYOUT REVIEW")
      .setDescription([
        `<@${message.author.id}> posted a highlight eligible for a **$25** payout.`,
        "",
        `[Open Highlight](${message.url})`,
        "",
        "Approve to issue the payout. Deny if the clip is invalid or violates league rules."
      ].join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}approve:${result.review.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}deny:${result.review.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { roles: [result.commissionerRoleId, result.compCommitteeRoleId].filter(Boolean) }
  }).catch(() => undefined);
}

export async function handleHighlightChannelMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const highlightsChannelId = await getHighlightsChannelId(message.guildId);
  if (!highlightsChannelId || message.channelId !== highlightsChannelId) return false;

  const clips = clipCount(message);
  if (clips === 0) return false;
  if (clips > 1) {
    await message.delete().catch(() => undefined);
    await message.channel.send({
      content: `<@${message.author.id}> only one highlight can be posted at a time. Multiple entries require multiple posts.`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => undefined);
    return true;
  }

  for (const emoji of Object.values(HIGHLIGHT_VOTE_EMOJIS)) {
    await message.react(emojiResolvable(emoji)).catch(() => undefined);
  }

  await message.reply({
    embeds: [new EmbedBuilder()
      .setTitle("Play of the Year Voting")
      .setDescription([
        "Vote on this highlight with the reactions below:",
        "",
        VOTE_GUIDE,
        "",
        "A play voted as the winner of a category it does not actually qualify for can have that payout voided."
      ].join("\n"))]
  }).catch(() => undefined);

  const result = await recApi.recordHighlightPost({
    guildId: message.guildId,
    discordId: message.author.id,
    discordChannelId: message.channelId,
    discordMessageId: message.id,
    messageUrl: message.url,
    content: message.content || mediaAttachments(message)[0]?.url || null,
  }).catch((error) => ({ recorded: false, reason: error instanceof Error ? error.message : String(error) }));

  if (!result?.recorded) {
    await message.reply({
      content: `I couldn't record this highlight for payout review: ${result?.reason ?? "unknown error"}`,
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return true;
  }

  if (result?.paidSlotAvailable === false) {
    await message.reply({
      content: "Highlight recorded for voting. You already have two paid highlight reviews for this game week, so this one will not trigger another $25 payout.",
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return true;
  }

  await postPendingReview(message, result);
  return true;
}

export async function handleHighlightReviewButton(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can review highlight payouts.", flags: MessageFlags.Ephemeral });
  }
  const [, , actionPart, reviewId] = interaction.customId.split(":");
  const action = actionPart === "approve" ? "approve" : "deny";
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.reviewHighlightPayout({
    reviewId,
    action,
    reviewedByDiscordId: interaction.user.id,
    deniedReason: action === "deny" ? "Denied by commissioner review." : null,
  });
  await interaction.editReply(result.updated ? `Highlight payout ${action === "approve" ? "approved and issued" : "denied"}.` : (result.reason ?? "No update made."));

  if (result.updated && action === "approve" && result.highlight?.discord_channel_id && result.highlight?.discord_message_id && interaction.inCachedGuild()) {
    const sourceChannel = await interaction.guild.channels.fetch(result.highlight.discord_channel_id).catch(() => null);
    if (sourceChannel?.isTextBased()) {
      const sourceMessage = await sourceChannel.messages.fetch(result.highlight.discord_message_id).catch(() => null);
      await sourceMessage?.react("✅").catch(() => undefined);
    }
  }

  if (result.updated && interaction.message?.editable) {
    const embeds = interaction.message.embeds.map((embed) => {
      const builder = EmbedBuilder.from(embed);
      const current = embed.description ?? "";
      builder.setDescription([current, "", `**${action === "approve" ? "Approved" : "Denied"} by <@${interaction.user.id}>**`].filter(Boolean).join("\n"));
      return builder;
    });
    await interaction.message.edit({ embeds, components: [] }).catch(() => undefined);
  }
}

export async function settleHighlightAwardsForGuild(guildId: string, client: Message["client"]) {
  const result = await recApi.listHighlightAwardCandidates(guildId);
  const highlights = result?.highlights ?? [];
  const winners = new Map<string, { highlight: any; count: number }>();
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { winners: [] };

  for (const highlight of highlights) {
    const channel = await guild.channels.fetch(highlight.discord_channel_id).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(highlight.discord_message_id).catch(() => null);
      if (!message) continue;
    for (const [category, emoji] of Object.entries(HIGHLIGHT_VOTE_EMOJIS)) {
      const reaction = message.reactions.cache.get(emoji.id) ?? message.reactions.cache.find((r) => r.emoji.id === emoji.id);
      const count = Math.max(0, (reaction?.count ?? 0) - 1);
      const current = winners.get(category);
      if (!current || count > current.count) winners.set(category, { highlight: { ...highlight, messageUrl: message.url, authorId: message.author.id }, count });
    }
  }

  const created = [];
  const announcementsChannelId = result?.league?.announcementsChannelId ?? null;
  const pendingPayoutsChannelId = result?.league?.pendingPayoutsChannelId ?? null;
  const announcementsChannel = announcementsChannelId ? await guild.channels.fetch(announcementsChannelId).catch(() => null) : null;
  const pendingPayoutsChannel = pendingPayoutsChannelId ? await guild.channels.fetch(pendingPayoutsChannelId).catch(() => null) : null;

  for (const [category, winner] of winners) {
    const review = await recApi.createHighlightAwardReview({ guildId, category, highlightPostId: winner.highlight.id, voteCount: winner.count });
    const emoji = HIGHLIGHT_VOTE_EMOJIS[category as keyof typeof HIGHLIGHT_VOTE_EMOJIS];
    const winnerMention = winner.highlight.authorId ? `<@${winner.highlight.authorId}>` : "Winning user";
    if (announcementsChannel?.isTextBased() && "send" in announcementsChannel) {
      await announcementsChannel.send({
        embeds: [new EmbedBuilder()
          .setTitle(`${emoji.label} Winner`)
          .setDescription([
            `**${emoji.label} Winner:** ${winnerMention}`,
            `Votes: **${winner.count}**`,
            "",
            `[Open winning highlight](${winner.highlight.messageUrl ?? winner.highlight.message_url})`
          ].join("\n"))]
      }).catch(() => undefined);
    }
    if (pendingPayoutsChannel?.isTextBased() && "send" in pendingPayoutsChannel && review?.review?.id) {
      await pendingPayoutsChannel.send({
        embeds: [new EmbedBuilder()
          .setTitle("PLAY OF THE YEAR PAYOUT REVIEW")
          .setDescription([
            `**Category:** ${emoji.label}`,
            `**Winner:** ${winnerMention}`,
            `**Bonus:** $500`,
            `**Votes:** ${winner.count}`,
            "",
            `[Open Highlight](${winner.highlight.messageUrl ?? winner.highlight.message_url})`,
            "",
            "Approve to issue the category bonus. Deny if the clip does not qualify for this category."
          ].join("\n"))],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}approve:${review.review.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}deny:${review.review.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
        )]
      }).catch(() => undefined);
    }
    created.push({ category, ...winner, review });
  }
  return { winners: created };
}
