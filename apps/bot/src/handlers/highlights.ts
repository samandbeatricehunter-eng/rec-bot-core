import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type AnyThreadChannel, type ButtonInteraction, type Guild, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel } from "../lib/route-channels.js";

export const HIGHLIGHT_REVIEW_PREFIX = "rec:highlight_review:";

import { HIGHLIGHT_AWARD_CATEGORY_LABELS, HIGHLIGHT_AWARD_EMOJIS, HIGHLIGHT_AWARD_KEYS, formatCoins } from "@rec/shared";

export const HIGHLIGHT_VOTE_EMOJIS = HIGHLIGHT_AWARD_EMOJIS;

// Emoji ids only — used to detect/restrict the one-vote-per-highlight reactions.
export const HIGHLIGHT_VOTE_EMOJI_IDS = new Set<string>(Object.values(HIGHLIGHT_VOTE_EMOJIS).map((e) => e.id));

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

function isInHighlightsChannel(message: Pick<Message, "channelId" | "channel">, highlightsChannelId: string) {
  return message.channelId === highlightsChannelId ||
    ("parentId" in message.channel && message.channel.parentId === highlightsChannelId);
}

async function getHighlightsChannelId(guildId: string) {
  const config = await recApi.getEconomyConfig(guildId).catch(() => null);
  return config?.routes?.highlights_channel_id ?? null;
}

// One category vote per user per highlight: when a user adds one of the five
// vote emojis, remove any other vote emoji they had on that message (radio-button).
export async function handleHighlightReactionRestrict(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Highlight voting is website-only. Discord reactions are ordinary reactions
  // and never participate in category voting or payout calculations.
  void reaction;
  void user;
  return;
}

export async function handleHighlightChannelMessage(message: Message): Promise<boolean> {
  // Linked users' first two media attachments for the league week are ingested for
  // payout review and season hosting. Unlinked users may still post; the API declines persistence.
  if (!message.guildId || message.author.bot) return false;
  const highlightsChannelId = await getHighlightsChannelId(message.guildId);
  if (!highlightsChannelId || !isInHighlightsChannel(message, highlightsChannelId)) return false;
  const urls = mediaAttachments(message).map((attachment) => attachment.url).slice(0, 2);
  if (!urls.length) return true;
  // Unlinked users remain free to post; the API declines their ingest, so no
  // payout or retained season clip is created for them.
  for (const [index, url] of urls.entries()) {
    await recApi.recordHighlightPost({ guildId: message.guildId, discordId: message.author.id,
      discordChannelId: message.channelId, discordMessageId: message.id, attachmentIndex: index,
      messageUrl: message.url, content: url }).catch(() => null);
  }
  return true;
}

export async function syncRecentHighlightMessages(guild: Guild): Promise<void> {
  // Gateway message events are authoritative; no history polling is needed.
  void guild;
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
    for (const category of HIGHLIGHT_AWARD_KEYS) {
      const emoji = HIGHLIGHT_VOTE_EMOJIS[category as keyof typeof HIGHLIGHT_VOTE_EMOJIS] as { id: string } | undefined;
      const reaction = emoji ? (message.reactions.cache.get(emoji.id) ?? message.reactions.cache.find((r) => r.emoji.id === emoji.id)) : undefined;
      // Hub category reactions count toward Play of the Year; general like/dislike
      // reactions are deliberately absent from webReactionCounts and never affect awards.
      // Categories with no Discord voting emoji (see HIGHLIGHT_AWARD_WEB_ONLY) tally from
      // web reactions alone.
      const count = Number(highlight.webReactionCounts?.[category] ?? 0);
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
    const categoryLabel = HIGHLIGHT_AWARD_CATEGORY_LABELS[category] ?? category;
    const splitAmount = Math.round(POTY_AWARD_TOTAL / tied.length); // ties split the award evenly
    const tieNote = tied.length > 1 ? ` (tie — split ${tied.length} ways)` : "";

    for (const winner of tied) {
      const review = await recApi.createHighlightAwardReview({ guildId, category, highlightPostId: winner.id, voteCount: count, amount: splitAmount });
      const winnerMention = winner.authorId ? `<@${winner.authorId}>` : "Winning user";
      if (announcementsChannel?.isTextBased() && "send" in announcementsChannel) {
        await announcementsChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle(`${categoryLabel} Winner${tieNote}`)
            .setDescription([
              `**${categoryLabel} Winner:** ${winnerMention}`,
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
              `**Category:** ${categoryLabel}${tieNote}`,
              `**Winner:** ${winnerMention}`,
              `**Bonus:** ${formatCoins(splitAmount)}${tied.length > 1 ? ` (split of ${formatCoins(POTY_AWARD_TOTAL)})` : ""}`,
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
