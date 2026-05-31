import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const LEAGUE_SETUP_CUSTOM_IDS = {
  leagueType: "rec:league_setup:league_type",
  importMode: "rec:league_setup:import_mode",
  featureToggles: "rec:league_setup:features",
  draftClassType: "rec:league_setup:draft_class_type",
  streamingRequirement: "rec:league_setup:streaming_requirement",
  fourthDownRule: "rec:league_setup:fourth_down_rule",
  gameplayCore: "rec:league_setup:gameplay_core",
  save: "rec:league_setup:save"
} as const;

export type LeagueSetupStep =
  | "league_type"
  | "import_mode"
  | "features"
  | "draft_class_type"
  | "streaming"
  | "fourth_down"
  | "gameplay"
  | "review";

export type LeagueSetupDraft = {
  name: string;
  step: LeagueSetupStep;
  leagueType: "fantasy_draft" | "regular_rosters" | "custom_rosters";
  importMode: "manual" | "ea_import" | "companion_app_export";
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
  streamingScope: "every_game" | "playoffs_only";
  streamingSide: "home" | "away" | "either" | "both";
  fourthDownRuleType: "none" | "standard_rec" | "custom";
  positionChangePolicy: "open" | "restricted" | "highly_restricted";
  customPlaybooksAllowed: boolean;
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
  offensivePlayCallCooldown?: number | null;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit?: number | null;
  defensivePlayCallCooldown?: number | null;
};

export function createDefaultLeagueSetupDraft(name: string): LeagueSetupDraft {
  return {
    name,
    step: "league_type",
    leagueType: "regular_rosters",
    importMode: "manual",
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
    streamingScope: "every_game",
    streamingSide: "either",
    fourthDownRuleType: "standard_rec",
    positionChangePolicy: "restricted",
    customPlaybooksAllowed: false,
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
    offensivePlayCallCooldown: null,
    defensivePlayCallLimitsEnabled: false,
    defensivePlayCallLimit: null,
    defensivePlayCallCooldown: null
  };
}

export function getPreviousLeagueSetupStep(step: LeagueSetupStep): LeagueSetupStep | "admin_panel" {
  switch (step) {
    case "league_type":
      return "admin_panel";
    case "import_mode":
      return "league_type";
    case "features":
      return "import_mode";
    case "draft_class_type":
      return "features";
    case "streaming":
      return "draft_class_type";
    case "fourth_down":
      return "streaming";
    case "gameplay":
      return "fourth_down";
    case "review":
      return "gameplay";
  }
}

function baseEmbed(title: string, draft: LeagueSetupDraft) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Use the selector below. You can go Back or return to Main Menu at any time."
    ].join("\n"));
}

export function buildLeagueTypeWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: League Type", draft);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.leagueType)
      .setPlaceholder("Select league type")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Regular Rosters").setValue("regular_rosters"),
        new StringSelectMenuOptionBuilder().setLabel("Fantasy Draft").setValue("fantasy_draft"),
        new StringSelectMenuOptionBuilder().setLabel("Custom Rosters").setValue("custom_rosters")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildImportModeWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Import Mode", draft);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.importMode)
      .setPlaceholder("Select import mode")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Manual").setValue("manual"),
        new StringSelectMenuOptionBuilder().setLabel("Import from EA").setValue("ea_import"),
        new StringSelectMenuOptionBuilder().setLabel("Export from Companion App").setValue("companion_app_export")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
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
        new StringSelectMenuOptionBuilder().setLabel("Coin Economy").setValue("coin_economy"),
        new StringSelectMenuOptionBuilder().setLabel("Custom Players").setValue("custom_players"),
        new StringSelectMenuOptionBuilder().setLabel("Legends").setValue("legends"),
        new StringSelectMenuOptionBuilder().setLabel("Dev Upgrades").setValue("dev_upgrades"),
        new StringSelectMenuOptionBuilder().setLabel("Age Resets").setValue("age_resets"),
        new StringSelectMenuOptionBuilder().setLabel("Training & Packages").setValue("training_packages"),
        new StringSelectMenuOptionBuilder().setLabel("Contract Adjustment Purchases").setValue("contract_purchases"),
        new StringSelectMenuOptionBuilder().setLabel("Cap Management Assistant").setValue("cap_assistant"),
        new StringSelectMenuOptionBuilder().setLabel("Draft Class Features").setValue("draft_class_features"),
        new StringSelectMenuOptionBuilder().setLabel("Media Features").setValue("media_features")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildDraftClassTypeWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Draft Class Type", draft);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.draftClassType)
      .setPlaceholder("Select draft class type")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Auto-Gen").setValue("auto_gen"),
        new StringSelectMenuOptionBuilder().setLabel("Custom").setValue("custom"),
        new StringSelectMenuOptionBuilder().setLabel("Realistic").setValue("realistic"),
        new StringSelectMenuOptionBuilder().setLabel("Other").setValue("other")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildStreamingWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Streaming", draft)
    .addFields({
      name: "Note",
      value: "Detailed home/away/every-game options default to Recommended / Every Game / Either Team for now and will be editable in the full Rules editor."
    });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.streamingRequirement)
      .setPlaceholder("Select streaming rule")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Required").setValue("required"),
        new StringSelectMenuOptionBuilder().setLabel("Recommended").setValue("recommended"),
        new StringSelectMenuOptionBuilder().setLabel("Disabled").setValue("disabled")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildFourthDownWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: 4th Down Rules", draft);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.fourthDownRule)
      .setPlaceholder("Select 4th down rule")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("No 4th Down Rules").setValue("none"),
        new StringSelectMenuOptionBuilder().setLabel("Standard REC Rule").setValue("standard_rec"),
        new StringSelectMenuOptionBuilder().setLabel("Custom 4th Down Rules").setValue("custom")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

export function buildGameplayWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Gameplay Settings", draft)
    .addFields({
      name: "Current Defaults",
      value: [
        "Difficulty: All-Madden",
        "Quarter Length: 8",
        "Accelerated Clock: 20 seconds",
        "Salary Cap: Off",
        "Trade Deadline: Off",
        "Abilities: On",
        "Wear & Tear: On"
      ].join("\n")
    });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.gameplayCore)
      .setPlaceholder("Select gameplay preset")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("REC Default").setValue("rec_default").setDescription("All-Madden, 8 min, accel clock, cap off."),
        new StringSelectMenuOptionBuilder().setLabel("Salary Cap Enabled").setValue("salary_cap_on").setDescription("REC default with salary cap on."),
        new StringSelectMenuOptionBuilder().setLabel("Casual Setup").setValue("casual").setDescription("All-Pro, 7 min, simplified settings.")
      )
  );

  return { embeds: [embed], components: [row, buildNavigationRow()] };
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

export function buildLeagueSetupReviewWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("Review League Setup")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Review the configuration below, then save the league."
    ].join("\n"))
    .addFields(
      {
        name: "Identity",
        value: [
          `Type: ${draft.leagueType}`,
          `Import Mode: ${draft.importMode}`,
          `Draft Class Type: ${draft.draftClassType}`
        ].join("\n"),
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
        name: "Rules / Gameplay",
        value: [
          `Streaming: ${draft.streamingRequirement}`,
          `4th Down: ${draft.fourthDownRuleType}`,
          `Difficulty: ${draft.difficulty}`,
          `Quarter Length: ${draft.quarterLengthMinutes}`,
          `Salary Cap: ${yesNo(draft.salaryCapEnabled)}`
        ].join("\n"),
        inline: false
      }
    )
    .setFooter({ text: "Economy requires 8 verified linked users before payouts activate." });

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
    case "league_type":
      return buildLeagueTypeWindow(draft);
    case "import_mode":
      return buildImportModeWindow(draft);
    case "features":
      return buildFeatureTogglesWindow(draft);
    case "draft_class_type":
      return buildDraftClassTypeWindow(draft);
    case "streaming":
      return buildStreamingWindow(draft);
    case "fourth_down":
      return buildFourthDownWindow(draft);
    case "gameplay":
      return buildGameplayWindow(draft);
    case "review":
      return buildLeagueSetupReviewWindow(draft);
  }
}

export function applyLeagueSetupDependencies(draft: LeagueSetupDraft) {
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

  return draft;
}
