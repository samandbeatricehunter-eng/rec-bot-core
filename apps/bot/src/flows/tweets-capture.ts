// User Tweets channel: a human message posted in the configured Tweets channel is captured,
// the original removed, and a 90-second public Yes/No confirmation (gated to the source user)
// decides whether it publishes. Ordinary leagues publish as the user's own team; Rise to
// Immortality opens an ephemeral Offensive Prospect / Owner / Defensive Prospect picker first.
// No user-facing /twitter command exists -- this channel-listener flow is the only member-side
// publishing path, per docs/handoff's uploaded TWEETS_SETUP.md.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder,
  type ButtonInteraction, type Message, type StringSelectMenuInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

const CONFIRM_PREFIX = "rec:tweets_capture:confirm:";
const IDENTITY_PREFIX = "rec:tweets_capture:identity:";
const CONFIRM_WINDOW_MS = 90_000;

type Candidate = {
  guildId: string;
  discordId: string;
  body: string;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingCandidates = new Map<string, Candidate>();

function newCandidateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function expireCandidate(candidateId: string, message: Message) {
  if (!pendingCandidates.has(candidateId)) return;
  pendingCandidates.delete(candidateId);
  await message.edit({
    embeds: [new EmbedBuilder().setColor(0x6b7280).setDescription("*This tweet submission expired.*")],
    components: [],
  }).catch(() => undefined);
}

/** Entry point from the bot's messageCreate listener -- returns true if this message was handled
 *  (i.e. the channel is a configured Tweets channel) so index-timeout.ts can stop checking other
 *  channel-scoped handlers, same convention as handleStreamChannelMessage. */
export async function handleTweetsChannelMessage(message: Message): Promise<boolean> {
  if (!message.guildId || message.author.bot) return false;
  const config = await recApi.getEconomyConfig(message.guildId).catch(() => null);
  const tweetsChannelId = config?.routes?.tweets_channel_id as string | undefined;
  if (!tweetsChannelId || message.channelId !== tweetsChannelId) return false;

  const body = message.content.trim();
  await message.delete().catch(() => undefined);
  if (!body || !message.channel.isSendable()) return true;

  const candidateId = newCandidateId();
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX}yes:${candidateId}`).setLabel("Yes, post it").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX}no:${candidateId}`).setLabel("No").setStyle(ButtonStyle.Secondary),
  );
  const sent = await message.channel.send({
    content: `<@${message.author.id}>`,
    embeds: [new EmbedBuilder()
      .setColor(0x1d9bf0)
      .setDescription(body)
      .setFooter({ text: "Post this to the tweets feed? This confirmation expires in 90 seconds." })],
    components: [confirmRow],
  }).catch(() => null);
  if (!sent) return true;

  const timeout = setTimeout(() => { void expireCandidate(candidateId, sent); }, CONFIRM_WINDOW_MS);
  pendingCandidates.set(candidateId, { guildId: message.guildId, discordId: message.author.id, body, timeout });
  return true;
}

async function publishAsTeamAndClose(interaction: ButtonInteraction, candidateId: string, candidate: Candidate) {
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Posting…" })], components: [] });
  try {
    await recApi.publishUserSubmittedTweet({ guildId: candidate.guildId, discordId: candidate.discordId, body: candidate.body, identity: "team" });
    await interaction.message.delete().catch(() => undefined);
  } catch (error) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe05252).setDescription(candidate.body).setFooter({ text: "Couldn't post that tweet. Try again." })], components: [] });
    console.error(`[ERROR] publishUserSubmittedTweet (team) failed for candidate ${candidateId}:`, error);
  }
}

export async function handleTweetsCaptureConfirmButton(interaction: ButtonInteraction) {
  const rest = interaction.customId.slice(CONFIRM_PREFIX.length);
  const [decision, candidateId] = rest.split(":");
  const candidate = candidateId ? pendingCandidates.get(candidateId) : undefined;
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }

  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId!);

  if (decision === "no") {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0x6b7280).setDescription("*Cancelled.*")], components: [] });
  }

  const personas = await recApi.listPlayerTwitterPersonas({ guildId: candidate.guildId, discordId: candidate.discordId }).catch(() => ({ personas: [], isRtiLeague: false }));
  if (personas.isRtiLeague && !personas.personas.length) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xe05252).setDescription(candidate.body).setFooter({ text: "Finish Origins (create your owner and players) before posting to the tweets feed." })],
      components: [],
    });
  }
  if (!personas.personas.length) {
    return publishAsTeamAndClose(interaction, candidateId!, candidate);
  }

  // Rise to Immortality: re-stash the candidate under the same id (button flow already deleted it
  // above) so the identity-select handler below can still find it.
  const identityCandidateId = newCandidateId();
  pendingCandidates.set(identityCandidateId, { ...candidate, timeout: setTimeout(() => pendingCandidates.delete(identityCandidateId), CONFIRM_WINDOW_MS) });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${IDENTITY_PREFIX}${identityCandidateId}`)
    .setPlaceholder("Post as...")
    .addOptions(personas.personas.map((persona) => ({ label: `${persona.roleLabel}: ${persona.name}`, description: persona.handle, value: persona.key })));
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Choose who's posting this." })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleTweetsCaptureIdentitySelect(interaction: StringSelectMenuInteraction) {
  const candidateId = interaction.customId.slice(IDENTITY_PREFIX.length);
  const candidate = pendingCandidates.get(candidateId);
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId);

  const identity = interaction.values[0] as "owner" | "offense" | "defense";
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Posting…" })], components: [] });
  try {
    await recApi.publishUserSubmittedTweet({ guildId: candidate.guildId, discordId: candidate.discordId, body: candidate.body, identity });
    await interaction.message.delete().catch(() => undefined);
  } catch (error) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe05252).setDescription(candidate.body).setFooter({ text: "Couldn't post that tweet. Try again." })], components: [] });
    console.error(`[ERROR] publishUserSubmittedTweet (${identity}) failed for candidate ${candidateId}:`, error);
  }
}

export function isTweetsCaptureConfirmButton(customId: string): boolean {
  return customId.startsWith(CONFIRM_PREFIX);
}

export function isTweetsCaptureIdentitySelect(customId: string): boolean {
  return customId.startsWith(IDENTITY_PREFIX);
}
