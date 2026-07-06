// Barrel module: league-setup.ts was split into focused sibling modules to keep file
// sizes manageable. This file re-exports the full original public API so existing
// importers (flows/league-setup.ts, index-timeout.ts, lib/rec-api.ts) keep working
// unchanged. See the sibling files for implementation:
//   league-setup-types.ts      — customId constants, draft type/state machine, step order
//   league-setup-shared.ts     — shared embed/select/option render helpers
//   league-setup-core.ts       — game/league-type windows
//   league-setup-purchases.ts  — economy + purchase-cap feature config, core attributes
//   league-setup-server.ts     — server/channel assignment config
//   league-setup-rules.ts      — streaming, 4th down, position/trade/CPU policy windows
//   league-setup-gameplay.ts   — difficulty/clock/CFB dynasty/play-call windows
//   league-setup-review.ts     — settings picker, review windows, top-level dispatch

export {
  LEAGUE_SETUP_CUSTOM_IDS,
  createDefaultLeagueSetupDraft,
  getPreviousLeagueSetupStep,
  getNextLeagueSetupStep,
  LEAGUE_GAME_OPTIONS,
  type LeagueSetupSettingsCategory,
  type LeagueGame,
  type LeagueSetupStep,
  type LeagueSetupDraft
} from "./league-setup-types.js";

export { buildGameSelectWindow, buildLeagueTypeWindow } from "./league-setup-core.js";

export {
  isPurchaseFeatureStep,
  purchaseCapCustomId,
  purchaseAllTimeCapOpenCustomId,
  purchaseAllTimeCapModalCustomId,
  coreAttributeGroupCustomId,
  attributeCapGroupCustomId,
  attributeCapModalCustomId,
  parsePurchaseAllTimeCapInput,
  buildPurchaseAllTimeCapModal,
  setPurchaseAllTimeCapValue,
  setPurchaseCapValue,
  setCoreAttributesForGroup,
  setAttributeCapOverride,
  buildPurchaseSettingWindow,
  buildAttributeCoreSelectionWindow,
  buildAttributeCapOverrideWindow,
  buildAttributeCapModal,
  formatPurchaseCapsReview,
  isLeagueSetupFeatureStep,
  setLeagueSetupFeatureAnswer,
  buildFeatureTogglesWindow,
  buildFeatureDecisionWindow,
  type PurchaseFeatureStep,
  type PurchaseAllTimeCapKind
} from "./league-setup-purchases.js";

export {
  LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS,
  setLeagueSetupServerChannel,
  buildLeagueSetupServerChannelModal,
  buildLeagueSetupServerSetupWindow
} from "./league-setup-server.js";

export {
  buildCustomCoachesRequiredWindow,
  buildCustomPlaybooksAllowedWindow,
  buildCoachAbilitiesRestrictedWindow,
  buildCoachAbilitiesRestrictionModal,
  buildRegularSeasonStreamingWindow,
  buildPostseasonStreamingWindow,
  buildRegularSeasonStreamingSideWindow,
  buildPostseasonStreamingSideWindow,
  buildStreamingSideWindow,
  buildFourthDownWindow,
  buildFourthDownCustomModal,
  buildPositionChangeWindow,
  buildPositionRestrictionModal,
  buildTradeApprovalWindow,
  buildCpuRulesWindow,
  buildCpuTradingRestrictionModal,
  buildActivityRequirementsWindow,
  buildActivityRequirementsModal
} from "./league-setup-rules.js";

export {
  buildDifficultyWindow,
  buildDifficultyCustomModal,
  buildQuarterLengthWindow,
  buildAcceleratedClockEnabledWindow,
  buildAcceleratedClockSecondsWindow,
  buildBooleanGameplayWindow,
  buildDynastyStructureWindow,
  buildRecruitingDifficultyWindow,
  buildConferenceRealignmentWindow,
  buildCfbToggleWindow,
  buildInjuryPolicyWindow,
  buildPlayCallNumberWindow,
  buildRoleWindow,
  buildFranchiseSettingsWindow,
  buildAssistSettingsWindow,
  buildCoachModeSettingsWindow,
  COACH_MODE_SUB_SETTINGS,
  buildConferenceAssignmentsWindow,
  buildConferenceGroupWindow,
  buildConferenceTargetWindow,
  conferenceGroupBrowseCustomId,
  conferenceAssignTargetCustomId
} from "./league-setup-gameplay.js";

export {
  buildTeamLinkingOptionalWindow,
  buildDefaultScheduleConfirmWindow,
  buildSettingsPickerWindow,
  buildLeagueSetupReviewWindow,
  buildCfbReviewWindow,
  buildLeagueSetupWindow,
  applyLeagueSetupDependencies
} from "./league-setup-review.js";
