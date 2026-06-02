import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const IMPORT_CUSTOM_IDS = {
  panel: "rec:imports:panel",
  eaImport: "rec:imports:ea",
  companionImport: "rec:imports:companion",
  manualImport: "rec:imports:manual",
  connectEaAccount: "rec:imports:ea_connect",
  eaConnectCodeModal: "rec:imports:ea_connect_code_modal",
  eaAuthCodeInput: "rec:imports:ea_auth_code",
  discoverFranchises: "rec:imports:discover_franchises",
  franchiseSelect: "rec:imports:franchise_select",
  status: "rec:imports:status",
  history: "rec:imports:history",
  weekScope: "rec:imports:week_scope",
  endpoints: "rec:imports:endpoints",
  previewJob: "rec:imports:preview_job",
  executeJob: "rec:imports:execute_job",
  approveJob: "rec:imports:approve_job",
  cancelJob: "rec:imports:cancel_job"
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
        .setLabel("Import Franchise")
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

export function buildEaConnectRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.connectEaAccount)
        .setLabel("Enter EA Auth Code")
        .setStyle(ButtonStyle.Primary)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildEaConnectCodeModal() {
  return new ModalBuilder()
    .setCustomId(IMPORT_CUSTOM_IDS.eaConnectCodeModal)
    .setTitle("Connect EA Account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(IMPORT_CUSTOM_IDS.eaAuthCodeInput)
          .setLabel("Paste the EA auth code from the redirect URL")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Paste the code= value from the EA redirect URL.")
      )
    );
}

export function buildDiscoverFranchisesRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.discoverFranchises)
        .setLabel("Discover Franchises")
        .setStyle(ButtonStyle.Primary)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildFranchiseSelectRow(franchises: any[]) {
  const options = franchises.slice(0, 25).map((franchise) => {
    const name = String(franchise.league_name ?? franchise.leagueName ?? "Unknown Franchise").slice(0, 100);
    const memberCount = typeof franchise.num_members === "number" ? `${franchise.num_members} members` : "Madden franchise";
    const teamName = franchise.user_team_name ? ` — ${franchise.user_team_name}` : "";

    return new StringSelectMenuOptionBuilder()
      .setLabel(name)
      .setValue(String(franchise.id))
      .setDescription(`${memberCount}${teamName}`.slice(0, 100));
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.franchiseSelect)
      .setPlaceholder("Select the franchise to import from")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(...options)
  );
}

export function buildWeekScopeRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.weekScope)
      .setPlaceholder("Select import scope")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Single Week")
          .setValue("single_week")
          .setDescription("Import one completed Madden week."),
        new StringSelectMenuOptionBuilder()
          .setLabel("Week Range")
          .setValue("selected_weeks")
          .setDescription("Import a span of completed weeks."),
        new StringSelectMenuOptionBuilder()
          .setLabel("Full Available")
          .setValue("full_available")
          .setDescription("Import all available core data."),
        new StringSelectMenuOptionBuilder()
          .setLabel("Full Regular Season Schedule")
          .setValue("full_regular_season_schedule")
          .setDescription("Schedule-only import for all regular season matchups.")
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

export function buildImportJobCreatedRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.previewJob)
        .setLabel("Preview Import")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.cancelJob)
        .setLabel("Cancel Import")
        .setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportPreviewRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.executeJob)
        .setLabel("Execute Import")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.cancelJob)
        .setLabel("Cancel Import")
        .setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportExecutedRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.approveJob)
        .setLabel("Approve Import")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(IMPORT_CUSTOM_IDS.cancelJob)
        .setLabel("Cancel Import")
        .setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportFlowNavigationRows() {
  return [buildNavigationRow({ includeAdminPanel: true })];
}
