import { MessageFlags, type ButtonInteraction, type MessageReaction, type PartialMessageReaction, type User, type PartialUser } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { isDiscordAdminInteraction, isDiscordAdminMember } from "../lib/admin.js";
import { idAfter } from "./game-scheduling-panel.js";

export const TRADE_RELEASE_COINS_PREFIX = "rec:trade:release_coins:";

/** "Confirm Sent In-Game — Release Coins" button on a finalized-trades post. The API call itself
 * edits this message to strip the button once the release succeeds, so there's nothing more to
 * do here on success. */
export async function handleTradeReleaseCoinsButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only a commissioner can release trade coins.", flags: MessageFlags.Ephemeral });
    return;
  }
  const tradeId = idAfter(TRADE_RELEASE_COINS_PREFIX, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.releaseTradeCoinsAsBot({ guildId: interaction.guildId, tradeId, reviewerDiscordId: interaction.user.id });
  } catch (error) {
    await interaction.followUp({
      content: error instanceof Error ? error.message : "Couldn't release trade coins. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
  }
}

const CHECK = "✅";
const CROSS = "❌";

async function resolveVoteContext(reactionIn: MessageReaction | PartialMessageReaction, userIn: User | PartialUser) {
  if (userIn.bot) return null;
  let reaction = reactionIn;
  if (reaction.partial) {
    try { reaction = await reaction.fetch(); } catch { return null; }
  }
  if (reaction.emoji.name !== CHECK && reaction.emoji.name !== CROSS) return null;

  let message = reaction.message;
  if (message.partial) {
    const fetched = await message.fetch().catch(() => null);
    if (!fetched) return null;
    message = fetched;
  }
  if (!message.guild) return null;

  const member = await message.guild.members.fetch(userIn.id).catch(() => null);
  if (!member || !isDiscordAdminMember(member)) return null;

  return {
    guildId: message.guild.id,
    channelId: message.channelId,
    messageId: message.id,
    discordId: userIn.id,
    vote: reaction.emoji.name === CHECK ? ("approve" as const) : ("reject" as const),
  };
}

/** A commissioner/co-commissioner reacting ✅/❌ on a proposed-trades committee-vote post casts
 * their vote. Anything that isn't a valid elector's vote on a live vote message is a silent
 * no-op — including pulling the reaction back off if the API rejects it (already resolved, not
 * an elector, etc.) so a reaction that didn't count doesn't look like it did. */
export async function handleTradeVoteReactionAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  const ctx = await resolveVoteContext(reaction, user);
  if (!ctx) return;
  const lookup = await recApi.getTradeVoteMessageTradeId({ guildId: ctx.guildId, channelId: ctx.channelId, messageId: ctx.messageId }).catch(() => null);
  if (!lookup?.tradeId) return;
  try {
    await recApi.castTradeVoteAsBot({ guildId: ctx.guildId, tradeId: lookup.tradeId, vote: ctx.vote, reviewerDiscordId: ctx.discordId });
  } catch {
    await reaction.users.remove(user.id).catch(() => undefined);
  }
}

/** Un-reacting retracts a previously cast vote — never resolves the trade on its own (removing a
 * vote can't push the tally to "everyone voted"). */
export async function handleTradeVoteReactionRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  const ctx = await resolveVoteContext(reaction, user);
  if (!ctx) return;
  const lookup = await recApi.getTradeVoteMessageTradeId({ guildId: ctx.guildId, channelId: ctx.channelId, messageId: ctx.messageId }).catch(() => null);
  if (!lookup?.tradeId) return;
  await recApi.retractTradeVoteAsBot({ guildId: ctx.guildId, tradeId: lookup.tradeId, reviewerDiscordId: ctx.discordId }).catch(() => undefined);
}
