// User Tweets channel: a human message posted in the configured Tweets channel is captured,
// the original removed, and a 90-second public Yes/No confirmation (gated to the source user)
// decides whether it publishes. Ordinary leagues publish as the user's own team; Rise to
// Immortality opens an ephemeral Offensive Prospect / Owner / Defensive Prospect picker first.
// After that (or immediately for non-RTI), an optional Twitter beef targeting step lets the
// author name a specific opponent to call out: pick their team, then either that team's
// RTI owner/offense/defense persona, or (non-RTI) a position + player on that roster, or the
// team/owner itself. No user-facing /twitter command exists -- this channel-listener flow is
// the only member-side publishing path, per docs/handoff's uploaded TWEETS_SETUP.md.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder,
  type ButtonInteraction, type Message, type StringSelectMenuInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

const CONFIRM_PREFIX = "rec:tweets_capture:confirm:";
const IDENTITY_PREFIX = "rec:tweets_capture:identity:";
const TARGET_PROMPT_PREFIX = "rec:tweets_capture:target_prompt:";
const TARGET_TEAM_PREFIX = "rec:tweets_capture:target_team:";
const TARGET_PERSONA_PREFIX = "rec:tweets_capture:target_persona:";
const TARGET_KIND_PREFIX = "rec:tweets_capture:target_kind:";
const TARGET_PLAYER_PREFIX = "rec:tweets_capture:target_player:";
const CONFIRM_WINDOW_MS = 90_000;

// Discord StringSelectMenus cap at 25 options -- a league bigger than that (or a full 53-man
// roster) gets truncated with a note rather than erroring.
const SELECT_OPTION_LIMIT = 25;

type TweetTarget = {
  kind: "team" | "owner" | "player";
  teamId?: string | null;
  userId?: string | null;
  playerId?: string | null;
  label: string;
};

type Candidate = {
  guildId: string;
  discordId: string;
  body: string;
  identity: "team" | "owner" | "offense" | "defense";
  target?: TweetTarget | null;
  targetTeamId?: string;
  targetTeamLabel?: string;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingCandidates = new Map<string, Candidate>();

function newCandidateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function restash(candidate: Candidate, patch: Partial<Candidate> = {}): string {
  const id = newCandidateId();
  pendingCandidates.set(id, { ...candidate, ...patch, timeout: setTimeout(() => pendingCandidates.delete(id), CONFIRM_WINDOW_MS) });
  return id;
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
  pendingCandidates.set(candidateId, { guildId: message.guildId, discordId: message.author.id, body, identity: "team", timeout });
  return true;
}

function targetPromptRow(candidateId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${TARGET_PROMPT_PREFIX}skip:${candidateId}`).setLabel("Just post it").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TARGET_PROMPT_PREFIX}choose:${candidateId}`).setLabel("Call out an opponent").setStyle(ButtonStyle.Primary),
  );
}

async function showTargetPrompt(interaction: ButtonInteraction | StringSelectMenuInteraction, candidate: Candidate) {
  const candidateId = restash(candidate);
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Want to call out a specific opponent, or just post it?" })],
    components: [targetPromptRow(candidateId)],
  });
}

async function publishAndClose(interaction: ButtonInteraction | StringSelectMenuInteraction, candidateId: string, candidate: Candidate) {
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Posting…" })], components: [] });
  try {
    await recApi.publishUserSubmittedTweet({
      guildId: candidate.guildId, discordId: candidate.discordId, body: candidate.body, identity: candidate.identity,
      target: candidate.target ?? null,
    });
    await interaction.message.delete().catch(() => undefined);
  } catch (error) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe05252).setDescription(candidate.body).setFooter({ text: "Couldn't post that tweet. Try again." })], components: [] });
    console.error(`[ERROR] publishUserSubmittedTweet (${candidate.identity}) failed for candidate ${candidateId}:`, error);
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
    return showTargetPrompt(interaction, candidate);
  }

  const identityCandidateId = restash(candidate);
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
  await showTargetPrompt(interaction, { ...candidate, identity });
}

export async function handleTweetsCaptureTargetPromptButton(interaction: ButtonInteraction) {
  const rest = interaction.customId.slice(TARGET_PROMPT_PREFIX.length);
  const [decision, candidateId] = rest.split(":");
  const candidate = candidateId ? pendingCandidates.get(candidateId) : undefined;
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId!);

  if (decision === "skip") {
    return publishAndClose(interaction, candidateId!, candidate);
  }

  const teams = await recApi.listBeefTargetTeams({ guildId: candidate.guildId, discordId: candidate.discordId }).catch(() => ({ teams: [] }));
  if (!teams.teams.length) {
    return publishAndClose(interaction, candidateId!, candidate);
  }

  const teamCandidateId = restash(candidate);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${TARGET_TEAM_PREFIX}${teamCandidateId}`)
    .setPlaceholder("Call out which team?")
    .addOptions(teams.teams.slice(0, SELECT_OPTION_LIMIT).map((team) => ({ label: team.label.slice(0, 100), value: team.teamId })));
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: "Which team's you calling out?" })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleTweetsCaptureTargetTeamSelect(interaction: StringSelectMenuInteraction) {
  const candidateId = interaction.customId.slice(TARGET_TEAM_PREFIX.length);
  const candidate = pendingCandidates.get(candidateId);
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId);

  const teamId = interaction.values[0]!;
  const teams = await recApi.listBeefTargetTeams({ guildId: candidate.guildId, discordId: candidate.discordId }).catch(() => ({ teams: [] }));
  const teamLabel = teams.teams.find((team) => team.teamId === teamId)?.label ?? "that team";
  const withTeam: Candidate = { ...candidate, targetTeamId: teamId, targetTeamLabel: teamLabel };

  const opponentPersonas = await recApi.listBeefTargetPersonas({ guildId: candidate.guildId, teamId }).catch(() => ({ personas: [] }));
  if (opponentPersonas.personas.length) {
    const personaCandidateId = restash(withTeam);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${TARGET_PERSONA_PREFIX}${personaCandidateId}`)
      .setPlaceholder("Call out who specifically?")
      .addOptions(opponentPersonas.personas.map((persona) => ({ label: `${persona.roleLabel}: ${persona.name}`, description: persona.handle, value: persona.key })));
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: `Who on ${teamLabel} are you calling out?` })],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    });
    return;
  }

  const roster = await recApi.getTeamRoster({ guildId: candidate.guildId, discordId: candidate.discordId, teamId }).catch(() => null);
  const positions = [...new Set((roster?.players ?? []).map((player) => player.position).filter(Boolean))];
  const kindCandidateId = restash(withTeam);
  const kindSelect = new StringSelectMenuBuilder()
    .setCustomId(`${TARGET_KIND_PREFIX}${kindCandidateId}`)
    .setPlaceholder("Call out who/what specifically?")
    .addOptions([
      { label: `Team (${teamLabel})`, value: "team" },
      { label: "Owner (the coach)", value: "owner" },
      ...positions.slice(0, SELECT_OPTION_LIMIT - 2).map((position) => ({ label: `A player: ${position}`, value: `position:${position}` })),
    ]);
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: `Calling out ${teamLabel} -- how specific?` })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(kindSelect)],
  });
}

export async function handleTweetsCaptureTargetPersonaSelect(interaction: StringSelectMenuInteraction) {
  const candidateId = interaction.customId.slice(TARGET_PERSONA_PREFIX.length);
  const candidate = pendingCandidates.get(candidateId);
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId);

  const personaKey = interaction.values[0]!;
  const personas = await recApi.listBeefTargetPersonas({ guildId: candidate.guildId, teamId: candidate.targetTeamId! }).catch(() => ({ personas: [] }));
  const chosen = personas.personas.find((persona) => persona.key === personaKey);
  if (!chosen) return publishAndClose(interaction, candidateId, candidate);

  const target: TweetTarget = chosen.key === "owner"
    ? { kind: "owner", userId: chosen.userId ?? null, teamId: candidate.targetTeamId, label: chosen.name }
    : { kind: "player", playerId: chosen.playerId ?? null, teamId: candidate.targetTeamId, label: chosen.name };
  return publishAndClose(interaction, candidateId, { ...candidate, target });
}

export async function handleTweetsCaptureTargetKindSelect(interaction: StringSelectMenuInteraction) {
  const candidateId = interaction.customId.slice(TARGET_KIND_PREFIX.length);
  const candidate = pendingCandidates.get(candidateId);
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId);

  const value = interaction.values[0]!;
  if (value === "team") {
    const target: TweetTarget = { kind: "team", teamId: candidate.targetTeamId, label: candidate.targetTeamLabel ?? "that team" };
    return publishAndClose(interaction, candidateId, { ...candidate, target });
  }
  if (value === "owner") {
    const target: TweetTarget = { kind: "owner", teamId: candidate.targetTeamId, label: `${candidate.targetTeamLabel ?? "that team"}'s coach` };
    return publishAndClose(interaction, candidateId, { ...candidate, target });
  }

  const position = value.slice("position:".length);
  const roster = await recApi.getTeamRoster({ guildId: candidate.guildId, discordId: candidate.discordId, teamId: candidate.targetTeamId! }).catch(() => null);
  const players = (roster?.players ?? []).filter((player) => player.position === position);
  if (!players.length) return publishAndClose(interaction, candidateId, candidate);

  const playerCandidateId = restash(candidate);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${TARGET_PLAYER_PREFIX}${playerCandidateId}`)
    .setPlaceholder(`Which ${position}?`)
    .addOptions(players.slice(0, SELECT_OPTION_LIMIT).map((player) => ({
      label: player.fullName.slice(0, 100),
      description: player.overallRating != null ? `${player.position} · ${player.overallRating} OVR` : player.position,
      value: player.id,
    })));
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x1d9bf0).setDescription(candidate.body).setFooter({ text: `Which ${position} on ${candidate.targetTeamLabel ?? "that team"}?` })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleTweetsCaptureTargetPlayerSelect(interaction: StringSelectMenuInteraction) {
  const candidateId = interaction.customId.slice(TARGET_PLAYER_PREFIX.length);
  const candidate = pendingCandidates.get(candidateId);
  if (!candidate) return interaction.reply({ content: "This submission already expired.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== candidate.discordId) {
    return interaction.reply({ content: "Only the person who wrote this can confirm it.", flags: MessageFlags.Ephemeral });
  }
  clearTimeout(candidate.timeout);
  pendingCandidates.delete(candidateId);

  const playerId = interaction.values[0]!;
  const roster = await recApi.getTeamRoster({ guildId: candidate.guildId, discordId: candidate.discordId, teamId: candidate.targetTeamId! }).catch(() => null);
  const player = (roster?.players ?? []).find((row) => row.id === playerId);
  const target: TweetTarget = { kind: "player", playerId, teamId: candidate.targetTeamId, label: player?.fullName ?? "that player" };
  return publishAndClose(interaction, candidateId, { ...candidate, target });
}

export function isTweetsCaptureConfirmButton(customId: string): boolean {
  return customId.startsWith(CONFIRM_PREFIX);
}

export function isTweetsCaptureIdentitySelect(customId: string): boolean {
  return customId.startsWith(IDENTITY_PREFIX);
}

export function isTweetsCaptureTargetPromptButton(customId: string): boolean {
  return customId.startsWith(TARGET_PROMPT_PREFIX);
}

export function isTweetsCaptureTargetTeamSelect(customId: string): boolean {
  return customId.startsWith(TARGET_TEAM_PREFIX);
}

export function isTweetsCaptureTargetPersonaSelect(customId: string): boolean {
  return customId.startsWith(TARGET_PERSONA_PREFIX);
}

export function isTweetsCaptureTargetKindSelect(customId: string): boolean {
  return customId.startsWith(TARGET_KIND_PREFIX);
}

export function isTweetsCaptureTargetPlayerSelect(customId: string): boolean {
  return customId.startsWith(TARGET_PLAYER_PREFIX);
}
