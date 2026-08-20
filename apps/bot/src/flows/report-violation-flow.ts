// Report Violation: ephemeral choice (rule violation with a free-text description, or dashing
// -- binary, no description needed) launched from the scheduling panel's "Report Violation"
// button. Commissioner resolution buttons (Grant FW/Clear, Grant FW/Reject) are posted
// server-side by matchup-scheduling.service.ts's reportRuleViolation/reportDashing and handled
// here, gated the same way as the AutoPilot resolution buttons in game-scheduling-panel.ts.
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { GAME_SCHEDULING_CUSTOM_IDS, idAfter } from "./game-scheduling-panel.js";

export const REPORT_VIOLATION_CUSTOM_IDS = {
  choiceRule: "rec:violation:choice:rule:",
  choiceDash: "rec:violation:choice:dash:",
  ruleModal: "rec:violation:modal:",
  violationGrantFw: "rec:gamesched:violation:grantfw:",
  violationClear: "rec:gamesched:violation:clear:",
  dashingGrantFw: "rec:gamesched:dashing:grantfw:",
  dashingReject: "rec:gamesched:dashing:reject:",
};

async function replyErr(interaction: ButtonInteraction | ModalSubmitInteraction, error: unknown) {
  const content = userFacingError(error);
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export async function handleReportViolationPanel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(GAME_SCHEDULING_CUSTOM_IDS.panelReportViolation, interaction.customId);
  await interaction.reply({
    content: "What happened?",
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${REPORT_VIOLATION_CUSTOM_IDS.choiceRule}${gameId}`).setLabel("Opponent violated rules").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${REPORT_VIOLATION_CUSTOM_IDS.choiceDash}${gameId}`).setLabel("Opponent dashed").setStyle(ButtonStyle.Danger),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleReportViolationChoiceRule(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(REPORT_VIOLATION_CUSTOM_IDS.choiceRule, interaction.customId);
  const modal = new ModalBuilder()
    .setCustomId(`${REPORT_VIOLATION_CUSTOM_IDS.ruleModal}${gameId}`)
    .setTitle("Report a rule violation")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("What rule did they violate?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe what happened").setRequired(true).setMaxLength(500),
    ));
  await interaction.showModal(modal);
}

export async function handleReportViolationRuleModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = interaction.customId.slice(REPORT_VIOLATION_CUSTOM_IDS.ruleModal.length);
  const description = interaction.fields.getTextInputValue("description");
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.reportRuleViolation({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, description });
    await interaction.editReply({ content: "Your report was submitted to the commissioner team." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleReportViolationChoiceDash(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(REPORT_VIOLATION_CUSTOM_IDS.choiceDash, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.reportDashing({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "Dashing reported to the commissioner team.", components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleViolationResolve(interaction: ButtonInteraction, decision: "grant_fw" | "clear") {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can resolve a violation report.", flags: MessageFlags.Ephemeral });
  }
  const prefix = decision === "grant_fw" ? REPORT_VIOLATION_CUSTOM_IDS.violationGrantFw : REPORT_VIOLATION_CUSTOM_IDS.violationClear;
  const gameId = idAfter(prefix, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.resolveViolationReport({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, decision });
    await interaction.editReply({
      content: decision === "grant_fw" ? "✅ Force Win granted for this violation report." : "Violation report cleared.",
      components: [],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleDashingResolve(interaction: ButtonInteraction, decision: "grant_fw" | "reject") {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can resolve a dashing report.", flags: MessageFlags.Ephemeral });
  }
  const prefix = decision === "grant_fw" ? REPORT_VIOLATION_CUSTOM_IDS.dashingGrantFw : REPORT_VIOLATION_CUSTOM_IDS.dashingReject;
  const gameId = idAfter(prefix, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.resolveDashingReport({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, decision });
    await interaction.editReply({
      content: decision === "grant_fw" ? "✅ Force Win granted for this dashing report." : "Dashing report rejected.",
      components: [],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}
