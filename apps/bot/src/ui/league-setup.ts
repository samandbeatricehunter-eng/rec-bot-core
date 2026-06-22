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
import { buildNavigationRow, NAV_CUSTOM_IDS } from "./navigation.js";

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
  postseasonStreaming: "rec:league_setup:streaming_postseason",
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
  coachAbilitiesRestrictionInput: "rec:league_setup:coach_abilities_restriction_input",
  reviewJump: "rec:league_setup:review_jump"
} as const;

export type LeagueSetupSettingsCategory = "features" | "server" | "rules" | "gameplay" | "play_call";

export type LeagueGame = "madden_26" | "madden_27" | "cfb_27";

export const LEAGUE_GAME_OPTIONS: Record<LeagueGame, string> = {
  madden_26: "Madden NFL 26",
  madden_27: "Madden NFL 27",
  cfb_27: "College Football 27"
};

export type LeagueSetupStep =
  | "game"
  | "league_type"
  | "economy"
  | "custom_players"
  | "legends"
  | "dev_upgrades"
  | "age_resets"
  | "attribute_purchases"
  | "player_trait_purchases"
  | "contract_purchases"
  | "server_setup"
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
  game: LeagueGame;
  leaguePassword?: string | null;
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
  attributePurchasesEnabled: boolean;
  playerTraitPurchasesEnabled: boolean;
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
  commissionerOfficeChannelId?: string | null;
  announcementsChannelId?: string | null;
  votingPollsChannelId?: string | null;
  streamsChannelId?: string | null;
  highlightsChannelId?: string | null;
  pendingPayoutsChannelId?: string | null;
  pendingPurchasesChannelId?: string | null;
  gameChannelsCategoryId?: string | null;
  // When true, changes are saved to DB immediately after each step and return to settings_picker.
  editMode: boolean;
};

const STEP_ORDER: LeagueSetupStep[] = [
  "game",
  "league_type",
  "economy",
  "custom_players",
  "legends",
  "dev_upgrades",
  "age_resets",
  "attribute_purchases",
  "player_trait_purchases",
  "contract_purchases",
  "server_setup",
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
    game: "madden_26",
    leaguePassword: null,
    step: "game",
    leagueType: "regular_rosters",
    importMode: "manual",
    seasonWeek: "training_camp",
    coinEconomyEnabled: false,
    customPlayersEnabled: false,
    legendsEnabled: false,
    devUpgradesEnabled: false,
    ageResetsEnabled: false,
    trainingPackagesEnabled: false,
    attributePurchasesEnabled: false,
    playerTraitPurchasesEnabled: false,
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
    offensivePlayCallLimitsEnabled: false,
    offensivePlayCallLimit: null,
    offensivePlayCallCooldownEnabled: false,
    offensivePlayCallCooldown: null,
    defensivePlayCallLimitsEnabled: false,
    defensivePlayCallLimit: null,
    defensivePlayCallCooldownEnabled: false,
    defensivePlayCallCooldown: null,
    linkTeamsAfterSetup: false,
    fairSimRequirements: "Request a Fair Sim after 48 hours of no response or failed scheduling effort, subject to commissioner review.",
    forceWinRequirements: "Request a Force Win after 72 hours of no response or missed agreed game time, subject to commissioner review.",
    commissionerOfficeChannelId: null,
    announcementsChannelId: null,
    votingPollsChannelId: null,
    streamsChannelId: null,
    highlightsChannelId: null,
    pendingPayoutsChannelId: null,
    pendingPurchasesChannelId: null,
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
export function getNextLeagueSetupStep(step: LeagueSetupStep, draft: LeagueSetupDraft): LeagueSetupStep {
  // Economy gates the consecutive purchase-feature section.
  if (step === "economy" && !draft.coinEconomyEnabled) return "server_setup";

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

const ECONOMY_FEATURE_STEPS = {
  economy: {
    title: "Economy",
    key: "coinEconomyEnabled",
    description: "Economy: Allows users to get paid for game outcomes, stats, streams and highlights, as well as (if activated) making purchases and placing wagers within this league."
  },
  custom_players: {
    title: "Custom Players",
    key: "customPlayersEnabled",
    description: "Custom Players: Allows users to purchase and create custom players to be added to the draft pool and reserved for their team. Players are built using template archetypes and a range of 'creation points' based on how much the user spends when purchasing the player package."
  },
  legends: {
    title: "Legends",
    key: "legendsEnabled",
    description: "Legends: Allows users to purchase NFL legends to be added to their team instantly."
  },
  dev_upgrades: {
    title: "Dev Upgrades",
    key: "devUpgradesEnabled",
    description: "Dev Upgrades: Allows users to purchase a development trait upgrade for a player on their team. Upgrades are in one-tier increments, so Star to Superstar, etc."
  },
  age_resets: {
    title: "Age Resets",
    key: "ageResetsEnabled",
    description: "Age Resets: Allows users to purchase an age reset for a player, resetting their in-game age to 21."
  },
  attribute_purchases: {
    title: "Attribute Purchases",
    key: "attributePurchasesEnabled",
    description: "Attribute Purchases: Allows users to purchase upgrades to a players attributes (grouped as core & non-core with different caps)."
  },
  player_trait_purchases: {
    title: "Player Trait Purchases",
    key: "playerTraitPurchasesEnabled",
    description: "Player Trait Purchases: Allows users to purchase changes to a players trait, ie, they want a player to play the ball but their trait is currently set to Play Defender."
  },
  contract_purchases: {
    title: "Contract Purchases",
    key: "contractAdjustmentPurchasesEnabled",
    description: "Contract Purchases: Allows users to buy salary and bonus reductions for players contracts, as well as limited contract extensions."
  }
} as const satisfies Partial<Record<LeagueSetupStep, { title: string; key: keyof LeagueSetupDraft; description: string }>>;

export function isLeagueSetupFeatureStep(step: LeagueSetupStep): step is keyof typeof ECONOMY_FEATURE_STEPS {
  return step in ECONOMY_FEATURE_STEPS;
}

export function setLeagueSetupFeatureAnswer(draft: LeagueSetupDraft, enabled: boolean) {
  if (!isLeagueSetupFeatureStep(draft.step)) return;
  const config = ECONOMY_FEATURE_STEPS[draft.step];
  (draft as any)[config.key] = enabled;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function fmt(value: string) {
  return value.replaceAll("_", " ");
}

export function buildGameSelectWindow(draft: LeagueSetupDraft, notice?: string) {
  const embed = new EmbedBuilder()
    .setTitle("League Setup: Game")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Which game is this league for? This determines the setup options and features available.",
      "",
      "• **Madden NFL 26** / **Madden NFL 27** — full franchise setup (Madden 27 uses the Madden 26 options for now).",
      "• **College Football 27** — dynasty setup is coming soon; not yet available."
    ].join("\n"));
  if (notice) embed.addFields({ name: "Heads up", value: notice });

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.game, "Select the game", [
        option("Madden NFL 26", "madden_26"),
        option("Madden NFL 27", "madden_27", "Uses the Madden 26 setup for now."),
        option("College Football 27", "cfb_27", "Coming soon — placeholder.")
      ]),
      buildNavigationRow()
    ]
  };
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

export function buildFeatureTogglesWindow(draft: LeagueSetupDraft) {
  return buildFeatureDecisionWindow(draft);
}

export function buildFeatureDecisionWindow(draft: LeagueSetupDraft) {
  if (!isLeagueSetupFeatureStep(draft.step)) return buildLeagueTypeWindow(draft);
  const config = ECONOMY_FEATURE_STEPS[draft.step];
  const current = Boolean(draft[config.key]);
  const embed = new EmbedBuilder()
    .setTitle(`League Setup: ${config.title}`)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      config.description,
      "",
      `Current Selection: **${current ? "Activated" : "Deactivated"}**`,
      draft.step === "economy" ? "If Economy is deactivated, setup skips the purchase-feature questions that depend on it." : null
    ].filter(Boolean).join("\n"));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureActivate).setLabel("Activate Feature").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate).setLabel("Deactivate Feature").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cancelWizard).setLabel("Cancel Wizard").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

export const LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS = {
  commissioner_office: { label: "Commissioner Office", field: "commissionerOfficeChannelId" },
  announcements: { label: "Announcements", field: "announcementsChannelId" },
  voting_polls: { label: "Voting Polls", field: "votingPollsChannelId" },
  streams: { label: "Streams", field: "streamsChannelId" },
  highlights: { label: "Highlights", field: "highlightsChannelId" },
  pending_payouts: { label: "Pending Payouts", field: "pendingPayoutsChannelId" },
  pending_purchases: { label: "Pending Purchases", field: "pendingPurchasesChannelId" },
  game_channels_category: { label: "Game Channels Category", field: "gameChannelsCategoryId" }
} as const;

function formatChannelValue(value?: string | null) {
  return value ? `<#${value}> (${value})` : "Not set";
}

export function setLeagueSetupServerChannel(draft: LeagueSetupDraft, channelType: string, value: string | null) {
  const option = LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS[channelType as keyof typeof LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS];
  if (!option) return;
  (draft as any)[option.field] = value;
}

export function buildLeagueSetupServerChannelModal(channelType: string, draft: LeagueSetupDraft) {
  const option = LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS[channelType as keyof typeof LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS];
  const current = option ? String((draft as any)[option.field] ?? "") : "";
  return new ModalBuilder()
    .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelModal}:${channelType}`)
    .setTitle(`Assign ${option?.label ?? "Channel"}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelInput)
          .setLabel("Discord Channel/Category ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(current)
          .setPlaceholder("Paste the Discord ID, or leave blank to clear it.")
      )
    );
}

export function buildLeagueSetupServerSetupWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Server Setup", draft)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Assign Discord channels and categories used by league features. These can also be edited later from Settings.",
      "",
      ...Object.entries(LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS).map(([, config]) => `**${config.label}:** ${formatChannelValue((draft as any)[config.field])}`)
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupSelect)
          .setPlaceholder("Select a channel/category assignment")
          .addOptions(
            ...Object.entries(LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS).map(([value, config]) =>
              new StringSelectMenuOptionBuilder().setLabel(config.label).setValue(value)
            )
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupDone).setLabel(draft.editMode ? "Back to Settings" : "Continue").setStyle(ButtonStyle.Success)
      ),
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
  const currentCustom = phase === "Playoff" ? draft.customFourthDownRulePlayoff : draft.customFourthDownRuleRegular;
  const embed = baseEmbed(`League Setup: 4th Down Rules - ${phase}`, draft);
  if (currentCustom) embed.addFields({ name: "Current Custom Rule", value: currentCustom.slice(0, 1024) });

  return {
    embeds: [embed],
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

export function buildFourthDownCustomModal(draft: LeagueSetupDraft, phase: "regular" | "playoff") {
  const isPlayoff = phase === "playoff";
  return new ModalBuilder()
    .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomModal}:${phase}`)
    .setTitle(`${isPlayoff ? "Playoff" : "Regular Season"} 4th Down Rule`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomInput)
          .setLabel("Custom 4th Down Rule")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(isPlayoff ? draft.customFourthDownRulePlayoff : draft.customFourthDownRuleRegular)
          .setPlaceholder("Describe when users may go for it on 4th down.")
      )
    );
}

export function buildPositionChangeWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Position Changes", draft);
  if (draft.positionChangePolicy !== "open" && draft.positionChangePolicyDescription) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.positionChangePolicyDescription.slice(0, 1024) });
  }

  return {
    embeds: [embed],
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

export function buildPositionRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionModal)
    .setTitle("Position Change Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionInput)
          .setLabel("Explain the restrictions")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.positionChangePolicyDescription ?? "")
          .setPlaceholder("e.g., Realistic changes only; OL-to-OL allowed, WR-to-TE requires approval.")
      )
    );
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
  const embed = baseEmbed("League Setup: CPU Trading", draft);
  if (draft.cpuTradingPolicy === "restricted" && draft.cpuTradingRestriction) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.cpuTradingRestriction.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingPolicy, "Select CPU trading policy", [
        option("Allowed", "allowed"),
        option("Restricted", "restricted", "Requires commissioner-defined restrictions."),
        option("Not Allowed", "not_allowed")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCpuTradingRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionModal)
    .setTitle("CPU Trading Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionInput)
          .setLabel("Explain CPU trading restrictions")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.cpuTradingRestriction ?? "")
          .setPlaceholder("e.g., Commissioner approval required; no CPU trades for star dev players.")
      )
    );
}

export function buildDifficultyWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("Gameplay: Difficulty", draft);
  if (draft.difficulty === "custom" && draft.difficultyCustomSettings) {
    embed.addFields({ name: "Current Custom Difficulty Notes", value: draft.difficultyCustomSettings.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.difficulty, "Select difficulty", [
        option("Rookie", "rookie"),
        option("Pro", "pro"),
        option("All-Pro", "all_pro"),
        option("All-Madden", "all_madden"),
        option("Custom", "custom", "Explain how difficulty or sliders were altered.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildDifficultyCustomModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.difficultyCustomModal)
    .setTitle("Custom Difficulty Settings")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.difficultyCustomInput)
          .setLabel("How was difficulty altered?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.difficultyCustomSettings ?? "")
          .setPlaceholder("Describe custom difficulty/sliders.")
      )
    );
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
    case "features": return "Features";
    case "server": return "Server Setup";
    case "rules": return "Rules & Policies";
    case "gameplay": return "Gameplay Settings";
    case "play_call": return "Play Call Settings";
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
              option("Features", "category:features"),
              option("Server Setup", "category:server"),
              option("Rules & Policies", "category:rules"),
              option("Gameplay Settings", "category:gameplay"),
              option("Play Call Settings", "category:play_call")
            )
        ),
        buildNavigationRow({ includeAdminPanel: true })
      ]
    };
  }

  const categoryOptions: Record<LeagueSetupSettingsCategory, StringSelectMenuOptionBuilder[]> = {
    features: [
      option("Economy", "economy"),
      option("Custom Players", "custom_players"),
      option("Legends", "legends"),
      option("Dev Upgrades", "dev_upgrades"),
      option("Age Resets", "age_resets"),
      option("Attribute Purchases", "attribute_purchases"),
      option("Player Trait Purchases", "player_trait_purchases"),
      option("Contract Purchases", "contract_purchases"),
      option("Activity Requirements (Fair Sim / Force Win)", "activity_requirements")
    ],
    server: [
      option("Server Channel Assignments", "server_setup")
    ],
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
      option("CPU Trading", "cpu_trading")
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
    .setDescription([`League: **${draft.name}**`, `League Password: ${draft.leaguePassword ? "Set" : "Not set / public"}`, "", "Review the configuration below, then save the league. Use the section buttons below to jump back and change answers."].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [`Game: ${LEAGUE_GAME_OPTIONS[draft.game] ?? draft.game}`, `Type: ${fmt(draft.leagueType)}`, "Starts: Season 1, Training Camp"].join("\n"),
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
          `Attribute Purchases: ${yesNo(draft.attributePurchasesEnabled)}`,
          `Player Trait Purchases: ${yesNo(draft.playerTraitPurchasesEnabled)}`,
          `Contract Purchases: ${yesNo(draft.contractAdjustmentPurchasesEnabled)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Server Setup",
        value: Object.entries(LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS)
          .map(([, config]) => `${config.label}: ${formatChannelValue((draft as any)[config.field])}`)
          .join("\n"),
        inline: false
      },
      {
        name: "Rules",
        value: [
          `Regular Season Streaming: ${fmt(draft.regularSeasonStreamingRequirement)}`,
          `Postseason Streaming: ${fmt(draft.postseasonStreamingRequirement)}`,
          `Required Streaming Side: ${fmt(draft.streamingSide)}`,
          `4th Down (Regular Season): ${fmt(draft.fourthDownRuleTypeRegular)}${draft.fourthDownRuleTypeRegular === "custom" ? ` - ${draft.customFourthDownRuleRegular || "Custom text missing"}` : ""}`,
          `4th Down (Playoff): ${fmt(draft.fourthDownRuleTypePlayoff)}${draft.fourthDownRuleTypePlayoff === "custom" ? ` - ${draft.customFourthDownRulePlayoff || "Custom text missing"}` : ""}`,
          `Position Changes: ${fmt(draft.positionChangePolicy)}${draft.positionChangePolicy !== "open" ? ` - ${draft.positionChangePolicyDescription || "Restriction text missing"}` : ""}`,
          `Custom Coaches Required: ${yesNo(draft.customCoachesRequired)}`,
          `Custom Playbooks Allowed: ${yesNo(draft.customPlaybooksAllowed)}`,
          `Coach Abilities Restricted: ${yesNo(draft.coachAbilitiesRestricted)}${draft.coachAbilitiesRestricted && draft.coachAbilitiesRestrictionNotes ? ` - ${draft.coachAbilitiesRestrictionNotes}` : ""}`,
          `Trade Approval: ${fmt(draft.tradeApprovalPolicy)}`,
          `CPU Trading: ${fmt(draft.cpuTradingPolicy)}${draft.cpuTradingPolicy === "restricted" ? ` - ${draft.cpuTradingRestriction || "Restriction text missing"}` : ""}`,
          `Fair Sim: ${draft.fairSimRequirements || "Not set"}`,
          `Force Win: ${draft.forceWinRequirements || "Not set"}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Gameplay",
        value: [
          `Difficulty: ${fmt(draft.difficulty)}${draft.difficulty === "custom" ? ` - ${draft.difficultyCustomSettings || "Custom text missing"}` : ""}`,
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
      .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:features`)
      .setLabel("Edit Features")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:server_setup`)
      .setLabel("Edit Server")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:rules`)
      .setLabel("Edit Rules")
      .setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:gameplay`)
      .setLabel("Edit Gameplay")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.save)
      .setLabel("Save League Setup")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [saveRow, actionRow, buildNavigationRow()] };
}

export function buildLeagueSetupWindow(draft: LeagueSetupDraft) {
  switch (draft.step) {
    case "game": return buildGameSelectWindow(draft);
    case "league_type": return buildLeagueTypeWindow(draft);
    case "economy":
    case "custom_players":
    case "legends":
    case "dev_upgrades":
    case "age_resets":
    case "attribute_purchases":
    case "player_trait_purchases":
    case "contract_purchases": return buildFeatureDecisionWindow(draft);
    case "server_setup": return buildLeagueSetupServerSetupWindow(draft);
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
    case "cpu_trading": return buildCpuRulesWindow(draft);
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
    draft.attributePurchasesEnabled = false;
    draft.playerTraitPurchasesEnabled = false;
    draft.contractAdjustmentPurchasesEnabled = false;
  }

  draft.trainingPackagesEnabled = false;
  draft.capManagementAssistantEnabled = false;
  draft.draftClassFeaturesEnabled = false;
  draft.scoutingPurchasesEnabled = false;
  draft.mediaFeaturesEnabled = draft.coinEconomyEnabled;

  if (!draft.acceleratedClockEnabled) {
    draft.acceleratedClockMinimumSeconds = 0;
  }

  if (!draft.coachAbilitiesRestricted) {
    draft.coachAbilitiesRestrictionNotes = "";
  }

  if (draft.fourthDownRuleTypeRegular !== "custom") {
    draft.customFourthDownRuleRegular = "";
  }
  if (draft.fourthDownRuleTypePlayoff !== "custom") {
    draft.customFourthDownRulePlayoff = "";
  }
  if (draft.positionChangePolicy === "open") {
    draft.positionChangePolicyDescription = "";
  }
  draft.cpuTradingAllowed = draft.cpuTradingPolicy === "allowed";
  draft.cpuFreeAgencyPolicy = "disabled";
  if (draft.cpuTradingPolicy !== "restricted") {
    draft.cpuTradingRestriction = "";
  }
  if (draft.difficulty !== "custom") {
    draft.difficultyCustomSettings = "";
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
