import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { fairSimRuleLabel, forceWinRuleLabel, getDefaultNflSeasonLabelForGame, RISE_TO_IMMORTALITY_LOCKED_SETTINGS, type MaddenLeagueGame } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";
import {
  LEAGUE_GAME_OPTIONS,
  LEAGUE_SETUP_CUSTOM_IDS,
  isRiseToImmortalityDraft,
  type LeagueSetupDraft,
  type LeagueSetupSettingsCategory
} from "./league-setup-types.js";
import { baseEmbed, boolText, fmt, formatDifficultyLabel, option, selectRow, yesNo } from "./league-setup-shared.js";
import {
  buildAttributeCoreSelectionWindow,
  buildPurchaseSettingWindow,
  formatPurchaseCapsReview
} from "./league-setup-purchases.js";
import { buildLeagueSetupServerSetupWindow, formatChannelValue, LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS } from "./league-setup-server.js";
import {
  buildActivityRequirementsWindow,
  buildFairSimRulesWindow,
  buildCoachAbilitiesRestrictedWindow,
  buildCustomCoachesRequiredWindow,
  buildCustomPlaybooksAllowedWindow,
  buildFourthDownWindow,
  buildPositionChangeWindow,
  buildPostseasonStreamingSideWindow,
  buildPostseasonStreamingWindow,
  buildRegularSeasonStreamingSideWindow,
  buildRegularSeasonStreamingWindow,
  buildTradeApprovalWindow
} from "./league-setup-rules.js";
import {
  buildAcceleratedClockEnabledWindow,
  buildAcceleratedClockSecondsWindow,
  buildBallHawkWindow,
  buildBooleanGameplayWindow,
  buildCoachFiringPolicyWindow,
  buildCoachModeSubSettingWindow,
  buildHeatSeekerWindow,
  buildInjuryPolicyWindow,
  buildAdvanceTimingWindow,
  buildPlayCallNumberWindow,
  buildPreorderBonusesWindow,
  buildQuarterLengthWindow,
  buildSwitchAssistWindow,
  buildDifficultyWindow,
  buildSlidersAdjustedWindow,
  COACH_MODE_SUB_SETTINGS,
  findCoachModeSubSetting
} from "./league-setup-gameplay.js";
import { buildFeatureDecisionWindow } from "./league-setup-purchases.js";
import { buildGameSelectWindow, buildImmortalityPositionWindow, buildImmortalityTeamPoolWindow, buildLeagueTypeWindow, buildRiseLockedEconomyWindow } from "./league-setup-core.js";

function formatFwFsRules(draft: LeagueSetupDraft): { fairSim: string; forceWin: string } {
  const fwRegular = draft.forceWinRulesRegular.map((k) => forceWinRuleLabel(k));
  const fwPostseason = draft.forceWinRulesPostseason.map((k) => forceWinRuleLabel(k));
  const fsRegular = draft.fairSimRulesRegular.map((k) => fairSimRuleLabel(k));
  const fsPostseason = draft.fairSimRulesPostseason.map((k) => fairSimRuleLabel(k));

  const forceWin = fwRegular.length || fwPostseason.length
    ? `Regular: ${fwRegular.length ? fwRegular.join(", ") : "None"} | Postseason: ${fwPostseason.length ? fwPostseason.join(", ") : "None"}`
    : "Not set";
  const fairSim = fsRegular.length || fsPostseason.length
    ? `Regular: ${fsRegular.length ? fsRegular.join(", ") : "None"} | Postseason: ${fsPostseason.length ? fsPostseason.join(", ") : "None"}`
    : "Not set";

  return { fairSim, forceWin };
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

function defaultScheduleSeasonLabel(game: LeagueSetupDraft["game"]) {
  return getDefaultNflSeasonLabelForGame(game as MaddenLeagueGame);
}

export function buildDefaultScheduleConfirmWindow(draft: LeagueSetupDraft) {
  const seasonLabel = defaultScheduleSeasonLabel(draft.game);
  const description = [
    `REC can pre-load the real NFL **${seasonLabel} regular-season matchups** (Weeks 1–18) for a new franchise.`,
    "",
    "Only choose **Yes** if your Madden league is in **Franchise Year 1** and still using that NFL season in-game.",
    "",
    "If your franchise is already several seasons deep, choose **No** — the default schedule would be out of date. You can enter or import the current schedule later.",
    "",
    "This seeds **matchups only**, not scores or results. Playoffs are not seeded."
  ].join("\n");

  return {
    embeds: [baseEmbed("League Setup: Default NFL Schedule", draft).setDescription(description)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.defaultScheduleConfirm, `Franchise Year 1 in the ${seasonLabel} NFL season?`, [
        option(`Yes — seed ${seasonLabel} regular-season matchups`, "yes"),
        option("No — skip default schedule seeding", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

function settingsCategoryLabel(category: LeagueSetupSettingsCategory) {
  switch (category) {
    case "features": return "Features";
    case "purchases": return "Purchases";
    case "server": return "Server Setup";
    case "rules": return "Rules & Policies";
    case "gameplay": return "Gameplay Settings";
    case "franchise": return "Franchise Settings";
    case "play_call": return "Play Call Settings";
  }
}

export function buildSettingsPickerWindow(draft: LeagueSetupDraft, category?: LeagueSetupSettingsCategory) {
  const isRise = isRiseToImmortalityDraft(draft);
  if (!category) {
    const categoryChoices = [
      option("Features", "category:features"),
      ...(isRise ? [] : [option("Purchases", "category:purchases")]),
      option("Server Setup", "category:server"),
      option("Rules & Policies", "category:rules"),
      option("Gameplay Settings", "category:gameplay"),
      option("Franchise Settings", "category:franchise"),
      option("Play Call Settings", "category:play_call")
    ];

    return {
      embeds: [new EmbedBuilder().setTitle("Edit League Settings").setDescription(`League: **${draft.name}**\n\nChoose a settings category. Changes are saved immediately.`)],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.settingsPicker)
            .setPlaceholder("Select a settings category")
            .addOptions(...categoryChoices)
        ),
        buildNavigationRow({ includeAdminPanel: true })
      ]
    };
  }

  const categoryOptions: Record<LeagueSetupSettingsCategory, StringSelectMenuOptionBuilder[]> = {
    features: [
      ...(isRise ? [] : [option("Economy", "economy")]),
      option("Activity Requirements (Fair Sim / Force Win)", "activity_requirements"),
      option("Default NFL Schedule (Franchise Year 1)", "default_schedule_confirm")
    ],
    purchases: [
      option("Custom Players", "custom_players"),
      option("Legends", "legends"),
      option("Dev Upgrades", "dev_upgrades"),
      option("Age Resets", "age_resets"),
      option("Attribute Purchases", "attribute_purchases"),
      option("Attribute Core Attributes", "attribute_core_attributes"),
      option("Contract Purchases", "contract_purchases"),
    ],
    server: [
      option("Server Channel Assignments", "server_setup")
    ],
    rules: [
      option("Regular Season Streaming", "regular_season_streaming"),
      option("Regular Season Streaming Side", "regular_season_streaming_side"),
      option("Postseason Streaming", "postseason_streaming"),
      option("Postseason Streaming Side", "postseason_streaming_side"),
      option("4th Down Rules (Regular Season)", "fourth_down_regular"),
      option("4th Down Rules (Playoff)", "fourth_down_playoff"),
      option("Custom Coaches Required?", "custom_coaches_required"),
      option("Custom Playbooks Allowed?", "custom_playbooks_allowed"),
      option("Coach Ability Restrictions", "coach_abilities_restricted"),
      option("Position Change Policy", "position_changes"),
      ...(isRise ? [] : [option("Trades Allowed", "trade_approval")]),
    ],
    gameplay: [
      option("Difficulty", "difficulty"),
      option("Sliders Adjusted", "sliders_adjusted"),
      option("Quarter Length", "quarter_length"),
      option("Accelerated Clock", "accelerated_clock_enabled"),
      ...(isRise ? [] : [
        option("Salary Cap", "salary_cap"),
        option("Trade Deadline", "trade_deadline"),
      ]),
      option("Abilities", "abilities"),
      option("Wear & Tear", "wear_and_tear"),
      ...(isRise ? [] : [option("Injuries", "injury_policy")]),
      option("Advance Timing", "advance_timing")
    ],
    franchise: [
      option("Coach Firing", "coach_firing_policy"),
      option("Preorder Bonuses", "preorder_bonuses"),
      option("Coach Mode", "coach_mode_enabled"),
      ...(draft.coachModeEnabled ? COACH_MODE_SUB_SETTINGS.map((setting) => option(setting.label, setting.step)) : []),
      option("Ball Hawk", "ball_hawk"),
      option("Heat Seeker", "heat_seeker"),
      option("Switch Assist", "switch_assist")
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

function formatFranchiseSettingsReview(draft: LeagueSetupDraft) {
  const lines = [
    `Coach Firing: ${fmt(draft.coachFiringPolicy)}`,
    `Preorder Bonuses: ${yesNo(draft.preorderBonusesEnabled)}`,
    `Coach Mode: ${yesNo(draft.coachModeEnabled)}`
  ];
  if (draft.coachModeEnabled) {
    lines.push(
      `  Autopass: ${yesNo(draft.coachModeAutoPassEnabled)}`,
      `  Autosnap: ${yesNo(draft.coachModeAutoSnapEnabled)}`,
      `  Coach Suggestions: ${yesNo(draft.coachModeCoachSuggestionsEnabled)}`
    );
  }
  lines.push(
    `Ball Hawk: ${fmt(draft.ballHawk)}`,
    `Heat Seeker: ${fmt(draft.heatSeeker)}`,
    `Switch Assist: ${fmt(draft.switchAssist)}`
  );
  return lines.join("\n");
}

export function buildLeagueSetupReviewWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("Review League Setup")
    .setDescription([`League: **${draft.name}**`, `League Password: ${draft.leaguePassword ? draft.leaguePassword : "Not set / public"}`, "", "Review the configuration below, then save the league. Use the section buttons below to jump back and change answers."].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [
          `Game: ${LEAGUE_GAME_OPTIONS[draft.game] ?? draft.game}`,
          `Type: ${fmt(draft.leagueType)}`,
          ...(isRiseToImmortalityDraft(draft)
            ? [
              `Offense position: ${draft.immortalityOffensePosition}`,
              `Defense position: ${draft.immortalityDefensePosition}`,
              `Team pool: ${draft.immortalityTeamPool === "custom_32" ? "32 custom (install on site)" : "Default NFL"}`,
            ]
            : []),
          "Starts: Season 1, Training Camp",
          `Default Schedule: ${draft.seedDefaultSchedule == null ? "Not answered" : draft.seedDefaultSchedule ? `Seed ${defaultScheduleSeasonLabel(draft.game) ?? "NFL"} regular season` : "Skip seeding"}`,
        ].join("\n"),
        inline: true
      },
      {
        name: "Features",
        value: isRiseToImmortalityDraft(draft)
          ? [
              "Store purchases: Off",
              "Attribute upgrades: Player XP",
              "Coins: contracts, 2 highlights/week at 100, GOTW, Media Day",
              "Wagers: Off",
              "Member articles / manual interviews: Off",
              `Injuries: ${fmt(draft.injuryPolicy)}`,
              `Wear & Tear: ${yesNo(draft.wearAndTearEnabled)}`,
              `Salary cap: ${yesNo(draft.salaryCapEnabled)}`,
              "Trades: Off",
            ].join("\n")
          : [
          `Economy: ${yesNo(draft.coinEconomyEnabled)}`,
          `Custom Players: ${yesNo(draft.customPlayersEnabled)}`,
          `Legends: ${yesNo(draft.legendsEnabled)}`,
          `Dev Upgrades: ${yesNo(draft.devUpgradesEnabled)}`,
          `Age Resets: ${yesNo(draft.ageResetsEnabled)}`,
          `Attribute Purchases: ${yesNo(draft.attributePurchasesEnabled)}`,
          `Contract Purchases: ${yesNo(draft.contractAdjustmentPurchasesEnabled)}`,
          "",
          formatPurchaseCapsReview(draft)
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
          `Regular Season Streaming Side: ${fmt(draft.regularSeasonStreamingSide)}`,
          `Postseason Streaming: ${fmt(draft.postseasonStreamingRequirement)}`,
          `Postseason Streaming Side: ${fmt(draft.postseasonStreamingSide)}`,
          `4th Down (Regular Season): ${fmt(draft.fourthDownRuleTypeRegular)}${draft.fourthDownRuleTypeRegular === "custom" ? ` - ${draft.customFourthDownRuleRegular || "Custom text missing"}` : ""}`,
          `4th Down (Playoff): ${fmt(draft.fourthDownRuleTypePlayoff)}${draft.fourthDownRuleTypePlayoff === "custom" ? ` - ${draft.customFourthDownRulePlayoff || "Custom text missing"}` : ""}`,
          `Position Changes: ${fmt(draft.positionChangePolicy)}${draft.positionChangePolicy !== "open" ? ` - ${draft.positionChangePolicyDescription || "Restriction text missing"}` : ""}`,
          `Custom Coaches Required: ${yesNo(draft.customCoachesRequired)}`,
          `Custom Playbooks Allowed: ${yesNo(draft.customPlaybooksAllowed)}`,
          `Coach Abilities Restricted: ${yesNo(draft.coachAbilitiesRestricted)}${draft.coachAbilitiesRestricted && draft.coachAbilitiesRestrictionNotes ? ` - ${draft.coachAbilitiesRestrictionNotes}` : ""}`,
          `Trades: ${draft.tradeApprovalPolicy === "not_allowed" ? "Off" : "On - competition committee review"}`,
          `Fair Sim: ${formatFwFsRules(draft).fairSim}`,
          `Force Win: ${formatFwFsRules(draft).forceWin}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Gameplay",
        value: [
          `Difficulty: ${formatDifficultyLabel(draft.difficulty)}`,
          `Sliders Adjusted: ${yesNo(draft.slidersAdjusted)}`,
          `Quarter Length: ${draft.quarterLengthMinutes}`,
          `Accelerated Clock: ${boolText(draft.acceleratedClockEnabled)}${draft.acceleratedClockEnabled ? ` (${draft.acceleratedClockMinimumSeconds}s)` : ""}`,
          `Salary Cap: ${boolText(draft.salaryCapEnabled)}`,
          `Trade Deadline: ${boolText(draft.tradeDeadlineEnabled)}`,
          `Abilities: ${boolText(draft.abilitiesEnabled)}`,
          `Wear & Tear: ${boolText(draft.wearAndTearEnabled)}`,
          `Injuries: ${fmt(draft.injuryPolicy)}`,
          `Advance Timing: ${draft.advanceTiming === "other" ? (draft.advanceTimingOther || "Other") : draft.advanceTiming}`,
          `Offense Limit: ${draft.offensivePlayCallLimitsEnabled ? `${draft.offensivePlayCallLimit ?? "?"} max/game` : "Off"}`,
          `Offense Cooldown: ${draft.offensivePlayCallCooldownEnabled ? `${draft.offensivePlayCallCooldown ?? "?"} plays before repeat` : "Off"}`,
          `Defense Limit: ${draft.defensivePlayCallLimitsEnabled ? `${draft.defensivePlayCallLimit ?? "?"} max/game` : "Off"}`,
          `Defense Cooldown: ${draft.defensivePlayCallCooldownEnabled ? `${draft.defensivePlayCallCooldown ?? "?"} plays before repeat` : "Off"}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Franchise Settings",
        value: formatFranchiseSettingsReview(draft),
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
      .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:franchise`)
      .setLabel("Edit Franchise")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.save)
      .setLabel("Save League Setup")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [saveRow, actionRow, buildNavigationRow()] };
}

// Injects a "Back to Review" button into a step window's last button-only row (or a new row
// if there's still room under Discord's 5-action-row limit) when the commissioner got here via
// an "Edit X" button on the pre-save Review screen — lets them bail straight back to Review
// instead of re-answering every consecutive step between here and there.
function withBackToReviewButton(window: ReturnType<typeof buildLeagueSetupStepWindow>) {
  if (!window) return window;
  const backButton = new ButtonBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.backToReview)
    .setLabel("Back to Review")
    .setStyle(ButtonStyle.Success);

  const components = [...window.components];
  const lastRow = components[components.length - 1];
  const isButtonOnlyRow = lastRow instanceof ActionRowBuilder
    && lastRow.components.every((component) => component instanceof ButtonBuilder);

  if (isButtonOnlyRow && lastRow.components.length < 5) {
    components[components.length - 1] = new ActionRowBuilder<ButtonBuilder>().addComponents(...lastRow.components as ButtonBuilder[], backButton);
    return { ...window, components };
  }
  if (components.length < 5) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(backButton));
    return { ...window, components };
  }
  // No room under the 5-row limit — skip silently rather than throwing.
  return window;
}

export function buildLeagueSetupWindow(draft: LeagueSetupDraft) {
  const window = buildLeagueSetupStepWindow(draft);
  if (draft.step === "review") {
    draft.returnToReview = false;
    return window;
  }
  if (draft.returnToReview && !draft.editMode) {
    return withBackToReviewButton(window);
  }
  return window;
}

function buildLeagueSetupStepWindow(draft: LeagueSetupDraft) {
  switch (draft.step) {
    case "game": return buildGameSelectWindow(draft);
    case "league_type": return buildLeagueTypeWindow(draft);
    case "immortality_offense_position": return buildImmortalityPositionWindow(draft, "offense");
    case "immortality_defense_position": return buildImmortalityPositionWindow(draft, "defense");
    case "immortality_team_pool": return buildImmortalityTeamPoolWindow(draft);
    case "economy": return isRiseToImmortalityDraft(draft) ? buildRiseLockedEconomyWindow(draft) : buildFeatureDecisionWindow(draft);
    case "custom_players":
    case "legends":
    case "dev_upgrades":
    case "age_resets":
    case "attribute_purchases":
    case "player_trait_purchases":
    case "contract_purchases": return buildPurchaseSettingWindow(draft);
    case "attribute_core_attributes": return buildAttributeCoreSelectionWindow(draft);
    case "server_setup": return buildLeagueSetupServerSetupWindow(draft);
    case "regular_season_streaming": return buildRegularSeasonStreamingWindow(draft);
    case "regular_season_streaming_side": return buildRegularSeasonStreamingSideWindow(draft);
    case "postseason_streaming": return buildPostseasonStreamingWindow(draft);
    case "postseason_streaming_side": return buildPostseasonStreamingSideWindow(draft);
    case "fourth_down_regular": return buildFourthDownWindow(draft, "Regular Season");
    case "fourth_down_playoff": return buildFourthDownWindow(draft, "Playoff");
    case "position_changes": return buildPositionChangeWindow(draft);
    case "custom_coaches_required": return buildCustomCoachesRequiredWindow(draft);
    case "custom_playbooks_allowed": return buildCustomPlaybooksAllowedWindow(draft);
    case "coach_abilities_restricted": return buildCoachAbilitiesRestrictedWindow(draft);
    case "trade_approval": return buildTradeApprovalWindow(draft);
    case "difficulty": return buildDifficultyWindow(draft);
    case "sliders_adjusted": return buildSlidersAdjustedWindow(draft);
    case "quarter_length": return buildQuarterLengthWindow(draft);
    case "accelerated_clock_enabled": return buildAcceleratedClockEnabledWindow(draft);
    case "accelerated_clock_seconds": return buildAcceleratedClockSecondsWindow(draft);
    case "salary_cap": return buildBooleanGameplayWindow(draft, "Gameplay: Salary Cap", LEAGUE_SETUP_CUSTOM_IDS.salaryCap, "Salary cap enabled?");
    case "trade_deadline": return buildBooleanGameplayWindow(draft, "Gameplay: Trade Deadline", LEAGUE_SETUP_CUSTOM_IDS.tradeDeadline, "Trade deadline enabled?");
    case "abilities": return buildBooleanGameplayWindow(draft, "Gameplay: Abilities", LEAGUE_SETUP_CUSTOM_IDS.abilities, "Abilities enabled?");
    case "wear_and_tear": return buildBooleanGameplayWindow(draft, "Gameplay: Wear & Tear", LEAGUE_SETUP_CUSTOM_IDS.wearAndTear, "Wear & Tear enabled?");
    case "injury_policy": return buildInjuryPolicyWindow(draft);
    case "advance_timing": return buildAdvanceTimingWindow(draft);
    case "coach_firing_policy": return buildCoachFiringPolicyWindow(draft);
    case "preorder_bonuses": return buildPreorderBonusesWindow(draft);
    case "coach_mode_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Coach Mode", LEAGUE_SETUP_CUSTOM_IDS.coachModeEnabled, "Coach Mode enabled?");
    case "coach_mode_auto_pass":
    case "coach_mode_auto_snap":
    case "coach_mode_coach_suggestions":
      return buildCoachModeSubSettingWindow(draft, findCoachModeSubSetting(draft.step));
    case "ball_hawk": return buildBallHawkWindow(draft);
    case "heat_seeker": return buildHeatSeekerWindow(draft);
    case "switch_assist": return buildSwitchAssistWindow(draft);
    case "offensive_limits_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Offensive Play Call Limits", LEAGUE_SETUP_CUSTOM_IDS.offensiveLimitsEnabled, "Offensive play call limits enabled?");
    case "offensive_limit": return buildPlayCallNumberWindow(draft, "Gameplay: Offensive Play Call Limit", LEAGUE_SETUP_CUSTOM_IDS.offensiveLimit, "Select max times a play can be called per game");
    case "offensive_cooldown_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Offensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldownEnabled, "Offensive play call cooldown enabled?");
    case "offensive_cooldown": return buildPlayCallNumberWindow(draft, "Gameplay: Offensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown, "Select plays required before repeating", true);
    case "defensive_limits_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Defensive Play Call Limits", LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled, "Defensive play call limits enabled?");
    case "defensive_limit": return buildPlayCallNumberWindow(draft, "Gameplay: Defensive Play Call Limit", LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit, "Select max times a play can be called per game");
    case "defensive_cooldown_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Defensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldownEnabled, "Defensive play call cooldown enabled?");
    case "defensive_cooldown": return buildPlayCallNumberWindow(draft, "Gameplay: Defensive Play Call Cooldown", LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown, "Select plays required before repeating", true);
    case "team_linking_optional": return buildTeamLinkingOptionalWindow(draft);
    case "default_schedule_confirm": return buildDefaultScheduleConfirmWindow(draft);
    case "activity_requirements": return buildActivityRequirementsWindow(draft);
    case "fair_sim_rules": return buildFairSimRulesWindow(draft);
    case "settings_picker": return buildSettingsPickerWindow(draft);
    case "review": return buildLeagueSetupReviewWindow(draft);
  }
}

export function applyLeagueSetupDependencies(draft: LeagueSetupDraft) {
  if (isRiseToImmortalityDraft(draft)) {
    draft.game = "madden_27";
    const locked = RISE_TO_IMMORTALITY_LOCKED_SETTINGS;
    draft.coinEconomyEnabled = locked.coinEconomyEnabled;
    draft.customPlayersEnabled = locked.customPlayersEnabled;
    draft.customPlayersSeasonCap = locked.customPlayersSeasonCap;
    draft.legendsEnabled = locked.legendsEnabled;
    draft.legendsSeasonCap = locked.legendsSeasonCap;
    draft.devUpgradesEnabled = locked.devUpgradesEnabled;
    draft.devUpgradesSeasonCap = locked.devUpgradesSeasonCap;
    draft.ageResetsEnabled = locked.ageResetsEnabled;
    draft.ageResetsSeasonCap = locked.ageResetsSeasonCap;
    draft.attributePurchasesEnabled = locked.attributePurchasesEnabled;
    draft.coreAttributePurchasesSeasonCap = locked.coreAttributePurchasesSeasonCap;
    draft.nonCoreAttributePurchasesSeasonCap = locked.nonCoreAttributePurchasesSeasonCap;
    draft.playerTraitPurchasesEnabled = locked.playerTraitPurchasesEnabled;
    draft.contractAdjustmentPurchasesEnabled = locked.contractAdjustmentPurchasesEnabled;
    draft.contractPurchasesSeasonCap = locked.contractPurchasesSeasonCap;
    draft.salaryCapEnabled = locked.salaryCapEnabled;
    draft.tradeDeadlineEnabled = locked.tradeDeadlineEnabled;
    draft.cpuTradingPolicy = locked.cpuTradingPolicy;
    draft.cpuTradingAllowed = locked.cpuTradingAllowed;
    draft.tradeApprovalPolicy = "not_allowed";
    draft.injuryPolicy = locked.injuryPolicy;
    draft.wearAndTearEnabled = locked.wearAndTearEnabled;
    draft.abilitiesEnabled = locked.abilitiesEnabled;
    draft.linkTeamsAfterSetup = false;
  }

  // Coach Mode sub-toggles only apply when Coach Mode itself is enabled.
  if (!draft.coachModeEnabled) {
    draft.coachModeAutoPassEnabled = false;
    draft.coachModeAutoSnapEnabled = false;
    draft.coachModeCoachSuggestionsEnabled = false;
  }

  draft.streamingRequirement = draft.regularSeasonStreamingRequirement;
  draft.streamingSide = draft.regularSeasonStreamingSide;
  draft.streamingScope = draft.postseasonStreamingRequirement === "required" && draft.regularSeasonStreamingRequirement !== "required" ? "playoffs_only" : "every_game";

  if (!draft.coinEconomyEnabled) {
    draft.customPlayersEnabled = false;
    draft.legendsEnabled = false;
    draft.devUpgradesEnabled = false;
    draft.ageResetsEnabled = false;
    draft.attributePurchasesEnabled = false;
    draft.playerTraitPurchasesEnabled = false;
    draft.contractAdjustmentPurchasesEnabled = false;
    draft.customPlayersSeasonCap = 0;
    draft.legendsSeasonCap = 0;
    draft.devUpgradesSeasonCap = 0;
    draft.ageResetsSeasonCap = 0;
    draft.playerTraitPurchasesSeasonCap = 0;
    draft.contractPurchasesSeasonCap = 0;
    draft.coreAttributePurchasesSeasonCap = 0;
    draft.nonCoreAttributePurchasesSeasonCap = 0;
    draft.coreAttributes = [];
    draft.coreAttributeCapOverrides = {};
  }

  if (!draft.customPlayersEnabled) {
    draft.customPlayersSeasonCap = 0;
  }
  if (!draft.legendsEnabled) {
    draft.legendsSeasonCap = 0;
  }
  if (!draft.devUpgradesEnabled) {
    draft.devUpgradesSeasonCap = 0;
  }
  if (!draft.ageResetsEnabled) {
    draft.ageResetsSeasonCap = 0;
  }
  if (!draft.playerTraitPurchasesEnabled) {
    draft.playerTraitPurchasesSeasonCap = 0;
  }
  if (!draft.contractAdjustmentPurchasesEnabled) {
    draft.contractPurchasesSeasonCap = 0;
  }
  if (!draft.attributePurchasesEnabled) {
    draft.coreAttributePurchasesSeasonCap = 0;
    draft.nonCoreAttributePurchasesSeasonCap = 0;
    draft.coreAttributes = [];
    draft.coreAttributeCapOverrides = {};
  }

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
  if (!isRiseToImmortalityDraft(draft)) {
    draft.tradeApprovalPolicy = draft.tradeApprovalPolicy === "not_allowed" ? "not_allowed" : "competition_committee_review";
    draft.cpuTradingPolicy = "allowed";
    draft.cpuTradingAllowed = true;
  } else {
    draft.cpuTradingAllowed = draft.cpuTradingPolicy === "allowed";
  }
  draft.cpuFreeAgencyPolicy = "disabled";
  draft.cpuTradingRestriction = "";
  if (!draft.slidersAdjusted) {
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
