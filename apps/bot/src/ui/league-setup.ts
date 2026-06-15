import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const LEAGUE_SETUP_CUSTOM_IDS = {
  leagueType: "rec:league_setup:league_type",
  importMode: "rec:league_setup:import_mode",
  seasonWeek: "rec:league_setup:season_week",
  featureToggles: "rec:league_setup:features",
  draftClassType: "rec:league_setup:draft_class_type",
  regularSeasonStreaming: "rec:league_setup:streaming_regular",
  postseasonStreaming: "rec:league_setup:streaming_postseason",
  streamingSide: "rec:league_setup:streaming_side",
  fourthDownRuleRegular: "rec:league_setup:fourth_down_rule_regular",
  fourthDownRulePlayoff: "rec:league_setup:fourth_down_rule_playoff",
  positionChangePolicy: "rec:league_setup:position_changes",
  tradeApprovalPolicy: "rec:league_setup:trade_approval",
  cpuRules: "rec:league_setup:cpu_rules",
  difficulty: "rec:league_setup:difficulty",
  quarterLength: "rec:league_setup:quarter_length",
  acceleratedClockEnabled: "rec:league_setup:accelerated_clock_enabled",
  acceleratedClockSeconds: "rec:league_setup:accelerated_clock_seconds",
  salaryCap: "rec:league_setup:salary_cap",
  tradeDeadline: "rec:league_setup:trade_deadline",
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
  coachAbilitiesRestrictionInput: "rec:league_setup:coach_abilities_restriction_input"
} as const;

export type LeagueSetupSettingsCategory = "rules" | "gameplay" | "play_call" | "features";

export type LeagueSetupStep =
  | "league_type"
  | "import_mode"
  | "season_week"
  | "features"
  | "draft_class_type"
  | "regular_season_streaming"
  | "streaming_side"
  | "postseason_streaming"
  | "fourth_down_regular"
  | "fourth_down_playoff"
  | "position_changes"
  | "custom_coaches_required"
  | "custom_playbooks_allowed"
  | "coach_abilities_restricted"
  | "trade_approval"
  | "cpu_rules"
  | "difficulty"
  | "quarter_length"
  | "accelerated_clock_enabled"
  | "accelerated_clock_seconds"
  | "salary_cap"
  | "trade_deadline"
  | "abilities"
  | "wear_and_tear"
  | "injury_policy"
  | "offensive_limits_enabled"
  | "offensive_limit"
  | "offensive_cooldown_enabled"
  | "offensive_cooldown"
  | "defensive_limits_enabled"
  | "defensive_limit"
  | "defensive_cooldown_enabled"
  | "defensive_cooldown"
  | "team_linking_optional"
  | "activity_requirements"
  | "settings_picker"
  | "review";

export type LeagueSetupDraft = {
  name: string;
  step: LeagueSetupStep;
  leagueType: "fantasy_draft" | "regular_rosters" | "custom_rosters";
  importMode: "manual" | "ea_import" | "companion_app_export";
  seasonWeek: string;
  coinEconomyEnabled: boolean;
  customPlayersEnabled: boolean;
  legendsEnabled: boolean;
  devUpgradesEnabled: boolean;
  ageResetsEnabled: boolean;
  trainingPackagesEnabled: boolean;
  contractAdjustmentPurchasesEnabled: boolean;
  capManagementAssistantEnabled: boolean;
  draftClassFeaturesEnabled: boolean;
  draftClassType: "custom" | "auto_gen" | "realistic" | "other";
  scoutingPurchasesEnabled: boolean;
  mediaFeaturesEnabled: boolean;
  streamingRequirement: "required" | "recommended" | "disabled";
  regularSeasonStreamingRequirement: "required" | "recommended" | "disabled";
  postseasonStreamingRequirement: "required" | "recommended" | "disabled";
  streamingScope: "every_game" | "playoffs_only";
  streamingSide: "home" | "away" | "either" | "both";
  fourthDownRuleTypeRegular: "none" | "standard_rec" | "custom";
  fourthDownRuleTypePlayoff: "none" | "standard_rec" | "custom";
  positionChangePolicy: "open" | "restricted" | "highly_restricted";
  customCoachesRequired: boolean;
  customPlaybooksAllowed: boolean;
  coachAbilitiesRestricted: boolean;
  coachAbilitiesRestrictionNotes: string;
  tradeApprovalPolicy: "no_approval_required" | "commissioner_review" | "competition_committee_review";
  cpuTradingAllowed: boolean;
  cpuFreeAgencyPolicy: "open" | "restricted" | "disabled";
  injuryPolicy: "off" | "on_standard" | "on_reduced";
  difficulty: "rookie" | "pro" | "all_pro" | "all_madden";
  quarterLengthMinutes: number;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number;
  salaryCapEnabled: boolean;
  tradeDeadlineEnabled: boolean;
  abilitiesEnabled: boolean;
  wearAndTearEnabled: boolean;
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
  fairSimRequirements: string;
  forceWinRequirements: string;
  // When true, changes are saved to DB immediately after each step and return to settings_picker.
  editMode: boolean;
};

const STEP_ORDER: LeagueSetupStep[] = [
  "league_type",
  "import_mode",
  "season_week",
  "features",
  "draft_class_type",
  "regular_season_streaming",
  "streaming_side",
  "postseason_streaming",
  "fourth_down_regular",
  "fourth_down_playoff",
  "position_changes",
  "custom_coaches_required",
  "custom_playbooks_allowed",
  "coach_abilities_restricted",
  "trade_approval",
  "cpu_rules",
  "difficulty",
  "quarter_length",
  "accelerated_clock_enabled",
  "accelerated_clock_seconds",
  "salary_cap",
  "trade_deadline",
  "abilities",
  "wear_and_tear",
  "injury_policy",
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
  "review"
];

export function createDefaultLeagueSetupDraft(name: string): LeagueSetupDraft {
  return {
    name,
    step: "league_type",
    leagueType: "regular_rosters",
    importMode: "manual",
    seasonWeek: "week_1",
    coinEconomyEnabled: false,
    customPlayersEnabled: false,
    legendsEnabled: false,
    devUpgradesEnabled: false,
    ageResetsEnabled: false,
    trainingPackagesEnabled: false,
    contractAdjustmentPurchasesEnabled: false,
    capManagementAssistantEnabled: false,
    draftClassFeaturesEnabled: false,
    draftClassType: "auto_gen",
    scoutingPurchasesEnabled: false,
    mediaFeaturesEnabled: true,
    streamingRequirement: "recommended",
    regularSeasonStreamingRequirement: "recommended",
    postseasonStreamingRequirement: "required",
    streamingScope: "every_game",
    streamingSide: "either",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "standard_rec",
    positionChangePolicy: "restricted",
    customCoachesRequired: false,
    customPlaybooksAllowed: false,
    coachAbilitiesRestricted: false,
    coachAbilitiesRestrictionNotes: "",
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingAllowed: true,
    cpuFreeAgencyPolicy: "open",
    injuryPolicy: "on_standard",
    difficulty: "all_madden",
    quarterLengthMinutes: 8,
    acceleratedClockEnabled: true,
    acceleratedClockMinimumSeconds: 20,
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
    abilitiesEnabled: true,
    wearAndTearEnabled: true,
    offensivePlayCallLimitsEnabled: false,
    offensivePlayCallLimit: null,
    offensivePlayCallCooldownEnabled: false,
    offensivePlayCallCooldown: null,
    defensivePlayCallLimitsEnabled: false,
    defensivePlayCallLimit: null,
    defensivePlayCallCooldownEnabled: false,
    defensivePlayCallCooldown: null,
    linkTeamsAfterSetup: false,
    fairSimRequirements: "",
    forceWinRequirements: "",
    editMode: false
  };
}

export function getPreviousLeagueSetupStep(step: LeagueSetupStep): LeagueSetupStep | "admin_panel" {
  const index = STEP_ORDER.indexOf(step);
  if (index <= 0) return "admin_panel";
  return STEP_ORDER[index - 1];
}

/**
 * Gets the next setup step in sequence
 *
 * @param step Current setup step
 * @param draft Current setup draft
 * @returns Next step to display
 */
export function getNextLeagueSetupStep(step: LeagueSetupStep, draft: LeagueSetupDraft): LeagueSetupStep {
  // Skip streaming_side if regular season streaming is disabled (no side to configure)
  if (step === "regular_season_streaming" && draft.regularSeasonStreamingRequirement === "disabled") return "postseason_streaming";

  // Skip accelerated clock seconds question if accelerated clock is disabled
  if (step === "accelerated_clock_enabled" && !draft.acceleratedClockEnabled) return "salary_cap";

  // Offensive: limit and cooldown are independent features, each with its own enable toggle.
  if (step === "offensive_limits_enabled" && !draft.offensivePlayCallLimitsEnabled) return "offensive_cooldown_enabled";
  if (step === "offensive_cooldown_enabled" && !draft.offensivePlayCallCooldownEnabled) return "defensive_limits_enabled";

  // Defensive: limit and cooldown are independent features, each with its own enable toggle.
  if (step === "defensive_limits_enabled" && !draft.defensivePlayCallLimitsEnabled) return "defensive_cooldown_enabled";
  if (step === "defensive_cooldown_enabled" && !draft.defensivePlayCallCooldownEnabled) return "team_linking_optional";

  const index = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)];
}

export function buildCustomCoachesRequiredWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Custom Coaches Required?", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.customCoachesRequired, "Are custom coaches required?", [
        option("Yes", "yes"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCustomPlaybooksAllowedWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Custom Playbooks Allowed?", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.customPlaybooksAllowedSelect, "Are custom playbooks allowed?", [
        option("Yes", "yes"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCoachAbilitiesRestrictedWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Coach Abilities Restricted?", draft);
  if (draft.coachAbilitiesRestrictionNotes) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.coachAbilitiesRestrictionNotes.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestricted, "Are coach abilities restricted?", [
        option("Yes - Set custom restrictions", "yes_custom"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCoachAbilitiesRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionModal)
    .setTitle("Coach Ability Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionInput)
          .setLabel("Custom coach ability restriction notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.coachAbilitiesRestrictionNotes ?? "")
          .setPlaceholder("e.g., No strategist tree, no offseason boost abilities, etc.")
      )
    );
}

function baseEmbed(title: string, draft: LeagueSetupDraft) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Use the selector below. Every screen includes Back and Main Menu controls."
    ].join("\n"));
}

function selectRow(customId: string, placeholder: string, options: StringSelectMenuOptionBuilder[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(...options)
  );
}

function option(label: string, value: string, description?: string) {
  const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
  if (description) opt.setDescription(description);
  return opt;
}

function yesNoOptions() {
  return [option("On / Enabled", "yes"), option("Off / Disabled", "no")];
}

function boolText(value: boolean) {
  return value ? "On" : "Off";
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function fmt(value: string) {
  return value.replaceAll("_", " ");
}

export function buildLeagueTypeWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: League Type", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.leagueType, "Select league type", [
        option("Regular Rosters", "regular_rosters"),
        option("Fantasy Draft", "fantasy_draft"),
        option("Custom Rosters", "custom_rosters")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildImportModeWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Import Mode", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.importMode, "Select import mode", [
        option("Manual", "manual"),
        option("Import from EA", "ea_import"),
        option("Export from Companion App", "companion_app_export")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildSeasonWeekWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Current Season Week", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.seasonWeek, "Select the current week/stage", [
        ...Array.from({ length: 18 }, (_, i) => option(`Regular Season Week ${i + 1}`, `week_${i + 1}`)),
        option("Wildcard Round", "wildcard"),
        option("Divisional Round", "divisional"),
        option("Conference Championship", "conference"),
        option("Super Bowl", "super_bowl"),
        option("Coach Hiring Stage", "coach_hiring"),
        option("Final Resigning Stage", "final_resigning")
      ]),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.seasonWeek}:postseason`)
          .setPlaceholder("Or select offseason stage")
          .addOptions(
            option("Free Agency", "free_agency"),
            option("Draft", "draft"),
            option("Training Camp / Preseason", "training_camp")
          )
      ),
      buildNavigationRow()
    ]
  };
}

export function buildFeatureTogglesWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Feature Configuration", draft)
    .addFields({
      name: "Dependency Notes",
      value: [
        "Coin Economy OFF automatically disables economy purchase features.",
        "Salary Cap OFF automatically disables Cap Assistant and Contract Purchases.",
        "Draft Class Features OFF automatically disables scouting purchases."
      ].join("\n")
    });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureToggles)
      .setPlaceholder("Select enabled features")
      .setMinValues(0)
      .setMaxValues(10)
      .addOptions(
        option("Coin Economy", "coin_economy"),
        option("Custom Players", "custom_players"),
        option("Legends", "legends"),
        option("Dev Upgrades", "dev_upgrades"),
        option("Age Resets", "age_resets"),
        option("Training & Packages", "training_packages"),
        option("Contract Adjustment Purchases", "contract_purchases"),
        option("Cap Management Assistant", "cap_assistant"),
        option("Draft Class Features", "draft_class_features"),
        option("Media Features", "media_features")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildDraftClassTypeWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Draft Class Type", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.draftClassType, "Select draft class type", [
        option("Auto-Gen", "auto_gen"),
        option("Custom", "custom"),
        option("Realistic", "realistic"),
        option("Other", "other")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildRegularSeasonStreamingWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Regular Season Streaming", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming, "Regular season streaming requirement", [
        option("Required", "required"),
        option("Recommended", "recommended"),
        option("Disabled", "disabled")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPostseasonStreamingWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Postseason Streaming", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming, "Postseason streaming requirement", [
        option("Required", "required"),
        option("Recommended", "recommended"),
        option("Disabled", "disabled")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildStreamingSideWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Required Streaming Side", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.streamingSide, "Who must stream when streaming is required?", [
        option("Home Team", "home"),
        option("Away Team", "away"),
        option("Either Team", "either"),
        option("Both Teams", "both")
      ]),
      buildNavigationRow()
    ]
  };
}

/**
 * Build 4th down rules window for either regular season or playoff
 * Allows different rules to apply in different phases of the season
 *
 * @param draft Current setup draft
 * @param phase "Regular Season" or "Playoff" to show in title
 * @returns Embed and components for 4th down rule selection
 */
export function buildFourthDownWindow(draft: LeagueSetupDraft, phase: "Regular Season" | "Playoff" = "Regular Season") {
  // Determine which rule to display based on phase
  const customId = phase === "Playoff" ? LEAGUE_SETUP_CUSTOM_IDS.fourthDownRulePlayoff : LEAGUE_SETUP_CUSTOM_IDS.fourthDownRuleRegular;

  return {
    embeds: [baseEmbed(`League Setup: 4th Down Rules - ${phase}`, draft)],
    components: [
      selectRow(customId, "Select 4th down rule", [
        option("No 4th Down Rules", "none"),
        option("Standard REC Rule", "standard_rec", "Past midfield and 4th & 3 or less; trailing in second half can go anytime."),
        option("Custom 4th Down Rules", "custom")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPositionChangeWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Position Changes", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.positionChangePolicy, "Select position change policy", [
        option("Open", "open"),
        option("Restricted", "restricted", "Realistic changes only."),
        option("Highly Restricted", "highly_restricted", "Same-group changes only unless approved.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildTradeApprovalWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Trade Approval", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.tradeApprovalPolicy, "Select trade approval rule", [
        option("No Approval Required", "no_approval_required"),
        option("Commissioner Review", "commissioner_review"),
        option("Competition Committee Review", "competition_committee_review")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCpuRulesWindow(draft: LeagueSetupDraft) {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cpuRules)
      .setPlaceholder("Select CPU rules")
      .setMinValues(1)
      .setMaxValues(2)
      .addOptions(
        option("CPU Trading Allowed", "cpu_trading"),
        option("CPU Free Agency Open", "cpu_fa_open")
      )
  );

  return { embeds: [baseEmbed("League Setup: CPU Rules", draft)], components: [row, buildNavigationRow()] };
}

export function buildDifficultyWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Difficulty", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.difficulty, "Select difficulty", [
        option("Rookie", "rookie"),
        option("Pro", "pro"),
        option("All-Pro", "all_pro"),
        option("All-Madden", "all_madden")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildQuarterLengthWindow(draft: LeagueSetupDraft) {
  const options = Array.from({ length: 12 }, (_, index) => index + 4).map((minutes) =>
    option(`${minutes} Minutes`, String(minutes))
  );

  return {
    embeds: [baseEmbed("Gameplay: Quarter Length", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.quarterLength, "Select quarter length", options), buildNavigationRow()]
  };
}

export function buildAcceleratedClockEnabledWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Accelerated Clock", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockEnabled, "Accelerated clock enabled?", yesNoOptions()), buildNavigationRow()]
  };
}

export function buildAcceleratedClockSecondsWindow(draft: LeagueSetupDraft) {
  const options = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((seconds) =>
    option(`${seconds} Seconds`, String(seconds))
  );

  return {
    embeds: [baseEmbed("Gameplay: Accelerated Clock Seconds", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockSeconds, "Select minimum play clock seconds", options), buildNavigationRow()]
  };
}

export function buildBooleanGameplayWindow(draft: LeagueSetupDraft, title: string, customId: string, placeholder: string) {
  return {
    embeds: [baseEmbed(title, draft)],
    components: [selectRow(customId, placeholder, yesNoOptions()), buildNavigationRow()]
  };
}

export function buildInjuryPolicyWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Injuries", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.injuryPolicy, "Select injury setting", [
        option("On", "on_standard"),
        option("Reduced", "on_reduced"),
        option("Off", "off")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPlayCallNumberWindow(draft: LeagueSetupDraft, title: string, customId: string, placeholder: string, isCooldown: boolean = false) {
  const options = Array.from({ length: 10 }, (_, index) => index + 1).map((value) =>
    option(String(value), String(value), isCooldown ? `${value} plays required before repeating` : undefined)
  );
  return {
    embeds: [baseEmbed(title, draft)],
    components: [selectRow(customId, placeholder, options), buildNavigationRow()]
  };
}

/**
 * Build role selection window for commissioner or committee role
 * NOTE: In a full implementation, this would fetch available Discord roles
 * and display a role select menu. For now, this stores the role ID from
 * the subsequent role-assign handler in index.ts
 *
 * @param draft Current setup draft
 * @param title Role name (e.g., "Commissioner Role")
 * @param customId Custom ID for this role selection
 * @param placeholder Placeholder text
 * @returns Embed and components for role info/next button
 */
export function buildRoleWindow(draft: LeagueSetupDraft, title: string, customId: string, placeholder: string) {
  return {
    embeds: [baseEmbed(`League Setup: ${title}`, draft)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(`Select ${title}`)
          .setStyle(ButtonStyle.Primary)
      ),
      buildNavigationRow()
    ]
  };
}

export function buildActivityRequirementsWindow(draft: LeagueSetupDraft) {
  const lines = [
    `League: **${draft.name}**`,
    "",
    "Enter your league's Fair Sim and Force Win rules. These appear in the rules panel and game channel embeds.",
    "",
    draft.fairSimRequirements ? `**Fair Sim:** ${draft.fairSimRequirements}` : "Fair Sim: Not set",
    draft.forceWinRequirements ? `**Force Win:** ${draft.forceWinRequirements}` : "Force Win: Not set"
  ].join("\n");
  return {
    embeds: [new EmbedBuilder().setTitle("League Setup: Activity Requirements").setDescription(lines)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsOpen).setLabel("Enter Activity Requirements").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsSkip).setLabel("Skip / Continue").setStyle(ButtonStyle.Secondary)
      ),
      buildNavigationRow()
    ]
  };
}

export function buildActivityRequirementsModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsModal)
    .setTitle("Activity Requirements")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.fairSimInput)
          .setLabel("Fair Sim Requirements")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(draft.fairSimRequirements ?? "")
          .setPlaceholder("e.g., Request a Fair Sim after 48 hours of no response.")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.forceWinInput)
          .setLabel("Force Win Requirements")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(draft.forceWinRequirements ?? "")
          .setPlaceholder("e.g., Request a Force Win after 72 hours of no response.")
      )
    );
}

function settingsCategoryLabel(category: LeagueSetupSettingsCategory) {
  switch (category) {
    case "rules": return "Rules & Policies";
    case "gameplay": return "Gameplay Settings";
    case "play_call": return "Play Call Settings";
    case "features": return "Features & Activity";
  }
}

export function buildSettingsPickerWindow(draft: LeagueSetupDraft, category?: LeagueSetupSettingsCategory) {
  if (!category) {
    return {
      embeds: [new EmbedBuilder().setTitle("Edit League Settings").setDescription(`League: **${draft.name}**\n\nChoose a settings category. Changes are saved immediately.`)],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.settingsPicker)
            .setPlaceholder("Select a settings category")
            .addOptions(
              option("Rules & Policies", "category:rules"),
              option("Gameplay Settings", "category:gameplay"),
              option("Play Call Settings", "category:play_call"),
              option("Features & Activity", "category:features")
            )
        ),
        buildNavigationRow({ includeAdminPanel: true })
      ]
    };
  }

  const categoryOptions: Record<LeagueSetupSettingsCategory, StringSelectMenuOptionBuilder[]> = {
    rules: [
      option("Regular Season Streaming", "regular_season_streaming"),
      option("Streaming Side (Who Must Stream)", "streaming_side"),
      option("Postseason Streaming", "postseason_streaming"),
      option("4th Down Rules (Regular Season)", "fourth_down_regular"),
      option("4th Down Rules (Playoff)", "fourth_down_playoff"),
      option("Custom Coaches Required?", "custom_coaches_required"),
      option("Custom Playbooks Allowed?", "custom_playbooks_allowed"),
      option("Coach Ability Restrictions", "coach_abilities_restricted"),
      option("Position Change Policy", "position_changes"),
      option("Trade Approval Policy", "trade_approval"),
      option("CPU Rules", "cpu_rules")
    ],
    gameplay: [
      option("Difficulty", "difficulty"),
      option("Quarter Length", "quarter_length"),
      option("Accelerated Clock", "accelerated_clock_enabled"),
      option("Salary Cap", "salary_cap"),
      option("Trade Deadline", "trade_deadline"),
      option("Abilities", "abilities"),
      option("Wear & Tear", "wear_and_tear"),
      option("Injuries", "injury_policy")
    ],
    play_call: [
      option("Offensive Play Call Limits", "offensive_limits_enabled"),
      option("Offensive Play Call Cooldown", "offensive_cooldown_enabled"),
      option("Defensive Play Call Limits", "defensive_limits_enabled"),
      option("Defensive Play Call Cooldown", "defensive_cooldown_enabled")
    ],
    features: [
      option("Feature Toggles", "features"),
      option("Draft Class Type", "draft_class_type"),
      option("Activity Requirements (Fair Sim / Force Win)", "activity_requirements")
    ]
  };

  return {
    embeds: [new EmbedBuilder().setTitle(`Edit League Settings: ${settingsCategoryLabel(category)}`).setDescription(`League: **${draft.name}**\n\nSelect a setting to edit. Changes are saved immediately.`)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.settingsPicker)
          .setPlaceholder("Select a setting to edit")
          .addOptions(
            ...categoryOptions[category],
            option("Back to Categories", "settings_categories")
          )
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}

export function buildTeamLinkingOptionalWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Link Teams (Optional)", draft)
      .setFooter({ text: "Linking opens right after you save the league on the next screen." })],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.teamLinkingOptional, "Link teams to users after saving?", [
        option("Yes, link teams after saving", "yes"),
        option("No, I'll link later", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildLeagueSetupReviewWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("Review League Setup")
    .setDescription([`League: **${draft.name}**`, "", "Review the configuration below, then save the league."].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [`Type: ${fmt(draft.leagueType)}`, `Import Mode: ${fmt(draft.importMode)}`, `Current Week: ${fmt(draft.seasonWeek)}`, `Draft Class Type: ${fmt(draft.draftClassType)}`].join("\n"),
        inline: true
      },
      {
        name: "Features",
        value: [
          `Economy: ${yesNo(draft.coinEconomyEnabled)}`,
          `Custom Players: ${yesNo(draft.customPlayersEnabled)}`,
          `Legends: ${yesNo(draft.legendsEnabled)}`,
          `Dev Upgrades: ${yesNo(draft.devUpgradesEnabled)}`,
          `Age Resets: ${yesNo(draft.ageResetsEnabled)}`,
          `Training: ${yesNo(draft.trainingPackagesEnabled)}`,
          `Contract Purchases: ${yesNo(draft.contractAdjustmentPurchasesEnabled)}`,
          `Draft Classes: ${yesNo(draft.draftClassFeaturesEnabled)}`,
          `Media: ${yesNo(draft.mediaFeaturesEnabled)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Rules",
        value: [
          `Regular Season Streaming: ${fmt(draft.regularSeasonStreamingRequirement)}`,
          `Postseason Streaming: ${fmt(draft.postseasonStreamingRequirement)}`,
          `Required Streaming Side: ${fmt(draft.streamingSide)}`,
          `4th Down (Regular Season): ${fmt(draft.fourthDownRuleTypeRegular)}`,
          `4th Down (Playoff): ${fmt(draft.fourthDownRuleTypePlayoff)}`,
          `Position Changes: ${fmt(draft.positionChangePolicy)}`,
          `Custom Coaches Required: ${yesNo(draft.customCoachesRequired)}`,
          `Custom Playbooks Allowed: ${yesNo(draft.customPlaybooksAllowed)}`,
          `Coach Abilities Restricted: ${yesNo(draft.coachAbilitiesRestricted)}${draft.coachAbilitiesRestricted && draft.coachAbilitiesRestrictionNotes ? ` - ${draft.coachAbilitiesRestrictionNotes}` : ""}`,
          `Trade Approval: ${fmt(draft.tradeApprovalPolicy)}`,
          `CPU Trading: ${yesNo(draft.cpuTradingAllowed)}`,
          `CPU Free Agency: ${fmt(draft.cpuFreeAgencyPolicy)}`,
          `Fair Sim: ${draft.fairSimRequirements || "Not set"}`,
          `Force Win: ${draft.forceWinRequirements || "Not set"}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Gameplay",
        value: [
          `Difficulty: ${fmt(draft.difficulty)}`,
          `Quarter Length: ${draft.quarterLengthMinutes}`,
          `Accelerated Clock: ${boolText(draft.acceleratedClockEnabled)}${draft.acceleratedClockEnabled ? ` (${draft.acceleratedClockMinimumSeconds}s)` : ""}`,
          `Salary Cap: ${boolText(draft.salaryCapEnabled)}`,
          `Trade Deadline: ${boolText(draft.tradeDeadlineEnabled)}`,
          `Abilities: ${boolText(draft.abilitiesEnabled)}`,
          `Wear & Tear: ${boolText(draft.wearAndTearEnabled)}`,
          `Injuries: ${fmt(draft.injuryPolicy)}`,
          `Offense Limit: ${draft.offensivePlayCallLimitsEnabled ? `${draft.offensivePlayCallLimit ?? "?"} max/game` : "Off"}`,
          `Offense Cooldown: ${draft.offensivePlayCallCooldownEnabled ? `${draft.offensivePlayCallCooldown ?? "?"} plays before repeat` : "Off"}`,
          `Defense Limit: ${draft.defensivePlayCallLimitsEnabled ? `${draft.defensivePlayCallLimit ?? "?"} max/game` : "Off"}`,
          `Defense Cooldown: ${draft.defensivePlayCallCooldownEnabled ? `${draft.defensivePlayCallCooldown ?? "?"} plays before repeat` : "Off"}`
        ].join("\n"),
        inline: false
      }
    )
    .setFooter({ text: "Economy payouts activate for linked users when Coin Economy is enabled." });

  const saveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.save)
      .setLabel("Save League Setup")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [saveRow, buildNavigationRow()] };
}

export function buildLeagueSetupWindow(draft: LeagueSetupDraft) {
  switch (draft.step) {
    case "league_type": return buildLeagueTypeWindow(draft);
    case "import_mode": return buildImportModeWindow(draft);
    case "season_week": return buildSeasonWeekWindow(draft);
    case "features": return buildFeatureTogglesWindow(draft);
    case "draft_class_type": return buildDraftClassTypeWindow(draft);
    case "regular_season_streaming": return buildRegularSeasonStreamingWindow(draft);
    case "postseason_streaming": return buildPostseasonStreamingWindow(draft);
    case "streaming_side": return buildStreamingSideWindow(draft);
    case "fourth_down_regular": return buildFourthDownWindow(draft, "Regular Season");
    case "fourth_down_playoff": return buildFourthDownWindow(draft, "Playoff");
    case "position_changes": return buildPositionChangeWindow(draft);
    case "custom_coaches_required": return buildCustomCoachesRequiredWindow(draft);
    case "custom_playbooks_allowed": return buildCustomPlaybooksAllowedWindow(draft);
    case "coach_abilities_restricted": return buildCoachAbilitiesRestrictedWindow(draft);
    case "trade_approval": return buildTradeApprovalWindow(draft);
    case "cpu_rules": return buildCpuRulesWindow(draft);
    case "difficulty": return buildDifficultyWindow(draft);
    case "quarter_length": return buildQuarterLengthWindow(draft);
    case "accelerated_clock_enabled": return buildAcceleratedClockEnabledWindow(draft);
    case "accelerated_clock_seconds": return buildAcceleratedClockSecondsWindow(draft);
    case "salary_cap": return buildBooleanGameplayWindow(draft, "Gameplay: Salary Cap", LEAGUE_SETUP_CUSTOM_IDS.salaryCap, "Salary cap enabled?");
    case "trade_deadline": return buildBooleanGameplayWindow(draft, "Gameplay: Trade Deadline", LEAGUE_SETUP_CUSTOM_IDS.tradeDeadline, "Trade deadline enabled?");
    case "abilities": return buildBooleanGameplayWindow(draft, "Gameplay: Abilities", LEAGUE_SETUP_CUSTOM_IDS.abilities, "Abilities enabled?");
    case "wear_and_tear": return buildBooleanGameplayWindow(draft, "Gameplay: Wear & Tear", LEAGUE_SETUP_CUSTOM_IDS.wearAndTear, "Wear & Tear enabled?");
    case "injury_policy": return buildInjuryPolicyWindow(draft);
    case "offensive_limits_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Offensive Play Call Limits", LEAGUE_SETUP_CUSTOM_IDS.offensiveLimitsEnabled, "Offensive play call limits enabled?");
    case "offensive_limit": return buildPlayCallNumberWindow(draft, "Gameplay: Offensive Play Call Limit", LEAGUE_SETUP_CUSTOM_IDS.offensiveLimit, "Select max times a play can be called per game");
    case "offensive_cooldown_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Offensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldownEnabled, "Offensive play call cooldown enabled?");
    case "offensive_cooldown": return buildPlayCallNumberWindow(draft, "Gameplay: Offensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown, "Select plays required before repeating", true);
    case "defensive_limits_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Defensive Play Call Limits", LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled, "Defensive play call limits enabled?");
    case "defensive_limit": return buildPlayCallNumberWindow(draft, "Gameplay: Defensive Play Call Limit", LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit, "Select max times a play can be called per game");
    case "defensive_cooldown_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Defensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldownEnabled, "Defensive play call cooldown enabled?");
    case "defensive_cooldown": return buildPlayCallNumberWindow(draft, "Gameplay: Defensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown, "Select plays required before repeating", true);
    case "team_linking_optional": return buildTeamLinkingOptionalWindow(draft);
    case "activity_requirements": return buildActivityRequirementsWindow(draft);
    case "settings_picker": return buildSettingsPickerWindow(draft);
    case "review": return buildLeagueSetupReviewWindow(draft);
  }
}

export function applyLeagueSetupDependencies(draft: LeagueSetupDraft) {
  draft.streamingRequirement = draft.regularSeasonStreamingRequirement;
  draft.streamingScope = draft.postseasonStreamingRequirement === "required" && draft.regularSeasonStreamingRequirement !== "required" ? "playoffs_only" : "every_game";

  if (!draft.coinEconomyEnabled) {
    draft.customPlayersEnabled = false;
    draft.legendsEnabled = false;
    draft.devUpgradesEnabled = false;
    draft.ageResetsEnabled = false;
    draft.trainingPackagesEnabled = false;
    draft.contractAdjustmentPurchasesEnabled = false;
  }

  if (!draft.draftClassFeaturesEnabled) {
    draft.scoutingPurchasesEnabled = false;
  }

  if (!draft.salaryCapEnabled) {
    draft.capManagementAssistantEnabled = false;
    draft.contractAdjustmentPurchasesEnabled = false;
  }

  if (!draft.acceleratedClockEnabled) {
    draft.acceleratedClockMinimumSeconds = 0;
  }

  if (!draft.coachAbilitiesRestricted) {
    draft.coachAbilitiesRestrictionNotes = "";
  }

  if (!draft.offensivePlayCallLimitsEnabled) {
    draft.offensivePlayCallLimit = null;
  }
  if (!draft.offensivePlayCallCooldownEnabled) {
    draft.offensivePlayCallCooldown = null;
  }

  if (!draft.defensivePlayCallLimitsEnabled) {
    draft.defensivePlayCallLimit = null;
  }
  if (!draft.defensivePlayCallCooldownEnabled) {
    draft.defensivePlayCallCooldown = null;
  }

  return draft;
}
