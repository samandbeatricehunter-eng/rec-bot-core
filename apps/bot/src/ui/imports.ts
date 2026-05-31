import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const IMPORT_CUSTOM_IDS = {
  panel: "rec:imports:panel",
  eaImport: "rec:imports:ea",
  companionImport: "rec:imports:companion",
  manualImport: "rec:imports:manual",
  status: "rec:imports:status",
  history: "rec:imports:history",
  weekScope: "rec:imports:week_scope",
  endpoints: "rec:imports:endpoints"
} as const;

export const CORE_IMPORT_ENDPOINTS = [
  { key: "league_metadata", label: "League Metadata" },
  { key: "teams", label: "Teams" },
  { key: "standings", label: "Standings" },
  { key: "schedule", label: "Schedule" },
  { key: "rosters", label: "Rosters" },
  { key: "players", label: "Players" },
  { key: "player_stats", label: "Player Stats" },
  { key: "team_stats", label: "Team Stats" }
] as const;

export function buildImportPanelRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.eaImport)
        .setLabel("EA Import")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.companionImport)
        .setLabel("Companion App Export")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.manualImport)
        .setLabel("Manual Entry")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.status)
        .setLabel("Import Status")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.history)
        .setLabel("Import History")
        .setStyle(ButtonStyle.Secondary)
    ),
    buildNavigationRow({ includeAdminPanel: true })
  ];
}

export function buildWeekScopeRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.weekScope)
      .setPlaceholder("Select import week scope")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Single Week")
          .setValue("single_week")
          .setDescription("Import one Madden week."),
        new StringSelectMenuOptionBuilder()
          .setLabel("Week Range")
          .setValue("selected_weeks")
          .setDescription("Import a span of weeks."),
        new StringSelectMenuOptionBuilder()
          .setLabel("Full Available")
          .setValue("full_available")
          .setDescription("Import all available core data.")
      )
  );
}

export function buildEndpointSelectRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.endpoints)
      .setPlaceholder("Select endpoints to import")
      .setMinValues(1)
      .setMaxValues(CORE_IMPORT_ENDPOINTS.length)
      .addOptions(
        ...CORE_IMPORT_ENDPOINTS.map((endpoint) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(endpoint.label)
            .setValue(endpoint.key)
        )
      )
  );
}

export function buildImportFlowNavigationRows() {
  return [buildNavigationRow({ includeAdminPanel: true })];
}
