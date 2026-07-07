export const LEAGUE_SETUP_CUSTOM_IDS = {
  game: "rec:league_setup:game",
  leagueType: "rec:league_setup:league_type",
  featureActivate: "rec:league_setup:feature_activate",
  featureDeactivate: "rec:league_setup:feature_deactivate",
  cancelWizard: "rec:league_setup:cancel",
  serverSetupSelect: "rec:league_setup:server_setup_select",
  serverSetupDone: "rec:league_setup:server_setup_done",
  serverSetupChannelModal: "rec:league_setup:server_channel_modal",
  serverSetupChannelInput: "rec:league_setup:server_channel_input",
  regularSeasonStreaming: "rec:league_setup:streaming_regular",
  regularSeasonStreamingSide: "rec:league_setup:streaming_regular_side",
  postseasonStreaming: "rec:league_setup:streaming_postseason",
  postseasonStreamingSide: "rec:league_setup:streaming_postseason_side",
  streamingSide: "rec:league_setup:streaming_side",
  fourthDownRuleRegular: "rec:league_setup:fourth_down_rule_regular",
  fourthDownRulePlayoff: "rec:league_setup:fourth_down_rule_playoff",
  fourthDownCustomModal: "rec:league_setup:fourth_down_custom_modal",
  fourthDownCustomInput: "rec:league_setup:fourth_down_custom_input",
  positionChangePolicy: "rec:league_setup:position_changes",
  positionChangeRestrictionModal: "rec:league_setup:position_change_restriction_modal",
  positionChangeRestrictionInput: "rec:league_setup:position_change_restriction_input",
  tradeApprovalPolicy: "rec:league_setup:trade_approval",
  cpuTradingPolicy: "rec:league_setup:cpu_trading_policy",
  cpuTradingRestrictionModal: "rec:league_setup:cpu_trading_restriction_modal",
  cpuTradingRestrictionInput: "rec:league_setup:cpu_trading_restriction_input",
  difficulty: "rec:league_setup:difficulty",
  difficultyCustomModal: "rec:league_setup:difficulty_custom_modal",
  difficultyCustomInput: "rec:league_setup:difficulty_custom_input",
  quarterLength: "rec:league_setup:quarter_length",
  acceleratedClockEnabled: "rec:league_setup:accelerated_clock_enabled",
  acceleratedClockSeconds: "rec:league_setup:accelerated_clock_seconds",
  salaryCap: "rec:league_setup:salary_cap",
  tradeDeadline: "rec:league_setup:trade_deadline",
  // CFB 27 dynasty-only settings (shown when game === "cfb_27").
  dynastyStructure: "rec:league_setup:dynasty_structure",
  recruitingDifficulty: "rec:league_setup:recruiting_difficulty",
  transferPortal: "rec:league_setup:transfer_portal",
  coachCarousel: "rec:league_setup:coach_carousel",
  conferenceRealignment: "rec:league_setup:conference_realignment",
  homeFieldAdvantage: "rec:league_setup:home_field_advantage",
  stadiumPulse: "rec:league_setup:stadium_pulse",
  abilities: "rec:league_setup:abilities",
  wearAndTear: "rec:league_setup:wear_and_tear",
  injuryPolicy: "rec:league_setup:injury_policy",
  offensiveLimitsEnabled: "rec:league_setup:off_limits_enabled",
  offensiveLimit: "rec:league_setup:off_limit",
  offensiveCooldownEnabled: "rec:league_setup:off_cooldown_enabled",
  offensiveCooldown: "rec:league_setup:off_cooldown",
  defensiveLimitsEnabled: "rec:league_setup:def_limits_enabled",
  defensiveLimit: "rec:league_setup:def_limit",
  defensiveCooldownEnabled: "rec:league_setup:def_cooldown_enabled",
  defensiveCooldown: "rec:league_setup:def_cooldown",
  teamLinkingOptional: "rec:league_setup:team_linking_optional",
  defaultScheduleConfirm: "rec:league_setup:default_schedule_confirm",
  save: "rec:league_setup:save",
  activityRequirementsOpen: "rec:league_setup:activity_requirements_open",
  activityRequirementsSkip: "rec:league_setup:activity_requirements_skip",
  activityRequirementsModal: "rec:league_setup:activity_requirements_modal",
  fairSimInput: "rec:league_setup:fair_sim_input",
  forceWinInput: "rec:league_setup:force_win_input",
  settingsPicker: "rec:league_setup:settings_picker",
  customCoachesRequired: "rec:league_setup:custom_coaches_required",
  customPlaybooksAllowedSelect: "rec:league_setup:custom_playbooks_allowed",
  coachAbilitiesRestricted: "rec:league_setup:coach_abilities_restricted",
  coachAbilitiesRestrictionModal: "rec:league_setup:coach_abilities_restriction_modal",
  coachAbilitiesRestrictionInput: "rec:league_setup:coach_abilities_restriction_input",
  reviewJump: "rec:league_setup:review_jump",
  purchaseCapPrefix: "rec:league_setup:purchase_cap",
  purchaseCoreAttrsOpen: "rec:league_setup:purchase_core_attrs_open",
  purchaseCoreAttrsDone: "rec:league_setup:purchase_core_attrs_done",
  coreAttrsPrefix: "rec:league_setup:core_attrs",
  attrCapOverrideOpen: "rec:league_setup:attr_cap_override_open",
  attrCapOverrideDone: "rec:league_setup:attr_cap_override_done",
  attrCapGroupPrefix: "rec:league_setup:attr_cap_group",
  attrCapModalPrefix: "rec:league_setup:attr_cap_modal",
  attrCapModalInput: "rec:league_setup:attr_cap_input",
  purchaseAllTimeCapOpenPrefix: "rec:league_setup:alltime_cap_open",
  purchaseAllTimeCapModalPrefix: "rec:league_setup:alltime_cap_modal",
  purchaseAllTimeCapInput: "rec:league_setup:alltime_cap_input",
  // CFB 27: Active Rosters replaces the League Type select (see getNextLeagueSetupStep / buildLeagueTypeWindow).
  activeRosters: "rec:league_setup:active_rosters",
  // Conference realignment editor (CFB 27 only, shown when conferenceRealignment === "allowed").
  conferenceAssignGroupPrefix: "rec:league_setup:conf_assign_group",
  conferenceAssignTargetSelect: "rec:league_setup:conf_assign_target",
  conferenceAssignDone: "rec:league_setup:conf_assign_done",
  conferenceAssignCancel: "rec:league_setup:conf_assign_cancel",
  // Franchise/coach-mode/assist settings (shared across Madden and CFB) — each is its own
  // dedicated step (see LeagueSetupStep / STEP_ORDER below), not a bundled multi-question screen.
  coachFiringPolicy: "rec:league_setup:coach_firing_policy",
  preorderBonuses: "rec:league_setup:preorder_bonuses",
  coachModeEnabled: "rec:league_setup:coach_mode_enabled",
  coachModeAutoPass: "rec:league_setup:coach_mode_auto_pass",
  coachModeAutoSnap: "rec:league_setup:coach_mode_auto_snap",
  coachModeCoachSuggestions: "rec:league_setup:coach_mode_coach_suggestions",
  coachModeRecruitFlipping: "rec:league_setup:coach_mode_recruit_flipping",
  coachModeAutoRecruiting: "rec:league_setup:coach_mode_auto_recruiting",
  coachModeAutoProgressPlayers: "rec:league_setup:coach_mode_auto_progress_players",
  coachModeUserAutoProgression: "rec:league_setup:coach_mode_user_auto_progression",
  coachModeCpuManageBudget: "rec:league_setup:coach_mode_cpu_manage_budget",
  coachModeCpuManageStaff: "rec:league_setup:coach_mode_cpu_manage_staff",
  coachModeCpuManageFacilities: "rec:league_setup:coach_mode_cpu_manage_facilities",
  ballHawk: "rec:league_setup:ball_hawk",
  heatSeeker: "rec:league_setup:heat_seeker",
  switchAssist: "rec:league_setup:switch_assist"
} as const;

export type LeagueSetupSettingsCategory = "features" | "purchases" | "server" | "rules" | "dynasty" | "gameplay" | "franchise" | "play_call";

export type LeagueGame = "madden_26" | "madden_27" | "cfb_27";

export const LEAGUE_GAME_OPTIONS: Record<LeagueGame, string> = {
  madden_26: "Madden NFL 26",
  madden_27: "Madden NFL 27",
  cfb_27: "College Football 27"
};

export type LeagueSetupStep =
  | "game"
  | "league_type"
  | "dynasty_structure"
  | "recruiting_difficulty"
  | "transfer_portal"
  | "coach_carousel"
  | "conference_realignment"
  | "conference_assignments"
  | "home_field_advantage"
  | "stadium_pulse"
  | "economy"
  | "custom_players"
  | "legends"
  | "dev_upgrades"
  | "age_resets"
  | "attribute_purchases"
  | "attribute_core_attributes"
  | "player_trait_purchases"
  | "contract_purchases"
  | "server_setup"
  | "regular_season_streaming"
  | "regular_season_streaming_side"
  | "postseason_streaming"
  | "postseason_streaming_side"
  | "fourth_down_regular"
  | "fourth_down_playoff"
  | "position_changes"
  | "custom_coaches_required"
  | "custom_playbooks_allowed"
  | "coach_abilities_restricted"
  | "trade_approval"
  | "cpu_trading"
  | "difficulty"
  | "quarter_length"
  | "accelerated_clock_enabled"
  | "accelerated_clock_seconds"
  | "salary_cap"
  | "trade_deadline"
  | "abilities"
  | "wear_and_tear"
  | "injury_policy"
  | "coach_firing_policy"
  | "preorder_bonuses"
  | "coach_mode_enabled"
  | "coach_mode_auto_pass"
  | "coach_mode_auto_snap"
  | "coach_mode_coach_suggestions"
  | "coach_mode_recruit_flipping"
  | "coach_mode_auto_recruiting"
  | "coach_mode_auto_progress_players"
  | "coach_mode_user_auto_progression"
  | "coach_mode_cpu_manage_budget"
  | "coach_mode_cpu_manage_staff"
  | "coach_mode_cpu_manage_facilities"
  | "ball_hawk"
  | "heat_seeker"
  | "switch_assist"
  | "offensive_limits_enabled"
  | "offensive_limit"
  | "offensive_cooldown_enabled"
  | "offensive_cooldown"
  | "defensive_limits_enabled"
  | "defensive_limit"
  | "defensive_cooldown_enabled"
  | "defensive_cooldown"
  | "team_linking_optional"
  | "default_schedule_confirm"
  | "activity_requirements"
  | "settings_picker"
  | "review";

export type LeagueSetupDraft = {
  name: string;
  game: LeagueGame;
  leaguePassword?: string | null;
  step: LeagueSetupStep;
  leagueType: "fantasy_draft" | "regular_rosters" | "custom_rosters";
  /** CFB 27 only: replaces League Type. On = ratings/styles track real-world changes; off = static. */
  activeRostersEnabled: boolean;
  seasonWeek: string;
  coinEconomyEnabled: boolean;
  customPlayersEnabled: boolean;
  legendsEnabled: boolean;
  devUpgradesEnabled: boolean;
  ageResetsEnabled: boolean;
  attributePurchasesEnabled: boolean;
  playerTraitPurchasesEnabled: boolean;
  contractAdjustmentPurchasesEnabled: boolean;
  mediaFeaturesEnabled: boolean;
  customPlayersSeasonCap: number;
  legendsSeasonCap: number;
  devUpgradesSeasonCap: number;
  ageResetsSeasonCap: number;
  playerTraitPurchasesSeasonCap: number;
  contractPurchasesSeasonCap: number;
  coreAttributePurchasesSeasonCap: number;
  nonCoreAttributePurchasesSeasonCap: number;
  coreAttributes: string[];
  coreAttributeCapOverrides: Record<string, number>;
  customPlayersAllTimeCap: number | null;
  legendsAllTimeCap: number | null;
  devUpgradesAllTimeCap: number | null;
  ageResetsAllTimeCap: number | null;
  playerTraitPurchasesAllTimeCap: number | null;
  contractPurchasesAllTimeCap: number | null;
  coreAttributePurchasesAllTimeCap: number | null;
  nonCoreAttributePurchasesAllTimeCap: number | null;
  streamingRequirement: "required" | "recommended" | "disabled";
  regularSeasonStreamingRequirement: "required" | "recommended" | "disabled";
  postseasonStreamingRequirement: "required" | "recommended" | "disabled";
  streamingScope: "every_game" | "playoffs_only";
  streamingSide: "home" | "away" | "either" | "both";
  regularSeasonStreamingSide: "home" | "away" | "either" | "both";
  postseasonStreamingSide: "home" | "away" | "either" | "both";
  fourthDownRuleTypeRegular: "none" | "standard_rec" | "custom";
  fourthDownRuleTypePlayoff: "none" | "standard_rec" | "custom";
  customFourthDownRuleRegular: string;
  customFourthDownRulePlayoff: string;
  positionChangePolicy: "open" | "restricted" | "highly_restricted";
  positionChangePolicyDescription: string;
  customCoachesRequired: boolean;
  customPlaybooksAllowed: boolean;
  coachAbilitiesRestricted: boolean;
  coachAbilitiesRestrictionNotes: string;
  tradeApprovalPolicy: "no_approval_required" | "commissioner_review" | "competition_committee_review";
  cpuTradingAllowed: boolean;
  cpuTradingPolicy: "allowed" | "restricted" | "not_allowed";
  cpuTradingRestriction: string;
  cpuFreeAgencyPolicy: "open" | "restricted" | "disabled";
  injuryPolicy: "off" | "on_standard" | "on_reduced";
  difficulty: "rookie" | "pro" | "all_pro" | "all_madden" | "custom";
  difficultyCustomSettings: string;
  quarterLengthMinutes: number;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number;
  salaryCapEnabled: boolean;
  tradeDeadlineEnabled: boolean;
  abilitiesEnabled: boolean;
  wearAndTearEnabled: boolean;
  // Franchise settings (shared across Madden and CFB).
  coachFiringPolicy: "off" | "on" | "cpu_only";
  preorderBonusesEnabled: boolean;
  coachModeEnabled: boolean;
  coachModeAutoPassEnabled: boolean;
  coachModeAutoSnapEnabled: boolean;
  coachModeCoachSuggestionsEnabled: boolean;
  // Coach Mode sub-toggles below only apply when game === "cfb_27".
  coachModeRecruitFlippingEnabled: boolean;
  coachModeAutoRecruitingEnabled: boolean;
  coachModeAutoProgressPlayersEnabled: boolean;
  coachModeUserAutoProgressionEnabled: boolean;
  coachModeCpuManageBudgetEnabled: boolean;
  coachModeCpuManageStaffEnabled: boolean;
  coachModeCpuManageFacilitiesEnabled: boolean;
  ballHawk: "on" | "off" | "keep_individual";
  heatSeeker: "on" | "off" | "keep_individual";
  switchAssist: "on" | "off" | "keep_individual";
  // CFB 27 dynasty settings (only meaningful when game === "cfb_27").
  dynastyType: "real" | "mixed";
  recruitingDifficulty: "easy" | "normal" | "hard";
  transferPortalEnabled: boolean;
  coachCarouselEnabled: boolean;
  conferenceRealignment: "allowed" | "locked";
  /** Team abbreviation -> conference override, set via the conference_assignments step (CFB 27 only). */
  conferenceAssignments: Record<string, string>;
  homeFieldAdvantageEnabled: boolean;
  stadiumPulseEnabled: boolean;
  /** Derived from dynastyType: Mixed Teams ⇒ true, Real Teams ⇒ false. */
  teamBuilderAllowed: boolean;
  offensivePlayCallLimitsEnabled: boolean;
  offensivePlayCallLimit?: number | null;
  offensivePlayCallCooldownEnabled: boolean;
  offensivePlayCallCooldown?: number | null;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit?: number | null;
  defensivePlayCallCooldownEnabled: boolean;
  defensivePlayCallCooldown?: number | null;
  // Whether to open the team-linking flow after the league is saved (chosen at the optional step).
  linkTeamsAfterSetup: boolean;
  /** null until the commissioner answers the franchise Year 1 / default schedule question. */
  seedDefaultSchedule: boolean | null;
  fairSimRequirements: string;
  forceWinRequirements: string;
  commissionerOfficeChannelId?: string | null;
  announcementsChannelId?: string | null;
  headlinesChannelId?: string | null;
  powerRankingsChannelId?: string | null;
  votingPollsChannelId?: string | null;
  streamsChannelId?: string | null;
  highlightsChannelId?: string | null;
  pendingPayoutsChannelId?: string | null;
  pendingPurchasesChannelId?: string | null;
  boxScoresChannelId?: string | null;
  gameChannelsCategoryId?: string | null;
  // When true, changes are saved to DB immediately after each step and return to settings_picker.
  editMode: boolean;
};

const STEP_ORDER: LeagueSetupStep[] = [
  "game",
  "league_type",
  "dynasty_structure",
  "recruiting_difficulty",
  "transfer_portal",
  "coach_carousel",
  "conference_realignment",
  "conference_assignments",
  "home_field_advantage",
  "stadium_pulse",
  "economy",
  "custom_players",
  "legends",
  "dev_upgrades",
  "age_resets",
  "attribute_purchases",
  "attribute_core_attributes",
  "player_trait_purchases",
  "contract_purchases",
  "server_setup",
  "regular_season_streaming",
  "regular_season_streaming_side",
  "postseason_streaming",
  "postseason_streaming_side",
  "fourth_down_regular",
  "fourth_down_playoff",
  "position_changes",
  "custom_coaches_required",
  "custom_playbooks_allowed",
  "coach_abilities_restricted",
  "trade_approval",
  "cpu_trading",
  "difficulty",
  "quarter_length",
  "accelerated_clock_enabled",
  "accelerated_clock_seconds",
  "salary_cap",
  "trade_deadline",
  "abilities",
  "wear_and_tear",
  "injury_policy",
  "coach_firing_policy",
  "preorder_bonuses",
  "coach_mode_enabled",
  "coach_mode_auto_pass",
  "coach_mode_auto_snap",
  "coach_mode_coach_suggestions",
  "coach_mode_recruit_flipping",
  "coach_mode_auto_recruiting",
  "coach_mode_auto_progress_players",
  "coach_mode_user_auto_progression",
  "coach_mode_cpu_manage_budget",
  "coach_mode_cpu_manage_staff",
  "coach_mode_cpu_manage_facilities",
  "ball_hawk",
  "heat_seeker",
  "switch_assist",
  "offensive_limits_enabled",
  "offensive_limit",
  "offensive_cooldown_enabled",
  "offensive_cooldown",
  "defensive_limits_enabled",
  "defensive_limit",
  "defensive_cooldown_enabled",
  "defensive_cooldown",
  "team_linking_optional",
  "activity_requirements",
  "default_schedule_confirm",
  "review"
];

export function createDefaultLeagueSetupDraft(name: string): LeagueSetupDraft {
  return {
    name,
    game: "madden_26",
    leaguePassword: null,
    step: "game",
    leagueType: "regular_rosters",
    activeRostersEnabled: true,
    seasonWeek: "training_camp",
    coinEconomyEnabled: false,
    customPlayersEnabled: false,
    legendsEnabled: false,
    devUpgradesEnabled: false,
    ageResetsEnabled: false,
    attributePurchasesEnabled: false,
    playerTraitPurchasesEnabled: false,
    contractAdjustmentPurchasesEnabled: false,
    mediaFeaturesEnabled: true,
    customPlayersSeasonCap: 0,
    legendsSeasonCap: 0,
    devUpgradesSeasonCap: 0,
    ageResetsSeasonCap: 0,
    playerTraitPurchasesSeasonCap: 0,
    contractPurchasesSeasonCap: 0,
    coreAttributePurchasesSeasonCap: 0,
    nonCoreAttributePurchasesSeasonCap: 0,
    coreAttributes: [],
    coreAttributeCapOverrides: {},
    customPlayersAllTimeCap: null,
    legendsAllTimeCap: null,
    devUpgradesAllTimeCap: null,
    ageResetsAllTimeCap: null,
    playerTraitPurchasesAllTimeCap: null,
    contractPurchasesAllTimeCap: null,
    coreAttributePurchasesAllTimeCap: null,
    nonCoreAttributePurchasesAllTimeCap: null,
    streamingRequirement: "recommended",
    regularSeasonStreamingRequirement: "recommended",
    postseasonStreamingRequirement: "required",
    streamingScope: "every_game",
    streamingSide: "either",
    regularSeasonStreamingSide: "either",
    postseasonStreamingSide: "either",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "standard_rec",
    customFourthDownRuleRegular: "",
    customFourthDownRulePlayoff: "",
    positionChangePolicy: "restricted",
    positionChangePolicyDescription: "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",
    customCoachesRequired: false,
    customPlaybooksAllowed: false,
    coachAbilitiesRestricted: false,
    coachAbilitiesRestrictionNotes: "",
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingAllowed: true,
    cpuTradingPolicy: "allowed",
    cpuTradingRestriction: "",
    cpuFreeAgencyPolicy: "disabled",
    injuryPolicy: "on_standard",
    difficulty: "all_madden",
    difficultyCustomSettings: "",
    quarterLengthMinutes: 8,
    acceleratedClockEnabled: true,
    acceleratedClockMinimumSeconds: 20,
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
    abilitiesEnabled: true,
    wearAndTearEnabled: true,
    coachFiringPolicy: "on",
    preorderBonusesEnabled: true,
    coachModeEnabled: false,
    coachModeAutoPassEnabled: false,
    coachModeAutoSnapEnabled: false,
    coachModeCoachSuggestionsEnabled: false,
    coachModeRecruitFlippingEnabled: false,
    coachModeAutoRecruitingEnabled: false,
    coachModeAutoProgressPlayersEnabled: false,
    coachModeUserAutoProgressionEnabled: false,
    coachModeCpuManageBudgetEnabled: false,
    coachModeCpuManageStaffEnabled: false,
    coachModeCpuManageFacilitiesEnabled: false,
    ballHawk: "keep_individual",
    heatSeeker: "keep_individual",
    switchAssist: "keep_individual",
    dynastyType: "real",
    recruitingDifficulty: "normal",
    transferPortalEnabled: true,
    coachCarouselEnabled: true,
    conferenceRealignment: "locked",
    conferenceAssignments: {},
    homeFieldAdvantageEnabled: true,
    stadiumPulseEnabled: true,
    teamBuilderAllowed: false,
    offensivePlayCallLimitsEnabled: false,
    offensivePlayCallLimit: null,
    offensivePlayCallCooldownEnabled: false,
    offensivePlayCallCooldown: null,
    defensivePlayCallLimitsEnabled: false,
    defensivePlayCallLimit: null,
    defensivePlayCallCooldownEnabled: false,
    defensivePlayCallCooldown: null,
    linkTeamsAfterSetup: false,
    seedDefaultSchedule: null,
    fairSimRequirements: "Fair Sims are the default for any game where users fail to schedule their game prior to advance time.",
    forceWinRequirements: "Force Wins can be requested if users agree to a scheduled time and one fails to appear within 1 hour of the elapsed game time.",
    commissionerOfficeChannelId: null,
    announcementsChannelId: null,
    headlinesChannelId: null,
    powerRankingsChannelId: null,
    votingPollsChannelId: null,
    streamsChannelId: null,
    highlightsChannelId: null,
    pendingPayoutsChannelId: null,
    pendingPurchasesChannelId: null,
    boxScoresChannelId: null,
    gameChannelsCategoryId: null,
    editMode: false
  };
}

function isStepOnForwardPath(draft: LeagueSetupDraft, target: LeagueSetupStep): boolean {
  let current: LeagueSetupStep = "game";
  const seen = new Set<LeagueSetupStep>();

  while (!seen.has(current)) {
    seen.add(current);
    if (current === target) return true;
    if (current === "review") return false;
    current = getNextLeagueSetupStep(current, draft);
  }

  return false;
}

export function getPreviousLeagueSetupStep(step: LeagueSetupStep, draft: LeagueSetupDraft): LeagueSetupStep | "admin_panel" {
  if (draft.editMode && step !== "settings_picker") return "settings_picker";

  const index = STEP_ORDER.indexOf(step);
  if (index <= 0) return "admin_panel";

  for (let i = index - 1; i >= 0; i--) {
    const candidate = STEP_ORDER[i];
    if (!isStepOnForwardPath(draft, candidate)) continue;
    if (getNextLeagueSetupStep(candidate, draft) === step) return candidate;
  }

  return "admin_panel";
}

/**
 * Gets the next setup step in sequence
 *
 * @param step Current setup step
 * @param draft Current setup draft
 * @returns Next step to display
 */
function streamingUserSettingApplies(requirement: LeagueSetupDraft["regularSeasonStreamingRequirement"]) {
  return requirement === "required" || requirement === "recommended";
}

export function getNextLeagueSetupStep(step: LeagueSetupStep, draft: LeagueSetupDraft): LeagueSetupStep {
  const isCfb = draft.game === "cfb_27";

  // The CFB dynasty block (dynasty_structure … stadium_pulse) sits between league_type and
  // economy. Madden titles skip the entire block; CFB walks through it via STEP_ORDER.
  if (step === "league_type" && !isCfb) return "economy";

  // CFB has Campus Legends (a plain toggle rendered by buildPurchaseSettingWindow) but no
  // Age Resets or Contract Purchases — skip those purchase steps.
  if (isCfb && step === "dev_upgrades") return "attribute_purchases";
  if (isCfb && step === "player_trait_purchases") return "server_setup";

  // Conference realignment editor only applies when realignment is allowed (CFB only —
  // conference_realignment is unreachable for Madden titles, see the dynasty-block skip above).
  if (step === "conference_realignment" && draft.conferenceRealignment !== "allowed") return "home_field_advantage";

  // CFB has no Salary Cap, Trade Deadline, or Abilities gameplay toggles.
  if (isCfb && step === "accelerated_clock_seconds") return "wear_and_tear";

  // CFB has no NFL default-schedule seeding question.
  if (isCfb && step === "activity_requirements") return "review";

  // CFB drops Position Change Policy entirely, and Coach Abilities/Trade Approval/CPU Trading
  // after Custom Playbooks — it keeps Custom Coaches Required and Custom Playbooks Allowed.
  if (isCfb && step === "fourth_down_playoff") return "custom_coaches_required";
  if (isCfb && step === "custom_playbooks_allowed") return "difficulty";

  // Coach Mode sub-settings only apply when Coach Mode itself is enabled — skip straight past
  // all ten individual sub-toggle steps to the assist settings block.
  if (step === "coach_mode_enabled" && !draft.coachModeEnabled) return "ball_hawk";

  // The last Madden-visible Coach Mode sub-toggle is Coach Suggestions — the remaining seven
  // (recruiting/staff/budget management) are CFB-only, so Madden jumps straight to Ball Hawk.
  if (!isCfb && step === "coach_mode_coach_suggestions") return "ball_hawk";

  // Economy gates the consecutive purchase-feature section.
  if (step === "economy" && !draft.coinEconomyEnabled) return "server_setup";

  if (step === "attribute_purchases" && !draft.attributePurchasesEnabled) return "player_trait_purchases";
  if (step === "attribute_purchases" && draft.attributePurchasesEnabled) return "attribute_core_attributes";

  if (step === "regular_season_streaming" && !streamingUserSettingApplies(draft.regularSeasonStreamingRequirement)) {
    return "postseason_streaming";
  }

  if (step === "postseason_streaming" && !streamingUserSettingApplies(draft.postseasonStreamingRequirement)) {
    return "fourth_down_regular";
  }

  // Skip accelerated clock seconds question if accelerated clock is disabled.
  // CFB then skips straight past the Madden-only salary cap / trade deadline / abilities toggles.
  if (step === "accelerated_clock_enabled" && !draft.acceleratedClockEnabled) return isCfb ? "wear_and_tear" : "salary_cap";

  // Offensive: limit and cooldown are independent features, each with its own enable toggle.
  if (step === "offensive_limits_enabled" && !draft.offensivePlayCallLimitsEnabled) return "offensive_cooldown_enabled";
  if (step === "offensive_cooldown_enabled" && !draft.offensivePlayCallCooldownEnabled) return "defensive_limits_enabled";

  // Defensive: limit and cooldown are independent features, each with its own enable toggle.
  if (step === "defensive_limits_enabled" && !draft.defensivePlayCallLimitsEnabled) return "defensive_cooldown_enabled";
  if (step === "defensive_cooldown_enabled" && !draft.defensivePlayCallCooldownEnabled) return "team_linking_optional";

  const index = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)];
}
