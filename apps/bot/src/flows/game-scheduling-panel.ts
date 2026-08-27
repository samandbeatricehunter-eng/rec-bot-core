import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { userFacingError } from "../lib/errors.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { openCustomTimePicker, userTimezoneOrDefault } from "./custom-time-picker.js";
import { startAvailabilityWizard } from "./availability-wizard.js";

export const GAME_SCHEDULING_CUSTOM_IDS = {
  panelAvailability: "rec:gamesched:panel:availability:",
  panelPropose: "rec:gamesched:panel:propose:",
  panelCantMake: "rec:gamesched:panel:cantmake:",
  panelReportViolation: "rec:gamesched:panel:reportviolation:",
  panelGameStarted: "rec:gamesched:panel:gamestarted:",
  proposeSelect: "rec:gamesched:proposeselect:",
  // Kept short deliberately -- prefix + 2 UUIDs (73 chars) must stay under Discord's 100-char
  // custom_id limit, or postDiscordChannelMessage gets silently rejected (code 50035) and the
  // opponent never sees the tag/buttons at all.
  proposalAccept: "r:s:a:",
  proposalCounter: "r:s:c:",
  cantMakeAcceptFs: "rec:gamesched:cantmake:accept_fs:",
  cantMakeAutopilot: "rec:gamesched:cantmake:autopilot:",
  cantMakeChoiceGrantFw: "rec:gamesched:cantmakechoice:grant_fw:",
  cantMakeChoiceRequestFs: "rec:gamesched:cantmakechoice:request_fs:",
  // Deliberately NOT prefixed with GAME_SCHEDULING_CUSTOM_IDS.autopilot ("rec:gamesched:autopilot:")
  // -- that's a different, pre-existing button (Request AutoPilot from the reminder flow) and a
  // shared prefix would make its startsWith() dispatch check also match these two.
  autopilotResolveGrant: "rec:gamesched:apresolve:grant:",
  autopilotResolveEnforceFs: "rec:gamesched:apresolve:enforcefs:",
  gameOver: "rec:gamesched:gameover:",
  gameOverModal: "rec:gamesched:gameovermodal:",
};

export function idAfter(prefix: string, customId: string): string {
  return customId.slice(prefix.length);
}

function proposalButtonParts(customId: string, prefix: string, legacyPrefix: string) {
  const rest = customId.startsWith(prefix) ? idAfter(prefix, customId) : idAfter(legacyPrefix, customId);
  const [gameId, proposalId, targetDiscordId] = rest.split(":");
  return { gameId, proposalId, targetDiscordId };
}

async function rejectNonRecipient(interaction: ButtonInteraction, targetDiscordId?: string) {
  if (!targetDiscordId || targetDiscordId === interaction.user.id) return false;
  await interaction.reply({
    content: "This scheduling offer is for the other coach in this matchup.",
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
  return true;
}

// Was hardcoded to UTC ("Fri, 28 Aug 2026 00:30:00 UTC") regardless of who was looking at it --
// now renders in the viewing user's own stored timezone (same lookup custom-time-picker.ts
// already uses for its picker), falling back to America/Chicago if it's never been set.
function fmtInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}

async function replyErr(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, error: unknown) {
  const content = userFacingError(error);
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export async function handleAdjustAvailability(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  try {
    await startAvailabilityWizard(interaction);
  } catch (error) {
    await replyErr(interaction, error);
  }
}

async function postProposeOptions(interaction: ButtonInteraction | ButtonInteraction, gameId: string, isCounter: boolean, proposalId?: string) {
  const [suggestions, timezone] = await Promise.all([
    recApi.getSchedulingSuggestions({ guildId: interaction.guildId!, discordId: interaction.user.id, gameId }),
    userTimezoneOrDefault(interaction.guildId!, interaction.user.id),
  ]);
  const options = suggestions.bestKickoffOptions.slice(0, 4).map((iso) =>
    new StringSelectMenuOptionBuilder().setLabel(fmtInZone(iso, timezone).slice(0, 100)).setValue(iso),
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Custom time…").setValue("custom"));
  const customId = isCounter
    ? `${GAME_SCHEDULING_CUSTOM_IDS.proposeSelect}counter:${gameId}:${proposalId}`
    : `${GAME_SCHEDULING_CUSTOM_IDS.proposeSelect}propose:${gameId}`;
  await interaction.editReply({
    content: suggestions.sharedWindows.length
      ? "Pick a time from your shared availability, or enter a custom one:"
      : "No shared availability was found — pick a custom time.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select a time").addOptions(options),
    )],
  });
}

export async function handleProposePanel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelPropose, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // The button's label already told the user what this does (Propose Time / Edit Proposal /
    // Reschedule-Cancel per proposeButtonLabel on the API side) -- a confirmed/reschedule-
    // requested game needs the confirmed time cleared before a fresh proposal can go out.
    const snapshot = await recApi.getSchedulingStatus({ guildId: interaction.guildId, discordId: interaction.user.id, gameId }).catch(() => null);
    if (snapshot?.status === "confirmed") {
      await recApi.requestSchedulingReschedule({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    }
    await postProposeOptions(interaction, gameId, false);
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleProposalCounterButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { gameId, proposalId, targetDiscordId } = proposalButtonParts(
    interaction.customId,
    GAME_SCHEDULING_CUSTOM_IDS.proposalCounter,
    "rec:sc:pc:",
  );
  if (await rejectNonRecipient(interaction, targetDiscordId)) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await postProposeOptions(interaction, gameId!, true, proposalId);
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleProposalAcceptButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { gameId, proposalId, targetDiscordId } = proposalButtonParts(
    interaction.customId,
    GAME_SCHEDULING_CUSTOM_IDS.proposalAccept,
    "rec:sc:pa:",
  );
  if (await rejectNonRecipient(interaction, targetDiscordId)) return;
  try {
    await interaction.deferReply();
    const result = await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: gameId!, proposalId: proposalId!, action: "accept" });
    const timezone = await userTimezoneOrDefault(interaction.guildId, interaction.user.id);
    await interaction.editReply({ content: `✅ Confirmed for ${result.scheduledFor ? fmtInZone(result.scheduledFor, timezone) : "the proposed time"}.`, components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleProposeOrCounterSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const rest = idAfter(GAME_SCHEDULING_CUSTOM_IDS.proposeSelect, interaction.customId);
  const parts = rest.split(":");
  const kind = parts[0] as "propose" | "counter";
  const gameId = parts[1]!;
  const proposalId = kind === "counter" ? parts[2] : undefined;
  const value = interaction.values[0]!;

  if (value === "custom") {
    await openCustomTimePicker(interaction, kind, gameId, proposalId);
    return;
  }

  try {
    await interaction.deferUpdate();
    if (kind === "counter") {
      await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, proposalId: proposalId!, action: "counter", counterForUtc: value });
    } else {
      await recApi.proposeSchedulingTime({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, proposedForUtc: value });
    }
    const timezone = await userTimezoneOrDefault(interaction.guildId, interaction.user.id);
    await interaction.editReply({ content: `Proposed **${fmtInZone(value, timezone)}**. Your opponent has been notified in the channel to accept or counter.`, components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

// First step: show only the options this league actually has enabled for the current season
// stage (getCantMakeGameOptions), rather than always offering both.
export async function handleCantMakePanel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelCantMake, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const options = await recApi.getCantMakeGameOptions({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    const buttons: ButtonBuilder[] = [];
    if (options.canGrantForceWin) buttons.push(new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.cantMakeChoiceGrantFw}${gameId}`).setLabel("Grant Force Win to Opponent").setStyle(ButtonStyle.Danger));
    if (options.canRequestFairSim) buttons.push(new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.cantMakeChoiceRequestFs}${gameId}`).setLabel("Request Fair Sim").setStyle(ButtonStyle.Primary));
    if (!buttons.length) {
      return interaction.editReply({ content: "Neither Force Win nor Fair Sim is enabled for this league at this stage. Contact a commissioner directly." });
    }
    await interaction.editReply({
      content: "You can't make this game before the deadline. How would you like to proceed?",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleCantMakeChoice(interaction: ButtonInteraction, choice: "grant_fw" | "request_fs") {
  if (!interaction.inCachedGuild()) return;
  const prefix = choice === "grant_fw" ? GAME_SCHEDULING_CUSTOM_IDS.cantMakeChoiceGrantFw : GAME_SCHEDULING_CUSTOM_IDS.cantMakeChoiceRequestFs;
  const gameId = idAfter(prefix, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.markSchedulingCantMakeGame({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, choice });
    await interaction.editReply({
      content: choice === "grant_fw" ? "You conceded the Force Win to your opponent — a commissioner has been tagged." : "Your opponent has been notified and asked to choose Fair Sim or AutoPilot.",
      components: [],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleAutopilotResolve(interaction: ButtonInteraction, decision: "grant_autopilot" | "enforce_fs") {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can resolve an AutoPilot request.", flags: MessageFlags.Ephemeral });
  }
  const prefix = decision === "grant_autopilot" ? GAME_SCHEDULING_CUSTOM_IDS.autopilotResolveGrant : GAME_SCHEDULING_CUSTOM_IDS.autopilotResolveEnforceFs;
  const gameId = idAfter(prefix, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.resolveAutopilotRequest({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, decision });
    await interaction.editReply({
      content: decision === "grant_autopilot" ? "✅ AutoPilot granted." : "Fair Sim enforced — AutoPilot was not granted.",
      components: [],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleCantMakeResponse(interaction: ButtonInteraction, choice: "accept_fs" | "request_autopilot") {
  if (!interaction.inCachedGuild()) return;
  const prefix = choice === "accept_fs" ? GAME_SCHEDULING_CUSTOM_IDS.cantMakeAcceptFs : GAME_SCHEDULING_CUSTOM_IDS.cantMakeAutopilot;
  const gameId = idAfter(prefix, interaction.customId);
  try {
    await interaction.deferReply();
    await recApi.resolveSchedulingCantMakeGame({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, choice });
    await interaction.editReply({
      content: choice === "accept_fs" ? "Fair Sim accepted for this game." : "AutoPilot requested — a commissioner has been notified.",
      components: [],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleGameOverButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.gameOver, interaction.customId);
  const modal = new ModalBuilder()
    .setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.gameOverModal}${gameId}`)
    .setTitle("Game is over")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("home_score").setLabel("Home score (optional)").setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("away_score").setLabel("Away score (optional)").setStyle(TextInputStyle.Short).setRequired(false)),
    );
  await interaction.showModal(modal);
}

export async function handleGameOverModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.gameOverModal, interaction.customId);
  const homeRaw = interaction.fields.getTextInputValue("home_score").trim();
  const awayRaw = interaction.fields.getTextInputValue("away_score").trim();
  await interaction.deferReply();
  try {
    const homeScore = homeRaw ? Number(homeRaw) : undefined;
    const awayScore = awayRaw ? Number(awayRaw) : undefined;
    if ((homeRaw && !Number.isFinite(homeScore)) || (awayRaw && !Number.isFinite(awayScore))) {
      return interaction.editReply({ content: "Scores must be numbers." });
    }
    await recApi.markGameOver({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, homeScore, awayScore });
    await interaction.editReply({ content: "Game marked over. The announcement has been updated." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handlePanelGameStarted(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelGameStarted, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.markGameStarted({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "🔴 Game marked as started — announced to the league. The panel button now says Game Over for when you're done." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

