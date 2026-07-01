import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed, option, selectRow, yesNoOptions } from "./league-setup-shared.js";

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
