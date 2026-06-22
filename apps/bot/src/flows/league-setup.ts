import { EmbedBuilder, MessageFlags, type Interaction, type ModalSubmitInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { ensureRecBaseRoles } from "../lib/role-sync.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildSetupDangerModal, MENU_CUSTOM_IDS, type SetupDangerAction } from "../ui/menu.js";
import {
  applyLeagueSetupDependencies,
  buildCoachAbilitiesRestrictionModal,
  buildGameSelectWindow,
  buildCpuTradingRestrictionModal,
  buildDifficultyCustomModal,
  buildFourthDownCustomModal,
  buildLeagueSetupWindow,
  buildLeagueSetupServerChannelModal,
  buildPositionRestrictionModal,
  buildSettingsPickerWindow,
  createDefaultLeagueSetupDraft,
  getNextLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  setLeagueSetupFeatureAnswer,
  setLeagueSetupServerChannel,
  type LeagueSetupDraft,
  type LeagueSetupSettingsCategory
} from "../ui/league-setup.js";
import { buildPostSetupTeamLinkingPanel } from "../ui/team-options.js";
import { markPostSetupActive, startPostSetupScheduleStep } from "./schedule.js";

export const leagueSetupSessions = new ExpiringSessionStore<LeagueSetupDraft>();
export async function handleSetupModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can use setup workflows.", flags: MessageFlags.Ephemeral });
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Setup workflows must be run inside a Discord server.", flags: MessageFlags.Ephemeral });
  const action = interaction.customId.split(":").at(-1) as SetupDangerAction | undefined;
  if (action === "league_setup") {
    const draft = createDefaultLeagueSetupDraft(interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leagueNameInput).trim());
    draft.leaguePassword = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leaguePasswordInput).trim() || null;
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.reply({ ...buildLeagueSetupWindow(draft), flags: MessageFlags.Ephemeral });
  }
}

export async function handleLeagueSetupSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  const value = interaction.values[0];

  // First step: pick the game. CFB 27 is a placeholder for now — it keeps the
  // user on this step with a notice; Madden titles proceed into the wizard.
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.game) {
    if (value === "cfb_27") {
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildGameSelectWindow(draft, "College Football 27 dynasty setup isn't available yet — it's coming soon. Choose a Madden title to continue for now."));
    }
    draft.game = value as LeagueSetupDraft["game"];
    draft.step = getNextLeagueSetupStep("game", draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.serverSetupSelect) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.showModal(buildLeagueSetupServerChannelModal(value, draft));
  }

  // Optional team-linking step: record the choice and advance to review.
  // Linking can only happen once the league exists, so it opens after Save (see handleLeagueSetupSave).
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.teamLinkingOptional) {
    draft.linkTeamsAfterSetup = value === "yes";
    draft.step = getNextLeagueSetupStep("team_linking_optional", draft);
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.defaultScheduleConfirm) {
    draft.seedDefaultSchedule = value === "yes";
    draft.step = getNextLeagueSetupStep("default_schedule_confirm", draft);
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  // Settings picker: navigate directly to the chosen step without saving
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.settingsPicker) {
    if (value === "back_admin") {
      leagueSetupSessions.delete(interaction.user.id);
      return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    }
    if (value.startsWith("category:")) {
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft, value.slice("category:".length) as LeagueSetupSettingsCategory));
    }
    if (value === "settings_categories") {
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft));
    }
    draft.step = value as LeagueSetupDraft["step"];
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  switch (interaction.customId) {
    case LEAGUE_SETUP_CUSTOM_IDS.leagueType: draft.leagueType = value as LeagueSetupDraft["leagueType"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming: draft.regularSeasonStreamingRequirement = value as LeagueSetupDraft["regularSeasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming: draft.postseasonStreamingRequirement = value as LeagueSetupDraft["postseasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.streamingSide: draft.streamingSide = value as LeagueSetupDraft["streamingSide"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRuleRegular: {
      draft.fourthDownRuleTypeRegular = value as LeagueSetupDraft["fourthDownRuleTypeRegular"];
      if (draft.fourthDownRuleTypeRegular === "custom") {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildFourthDownCustomModal(draft, "regular"));
      }
      draft.customFourthDownRuleRegular = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRulePlayoff: {
      draft.fourthDownRuleTypePlayoff = value as LeagueSetupDraft["fourthDownRuleTypePlayoff"];
      if (draft.fourthDownRuleTypePlayoff === "custom") {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildFourthDownCustomModal(draft, "playoff"));
      }
      draft.customFourthDownRulePlayoff = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.positionChangePolicy: {
      draft.positionChangePolicy = value as LeagueSetupDraft["positionChangePolicy"];
      if (draft.positionChangePolicy !== "open") {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildPositionRestrictionModal(draft));
      }
      draft.positionChangePolicyDescription = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.customCoachesRequired: draft.customCoachesRequired = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.customPlaybooksAllowedSelect: draft.customPlaybooksAllowed = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestricted: {
      if (value === "yes_custom") {
        draft.coachAbilitiesRestricted = true;
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildCoachAbilitiesRestrictionModal(draft));
      }
      draft.coachAbilitiesRestricted = false;
      draft.coachAbilitiesRestrictionNotes = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.tradeApprovalPolicy: draft.tradeApprovalPolicy = value as LeagueSetupDraft["tradeApprovalPolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.cpuTradingPolicy: {
      draft.cpuTradingPolicy = value as LeagueSetupDraft["cpuTradingPolicy"];
      if (draft.cpuTradingPolicy === "restricted") {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildCpuTradingRestrictionModal(draft));
      }
      draft.cpuTradingRestriction = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.difficulty: {
      draft.difficulty = value as LeagueSetupDraft["difficulty"];
      if (draft.difficulty === "custom") {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.showModal(buildDifficultyCustomModal(draft));
      }
      draft.difficultyCustomSettings = "";
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.quarterLength: draft.quarterLengthMinutes = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockEnabled: draft.acceleratedClockEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockSeconds: draft.acceleratedClockMinimumSeconds = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.salaryCap: draft.salaryCapEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.tradeDeadline: draft.tradeDeadlineEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.abilities: draft.abilitiesEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.wearAndTear: draft.wearAndTearEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.injuryPolicy: draft.injuryPolicy = value as LeagueSetupDraft["injuryPolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimitsEnabled: draft.offensivePlayCallLimitsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimit: draft.offensivePlayCallLimit = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldownEnabled: draft.offensivePlayCallCooldownEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown: draft.offensivePlayCallCooldown = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled: draft.defensivePlayCallLimitsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit: draft.defensivePlayCallLimit = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldownEnabled: draft.defensivePlayCallCooldownEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown: draft.defensivePlayCallCooldown = Number(value); break;
  }

  // In edit mode: save the change to DB immediately, then return to the settings picker
  if (draft.editMode && interaction.guildId) {
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save league setting edit:", err);
    }
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  await interaction.update(buildLeagueSetupWindow(draft));
}

async function saveDraftEditIfNeeded(interaction: { guildId: string | null; user: { id: string } }, draft: LeagueSetupDraft) {
  if (!draft.editMode || !interaction.guildId) return;
  try {
    await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    await recApi.setEconomyConfig({
      guildId: interaction.guildId,
      commissionerOfficeChannelId: draft.commissionerOfficeChannelId ?? undefined,
      announcementsChannelId: draft.announcementsChannelId ?? undefined,
      votingPollsChannelId: draft.votingPollsChannelId ?? undefined,
      streamsChannelId: draft.streamsChannelId ?? undefined,
      highlightsChannelId: draft.highlightsChannelId ?? undefined,
      pendingPayoutsChannelId: draft.pendingPayoutsChannelId ?? undefined,
      pendingPurchasesChannelId: draft.pendingPurchasesChannelId ?? undefined,
      boxScoresChannelId: draft.boxScoresChannelId ?? undefined,
      gameChannelsCategoryId: draft.gameChannelsCategoryId ?? undefined
    });
  } catch (err) {
    console.error("[ERROR] Failed to save league setup edit:", err);
  }
}

export async function handleLeagueSetupButton(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open /menu again.", flags: MessageFlags.Ephemeral });

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.cancelWizard) {
    leagueSetupSessions.delete(interaction.user.id);
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureActivate || interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate) {
    setLeagueSetupFeatureAnswer(draft, interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureActivate);
    applyLeagueSetupDependencies(draft);
    if (draft.editMode) {
      await saveDraftEditIfNeeded(interaction, draft);
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft));
    }
    draft.step = getNextLeagueSetupStep(draft.step, draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.serverSetupDone) {
    await saveDraftEditIfNeeded(interaction, draft);
    draft.step = draft.editMode ? "settings_picker" : getNextLeagueSetupStep(draft.step, draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(draft.editMode ? buildSettingsPickerWindow(draft) : buildLeagueSetupWindow(draft));
  }

  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:`)) {
    const section = interaction.customId.slice(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:`.length);
    const sectionStart: Record<string, LeagueSetupDraft["step"]> = {
      features: "economy",
      server_setup: "server_setup",
      rules: "regular_season_streaming",
      gameplay: "difficulty"
    };
    draft.step = sectionStart[section] ?? "review";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }
}

export async function handleActivityRequirementsModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });

  draft.fairSimRequirements = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.fairSimInput).trim();
  draft.forceWinRequirements = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.forceWinInput).trim();
  leagueSetupSessions.set(interaction.user.id, draft);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (draft.editMode && interaction.guildId) {
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save activity requirements:", err);
    }
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.editReply(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  return interaction.editReply(buildLeagueSetupWindow(draft));
}

export async function handleCoachAbilitiesRestrictionModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });

  draft.coachAbilitiesRestricted = true;
  draft.coachAbilitiesRestrictionNotes = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionInput).trim();
  leagueSetupSessions.set(interaction.user.id, draft);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (draft.editMode && interaction.guildId) {
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save coach ability restrictions:", err);
    }
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.editReply(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  return interaction.editReply(buildLeagueSetupWindow(draft));
}

async function finishModalStep(interaction: ModalSubmitInteraction, draft: LeagueSetupDraft) {
  leagueSetupSessions.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (draft.editMode && interaction.guildId) {
    await saveDraftEditIfNeeded(interaction, draft);
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.editReply(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  return interaction.editReply(buildLeagueSetupWindow(draft));
}

export async function handleLeagueSetupServerChannelModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
  const channelType = interaction.customId.slice(`${LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelModal}:`.length);
  const value = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelInput).trim() || null;
  setLeagueSetupServerChannel(draft, channelType, value);
  leagueSetupSessions.set(interaction.user.id, draft);
  await saveDraftEditIfNeeded(interaction, draft);
  return interaction.reply({ ...buildLeagueSetupWindow(draft), flags: MessageFlags.Ephemeral });
}

export async function handleFourthDownCustomModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
  const phase = interaction.customId.slice(`${LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomModal}:`.length);
  const value = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomInput).trim();
  if (phase === "playoff") draft.customFourthDownRulePlayoff = value;
  else draft.customFourthDownRuleRegular = value;
  return finishModalStep(interaction, draft);
}

export async function handlePositionRestrictionModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
  draft.positionChangePolicyDescription = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionInput).trim();
  return finishModalStep(interaction, draft);
}

export async function handleCpuTradingRestrictionModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
  draft.cpuTradingPolicy = "restricted";
  draft.cpuTradingRestriction = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionInput).trim();
  return finishModalStep(interaction, draft);
}

export async function handleDifficultyCustomModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
  draft.difficulty = "custom";
  draft.difficultyCustomSettings = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.difficultyCustomInput).trim();
  return finishModalStep(interaction, draft);
}

// Maps the setup season-week selection to the league's current_week + season_stage.
function mapSeasonWeekToLeagueWeek(seasonWeek: string): { weekNumber: number; seasonStage: string } {
  if (seasonWeek.startsWith("week_")) {
    const n = Number(seasonWeek.slice("week_".length));
    return { weekNumber: Number.isFinite(n) && n > 0 ? n : 1, seasonStage: "regular_season" };
  }
  switch (seasonWeek) {
    case "wildcard": return { weekNumber: 19, seasonStage: "wild_card" };
    case "divisional": return { weekNumber: 20, seasonStage: "divisional" };
    case "conference": return { weekNumber: 21, seasonStage: "conference_championship" };
    case "super_bowl": return { weekNumber: 22, seasonStage: "super_bowl" };
    case "coach_hiring":    return { weekNumber: 1, seasonStage: "coach_hiring" };
    case "final_resigning": return { weekNumber: 1, seasonStage: "final_resigning" };
    case "free_agency":     return { weekNumber: 1, seasonStage: "free_agency" };
    case "draft":           return { weekNumber: 1, seasonStage: "draft" };
    case "training_camp":   return { weekNumber: 1, seasonStage: "preseason_training_camp" };
    default: return { weekNumber: 1, seasonStage: "regular_season" };
  }
}

function formatLeagueSetupSaveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AbortError") || message.includes("timed out")) {
    return "Saving timed out while contacting the REC API. Check that the API is running, then try again.";
  }
  if (message.includes("REC API request failed")) {
    return `Saving failed: ${message.slice(0, 900)}`;
  }
  return `Saving failed: ${message.slice(0, 900)}`;
}

function formatDefaultScheduleSeedResult(result: { seeded?: boolean; reason?: string; gameCount?: number } | null | undefined) {
  if (!result) return null;
  if (result.seeded) return `Default NFL schedule seeded (${result.gameCount ?? 0} regular-season matchups).`;
  if (result.reason === "not_requested" || result.reason === "unsupported_game" || result.reason === "not_league_year_one") return null;
  if (result.reason === "already_seeded") return "Default NFL schedule was already seeded for this league.";
  if (result.reason === "schedule_exists") return "Schedule already has games saved — default seed skipped.";
  return `Default schedule not seeded (${result.reason ?? "unknown reason"}).`;
}

export async function handleLeagueSetupSave(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can save League Setup.", flags: MessageFlags.Ephemeral });
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });

  if ((draft.game === "madden_26" || draft.game === "madden_27") && draft.seedDefaultSchedule == null) {
    return interaction.reply({
      content: "Answer the Default NFL Schedule question before saving.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Saving League Setup...").setDescription("Creating your league and applying configuration. This may take a moment.")],
    components: []
  });

    try {
      const result = await recApi.createLeague({
        ...applyLeagueSetupDependencies(draft),
        seedDefaultSchedule: draft.seedDefaultSchedule ?? false,
        guildId: interaction.guildId,
        requestedByDiscordId: interaction.user.id,
        serverName: interaction.guild?.name
      });

    const roleWarnings: string[] = [];
    try {
      await ensureRecBaseRoles(interaction.guild);
    } catch (error) {
      console.error("[ERROR] Failed to create REC base roles:", error);
      roleWarnings.push(`Role setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // New leagues always begin in Training Camp. The first advance into regular-season Week 1
    // is the one place where REC imports the full regular-season schedule.
    const { weekNumber, seasonStage } = mapSeasonWeekToLeagueWeek("training_camp");
    try {
      await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
    } catch (error) {
      console.error("[ERROR] Failed to set league starting week:", error);
    }

    try {
      await recApi.setEconomyConfig({
        guildId: interaction.guildId,
        commissionerOfficeChannelId: draft.commissionerOfficeChannelId ?? undefined,
        announcementsChannelId: draft.announcementsChannelId ?? undefined,
        votingPollsChannelId: draft.votingPollsChannelId ?? undefined,
        streamsChannelId: draft.streamsChannelId ?? undefined,
        highlightsChannelId: draft.highlightsChannelId ?? undefined,
        pendingPayoutsChannelId: draft.pendingPayoutsChannelId ?? undefined,
        pendingPurchasesChannelId: draft.pendingPurchasesChannelId ?? undefined,
        boxScoresChannelId: draft.boxScoresChannelId ?? undefined,
        gameChannelsCategoryId: draft.gameChannelsCategoryId ?? undefined
      });
    } catch (error) {
      console.error("[ERROR] Failed to save server setup routes:", error);
    }

    let scheduleNote: string | null = formatDefaultScheduleSeedResult(result.defaultScheduleSeed);
    if (!scheduleNote && Array.isArray(result.defaultTeams) && result.defaultTeams.length > 0) {
      scheduleNote = `Default NFL teams created (${result.defaultTeams.length} teams).`;
    }

    const wantsLinking = draft.linkTeamsAfterSetup;
    leagueSetupSessions.delete(interaction.user.id);
    markPostSetupActive(interaction.user.id, interaction.guildId, draft.seedDefaultSchedule === true);
    const franchiseYearOne = draft.seedDefaultSchedule === true;
    const scheduleStepLabel = franchiseYearOne ? "review the Week 1–18 schedule" : "enter or skip the schedule setup";

    const savedDescription = [
      `League: **${result.league.name}**`,
      "",
      `Type: ${result.configuration.roster_type}`,
      "Starts: Season 1, Training Camp",
      `Economy: ${result.configuration.coin_economy_enabled ? "Enabled" : "Disabled"}`,
      `Regular Season Streaming: ${result.configuration.regular_season_streaming_requirement}`,
      `Postseason Streaming: ${result.configuration.postseason_streaming_requirement}`,
      `Injuries: ${result.configuration.injury_policy}`,
      "",
      "Discord Roles: **REC League Member**, **REC League Comp. Committee**, and **REC League Commissioner**",
      "NFL Teams: **32 default teams** seeded automatically",
      ...roleWarnings,
      ...(scheduleNote ? ["", scheduleNote] : []),
      "",
      "Economy payouts activate for linked users when Economy is enabled."
    ].join("\n");

    if (!wantsLinking) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("League Setup Saved").setDescription(savedDescription)],
        components: [],
      });
      return startPostSetupScheduleStep(interaction);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("League Setup Saved — Link Teams")
          .setDescription([
            savedDescription,
            "",
            `Link users to teams below, or continue when ready to ${scheduleStepLabel}.`
          ].join("\n")),
        ...buildPostSetupTeamLinkingPanel(franchiseYearOne).embeds
      ],
      components: buildPostSetupTeamLinkingPanel(franchiseYearOne).components
    });
  } catch (error) {
    console.error("[ERROR] League setup save failed:", error);
    leagueSetupSessions.set(interaction.user.id, draft);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("League Setup Save Failed")
          .setDescription([
            formatLeagueSetupSaveError(error),
            "",
            "Your answers are still in this session. Fix the issue, then press **Save League Setup** again."
          ].join("\n"))
      ],
      components: buildLeagueSetupWindow({ ...draft, step: "review" }).components
    });
  }
}

