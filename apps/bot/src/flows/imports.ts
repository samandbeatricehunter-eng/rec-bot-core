import { EmbedBuilder, Interaction } from "discord.js";
import type { RecImportMode } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  ALL_ENDPOINTS_KEY,
  CORE_IMPORT_ENDPOINTS,
  buildEaConnectCodeModal,
  buildEaConnectRows,
  buildEndpointSelectRow,
  buildFranchiseSelectRow,
  buildImportExecutedRows,
  buildImportFlowNavigationRows,
  buildImportJobCreatedRows,
  buildImportPanelRows,
  buildImportPreviewRows,
  buildWeekScopeRow,
  IMPORT_CUSTOM_IDS
} from "../ui/imports.js";

export type ImportDraft = {
  importMode?: RecImportMode;
  importJobId?: string;
  weekScope?: "current_week" | "single_week" | "selected_weeks" | "full_available" | "full_regular_season_schedule";
  weekFrom?: number;
  weekTo?: number;
  endpointKeys?: string[];
  eaFranchiseId?: string;
  eaExternalLeagueId?: string;
  eaExternalLeagueName?: string;
  franchises?: any[];
  eaLoginUrl?: string;
  eaConsole?: "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";
};

export const importSessions = new Map<string, ImportDraft>();

export function buildImportPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Import Data")
        .setDescription([
          "Create and monitor REC Core import jobs.",
          "",
          "Imports store data and update eligibility signals only. Economy payouts are issued later during league advance, not during import."
        ].join("\n"))
    ],
    components: buildImportPanelRows()
  };
}

function statusIcon(status: string) {
  if (status === "success" || status === "completed") return "OK";
  if (status === "failed") return "FAILED";
  if (status === "running" || status === "validating" || status === "reconciling") return "RUNNING";
  if (status === "skipped" || status === "completed_with_warnings") return "WARN";
  if (status === "cancelled") return "CANCELLED";
  return "-";
}

function extractApiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      if (typeof parsed.error === "string") return parsed.error;
    } catch {}
  }
  return message.replace(/^REC API request failed:\s*/i, "");
}

function normalizeEaAuthCode(raw: string) {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("code") ?? trimmed;
  } catch {
    const match = trimmed.match(/[?&]code=([^&\s]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  }
}

function truncateLines(lines: string[], maxChars = 3600) {
  const output: string[] = [];
  let length = 0;
  for (const line of lines) {
    const next = length + line.length + 1;
    if (next > maxChars) {
      output.push(`...and ${Math.max(0, lines.length - output.length)} more item(s).`);
      break;
    }
    output.push(line);
    length = next;
  }
  return output.join("\n");
}

function formatEndpointAttempts(attempts: any[]) {
  if (!attempts?.length) return "No endpoint attempts recorded yet.";
  return attempts
    .map((attempt) => {
      const records = typeof attempt.records_found === "number" ? ` - ${attempt.records_found} records` : "";
      const http = attempt.http_status ? ` (${attempt.http_status})` : "";
      return `${statusIcon(attempt.status)} ${attempt.endpoint_label}${http}${records}`;
    })
    .join("\n");
}

function formatImportJob(job: any) {
  if (!job) return "No import job found for this league.";
  return [
    `Mode: **${String(job.import_mode).replaceAll("_", " ")}**`,
    `Status: **${String(job.status).replaceAll("_", " ")}**`,
    job.import_label ? `Label: **${job.import_label}**` : undefined,
    job.ea_external_league_name ? `EA League: **${job.ea_external_league_name}**` : undefined,
    job.week_from || job.week_to ? `Weeks: **${job.week_from ?? "?"} -> ${job.week_to ?? "?"}**` : undefined,
    `Created: ${job.created_at ? new Date(job.created_at).toLocaleString() : "Unknown"}`
  ].filter(Boolean).join("\n");
}

function formatRecentImports(franchise: any) {
  const imports = franchise.recentImports ?? [];
  if (!imports.length) return "No recent imports found for this franchise.";
  return imports.slice(0, 3).map((job: any, index: number) => {
    const date = job.completed_at ?? job.created_at;
    const dateText = date ? new Date(date).toLocaleString() : "Unknown date";
    const endpoints = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length
      ? job.selected_endpoint_keys.join(", ")
      : "No endpoint list recorded";
    return `${index + 1}. ${dateText} - ${String(job.status).replaceAll("_", " ")} - ${endpoints}`;
  }).join("\n");
}

function buildFranchiseDiscoveryDescription(result: any) {
  const franchises = result.franchises ?? [];
  if (!franchises.length) {
    return [
      "No Madden franchises were discovered for this EA account.",
      "",
      "Reconnect EA or verify the selected console/platform if this is unexpected."
    ].join("\n");
  }
  const preview = franchises.slice(0, 5).map((franchise: any, index: number) => {
    const name = franchise.league_name ?? franchise.leagueName ?? "Unknown Franchise";
    const team = franchise.user_team_name ? ` - ${franchise.user_team_name}` : "";
    const members = typeof franchise.num_members === "number" ? ` (${franchise.num_members} members)` : "";
    return `${index + 1}. **${name}**${team}${members}`;
  });
  return [
    `Discovered **${franchises.length}** franchise(s).`,
    "",
    ...preview,
    "",
    "Select the franchise to import from. The next screen will show recent import history before endpoint selection."
  ].join("\n");
}

function buildEaConnectDescription(status: any) {
  return [
    "EA login is required before franchise discovery can continue.",
    "",
    "1. Open this EA login URL:",
    status.loginUrl,
    "",
    "2. Complete the EA login.",
    "3. After EA redirects you, copy the full redirected URL or the `code=` value.",
    "4. Click **Enter EA Auth Code** and paste it.",
    "",
    "After the code is accepted, REC will save the EA token and automatically discover your franchises."
  ].join("\n");
}

function previewSummary(job: any) {
  return job?.preview_summary ?? job?.previewSummary ?? {};
}

function buildPreviewEmbeds(result: any) {
  const job = result.job;
  const summary = previewSummary(job);
  const recordCounts = summary.endpointRecordCounts ?? {};
  const matchupResults = summary.matchupResults ?? {};
  const missingGames = matchupResults.missingResultGames ?? [];
  const endpointMissingData = summary.endpointMissingData ?? [];
  const warnings = job.validation_warnings ?? job.validationWarnings ?? [];
  const errors = job.validation_errors ?? job.validationErrors ?? [];

  const embeds = [
    new EmbedBuilder()
      .setTitle("Import Preview - Summary")
      .setDescription([
        `Job: **${job.id}**`,
        `Status: **${String(job.status).replaceAll("_", " ")}**`,
        `Confidence: **${summary.importConfidence ?? "Unknown"}%**`,
        "",
        "**Record Counts**",
        `Games: **${recordCounts.games ?? 0}**`,
        `Standings: **${recordCounts.standings ?? 0}**`,
        `Team Stats: **${recordCounts.teamStats ?? 0}**`,
        `Player Stats: **${recordCounts.playerStats ?? 0}**`,
        "",
        `Missing Result Games: **${matchupResults.gamesMissingScores ?? missingGames.length ?? 0}**`,
        `Endpoint Missing Data Groups: **${endpointMissingData.length}**`,
        `Warnings: **${warnings.length}**`,
        `Errors: **${errors.length}**`,
        "",
        summary.payouts ?? "Payouts deferred until league advance."
      ].join("\n"))
  ];

  embeds.push(
    new EmbedBuilder()
      .setTitle("Import Preview - Missing Results")
      .setDescription(missingGames.length
        ? truncateLines(missingGames.map((game: any, index: number) => [
            `${index + 1}. **${game.matchup ?? "Unknown Matchup"}**${game.week ? ` - Week ${game.week}` : ""}`,
            `Missing: ${(game.missingFields ?? ["score/result"]).join(", ")}`,
            game.externalGameId ? `External Game ID: ${game.externalGameId}` : undefined
          ].filter(Boolean).join("\n")))
        : "No missing game results found in staged data.")
  );

  const endpointLines: string[] = [];
  for (const endpoint of endpointMissingData) {
    endpointLines.push(`**${endpoint.endpointLabel ?? endpoint.endpointKey ?? "Endpoint"}** - ${endpoint.affectedRows ?? 0} affected row(s)`);
    for (const row of (endpoint.rows ?? []).slice(0, 10)) {
      endpointLines.push(`- ${row.label ?? "Unknown Row"}: ${(row.missingFields ?? []).join(", ")}`);
    }
    endpointLines.push("");
  }

  embeds.push(
    new EmbedBuilder()
      .setTitle("Import Preview - Missing Endpoint Data")
      .setDescription(endpointLines.length ? truncateLines(endpointLines) : "No missing endpoint fields detected in staged data.")
  );

  const noteLines = [
    ...warnings.map((warning: any, index: number) => `${index + 1}. WARN ${warning.message ?? warning.code ?? JSON.stringify(warning)}`),
    ...errors.map((error: any, index: number) => `${index + 1}. ERROR ${error.message ?? error.code ?? JSON.stringify(error)}`)
  ];

  embeds.push(
    new EmbedBuilder()
      .setTitle("Import Preview - Validation Notes")
      .setDescription(noteLines.length ? truncateLines(noteLines) : "No validation warnings or errors reported.")
  );

  return embeds;
}

async function discoverAndRenderFranchises(interaction: Extract<Interaction, { editReply: any; user: any }>) {
  const result = await recApi.discoverEaFranchises({ discordId: interaction.user.id });
  const franchises = result.franchises ?? [];
  importSessions.set(interaction.user.id, {
    ...(importSessions.get(interaction.user.id) ?? {}),
    importMode: "ea_import",
    franchises
  });
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Discovered EA Franchises").setDescription(buildFranchiseDiscoveryDescription(result))],
    components: franchises.length ? [buildFranchiseSelectRow(franchises), ...buildImportFlowNavigationRows()] : buildEaConnectRows()
  });
}

function getCurrentImportJobId(userId: string) {
  return importSessions.get(userId)?.importJobId;
}

async function requireCurrentImportJob(interaction: Extract<Interaction, { user: any; reply: any }>) {
  const importJobId = getCurrentImportJobId(interaction.user.id);
  if (!importJobId) {
    await interaction.reply({ content: "Import job session expired. Open Import Status or create a new import job.", ephemeral: true });
    return null;
  }
  return importJobId;
}

function expandEndpointKeys(values: string[]) {
  if (values.includes(ALL_ENDPOINTS_KEY)) return CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key);
  return values;
}

function applyDefaultWeeks(draft: ImportDraft) {
  if (draft.weekScope === "single_week") {
    draft.weekFrom = draft.weekFrom ?? 1;
    draft.weekTo = draft.weekTo ?? draft.weekFrom;
  }
  if (draft.weekScope === "selected_weeks") {
    draft.weekFrom = draft.weekFrom ?? 1;
    draft.weekTo = draft.weekTo ?? 23;
  }
}

export async function renderImportPanel(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can manage imports.", ephemeral: true });
    return;
  }
  importSessions.delete(interaction.user.id);
  await interaction.update(buildImportPanelPayload());
}

export async function handleImportButton(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can manage imports.", ephemeral: true });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.status) {
    await interaction.deferUpdate();
    const result = await recApi.getImportStatus(interaction.guildId);
    if (result.job?.id) importSessions.set(interaction.user.id, { ...(importSessions.get(interaction.user.id) ?? {}), importJobId: result.job.id });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Status").setDescription([`League: **${result.league?.name ?? "Unknown"}**`, "", formatImportJob(result.job), "", "**Endpoint Attempts**", formatEndpointAttempts(result.endpointAttempts ?? [])].join("\n"))],
      components: result.job?.id ? buildImportJobCreatedRows() : buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.history) {
    await interaction.deferUpdate();
    const result = await recApi.getImportHistory(interaction.guildId);
    const rows = (result.jobs ?? []).slice(0, 10).map((job: any, index: number) => {
      const label = job.import_label ? ` - ${job.import_label}` : "";
      return `${index + 1}. ${statusIcon(job.status)} **${String(job.import_mode).replaceAll("_", " ")}** - ${String(job.status).replaceAll("_", " ")}${label}`;
    });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import History").setDescription(rows.length ? rows.join("\n") : "No recent import jobs found.")],
      components: buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.previewJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();
    const preview = await recApi.previewImportJob(importJobId);
    await interaction.editReply({ embeds: buildPreviewEmbeds(preview), components: buildImportPreviewRows() });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.executeJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();
    const executed = await recApi.executeImportJob(importJobId);
    const refreshed = await recApi.getImportJob(importJobId).catch(() => executed);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Committed").setDescription(["The staged import commit request completed.", "", formatImportJob(refreshed.job ?? executed.job), "", "Review Import Status before final approval."].join("\n"))],
      components: buildImportExecutedRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.approveJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();
    const approved = await recApi.approveImportJob(importJobId);
    importSessions.delete(interaction.user.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Approved").setDescription(["Import preview approved and moved into reconciliation.", "", formatImportJob(approved.job)].join("\n"))],
      components: buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.cancelJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();
    const cancelled = await recApi.cancelImportJob({ importJobId, reason: "Cancelled from Discord import workflow." });
    importSessions.delete(interaction.user.id);
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Import Cancelled").setDescription(formatImportJob(cancelled.job))], components: buildImportPanelRows() });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.connectEaAccount) {
    await interaction.showModal(buildEaConnectCodeModal());
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.discoverFranchises) {
    await interaction.deferUpdate();
    try {
      await discoverAndRenderFranchises(interaction);
    } catch (error) {
      const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id }).catch(() => null);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Connect EA Account").setDescription(status?.loginUrl ? buildEaConnectDescription(status) : extractApiErrorMessage(error))], components: buildEaConnectRows() });
    }
    return;
  }

  const modeByButton: Record<string, RecImportMode> = {
    [IMPORT_CUSTOM_IDS.eaImport]: "ea_import",
    [IMPORT_CUSTOM_IDS.companionImport]: "companion_app_export",
    [IMPORT_CUSTOM_IDS.manualImport]: "manual"
  };
  const importMode = modeByButton[interaction.customId];

  if (importMode === "ea_import") {
    importSessions.set(interaction.user.id, { importMode: "ea_import" });
    await interaction.deferUpdate();
    try {
      const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id });
      if (status.connected) {
        await discoverAndRenderFranchises(interaction);
        return;
      }
      importSessions.set(interaction.user.id, { importMode: "ea_import", eaLoginUrl: status.loginUrl });
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Connect EA Account").setDescription(buildEaConnectDescription(status))], components: buildEaConnectRows() });
    } catch (error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EA Account Check Failed").setDescription(extractApiErrorMessage(error))], components: buildImportPanelRows() });
    }
    return;
  }

  if (importMode) {
    importSessions.set(interaction.user.id, { importMode });
    await interaction.update({
      embeds: [new EmbedBuilder().setTitle("Create Import Job").setDescription([`Mode: **${importMode.replaceAll("_", " ")}**`, "", "Select the week scope for this import.", "", "No data will be committed and no payouts will be issued by creating this job."].join("\n"))],
      components: [buildWeekScopeRow(), ...buildImportFlowNavigationRows()]
    });
  }
}

export async function handleImportModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit() || interaction.customId !== IMPORT_CUSTOM_IDS.eaConnectCodeModal) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can connect EA accounts for imports.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  try {
    const rawCode = interaction.fields.getTextInputValue(IMPORT_CUSTOM_IDS.eaAuthCodeInput);
    const code = normalizeEaAuthCode(rawCode);
    await recApi.connectEaAccount({ discordId: interaction.user.id, code });
    await discoverAndRenderFranchises(interaction);
  } catch (error) {
    const draft = importSessions.get(interaction.user.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("EA Connection Failed").setDescription([extractApiErrorMessage(error), "", draft?.eaLoginUrl ? "Open the EA login URL again, complete login, then paste the newest code." : "Try the EA login again and paste the newest auth code."].join("\n"))],
      components: buildEaConnectRows()
    });
  }
}

export async function handleImportSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
  const draft = importSessions.get(interaction.user.id);
  if (!draft) {
    await interaction.reply({ content: "Import session expired. Open Admin Panel -> Import Data again.", ephemeral: true });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.franchiseSelect) {
    const selectedId = interaction.values[0];
    const selected = (draft.franchises ?? []).find((franchise) => String(franchise.id) === selectedId);
    if (!selected) {
      await interaction.reply({ content: "Selected franchise was not found. Run discovery again.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const result = await recApi.selectEaFranchise({ guildId: interaction.guildId, eaFranchiseId: selectedId, selectedByDiscordId: interaction.user.id });
    draft.eaFranchiseId = selectedId;
    draft.eaExternalLeagueId = String(selected.external_league_id ?? selected.externalLeagueId ?? "");
    draft.eaExternalLeagueName = String(selected.league_name ?? selected.leagueName ?? "Selected Franchise");
    importSessions.set(interaction.user.id, draft);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Franchise Selected").setDescription([`Franchise: **${draft.eaExternalLeagueName}**`, result.message ? `Status: ${result.message}` : undefined, "", "**Recent Imports**", formatRecentImports(selected), "", "Select the scope for this import."].filter(Boolean).join("\n"))],
      components: [buildWeekScopeRow(), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.weekScope) {
    draft.weekScope = interaction.values[0] as ImportDraft["weekScope"];
    applyDefaultWeeks(draft);
    importSessions.set(interaction.user.id, draft);
    await interaction.update({
      embeds: [new EmbedBuilder().setTitle("Create Import Job").setDescription([draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined, `Mode: **${draft.importMode?.replaceAll("_", " ")}**`, `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`, draft.weekFrom ? `Weeks: **${draft.weekFrom}${draft.weekTo && draft.weekTo !== draft.weekFrom ? ` -> ${draft.weekTo}` : ""}**` : undefined, "", "Select the core endpoints to include."].filter(Boolean).join("\n"))],
      components: [buildEndpointSelectRow(), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.endpoints) {
    draft.endpointKeys = expandEndpointKeys(interaction.values);
    importSessions.set(interaction.user.id, draft);
    if (!draft.importMode) {
      await interaction.reply({ content: "Import mode is missing. Restart the import flow.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const result = await recApi.createImportJob({
      guildId: interaction.guildId,
      importMode: draft.importMode,
      importLabel: `${draft.eaExternalLeagueName ? `${draft.eaExternalLeagueName} - ` : ""}${draft.importMode.replaceAll("_", " ")} - ${draft.weekScope?.replaceAll("_", " ") ?? "selected scope"}`,
      requestedByDiscordId: interaction.user.id,
      eaExternalLeagueId: draft.eaExternalLeagueId,
      eaExternalLeagueName: draft.eaExternalLeagueName,
      importScope: draft.weekScope,
      weekFrom: draft.weekFrom,
      weekTo: draft.weekTo,
      selectedEndpointKeys: draft.endpointKeys
    });
    draft.importJobId = result.job?.id;
    importSessions.set(interaction.user.id, draft);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Job Created").setDescription([`League: **${result.job?.league?.name ?? "Current League"}**`, draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined, `Mode: **${draft.importMode.replaceAll("_", " ")}**`, `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`, draft.weekFrom ? `Weeks: **${draft.weekFrom}${draft.weekTo && draft.weekTo !== draft.weekFrom ? ` -> ${draft.weekTo}` : ""}**` : undefined, `Endpoints: **${draft.endpointKeys.length} selected**`, "", "Next step: preview the import to inspect missing scores and endpoint data before execution.", "", "Economy payouts remain deferred until the league advance workflow."].filter(Boolean).join("\n"))],
      components: buildImportJobCreatedRows()
    });
  }
}
