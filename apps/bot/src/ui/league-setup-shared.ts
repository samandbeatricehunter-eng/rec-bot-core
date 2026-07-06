import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import type { LeagueSetupDraft } from "./league-setup-types.js";

export function baseEmbed(title: string, draft: LeagueSetupDraft) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Use the selector below. Every screen includes Back and Main Menu controls."
    ].join("\n"));
}

export function selectRow(customId: string, placeholder: string, options: StringSelectMenuOptionBuilder[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(...options)
  );
}

export function option(label: string, value: string, description?: string) {
  const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
  if (description) opt.setDescription(description);
  return opt;
}

export function yesNoOptions() {
  return [option("On / Enabled", "yes"), option("Off / Disabled", "no")];
}

export function boolText(value: boolean) {
  return value ? "On" : "Off";
}

export function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

export function fmt(value: string) {
  return value.replaceAll("_", " ");
}

const CFB_DIFFICULTY_LABELS: Record<string, string> = {
  rookie: "Freshman",
  pro: "Varsity",
  all_pro: "All-American",
  all_madden: "Heisman",
  custom: "Custom"
};

export function formatDifficultyLabel(value: string, isCfb: boolean) {
  return isCfb ? CFB_DIFFICULTY_LABELS[value] ?? fmt(value) : fmt(value);
}
