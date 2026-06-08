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
  openEaLogin: "rec:imports:ea_open_login",
  eaConnectCodeModal: "rec:imports:ea_connect_code_modal",
  eaAuthCodeInput: "rec:imports:ea_auth_code",
  discoverFranchises: "rec:imports:discover_franchises",
  franchiseSelect: "rec:imports:franchise_select",
  history: "rec:imports:history",
  resumePending: "rec:imports:resume_pending",
  cancelPendingStartNew: "rec:imports:cancel_pending_start_new",
  weekScope: "rec:imports:week_scope",
  weekSelect: "rec:imports:week_select",
  endpoints: "rec:imports:endpoints",
  previewJob: "rec:imports:preview_job",
  executeJob: "rec:imports:execute_job",
  approveJob: "rec:imports:approve_job",
  cancelJob: "rec:imports:cancel_job",
  missingGameSelect: "rec:imports:missing_game_select",
  requestMissingReimport: "rec:imports:missing_reimport",
  manualMissingScore: "rec:imports:missing_manual_score",
  ignoreMissingResult: "rec:imports:missing_ignore",
  refreshMissingResults: "rec:imports:missing_refresh",
  manualMissingScoreModal: "rec:imports:missing_score_modal",
  homeScoreInput: "rec:imports:home_score",
  awayScoreInput: "rec:imports:away_score",
  missingScoreNotesInput: "rec:imports:missing_score_notes"
} as const;

export const ALL_ENDPOINTS_KEY = "__all_core_endpoints";

export const CORE_IMPORT_ENDPOINTS = [
  { key: "league_metadata", label: "League Metadata" },
  { key: "teams", label: "Teams" },
  { key: "standings", label: "Standings" },
  { key: "schedule", label: "Schedule" },
  { key: "rosters", label: "Rosters / Players" },
  { key: "player_stats", label: "Player Stats" },
  { key: "team_stats", label: "Team Stats" }
] as const;

export function buildImportPanelRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.eaImport).setLabel("Import Franchise").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.companionImport).setLabel("Companion App Export").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.manualImport).setLabel("Manual Entry").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.history).setLabel("Import History").setStyle(ButtonStyle.Secondary)
    ),
    buildNavigationRow({ includeAdminPanel: true })
  ];
}

export function buildPendingImportRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.resumePending).setLabel("Resume Previous Import").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.cancelPendingStartNew).setLabel("Cancel Previous Import and Start New").setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildEaConnectRows(loginUrl?: string | null) {
  const firstRow = new ActionRowBuilder<ButtonBuilder>();

  if (loginUrl) {
    firstRow.addComponents(
      new ButtonBuilder().setLabel("Open EA Login").setStyle(ButtonStyle.Link).setURL(loginUrl),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.connectEaAccount).setLabel("Enter EA Auth Code").setStyle(ButtonStyle.Primary)
    );
  } else {
    firstRow.addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.connectEaAccount).setLabel("Enter EA Auth Code").setStyle(ButtonStyle.Primary)
    );
  }

  return [firstRow, ...buildImportFlowNavigationRows()];
}

export function buildEaConnectCodeModal() {
  return new ModalBuilder()
    .setCustomId(IMPORT_CUSTOM_IDS.eaConnectCodeModal)
    .setTitle("Connect EA Account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(IMPORT_CUSTOM_IDS.eaAuthCodeInput)
          .setLabel("Paste the EA auth code or full redirect URL")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Paste the full http://127.0.0.1/success?code=... URL or just the code.")
      )
    );
}

export function buildManualMissingScoreModal() {
  return new ModalBuilder()
    .setCustomId(IMPORT_CUSTOM_IDS.manualMissingScoreModal)
    .setTitle("Manual Missing Game Score")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(IMPORT_CUSTOM_IDS.awayScoreInput).setLabel("Away Score").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(IMPORT_CUSTOM_IDS.homeScoreInput).setLabel("Home Score").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(IMPORT_CUSTOM_IDS.missingScoreNotesInput).setLabel("Notes").setStyle(TextInputStyle.Paragraph).setRequired(false)
      )
    );
}

export function buildDiscoverFranchisesRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.discoverFranchises).setLabel("Discover Franchises").setStyle(ButtonStyle.Primary)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildFranchiseSelectRow(franchises: any[]) {
  const options = franchises.slice(0, 25).map((franchise) => {
    const name = String(franchise.league_name ?? franchise.leagueName ?? "Unknown Franchise").slice(0, 100);
    const memberCount = typeof franchise.num_members === "number" ? `${franchise.num_members} members` : "Madden franchise";
    const teamName = franchise.user_team_name ? ` - ${franchise.user_team_name}` : "";
    return new StringSelectMenuOptionBuilder().setLabel(name).setValue(String(franchise.id)).setDescription(`${memberCount}${teamName}`.slice(0, 100));
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(IMPORT_CUSTOM_IDS.franchiseSelect).setPlaceholder("Select the franchise to import from").setMinValues(1).setMaxValues(1).addOptions(...options)
  );
}

export function buildMissingGameSelectRow(missingGames: any[]) {
  const options = missingGames.slice(0, 25).map((game) => {
    const matchup = `${game.away_team_name ?? "Away"} at ${game.home_team_name ?? "Home"}`.slice(0, 100);
    const week = game.week_number ? `Week ${game.week_number}` : "Missing result";
    return new StringSelectMenuOptionBuilder().setLabel(matchup).setValue(String(game.id)).setDescription(week.slice(0, 100));
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(IMPORT_CUSTOM_IDS.missingGameSelect).setPlaceholder("Select a missing-result game").setMinValues(1).setMaxValues(1).addOptions(...options)
  );
}

export function buildMissingResultActionRows(hasSelection = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.requestMissingReimport).setLabel("Request Reimport").setStyle(ButtonStyle.Primary).setDisabled(!hasSelection),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.manualMissingScore).setLabel("Manual Score").setStyle(ButtonStyle.Success).setDisabled(!hasSelection),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.ignoreMissingResult).setLabel("Ignore Missing").setStyle(ButtonStyle.Danger).setDisabled(!hasSelection)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.refreshMissingResults).setLabel("Refresh Missing Results").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.previewJob).setLabel("Regenerate Preview").setStyle(ButtonStyle.Secondary)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildWeekScopeRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.weekScope)
      .setPlaceholder("Select import scope")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Current Week").setValue("current_week").setDescription("Import the league's current Madden week."),
        new StringSelectMenuOptionBuilder().setLabel("Single Week").setValue("single_week").setDescription("Import one completed Madden week for catch-up/advance processing."),
        new StringSelectMenuOptionBuilder().setLabel("Full Regular Season Schedule").setValue("full_regular_season_schedule").setDescription("Schedule-only import for all regular season matchups. Expected NFL total: 272 games.")
      )
  );
}

export function buildWeekSelectRow() {
  const labels = [
    ...Array.from({ length: 18 }, (_, index) => ({ label: `Week ${index + 1}`, value: String(index + 1), description: `Import regular season Week ${index + 1}.` })),
    { label: "Wild Card", value: "19", description: "Import Wild Card playoff week." },
    { label: "Divisional", value: "20", description: "Import Divisional playoff week." },
    { label: "Conference Championship", value: "21", description: "Import Conference Championship week." },
    { label: "Super Bowl", value: "22", description: "Import Super Bowl week." }
  ];

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.weekSelect)
      .setPlaceholder("Select the exact Madden week to import")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(...labels.map((week) => new StringSelectMenuOptionBuilder().setLabel(week.label).setValue(week.value).setDescription(week.description)))
  );
}

export function buildEndpointSelectRow() {
  const allOption = new StringSelectMenuOptionBuilder()
    .setLabel("All Core Endpoints")
    .setValue(ALL_ENDPOINTS_KEY)
    .setDescription("Select every endpoint below.");

  const endpointOptions = CORE_IMPORT_ENDPOINTS.map((endpoint) => new StringSelectMenuOptionBuilder().setLabel(endpoint.label).setValue(endpoint.key));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(IMPORT_CUSTOM_IDS.endpoints)
      .setPlaceholder("Select endpoints to import")
      .setMinValues(1)
      .setMaxValues(CORE_IMPORT_ENDPOINTS.length + 1)
      .addOptions(allOption, ...endpointOptions)
  );
}

export function buildImportJobCreatedRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.previewJob).setLabel("Preview Import").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.cancelJob).setLabel("Cancel Import").setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportPreviewRows(hasMissingResults = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.executeJob).setLabel("Commit Import").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.refreshMissingResults).setLabel("Resolve Missing Results").setStyle(ButtonStyle.Primary).setDisabled(!hasMissingResults),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.cancelJob).setLabel("Cancel Import").setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportExecutedRows(hasMissingResults = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.approveJob).setLabel("Approve Import").setStyle(ButtonStyle.Success).setDisabled(hasMissingResults),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.refreshMissingResults).setLabel("Resolve Missing Results").setStyle(ButtonStyle.Primary).setDisabled(!hasMissingResults),
      new ButtonBuilder().setCustomId(IMPORT_CUSTOM_IDS.cancelJob).setLabel("Cancel Import").setStyle(ButtonStyle.Danger)
    ),
    ...buildImportFlowNavigationRows()
  ];
}

export function buildImportFlowNavigationRows() {
  return [buildNavigationRow({ includeAdminPanel: true })];
}
