import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed, formatDifficultyLabel, option, selectRow, yesNoOptions } from "./league-setup-shared.js";

export function buildDifficultyWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("Gameplay: Difficulty", draft);

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.difficulty, "Select difficulty", [
        option(formatDifficultyLabel("rookie"), "rookie"),
        option(formatDifficultyLabel("pro"), "pro"),
        option(formatDifficultyLabel("all_pro"), "all_pro"),
        option(formatDifficultyLabel("all_madden"), "all_madden")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildSlidersAdjustedWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Sliders Adjusted", draft)
      .setDescription("Have any gameplay sliders been adjusted from the game defaults for this league?")],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.slidersAdjusted, "Sliders adjusted?", yesNoOptions()),
      buildNavigationRow()
    ]
  };
}

/** @deprecated Custom difficulty notes were replaced by Sliders Adjusted. Kept for edit-mode compatibility. */
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

export function buildAdvanceTimingWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Advance Timing", draft)
      .setDescription("How long do coaches typically have between league advances?")],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.advanceTiming, "Advance timing", [
        option("24 hours", "24hr"),
        option("48 hours", "48hr"),
        option("72 hours", "72hr"),
        option("Other", "other", "Enter a custom advance window.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildAdvanceTimingOtherModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.advanceTimingOtherModal)
    .setTitle("Custom Advance Timing")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.advanceTimingOtherInput)
          .setLabel("Advance timing window")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120)
          .setValue(draft.advanceTimingOther ?? "")
          .setPlaceholder("e.g. Every Monday & Thursday at 9pm ET")
      )
    );
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

// ---- Franchise / Coach Mode / Assist settings. Each setting below gets its own dedicated
// wizard step (never bundled multiple questions onto one screen — see 79eac1cf for the bug
// that caused). ----

function threeWayOptions(offLabel: string, onLabel: string, thirdLabel: string, thirdValue: string, thirdDescription?: string) {
  return [option(offLabel, "off"), option(onLabel, "on"), option(thirdLabel, thirdValue, thirdDescription)];
}

export function buildCoachFiringPolicyWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Franchise Settings: Coach Firing", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.coachFiringPolicy, "Coach Firing", threeWayOptions("Off", "On", "CPU Only", "cpu_only", "Only CPU-controlled coaches can be fired.")),
      buildNavigationRow()
    ]
  };
}

export function buildPreorderBonusesWindow(draft: LeagueSetupDraft) {
  return buildBooleanGameplayWindow(draft, "Franchise Settings: Preorder Bonuses", LEAGUE_SETUP_CUSTOM_IDS.preorderBonuses, "Preorder Bonuses enabled?");
}

function assistOptions() {
  return [option("On", "on"), option("Off", "off"), option("Keep Individual", "keep_individual", "Leave each user's personal setting as-is.")];
}

export function buildBallHawkWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Ball Hawk", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.ballHawk, "Ball Hawk", assistOptions()), buildNavigationRow()]
  };
}

export function buildHeatSeekerWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Heat Seeker", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.heatSeeker, "Heat Seeker", assistOptions()), buildNavigationRow()]
  };
}

export function buildSwitchAssistWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("Gameplay: Switch Assist", draft)],
    components: [selectRow(LEAGUE_SETUP_CUSTOM_IDS.switchAssist, "Switch Assist", assistOptions()), buildNavigationRow()]
  };
}

export type CoachModeSubSetting = { step: LeagueSetupDraft["step"]; key: keyof LeagueSetupDraft; customId: string; label: string };

export const COACH_MODE_SUB_SETTINGS: CoachModeSubSetting[] = [
  { step: "coach_mode_auto_pass", key: "coachModeAutoPassEnabled", customId: LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoPass, label: "Autopass" },
  { step: "coach_mode_auto_snap", key: "coachModeAutoSnapEnabled", customId: LEAGUE_SETUP_CUSTOM_IDS.coachModeAutoSnap, label: "Autosnap" },
  { step: "coach_mode_coach_suggestions", key: "coachModeCoachSuggestionsEnabled", customId: LEAGUE_SETUP_CUSTOM_IDS.coachModeCoachSuggestions, label: "Coach Suggestions" }
];

export function findCoachModeSubSetting(step: LeagueSetupDraft["step"]) {
  const setting = COACH_MODE_SUB_SETTINGS.find((candidate) => candidate.step === step);
  if (!setting) throw new Error(`No coach mode sub-setting registered for step "${step}"`);
  return setting;
}

export function buildCoachModeSubSettingWindow(draft: LeagueSetupDraft, setting: CoachModeSubSetting) {
  return buildBooleanGameplayWindow(draft, `Gameplay: Coach Mode — ${setting.label}`, setting.customId, `${setting.label} enabled?`);
}
