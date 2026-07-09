import { EmbedBuilder, MessageFlags, type Interaction, type ModalSubmitInteraction } from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { ensureRecBaseRoles } from "../lib/role-sync.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildSetupDangerModal, MENU_CUSTOM_IDS, type SetupDangerAction } from "../ui/menu.js";
import {
  applyLeagueSetupDependencies,
  buildCoachAbilitiesRestrictionModal,
  buildCpuTradingRestrictionModal,
  buildDifficultyCustomModal,
  buildFourthDownCustomModal,
  buildLeagueSetupWindow,
  buildLeagueSetupServerChannelModal,
  buildPositionRestrictionModal,
  buildSettingsPickerWindow,
  buildAttributeCapOverrideWindow,
  buildAttributeCapModal,
  coreAttributeGroupCustomId,
  setAttributeCapOverride,
  createDefaultLeagueSetupDraft,
  getNextLeagueSetupStep,
  isPurchaseFeatureStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  setCoreAttributesForGroup,
  setLeagueSetupFeatureAnswer,
  setPurchaseCapValue,
  setLeagueSetupServerChannel,
  LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS,
  COACH_MODE_SUB_SETTINGS,
  buildConferenceAssignmentsWindow,
  buildConferenceGroupWindow,
  buildConferenceTargetWindow,
  type LeagueSetupDraft,
  type LeagueSetupSettingsCategory,
} from "../ui/league-setup.js";
import type { MaddenAttributeDropdownGroupKey } from "@rec/shared";
import { buildPostSetupTeamLinkingPanel } from "../ui/team-options.js";
import { markPostSetupActive, startPostSetupScheduleStep } from "./schedule.js";

export const leagueSetupSessions = new ExpiringSessionStore<LeagueSetupDraft>();
export async function handleSetupModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  if (!isFullLeagueAdminInteraction(interaction)) return interaction.reply({ content: "Only commissioners or server admins can use setup workflows.", flags: MessageFlags.Ephemeral });
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Setup workflows must be run inside a Discord server.", flags: MessageFlags.Ephemeral });
  const action = interaction.customId.split(":").at(-1) as SetupDangerAction | undefined;
  if (action === "league_setup") {
    const draft = createDefaultLeagueSetupDraft(interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leagueNameInput).trim());
    draft.leaguePassword = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leaguePasswordInput).trim() || null;
    leagueSetupSessions.set(interaction.user.id, draft);
    if (interaction.isFromMessage()) return interaction.update(buildLeagueSetupWindow(draft));
    return interaction.reply({ ...buildLeagueSetupWindow(draft), flags: MessageFlags.Ephemeral });
  }
}

export async function handleLeagueSetupSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  const value = interaction.values[0];

  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.purchaseCapPrefix}:`)) {
    setPurchaseCapValue(draft, interaction.customId, value);
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    if (draft.editMode && interaction.guildId) {
      try {
        await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
      } catch (err) {
        console.error("[ERROR] Failed to save purchase cap setting:", err);
      }
    }
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.coreAttrsPrefix}:`)) {
    const group = interaction.customId.split(":").at(-1) as MaddenAttributeDropdownGroupKey;
    setCoreAttributesForGroup(draft, group, interaction.values);
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    if (draft.editMode && interaction.guildId) {
      try {
        await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
      } catch (err) {
        console.error("[ERROR] Failed to save core attribute selection:", err);
      }
    }
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  // Picking a core attribute in the per-attribute cap window opens a modal to set its cap.
  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.attrCapGroupPrefix}:`)) {
    const code = interaction.values[0];
    if (!code) return interaction.update(buildAttributeCapOverrideWindow(draft));
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.showModal(buildAttributeCapModal(code, draft));
  }

  // Conference Assignments (CFB): picking a team within a conference opens the target-conference picker.
  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignGroupPrefix}:`)) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildConferenceTargetWindow(draft, value));
  }

  // Conference Assignments (CFB): the main screen's select picks a conference to browse.
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignGroupPrefix) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildConferenceGroupWindow(draft, value));
  }

  // Conference Assignments (CFB): picking a target conference commits the move.
  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignTargetSelect}:`)) {
    const abbreviation = interaction.customId.slice(`${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignTargetSelect}:`.length);
    draft.conferenceAssignments[abbreviation] = value;
    leagueSetupSessions.set(interaction.user.id, draft);
    if (draft.editMode && interaction.guildId) {
      try {
        await recApi.updateTeamConference({ guildId: interaction.guildId, abbreviation, conference: value, requestedByDiscordId: interaction.user.id });
      } catch (err) {
        console.error("[ERROR] Failed to save conference assignment:", err);
      }
    }
    return interaction.update(buildConferenceAssignmentsWindow(draft));
  }

  // First step: pick the game. Madden titles and College Football 27 both proceed
  // into the wizard; the game choice branches which steps the wizard presents.
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.game) {
    draft.game = value as LeagueSetupDraft["game"];
    draft.step = getNextLeagueSetupStep("game", draft);
    applyLeagueSetupDependencies(draft);
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
    if (draft.step === "attribute_core_attributes" && !draft.attributePurchasesEnabled) {
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      const picker = buildSettingsPickerWindow(draft, "purchases");
      picker.embeds[0]?.setDescription(`League: **${draft.name}**\n\nEnable **Attribute Purchases** before configuring core attributes.`);
      return interaction.update(picker);
    }
    if (COACH_MODE_SUB_SETTINGS.some((setting) => setting.step === draft.step) && !draft.coachModeEnabled) {
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      const picker = buildSettingsPickerWindow(draft, draft.game === "cfb_27" ? "dynasty" : "franchise");
      picker.embeds[0]?.setDescription(`League: **${draft.name}**\n\nEnable **Coach Mode** before configuring its settings.`);
      return interaction.update(picker);
    }
    // Editing an existing league: seed the conference-assignment map from the teams actually
    // saved for this league instead of the static catalog defaults.
    if (draft.step === "conference_assignments" && draft.editMode && interaction.guildId) {
      try {
        const { teams } = await recApi.getLeagueTeamConferences(interaction.guildId);
        draft.conferenceAssignments = Object.fromEntries(teams.map((team) => [team.abbreviation, team.conference]));
      } catch (err) {
        console.error("[ERROR] Failed to load current team conferences:", err);
      }
    }
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  switch (interaction.customId) {
    case LEAGUE_SETUP_CUSTOM_IDS.leagueType: draft.leagueType = value as LeagueSetupDraft["leagueType"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.activeRosters: draft.activeRostersEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming: draft.regularSeasonStreamingRequirement = value as LeagueSetupDraft["regularSeasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreamingSide: draft.regularSeasonStreamingSide = value as LeagueSetupDraft["regularSeasonStreamingSide"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming: draft.postseasonStreamingRequirement = value as LeagueSetupDraft["postseasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.postseasonStreamingSide: draft.postseasonStreamingSide = value as LeagueSetupDraft["postseasonStreamingSide"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.streamingSide: draft.regularSeasonStreamingSide = value as LeagueSetupDraft["streamingSide"]; draft.streamingSide = draft.regularSeasonStreamingSide; break;
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
    case LEAGUE_SETUP_CUSTOM_IDS.dynastyStructure:
      draft.dynastyType = value as LeagueSetupDraft["dynastyType"];
      draft.teamBuilderAllowed = draft.dynastyType === "mixed";
      break;
    case LEAGUE_SETUP_CUSTOM_IDS.recruitingDifficulty: draft.recruitingDifficulty = value as LeagueSetupDraft["recruitingDifficulty"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.transferPortal: draft.transferPortalEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachCarousel: draft.coachCarouselEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.conferenceRealignment: draft.conferenceRealignment = value as LeagueSetupDraft["conferenceRealignment"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.homeFieldAdvantage: draft.homeFieldAdvantageEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.stadiumPulse: draft.stadiumPulseEnabled = value === "yes"; break;
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
    case LEAGUE_SETUP_CUSTOM_IDS.coachFiringPolicy: draft.coachFiringPolicy = value as LeagueSetupDraft["coachFiringPolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.preorderBonuses: draft.preorderBonusesEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeEnabled: draft.coachModeEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoPass: draft.coachModeAutoPassEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoSnap: draft.coachModeAutoSnapEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeCoachSuggestions: draft.coachModeCoachSuggestionsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeRecruitFlipping: draft.coachModeRecruitFlippingEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoRecruiting: draft.coachModeAutoRecruitingEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoProgressPlayers: draft.coachModeAutoProgressPlayersEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeUserAutoProgression: draft.coachModeUserAutoProgressionEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeCpuManageBudget: draft.coachModeCpuManageBudgetEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeCpuManageStaff: draft.coachModeCpuManageStaffEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.coachModeCpuManageFacilities: draft.coachModeCpuManageFacilitiesEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.ballHawk: draft.ballHawk = value as LeagueSetupDraft["ballHawk"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.heatSeeker: draft.heatSeeker = value as LeagueSetupDraft["heatSeeker"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.switchAssist: draft.switchAssist = value as LeagueSetupDraft["switchAssist"]; break;
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
  } catch (err) {
    console.error("[ERROR] Failed to save league setting edit:", err);
  }
}

// Saves a single channel assignment that the user explicitly changed in the
// current session. Kept separate from saveDraftEditIfNeeded so that bulk
// navigation saves (Next/Back) never overwrite channels set via the direct
// Server Setup panel with stale draft values.
async function saveChannelEditIfNeeded(interaction: { guildId: string | null; user: { id: string } }, draft: LeagueSetupDraft, channelField: string) {
  if (!draft.editMode || !interaction.guildId) return;
  const value = (draft as any)[channelField] ?? undefined;
  try {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, [channelField]: value });
  } catch (err) {
    console.error("[ERROR] Failed to save channel edit:", err);
  }
}

export async function handleAttributeCapModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });

  const code = interaction.customId.split(":").at(-1)!;
  const raw = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.attrCapModalInput);
  const result = setAttributeCapOverride(draft, code, raw);
  if (result === "invalid") {
    return interaction.reply({ content: "Invalid cap. Enter a whole number 0-99 (0 = unlimited), or leave blank to use the default.", flags: MessageFlags.Ephemeral });
  }

  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  if (draft.editMode && interaction.guildId) {
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save attribute cap override:", err);
    }
  }

  if (interaction.isFromMessage()) return interaction.update(buildAttributeCapOverrideWindow(draft));
  return interaction.reply({ ...buildAttributeCapOverrideWindow(draft), flags: MessageFlags.Ephemeral });
}

export async function handleLeagueSetupButton(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open /menu again.", flags: MessageFlags.Ephemeral });

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.cancelWizard) {
    leagueSetupSessions.delete(interaction.user.id);
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsOpen) {
    draft.step = "attribute_core_attributes";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideOpen) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildAttributeCapOverrideWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideDone) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsDone) {
    applyLeagueSetupDependencies(draft);
    if (draft.editMode) {
      await saveDraftEditIfNeeded(interaction, draft);
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft, "purchases"));
    }
    draft.step = getNextLeagueSetupStep("attribute_core_attributes", draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureActivate || interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate) {
    setLeagueSetupFeatureAnswer(draft, interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureActivate);
    applyLeagueSetupDependencies(draft);
    if (draft.editMode) {
      await saveDraftEditIfNeeded(interaction, draft);
      if (isPurchaseFeatureStep(draft.step)) {
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.update(buildLeagueSetupWindow(draft));
      }
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft));
    }
    // Purchase-cap screens combine Activate/Deactivate with cap selectors on one screen — stay
    // put so a cap can still be set once activated; the "Continue" button advances explicitly.
    if (isPurchaseFeatureStep(draft.step)) {
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildLeagueSetupWindow(draft));
    }
    draft.step = getNextLeagueSetupStep(draft.step, draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseFeatureDone) {
    applyLeagueSetupDependencies(draft);
    if (draft.editMode) {
      await saveDraftEditIfNeeded(interaction, draft);
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft, "purchases"));
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

  // Conference Assignments (CFB): "Back to Conferences" / "Cancel" both return to the main screen.
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignCancel) {
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildConferenceAssignmentsWindow(draft));
  }

  // Conference Assignments (CFB): "Continue"/"Save & Back" — team-level moves are already
  // persisted as they happen, so this just navigates onward.
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignDone) {
    if (draft.editMode) {
      draft.step = "settings_picker";
      leagueSetupSessions.set(interaction.user.id, draft);
      return interaction.update(buildSettingsPickerWindow(draft, "dynasty"));
    }
    draft.step = getNextLeagueSetupStep("conference_assignments", draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:`)) {
    const section = interaction.customId.slice(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:`.length);
    const sectionStart: Record<string, LeagueSetupDraft["step"]> = {
      features: "economy",
      server_setup: "server_setup",
      rules: "regular_season_streaming",
      gameplay: "difficulty",
      franchise: "coach_firing_policy",
      dynasty: "dynasty_structure"
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

  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  const option = LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS[channelType as keyof typeof LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS];
  setLeagueSetupServerChannel(draft, channelType, value);
  leagueSetupSessions.set(interaction.user.id, draft);
  // Save only the channel the user just changed — not the full draft — so stale
  // draft values can't overwrite channels set via the direct Server Setup panel.
  if (option) await saveChannelEditIfNeeded(interaction, draft, option.field);
  if (interaction.isFromMessage()) return interaction.update(buildLeagueSetupWindow(draft));
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
    case "preseason":       return { weekNumber: 1, seasonStage: "preseason" };
    default: return { weekNumber: 1, seasonStage: "regular_season" };
  }
}

function formatLeagueSetupSaveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AbortError") || message.includes("timed out")) {
    return "Saving timed out while contacting the REC API. Check that the API is running, then try again.";
  }
  return `Saving failed: ${userFacingError(error).slice(0, 900)}`;
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
  if (!isFullLeagueAdminInteraction(interaction)) return interaction.reply({ content: "Only commissioners or server admins can save League Setup.", flags: MessageFlags.Ephemeral });
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

    // New leagues always begin in the preseason: Madden calls this Training Camp, CFB has no
    // such period and starts at Preseason (the week before the Week 0 regular-season slate).
    // The first advance into regular-season Week 1 (Madden) / Week 0 (CFB) is the one place
    // where REC imports the full regular-season schedule.
    const { weekNumber, seasonStage } = mapSeasonWeekToLeagueWeek(draft.game === "cfb_27" ? "preseason" : "training_camp");
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
        headlinesChannelId: draft.headlinesChannelId ?? undefined,
        powerRankingsChannelId: draft.powerRankingsChannelId ?? undefined,
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

    const isCfb = draft.game === "cfb_27";
    let scheduleNote: string | null = formatDefaultScheduleSeedResult(result.defaultScheduleSeed);
    if (!scheduleNote && Array.isArray(result.defaultTeams) && result.defaultTeams.length > 0) {
      scheduleNote = isCfb
        ? `Default College Football 27 teams created (${result.defaultTeams.length} teams).`
        : `Default NFL teams created (${result.defaultTeams.length} teams).`;
    }

    const wantsLinking = draft.linkTeamsAfterSetup;
    leagueSetupSessions.delete(interaction.user.id);
    markPostSetupActive(interaction.user.id, interaction.guildId, draft.seedDefaultSchedule === true, draft.game);
    const franchiseYearOne = draft.seedDefaultSchedule === true;
    const scheduleStepLabel = franchiseYearOne ? "review the Week 1–18 schedule" : "enter or skip the schedule setup";

    const savedDescription = [
      `League: **${result.league.name}**`,
      "",
      `Type: ${result.configuration.roster_type}`,
      isCfb ? "Starts: Season 1, Preseason" : "Starts: Season 1, Training Camp",
      `Economy: ${result.configuration.coin_economy_enabled ? "Enabled" : "Disabled"}`,
      `Regular Season Streaming: ${result.configuration.regular_season_streaming_requirement}`,
      `Postseason Streaming: ${result.configuration.postseason_streaming_requirement}`,
      `Injuries: ${result.configuration.injury_policy}`,
      "",
      "Discord Roles: **REC League Member**, **REC League Comp. Committee**, and **REC League Commissioner**",
      isCfb
        ? `CFB Teams: **${result.defaultTeams?.length ?? 136} default teams** seeded automatically`
        : "NFL Teams: **32 default teams** seeded automatically",
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

