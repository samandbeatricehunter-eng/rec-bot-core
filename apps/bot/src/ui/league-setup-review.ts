import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { getDefaultNflSeasonLabelForGame, type MaddenLeagueGame } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";
import {
  LEAGUE_GAME_OPTIONS,
  LEAGUE_SETUP_CUSTOM_IDS,
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
  buildCoachAbilitiesRestrictedWindow,
  buildCpuRulesWindow,
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
  buildConferenceAssignmentsWindow,
  buildConferenceRealignmentWindow,
  buildDynastyStructureWindow,
  buildHeatSeekerWindow,
  buildInjuryPolicyWindow,
  buildPlayCallNumberWindow,
  buildPreorderBonusesWindow,
  buildQuarterLengthWindow,
  buildRecruitingDifficultyWindow,
  buildSwitchAssistWindow,
  buildCfbToggleWindow,
  buildDifficultyWindow,
  COACH_MODE_SUB_SETTINGS,
  findCoachModeSubSetting
} from "./league-setup-gameplay.js";
import { buildFeatureDecisionWindow } from "./league-setup-purchases.js";
import { buildGameSelectWindow, buildLeagueTypeWindow } from "./league-setup-core.js";

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
  if (game === "madden_26" || game === "madden_27") {
    return getDefaultNflSeasonLabelForGame(game as MaddenLeagueGame);
  }
  return null;
}

export function buildDefaultScheduleConfirmWindow(draft: LeagueSetupDraft) {
  const seasonLabel = defaultScheduleSeasonLabel(draft.game);
  const description = seasonLabel
    ? [
        `REC can pre-load the real NFL **${seasonLabel} regular-season matchups** (Weeks 1–18) for a new franchise.`,
        "",
        "Only choose **Yes** if your Madden league is in **Franchise Year 1** and still using that NFL season in-game.",
        "",
        "If your franchise is already several seasons deep, choose **No** — the default schedule would be out of date. You can enter or import the current schedule later.",
        "",
        "This seeds **matchups only**, not scores or results. Playoffs are not seeded."
      ].join("\n")
    : "Default NFL schedule seeding is only available for Madden NFL leagues.";

  return {
    embeds: [baseEmbed("League Setup: Default NFL Schedule", draft).setDescription(description)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.defaultScheduleConfirm, seasonLabel ? `Franchise Year 1 in the ${seasonLabel} NFL season?` : "Seed default NFL schedule?", [
        option(`Yes — seed ${seasonLabel ?? "default"} regular-season matchups`, "yes"),
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
    case "dynasty": return "Dynasty Settings";
    case "gameplay": return "Gameplay Settings";
    case "franchise": return "Franchise Settings";
    case "play_call": return "Play Call Settings";
  }
}

export function buildSettingsPickerWindow(draft: LeagueSetupDraft, category?: LeagueSetupSettingsCategory) {
  const isCfb = draft.game === "cfb_27";
  if (!category) {
    const categoryChoices = [
      option("Features", "category:features"),
      option("Purchases", "category:purchases"),
      option("Server Setup", "category:server"),
      option("Rules & Policies", "category:rules"),
      ...(isCfb ? [option("Dynasty Settings", "category:dynasty")] : []),
      option("Gameplay Settings", "category:gameplay"),
      // CFB folds Coach Firing/Preorder Bonuses/Coach Mode/Assists into Dynasty Settings —
      // it's not called "Franchise" there. Madden keeps its own Franchise Settings category.
      ...(isCfb ? [] : [option("Franchise Settings", "category:franchise")]),
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
      option("Economy", "economy"),
      option("Activity Requirements (Fair Sim / Force Win)", "activity_requirements"),
      ...(isCfb ? [] : [option("Default NFL Schedule (Franchise Year 1)", "default_schedule_confirm")])
    ],
    purchases: isCfb ? [
      option("Custom Recruits", "custom_players"),
      option("Campus Legends", "legends"),
      option("Dev Upgrades", "dev_upgrades"),
      option("Attribute Purchases", "attribute_purchases"),
      option("Attribute Core Attributes", "attribute_core_attributes"),
      option("Player Trait Purchases", "player_trait_purchases"),
    ] : [
      option("Custom Players", "custom_players"),
      option("Legends", "legends"),
      option("Dev Upgrades", "dev_upgrades"),
      option("Age Resets", "age_resets"),
      option("Attribute Purchases", "attribute_purchases"),
      option("Attribute Core Attributes", "attribute_core_attributes"),
      option("Player Trait Purchases", "player_trait_purchases"),
      option("Contract Purchases", "contract_purchases"),
    ],
    server: [
      option("Server Channel Assignments", "server_setup")
    ],
    rules: isCfb ? [
      option("Regular Season Streaming", "regular_season_streaming"),
      option("Regular Season Streaming Side", "regular_season_streaming_side"),
      option("Postseason Streaming", "postseason_streaming"),
      option("Postseason Streaming Side", "postseason_streaming_side"),
      option("4th Down Rules (Regular Season)", "fourth_down_regular"),
      option("4th Down Rules (Playoff)", "fourth_down_playoff"),
      option("Custom Coaches Required?", "custom_coaches_required"),
      option("Custom Playbooks Allowed?", "custom_playbooks_allowed")
    ] : [
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
      option("Trade Approval Policy", "trade_approval"),
      option("CPU Trading", "cpu_trading")
    ],
    dynasty: [
      option("Dynasty Structure", "dynasty_structure"),
      option("Recruiting Difficulty", "recruiting_difficulty"),
      option("Transfer Portal", "transfer_portal"),
      option("Coach Carousel", "coach_carousel"),
      option("Conference Realignment", "conference_realignment"),
      ...(draft.conferenceRealignment === "allowed" ? [option("Conference Assignments", "conference_assignments")] : []),
      option("Home-Field Advantage", "home_field_advantage"),
      option("Stadium Pulse", "stadium_pulse"),
      // CFB calls this section "Dynasty" rather than "Franchise" — these live in the
      // Dynasty category here instead of a separate Franchise category (Madden-only).
      option("Coach Firing", "coach_firing_policy"),
      option("Preorder Bonuses", "preorder_bonuses"),
      option("Coach Mode", "coach_mode_enabled"),
      ...(draft.coachModeEnabled ? COACH_MODE_SUB_SETTINGS.filter((setting) => !setting.cfbOnly || isCfb).map((setting) => option(setting.label, setting.step)) : []),
      option("Ball Hawk", "ball_hawk"),
      option("Heat Seeker", "heat_seeker"),
      option("Switch Assist", "switch_assist")
    ],
    gameplay: isCfb ? [
      option("Difficulty", "difficulty"),
      option("Quarter Length", "quarter_length"),
      option("Accelerated Clock", "accelerated_clock_enabled"),
      option("Wear & Tear", "wear_and_tear"),
      option("Injuries", "injury_policy")
    ] : [
      option("Difficulty", "difficulty"),
      option("Quarter Length", "quarter_length"),
      option("Accelerated Clock", "accelerated_clock_enabled"),
      option("Salary Cap", "salary_cap"),
      option("Trade Deadline", "trade_deadline"),
      option("Abilities", "abilities"),
      option("Wear & Tear", "wear_and_tear"),
      option("Injuries", "injury_policy")
    ],
    franchise: [
      option("Coach Firing", "coach_firing_policy"),
      option("Preorder Bonuses", "preorder_bonuses"),
      option("Coach Mode", "coach_mode_enabled"),
      ...(draft.coachModeEnabled ? COACH_MODE_SUB_SETTINGS.filter((setting) => !setting.cfbOnly || isCfb).map((setting) => option(setting.label, setting.step)) : []),
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
  const isCfb = draft.game === "cfb_27";
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
    if (isCfb) {
      lines.push(
        `  Recruit Flipping: ${yesNo(draft.coachModeRecruitFlippingEnabled)}`,
        `  Auto Recruiting: ${yesNo(draft.coachModeAutoRecruitingEnabled)}`,
        `  Auto Progress Players: ${yesNo(draft.coachModeAutoProgressPlayersEnabled)}`,
        `  User Coach Auto Progression: ${yesNo(draft.coachModeUserAutoProgressionEnabled)}`,
        `  CPU Manage Budget: ${yesNo(draft.coachModeCpuManageBudgetEnabled)}`,
        `  CPU Manage Staff: ${yesNo(draft.coachModeCpuManageStaffEnabled)}`,
        `  CPU Manage Facilities Spending: ${yesNo(draft.coachModeCpuManageFacilitiesEnabled)}`
      );
    }
  }
  lines.push(
    `Ball Hawk: ${fmt(draft.ballHawk)}`,
    `Heat Seeker: ${fmt(draft.heatSeeker)}`,
    `Switch Assist: ${fmt(draft.switchAssist)}`
  );
  return lines.join("\n");
}

export function buildLeagueSetupReviewWindow(draft: LeagueSetupDraft) {
  if (draft.game === "cfb_27") return buildCfbReviewWindow(draft);

  const embed = new EmbedBuilder()
    .setTitle("Review League Setup")
    .setDescription([`League: **${draft.name}**`, `League Password: ${draft.leaguePassword ? draft.leaguePassword : "Not set / public"}`, "", "Review the configuration below, then save the league. Use the section buttons below to jump back and change answers."].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [`Game: ${LEAGUE_GAME_OPTIONS[draft.game] ?? draft.game}`, `Type: ${fmt(draft.leagueType)}`, "Starts: Season 1, Training Camp", `Default Schedule: ${draft.seedDefaultSchedule == null ? "Not answered" : draft.seedDefaultSchedule ? `Seed ${defaultScheduleSeasonLabel(draft.game) ?? "NFL"} regular season` : "Skip seeding"}`].join("\n"),
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

export function buildCfbReviewWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("Review CFB 27 Dynasty Setup")
    .setDescription([`League: **${draft.name}**`, `League Password: ${draft.leaguePassword ? draft.leaguePassword : "Not set / public"}`, "", "Review your College Football 27 dynasty configuration, then save. Use the section buttons below to jump back and change answers."].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [
          `Game: ${LEAGUE_GAME_OPTIONS[draft.game] ?? draft.game}`,
          `Active Rosters: ${yesNo(draft.activeRostersEnabled)}`,
          `Dynasty Structure: ${draft.dynastyType === "mixed" ? "Mixed Teams" : "Real Teams"}`,
          `Team Builder: ${yesNo(draft.teamBuilderAllowed)}`,
          "Starts: Season 1, Preseason"
        ].join("\n"),
        inline: true
      },
      {
        name: "Dynasty Settings",
        value: [
          `Recruiting Difficulty: ${fmt(draft.recruitingDifficulty)}`,
          `Transfer Portal: ${yesNo(draft.transferPortalEnabled)}`,
          `Coach Carousel: ${yesNo(draft.coachCarouselEnabled)}`,
          `Conference Realignment: ${fmt(draft.conferenceRealignment)}`,
          ...(draft.conferenceRealignment === "allowed" ? [`Conferences Reassigned: ${Object.keys(draft.conferenceAssignments).length}`] : []),
          `Home-Field Advantage: ${yesNo(draft.homeFieldAdvantageEnabled)}`,
          `Stadium Pulse: ${yesNo(draft.stadiumPulseEnabled)}`,
          `Wear & Tear: ${boolText(draft.wearAndTearEnabled)}`,
          "",
          formatFranchiseSettingsReview(draft)
        ].join("\n"),
        inline: true
      },
      {
        name: "Features",
        value: [
          `Economy: ${yesNo(draft.coinEconomyEnabled)}`,
          `Custom Recruits: ${yesNo(draft.customPlayersEnabled)}`,
          `Campus Legends: ${yesNo(draft.legendsEnabled)}`,
          `Dev Upgrades: ${yesNo(draft.devUpgradesEnabled)}`,
          `Attribute Purchases: ${yesNo(draft.attributePurchasesEnabled)}`,
          `Player Trait Purchases: ${yesNo(draft.playerTraitPurchasesEnabled)}`,
          "",
          formatPurchaseCapsReview(draft)
        ].join("\n"),
        inline: false
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
          `Custom Coaches Required: ${yesNo(draft.customCoachesRequired)}`,
          `Custom Playbooks Allowed: ${yesNo(draft.customPlaybooksAllowed)}`,
          `Fair Sim: ${draft.fairSimRequirements || "Not set"}`,
          `Force Win: ${draft.forceWinRequirements || "Not set"}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Gameplay",
        value: [
          `Difficulty: ${formatDifficultyLabel(draft.difficulty, true)}${draft.difficulty === "custom" ? ` - ${draft.difficultyCustomSettings || "Custom text missing"}` : ""}`,
          `Quarter Length: ${draft.quarterLengthMinutes}`,
          `Accelerated Clock: ${boolText(draft.acceleratedClockEnabled)}${draft.acceleratedClockEnabled ? ` (${draft.acceleratedClockMinimumSeconds}s)` : ""}`,
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

  const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:dynasty`).setLabel("Edit Dynasty").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:features`).setLabel("Edit Features").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:server_setup`).setLabel("Edit Server").setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:rules`).setLabel("Edit Rules").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:gameplay`).setLabel("Edit Gameplay").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.save).setLabel("Save Dynasty Setup").setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [editRow, actionRow, buildNavigationRow()] };
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
    case "dynasty_structure": return buildDynastyStructureWindow(draft);
    case "recruiting_difficulty": return buildRecruitingDifficultyWindow(draft);
    case "transfer_portal": return buildCfbToggleWindow(draft, "CFB Setup: Transfer Portal", LEAGUE_SETUP_CUSTOM_IDS.transferPortal, "Is the Transfer Portal active? Players may enter/leave via the portal between seasons.", "Transfer Portal enabled?");
    case "coach_carousel": return buildCfbToggleWindow(draft, "CFB Setup: Coach Carousel", LEAGUE_SETUP_CUSTOM_IDS.coachCarousel, "Is the Coach Carousel active? Coaches may be hired away or change programs between seasons.", "Coach Carousel enabled?");
    case "conference_realignment": return buildConferenceRealignmentWindow(draft);
    case "conference_assignments": return buildConferenceAssignmentsWindow(draft);
    case "home_field_advantage": return buildCfbToggleWindow(draft, "CFB Setup: Home-Field Advantage", LEAGUE_SETUP_CUSTOM_IDS.homeFieldAdvantage, "Enable Home-Field Advantage? Hostile road environments shake the play-art and pressure the visiting offense.", "Home-Field Advantage enabled?");
    case "stadium_pulse": return buildCfbToggleWindow(draft, "CFB Setup: Stadium Pulse", LEAGUE_SETUP_CUSTOM_IDS.stadiumPulse, "Enable Stadium Pulse? Crowd energy builds with momentum and affects the on-field atmosphere.", "Stadium Pulse enabled?");
    case "economy": return buildFeatureDecisionWindow(draft);
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
    case "coach_firing_policy": return buildCoachFiringPolicyWindow(draft);
    case "preorder_bonuses": return buildPreorderBonusesWindow(draft);
    case "coach_mode_enabled": return buildBooleanGameplayWindow(draft, "Gameplay: Coach Mode", LEAGUE_SETUP_CUSTOM_IDS.coachModeEnabled, "Coach Mode enabled?");
    case "coach_mode_auto_pass":
    case "coach_mode_auto_snap":
    case "coach_mode_coach_suggestions":
    case "coach_mode_recruit_flipping":
    case "coach_mode_auto_recruiting":
    case "coach_mode_auto_progress_players":
    case "coach_mode_user_auto_progression":
    case "coach_mode_cpu_manage_budget":
    case "coach_mode_cpu_manage_staff":
    case "coach_mode_cpu_manage_facilities":
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
    case "settings_picker": return buildSettingsPickerWindow(draft);
    case "review": return buildLeagueSetupReviewWindow(draft);
  }
}

export function applyLeagueSetupDependencies(draft: LeagueSetupDraft) {
  // CFB: Team Builder availability is coupled to the dynasty structure.
  // Mixed Teams ⇒ team builder on; Real Teams ⇒ off.
  draft.teamBuilderAllowed = draft.dynastyType === "mixed";

  // CFB has Campus Legends (a plain toggle) but no Age Resets or Contract Purchases —
  // keep those off so they can never persist on.
  if (draft.game === "cfb_27") {
    draft.ageResetsEnabled = false;
    draft.ageResetsSeasonCap = 0;
    draft.contractAdjustmentPurchasesEnabled = false;
    draft.contractPurchasesSeasonCap = 0;
    // CFB has no salary cap, trade deadline, or abilities toggle.
    draft.salaryCapEnabled = false;
    draft.tradeDeadlineEnabled = false;
  }

  // Conference assignment overrides only make sense for CFB leagues that allow realignment.
  if (draft.game !== "cfb_27" || draft.conferenceRealignment !== "allowed") {
    draft.conferenceAssignments = {};
  }

  // Coach Mode sub-toggles only apply when Coach Mode itself is enabled.
  if (!draft.coachModeEnabled) {
    draft.coachModeAutoPassEnabled = false;
    draft.coachModeAutoSnapEnabled = false;
    draft.coachModeCoachSuggestionsEnabled = false;
    draft.coachModeRecruitFlippingEnabled = false;
    draft.coachModeAutoRecruitingEnabled = false;
    draft.coachModeAutoProgressPlayersEnabled = false;
    draft.coachModeUserAutoProgressionEnabled = false;
    draft.coachModeCpuManageBudgetEnabled = false;
    draft.coachModeCpuManageStaffEnabled = false;
    draft.coachModeCpuManageFacilitiesEnabled = false;
  }
  // The extra Coach Mode sub-toggles (recruiting/staff/budget management) are CFB-only.
  if (draft.game !== "cfb_27") {
    draft.coachModeRecruitFlippingEnabled = false;
    draft.coachModeAutoRecruitingEnabled = false;
    draft.coachModeAutoProgressPlayersEnabled = false;
    draft.coachModeUserAutoProgressionEnabled = false;
    draft.coachModeCpuManageBudgetEnabled = false;
    draft.coachModeCpuManageStaffEnabled = false;
    draft.coachModeCpuManageFacilitiesEnabled = false;
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
