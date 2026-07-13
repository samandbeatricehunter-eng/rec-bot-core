import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type Guild, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type TextChannel, type User } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel } from "../lib/route-channels.js";

export const HIGHLIGHT_REVIEW_PREFIX = "rec:highlight_review:";

export const HIGHLIGHT_VOTE_EMOJIS = {
  TOTY: { label: "Throw of the Year", name: "BestThrow", id: "1519426233019011162" },
  COTY: { label: "Catch of the Year", name: "BestCatch", id: "1519426404213588148" },
  ROTY: { label: "Run of the Year", name: "BestRun", id: "1519427393364824217" },
  IOTY: { label: "Interception of the Year", name: "BestINT", id: "1519427729361997864" },
  HOTY: { label: "Hit of the Year", name: "BestHit", id: "1519429778761846914" },
} as const;

// Emoji ids only — used to detect/restrict the one-vote-per-highlight reactions.
export const HIGHLIGHT_VOTE_EMOJI_IDS = new Set<string>(Object.values(HIGHLIGHT_VOTE_EMOJIS).map((e) => e.id));

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

// One category vote per user per highlight: when a user adds one of the five
// vote emojis, remove any other vote emoji they had on that message (radio-button).
export async function handleHighlightReactionRestrict(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return;
  }
  const emojiId = reaction.emoji.id;
  if (!emojiId || !HIGHLIGHT_VOTE_EMOJI_IDS.has(emojiId)) return;
  const guildId = reaction.message.guildId ?? reaction.message.guild?.id ?? null;
  if (!guildId) return;
  const highlightsChannelId = await getHighlightsChannelId(guildId);
  if (!highlightsChannelId || reaction.message.channelId !== highlightsChannelId) return;

  for (const other of reaction.message.reactions.cache.values()) {
    if (other.emoji.id && other.emoji.id !== emojiId && HIGHLIGHT_VOTE_EMOJI_IDS.has(other.emoji.id)) {
      await other.users.remove(user.id).catch(() => undefined);
    }
  }
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

  const result = await recApi.recordHighlightPost({
    guildId: message.guildId,
    discordId: message.author.id,
    discordChannelId: message.channelId,
    discordMessageId: message.id,
    messageUrl: message.url,
    // Persist the actual attachment URL even when the post also has a caption; captions
    // are not playable and previously prevented the Hub from finding the video.
    content: mediaAttachments(message)[0]?.url || message.content || null,
  }).catch((error) => ({ recorded: false, reason: error instanceof Error ? error.message : String(error) }));

  // Posted outside an active season (before regular-season Wk 1 or after the
  // championship game) — highlights aren't accepted, so remove it and tell the user.
  if (result?.accepted === false) {
    await message.delete().catch(() => undefined);
    const notice = await message.channel.send({
      content: `<@${message.author.id}> ${result.reason ?? "Highlights are only accepted during an active season (regular-season Week 1 through the championship game)."}`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);
    if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 12_000);
    return true;
  }

  if (!result?.recorded) {
    await message.reply({
      content: `I couldn't record this highlight for payout review: ${result?.reason ?? "unknown error"}`,
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return true;
  }

  // Voting emojis only preload during the regular season. In the postseason
  // the payout is still logged, but POTY voting has already concluded.
  if (result.preloadEmojis !== false) {
    for (const emoji of Object.values(HIGHLIGHT_VOTE_EMOJIS)) {
      await message.react(emojiResolvable(emoji)).catch(() => undefined);
    }
  }

  if (result?.paidSlotAvailable === false) {
    await message.reply({
      content: "Highlight recorded for voting. You already have two paid highlight reviews for this game week, so this one will not trigger another $25 payout.",
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return true;
  }

  return true;
}

export async function syncRecentHighlightMessages(guild: Guild): Promise<void> {
  const highlightsChannelId = await getHighlightsChannelId(guild.id);
  if (!highlightsChannelId) return;
  const channel = await guild.channels.fetch(highlightsChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  if (!messages) return;
  const recent = [...messages.values()].filter((message) => !message.author.bot && clipCount(message) === 1).sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-5);
  for (const message of recent) {
    await recApi.recordHighlightPost({
      guildId: guild.id,
      discordId: message.author.id,
      discordChannelId: message.channelId,
      discordMessageId: message.id,
      messageUrl: message.url,
      content: mediaAttachments(message)[0]?.url || message.content || null,
    }).catch((error) => console.error(`[ERROR] Failed to reconcile highlight ${message.id} for guild ${guild.id}:`, error));
  }
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

const POTY_AWARD_TOTAL = 500;

export async function settleHighlightAwardsForGuild(guildId: string, client: Message["client"]) {
  const result = await recApi.listHighlightAwardCandidates(guildId);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { winners: [], alreadyFinalized: false };

  // Frozen: POTY already finalized this season — emoji changes no longer re-tally.
  if (result?.alreadyFinalized) {
    return { winners: [], alreadyFinalized: true };
  }

  const highlights = result?.highlights ?? [];
  // Per category, track the leading vote count and ALL highlights tied at it.
  const leaders = new Map<string, { count: number; highlights: any[] }>();

  for (const highlight of highlights) {
    const channel = await guild.channels.fetch(highlight.discord_channel_id).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(highlight.discord_message_id).catch(() => null);
    if (!message) continue;
    for (const [category, emoji] of Object.entries(HIGHLIGHT_VOTE_EMOJIS)) {
      const reaction = message.reactions.cache.get(emoji.id) ?? message.reactions.cache.find((r) => r.emoji.id === emoji.id);
      // Hub category reactions count toward Play of the Year; general like/dislike
      // reactions are deliberately absent from webReactionCounts and never affect awards.
      const count = Math.max(0, (reaction?.count ?? 0) - 1) + Number(highlight.webReactionCounts?.[category] ?? 0);
      if (count <= 0) continue;
      const entry = { ...highlight, messageUrl: message.url, authorId: message.author.id };
      const cur = leaders.get(category);
      if (!cur || count > cur.count) leaders.set(category, { count, highlights: [entry] });
      else if (count === cur.count) cur.highlights.push(entry);
    }
  }

  const created = [];
  const announcementsChannelId = result?.league?.announcementsChannelId ?? null;
  const pendingPayoutsChannelId = result?.league?.pendingPayoutsChannelId ?? null;
  const announcementsChannel = announcementsChannelId ? await getAnnouncementsChannel(guild, { announcements_channel_id: announcementsChannelId }) : null;
  const pendingPayoutsChannel = pendingPayoutsChannelId ? await guild.channels.fetch(pendingPayoutsChannelId).catch(() => null) : null;

  for (const [category, { count, highlights: tied }] of leaders) {
    const emoji = HIGHLIGHT_VOTE_EMOJIS[category as keyof typeof HIGHLIGHT_VOTE_EMOJIS];
    const splitAmount = Math.round(POTY_AWARD_TOTAL / tied.length); // ties split the $500 evenly
    const tieNote = tied.length > 1 ? ` (tie — split ${tied.length} ways)` : "";

    for (const winner of tied) {
      const review = await recApi.createHighlightAwardReview({ guildId, category, highlightPostId: winner.id, voteCount: count, amount: splitAmount });
      const winnerMention = winner.authorId ? `<@${winner.authorId}>` : "Winning user";
      if (announcementsChannel?.isTextBased() && "send" in announcementsChannel) {
        await announcementsChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle(`${emoji.label} Winner${tieNote}`)
            .setDescription([
              `**${emoji.label} Winner:** ${winnerMention}`,
              `Votes: **${count}**`,
              "",
              `[Open winning highlight](${winner.messageUrl ?? winner.message_url})`,
            ].join("\n"))]
        }).catch(() => undefined);
      }
      if (pendingPayoutsChannel?.isTextBased() && "send" in pendingPayoutsChannel && review?.review?.id) {
        await pendingPayoutsChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle("PLAY OF THE YEAR PAYOUT REVIEW")
            .setDescription([
              `**Category:** ${emoji.label}${tieNote}`,
              `**Winner:** ${winnerMention}`,
              `**Bonus:** $${splitAmount}${tied.length > 1 ? ` (split of $${POTY_AWARD_TOTAL})` : ""}`,
              `**Votes:** ${count}`,
              "",
              `[Open Highlight](${winner.messageUrl ?? winner.message_url})`,
              "",
              "Approve to issue the category bonus. Deny if the clip does not qualify for this category."
            ].join("\n"))],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}approve:${review.review.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${HIGHLIGHT_REVIEW_PREFIX}deny:${review.review.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
          )]
        }).catch(() => undefined);
      }
      created.push({ category, count, highlight: winner, review });
    }
  }
  return { winners: created, alreadyFinalized: false };
}
