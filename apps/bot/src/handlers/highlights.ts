import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type AnyThreadChannel, type ButtonInteraction, type Guild, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel } from "../lib/route-channels.js";

export const HIGHLIGHT_REVIEW_PREFIX = "rec:highlight_review:";

import { HIGHLIGHT_AWARD_CATEGORY_LABELS, HIGHLIGHT_AWARD_EMOJIS, HIGHLIGHT_AWARD_KEYS, formatCoins } from "@rec/shared";

export const HIGHLIGHT_VOTE_EMOJIS = HIGHLIGHT_AWARD_EMOJIS;

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
  if (!highlightsChannelId || !isInHighlightsChannel(reaction.message as Message, highlightsChannelId)) return;

  for (const other of reaction.message.reactions.cache.values()) {
    if (other.emoji.id && other.emoji.id !== emojiId && HIGHLIGHT_VOTE_EMOJI_IDS.has(other.emoji.id)) {
      await other.users.remove(user.id).catch(() => undefined);
    }
  }
}

export async function handleHighlightChannelMessage(message: Message): Promise<boolean> {
  // Discord Highlights channel ingest is retired — registered users upload via site/PWA.
  void message;
  return false;
}

export async function syncRecentHighlightMessages(guild: Guild): Promise<void> {
  // Discord channel reconciliation retired with channel ingest.
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
