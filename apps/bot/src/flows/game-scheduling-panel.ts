import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

export const GAME_SCHEDULING_CUSTOM_IDS = {
  panelAvailability: "rec:gamesched:panel:availability:",
  panelPropose: "rec:gamesched:panel:propose:",
  panelCantMake: "rec:gamesched:panel:cantmake:",
  panelReset: "rec:gamesched:panel:reset:",
  proposeSelect: "rec:gamesched:proposeselect:",
  proposeModal: "rec:gamesched:proposemodal:",
  proposalAccept: "rec:gamesched:proposal:accept:",
  proposalCounter: "rec:gamesched:proposal:counter:",
  counterModal: "rec:gamesched:countermodal:",
  checkin: "rec:gamesched:checkin:",
  fwRequest: "rec:gamesched:fwrequest:",
  autopilot: "rec:gamesched:autopilot:",
  cantMakeAcceptFs: "rec:gamesched:cantmake:accept_fs:",
  cantMakeAutopilot: "rec:gamesched:cantmake:autopilot:",
};

function idAfter(prefix: string, customId: string): string {
  return customId.slice(prefix.length);
}

// Builds a persistent panel; posted once per game channel right after the intro embed. Callers
// re-post/edit this same shape from a status-refresh action, so it's exported.
export function buildSchedulingPanel(gameId: string) {
  const embed = new EmbedBuilder()
    .setTitle("Scheduling")
    .setColor(COLORS.gold)
    .setDescription("🟡 Not Scheduled — use the buttons below to line up a kickoff time before advance.");
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.panelAvailability}${gameId}`).setLabel("Adjust Availability").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.panelPropose}${gameId}`).setLabel("Propose Time").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.panelCantMake}${gameId}`).setLabel("Can't Make Game").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${GAME_SCHEDULING_CUSTOM_IDS.panelReset}${gameId}`).setLabel("Reset (Commissioner)").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.toUTCString().replace(" GMT", "")} UTC`;
}

async function replyErr(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, error: unknown) {
  const content = userFacingError(error);
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export async function handleAdjustAvailability(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelAvailability, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const suggestions = await recApi.getSchedulingSuggestions({ guildId: interaction.guildId, gameId });
    const best = suggestions.bestWindow
      ? `Best shared window: **${fmtUtc(suggestions.bestWindow.kickoffUtc)}** – ${fmtUtc(suggestions.bestWindow.windowEndUtc)}`
      : "No shared availability found yet before the deadline.";
    await interaction.editReply({
      content: `${best}\n\nUse \`/setavailability\` and \`/settimezone\` to update your own availability (or the Availability button on the site).`,
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

async function postProposeOptions(interaction: ButtonInteraction | ButtonInteraction, gameId: string, isCounter: boolean, proposalId?: string) {
  const suggestions = await recApi.getSchedulingSuggestions({ guildId: interaction.guildId!, gameId });
  const options = suggestions.bestKickoffOptions.slice(0, 4).map((iso) =>
    new StringSelectMenuOptionBuilder().setLabel(fmtUtc(iso).slice(0, 100)).setValue(iso),
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
    await postProposeOptions(interaction, gameId, false);
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleProposalCounterButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const rest = idAfter(GAME_SCHEDULING_CUSTOM_IDS.proposalCounter, interaction.customId);
  const [gameId, proposalId] = rest.split(":");
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await postProposeOptions(interaction, gameId!, true, proposalId);
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleProposalAcceptButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const rest = idAfter(GAME_SCHEDULING_CUSTOM_IDS.proposalAccept, interaction.customId);
  const [gameId, proposalId] = rest.split(":");
  try {
    await interaction.deferReply();
    const result = await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: gameId!, proposalId: proposalId!, action: "accept" });
    await interaction.editReply({ content: `✅ Confirmed for ${result.scheduledFor ? fmtUtc(result.scheduledFor) : "the proposed time"}.`, components: [] });
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
    const modal = new ModalBuilder()
      .setCustomId(kind === "counter" ? `${GAME_SCHEDULING_CUSTOM_IDS.counterModal}${gameId}:${proposalId}` : `${GAME_SCHEDULING_CUSTOM_IDS.proposeModal}${gameId}`)
      .setTitle("Custom time")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("date").setLabel("Date (YYYY-MM-DD)").setStyle(TextInputStyle.Short).setPlaceholder("2026-08-20").setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("time").setLabel("Time (e.g. 8:00 PM)").setStyle(TextInputStyle.Short).setPlaceholder("8:00 PM").setRequired(true)),
      );
    await interaction.showModal(modal);
    return;
  }

  try {
    await interaction.deferUpdate();
    if (kind === "counter") {
      await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, proposalId: proposalId!, action: "counter", counterForUtc: value });
    } else {
      await recApi.proposeSchedulingTime({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, proposedForUtc: value });
    }
    await interaction.editReply({ content: `Proposed **${fmtUtc(value)}**. Your opponent has been notified.`, components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

async function userTimezoneOrDefault(guildId: string, discordId: string): Promise<string> {
  try {
    const profile = await recApi.getSchedulingProfile({ guildId, discordId });
    return profile.profile.timezone ?? "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

export async function handleProposeCustomModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.proposeModal, interaction.customId);
  const date = interaction.fields.getTextInputValue("date");
  const time = interaction.fields.getTextInputValue("time");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const timezone = await userTimezoneOrDefault(interaction.guildId, interaction.user.id);
    await recApi.proposeSchedulingTime({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, localDate: date, localTime: time, timezone });
    await interaction.editReply({ content: `Proposed **${date} ${time} (${timezone})**. Your opponent has been notified.` });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleCounterCustomModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const rest = idAfter(GAME_SCHEDULING_CUSTOM_IDS.counterModal, interaction.customId);
  const [gameId, proposalId] = rest.split(":");
  const date = interaction.fields.getTextInputValue("date");
  const time = interaction.fields.getTextInputValue("time");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const timezone = await userTimezoneOrDefault(interaction.guildId, interaction.user.id);
    await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: gameId!, proposalId: proposalId!, action: "counter", localDate: date, localTime: time, timezone });
    await interaction.editReply({ content: `Countered with **${date} ${time} (${timezone})**. Your opponent has been notified.` });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleCantMakePanel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelCantMake, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.markSchedulingCantMakeGame({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "Your opponent has been notified and asked to choose Fair Sim or AutoPilot." });
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

export async function handleCheckin(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.checkin, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.checkInScheduling({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "✅ You're checked in." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleFwRequest(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.fwRequest, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.requestSchedulingForceWin({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "Force Win requested — flagged for the commissioner in Advance Readiness." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleAutopilotRequest(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.autopilot, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.submitMatchupHelpRequest({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, kind: "autopilot", message: "Requested via the scheduling reminder's Request AutoPilot button." });
    await interaction.editReply({ content: "AutoPilot requested — a commissioner has been notified." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handlePanelReset(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelReset, interaction.customId);
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner or co-commissioner can reset scheduling.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
  try {
    await interaction.deferReply();
    await recApi.resetScheduling({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "🔄 Scheduling reset for this game." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}
