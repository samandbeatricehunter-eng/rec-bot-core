import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { CFB_27_TEAMS, CONFERENCE_ORDER } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed, boolText, fmt, formatDifficultyLabel, option, selectRow, yesNoOptions } from "./league-setup-shared.js";

export function buildDifficultyWindow(draft: LeagueSetupDraft) {
  const isCfb = draft.game === "cfb_27";
  const embed = baseEmbed("Gameplay: Difficulty", draft);
  if (draft.difficulty === "custom" && draft.difficultyCustomSettings) {
    embed.addFields({ name: "Current Custom Difficulty Notes", value: draft.difficultyCustomSettings.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.difficulty, "Select difficulty", [
        option(formatDifficultyLabel("rookie", isCfb), "rookie"),
        option(formatDifficultyLabel("pro", isCfb), "pro"),
        option(formatDifficultyLabel("all_pro", isCfb), "all_pro"),
        option(formatDifficultyLabel("all_madden", isCfb), "all_madden"),
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

// ---- CFB 27 dynasty setup windows (only reached when game === "cfb_27") ----

function cfbEmbed(title: string, draft: LeagueSetupDraft, description: string) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([`League: **${draft.name}**`, "", description].join("\n"));
}

export function buildDynastyStructureWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [cfbEmbed("CFB Setup: Dynasty Structure", draft, [
      "How are this dynasty's teams composed?",
      "",
      "• **Real Teams** — everyone uses the real FBS programs. Team Builder is **disabled**.",
      "• **Mixed Teams** — custom/created programs are allowed alongside real ones, so Team Builder is **enabled**."
    ].join("\n"))],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.dynastyStructure, "Select dynasty structure", [
        option("Real Teams", "real", "Real FBS programs only — Team Builder off."),
        option("Mixed Teams", "mixed", "Allow created programs — Team Builder on.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildRecruitingDifficultyWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [cfbEmbed("CFB Setup: Recruiting Difficulty", draft, "How hard is it to land recruits and win recruiting battles this dynasty?")],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.recruitingDifficulty, "Select recruiting difficulty", [
        option("Easy", "easy"),
        option("Normal", "normal"),
        option("Hard", "hard")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildConferenceRealignmentWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [cfbEmbed("CFB Setup: Conference Realignment", draft, [
      "May teams move conferences during the dynasty?",
      "",
      "• **Locked** — conferences stay as they start.",
      "• **Allowed** — realignment / expansion is permitted between seasons."
    ].join("\n"))],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.conferenceRealignment, "Select realignment policy", [
        option("Locked", "locked"),
        option("Allowed", "allowed")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCfbToggleWindow(draft: LeagueSetupDraft, title: string, customId: string, description: string, placeholder: string) {
  return {
    embeds: [cfbEmbed(title, draft, description)],
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

// ---- Franchise / Coach Mode / Assist settings (shared across Madden and CFB).
// CFB calls this section "Dynasty" rather than "Franchise" — Madden keeps "Franchise". ----

function threeWayOptions(offLabel: string, onLabel: string, thirdLabel: string, thirdValue: string, thirdDescription?: string) {
  return [option(offLabel, "off"), option(onLabel, "on"), option(thirdLabel, thirdValue, thirdDescription)];
}

function franchiseOrDynastyLabel(draft: LeagueSetupDraft) {
  return draft.game === "cfb_27" ? "Dynasty" : "Franchise";
}

export function buildFranchiseSettingsWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed(`Gameplay: ${franchiseOrDynastyLabel(draft)} Settings`, draft)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Pick answers for both settings below, then press Continue.",
      "",
      `Coach Firing: **${fmt(draft.coachFiringPolicy)}**`,
      `Preorder Bonuses: **${boolText(draft.preorderBonusesEnabled)}**`
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.coachFiringPolicy, "Coach Firing", threeWayOptions("Off", "On", "CPU Only", "cpu_only", "Only CPU-controlled coaches can be fired.")),
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.preorderBonuses, "Preorder Bonuses", yesNoOptions()),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.franchiseSettingsDone)
          .setLabel(draft.editMode ? "Save & Continue" : "Continue")
          .setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

function assistOptions() {
  return [option("On", "on"), option("Off", "off"), option("Keep Individual", "keep_individual", "Leave each user's personal setting as-is.")];
}

export function buildAssistSettingsWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("Gameplay: Assist Settings", draft)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Pick answers for all three settings below, then press Continue.",
      "",
      `Ball Hawk: **${fmt(draft.ballHawk)}**`,
      `Heat Seeker: **${fmt(draft.heatSeeker)}**`,
      `Switch Assist: **${fmt(draft.switchAssist)}**`
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.ballHawk, "Ball Hawk", assistOptions()),
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.heatSeeker, "Heat Seeker", assistOptions()),
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.switchAssist, "Switch Assist", assistOptions()),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.assistSettingsDone)
          .setLabel(draft.editMode ? "Save & Continue" : "Continue")
          .setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

type CoachModeSubSetting = { key: keyof LeagueSetupDraft; label: string; cfbOnly?: boolean };

export const COACH_MODE_SUB_SETTINGS: CoachModeSubSetting[] = [
  { key: "coachModeAutoPassEnabled", label: "Autopass" },
  { key: "coachModeAutoSnapEnabled", label: "Autosnap" },
  { key: "coachModeCoachSuggestionsEnabled", label: "Coach Suggestions" },
  { key: "coachModeRecruitFlippingEnabled", label: "Recruit Flipping", cfbOnly: true },
  { key: "coachModeAutoRecruitingEnabled", label: "Auto Recruiting", cfbOnly: true },
  { key: "coachModeAutoProgressPlayersEnabled", label: "Auto Progress Players", cfbOnly: true },
  { key: "coachModeUserAutoProgressionEnabled", label: "User Coach Auto Progression", cfbOnly: true },
  { key: "coachModeCpuManageBudgetEnabled", label: "CPU Manage Budget", cfbOnly: true },
  { key: "coachModeCpuManageStaffEnabled", label: "CPU Manage Staff", cfbOnly: true },
  { key: "coachModeCpuManageFacilitiesEnabled", label: "CPU Manage Facilities Spending", cfbOnly: true }
];

export function buildCoachModeSettingsWindow(draft: LeagueSetupDraft) {
  const isCfb = draft.game === "cfb_27";
  const visible = COACH_MODE_SUB_SETTINGS.filter((setting) => !setting.cfbOnly || isCfb);
  const embed = new EmbedBuilder()
    .setTitle(`${isCfb ? "Dynasty" : "Gameplay"}: Coach Mode Settings`)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Pick a setting below to toggle it on/off.",
      "",
      ...visible.map((setting) => `${setting.label}: **${draft[setting.key] ? "On" : "Off"}**`)
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(
        LEAGUE_SETUP_CUSTOM_IDS.coachModeSettingSelect,
        "Select a setting to toggle",
        visible.map((setting) => option(setting.label, setting.key as string, draft[setting.key] ? "Currently On" : "Currently Off"))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.coachModeSettingsDone)
          .setLabel(draft.editMode ? "Save & Continue" : "Continue")
          .setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

// ---- Conference assignment editor (CFB 27 only) ----

const CFB_CONFERENCES = CONFERENCE_ORDER.filter((conference) => conference !== "NFC" && conference !== "AFC");

function effectiveConference(draft: LeagueSetupDraft, team: { abbreviation: string; conference: string }) {
  return draft.conferenceAssignments[team.abbreviation] ?? team.conference;
}

function cfbTeamDisplayName(team: { name: string; mascot: string }) {
  return `${team.name} ${team.mascot}`;
}

export function conferenceGroupBrowseCustomId(conference: string) {
  return `${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignGroupPrefix}:${encodeURIComponent(conference)}`;
}

export function conferenceAssignTargetCustomId(abbreviation: string) {
  return `${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignTargetSelect}:${abbreviation}`;
}

export function buildConferenceAssignmentsWindow(draft: LeagueSetupDraft) {
  const counts = new Map<string, number>();
  for (const team of CFB_27_TEAMS) {
    const conference = effectiveConference(draft, team);
    counts.set(conference, (counts.get(conference) ?? 0) + 1);
  }
  const movedCount = Object.keys(draft.conferenceAssignments).length;

  const embed = new EmbedBuilder()
    .setTitle("CFB Setup: Conference Assignments")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Realign teams to match their real conference alignment in the game. Pick a conference to view its teams, then move any team to a different conference.",
      `Teams moved from their default conference so far: **${movedCount}**`
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(
        LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignGroupPrefix,
        "Select a conference to view",
        CFB_CONFERENCES.map((conference) => option(conference, conference, `${counts.get(conference) ?? 0} teams`))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignDone)
          .setLabel(draft.editMode ? "Save & Back to Dynasty Settings" : "Continue")
          .setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

export function buildConferenceGroupWindow(draft: LeagueSetupDraft, conference: string) {
  const teams = CFB_27_TEAMS.filter((team) => effectiveConference(draft, team) === conference);
  const embed = new EmbedBuilder()
    .setTitle(`CFB Setup: ${conference} Teams`)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      `Pick a team to move to a different conference (${teams.length} currently in ${conference}).`
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(
        conferenceGroupBrowseCustomId(conference),
        `${conference} — pick a team to move`,
        teams.map((team) => option(cfbTeamDisplayName(team), team.abbreviation))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignCancel).setLabel("Back to Conferences").setStyle(ButtonStyle.Secondary)
      ),
      buildNavigationRow()
    ]
  };
}

export function buildConferenceTargetWindow(draft: LeagueSetupDraft, abbreviation: string) {
  const team = CFB_27_TEAMS.find((t) => t.abbreviation === abbreviation);
  const current = team ? effectiveConference(draft, team) : "Unknown";
  const embed = new EmbedBuilder()
    .setTitle(`CFB Setup: Move ${team ? cfbTeamDisplayName(team) : abbreviation}`)
    .setDescription([`League: **${draft.name}**`, "", `Currently in **${current}**. Select the new conference.`].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(
        conferenceAssignTargetCustomId(abbreviation),
        "Select new conference",
        CFB_CONFERENCES.map((conference) => option(conference, conference))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignCancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      ),
      buildNavigationRow()
    ]
  };
}
