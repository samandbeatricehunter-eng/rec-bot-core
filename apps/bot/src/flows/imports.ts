import { ButtonInteraction, EmbedBuilder, Interaction, StringSelectMenuInteraction } from "discord.js";
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
  buildPendingImportRows,
  buildImportPreviewRows,
  buildDiscoverFranchisesRows,
  buildWeekScopeRow,
  buildWeekSelectRow,
  IMPORT_CUSTOM_IDS,
  parseApproveImportCustomId
} from "../ui/imports.js";

export type ImportDraft = {
  importMode?: RecImportMode;
  importJobId?: string;
  weekScope?: "current_week" | "single_week" | "full_regular_season_schedule";
  weekFrom?: number;
  weekTo?: number;
  selectedWeeks?: number[];
  endpointKeys?: string[];
  eaFranchiseId?: string;
  eaExternalLeagueId?: string;
  eaExternalLeagueName?: string;
  franchises?: any[];
  eaLoginUrl?: string;
  eaConsole?: "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";
  pendingStartMode?: RecImportMode;
};

export const importSessions = new Map<string, ImportDraft>();

export function importWeekLabel(week: number) {
  if (week <= 18) return `Week ${week}`;
  return week === 19 ? "Wild Card" : week === 20 ? "Divisional" : week === 21 ? "Conference Championship" : "Super Bowl";
}

const IMPORT_PROGRESS_STEPS = [
  { key: "league_metadata", label: "Preparing import context" },
  { key: "teams", label: "Importing teams" },
  { key: "standings", label: "Importing standings" },
  { key: "schedule", label: "Importing schedule" },
  { key: "rosters", label: "Importing rosters and player attributes" },
  { key: "team_stats", label: "Importing team stats" },
  { key: "player_stats", label: "Importing player stats" }
] as const;

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

function parseApiErrorPayload(error: unknown): any | null {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    return JSON.parse(message.slice(jsonStart));
  } catch {
    return null;
  }
}

function extractApiErrorMessage(error: unknown) {
  const parsed = parseApiErrorPayload(error);
  if (typeof parsed?.error === "string") return parsed.error;

  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^REC API request failed:\s*/i, "");
}

function isEaReconnectRequired(error: unknown) {
  const message = extractApiErrorMessage(error).toLowerCase();
  const parsed = parseApiErrorPayload(error);
  const details = parsed?.details ?? {};

  return Boolean(
    details?.reconnectRequired ||
    message.includes("could not create ea blaze session") ||
    message.includes("ea reconnect required") ||
    message.includes("saved ea refresh token") ||
    details?.error?.errorname === "ERR_SYSTEM"
  );
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
  const endpointExecution = summary.endpointExecution ?? {};
  const endpointResults = endpointExecution.results ?? [];
  const latestEndpoint = summary.latestEndpoint;
  const matchupResults = summary.matchupResults ?? {};
  const missingGames = matchupResults.missingResultGames ?? [];
  const endpointMissingData = summary.endpointMissingData ?? [];
  const warnings = job.validation_warnings ?? job.validationWarnings ?? [];
  const errors = job.validation_errors ?? job.validationErrors ?? [];

  const failedEndpoints = endpointResults.filter((endpoint: any) => endpoint.status === "failed" || endpoint.status === "skipped");
  const commitWarnings: string[] = Array.isArray(summary.committedCounts?.warnings) ? summary.committedCounts.warnings : [];

  const endpointCountLines = endpointResults.length
    ? endpointResults.map((endpoint: any) => `${statusIcon(endpoint.status)} ${endpoint.endpointLabel ?? endpoint.endpointKey}: **${endpoint.recordsFound ?? 0}** staged`)
    : latestEndpoint
      ? [`${statusIcon(latestEndpoint.status)} ${latestEndpoint.endpointKey ?? "Latest Endpoint"}: **${latestEndpoint.recordsFound ?? 0}** staged`]
      : [`Staging Writes: **${summary.stagingWrites ?? 0}**`];

  const embeds = [
    new EmbedBuilder()
      .setTitle("Import Preview - Summary")
      .setDescription([
        `Job: **${job.id}**`,
        `Status: **${String(job.status).replaceAll("_", " ")}**`,
        `Confidence: **${summary.importConfidence ?? "Unknown"}%**`,
        "",
        "**Staged Endpoint Counts**",
        ...endpointCountLines,
        "",
        "**Preview Record Counts**",
        `Games: **${recordCounts.games ?? 0}**`,
        `Standings: **${recordCounts.standings ?? 0}**`,
        `Team Stats: **${recordCounts.teamStats ?? 0}**`,
        `Player Stats: **${recordCounts.playerStats ?? 0}**`,
        "",
        `Failed Endpoints: **${failedEndpoints.length}**`,
        `Missing Result Games: **${matchupResults.gamesMissingScores ?? missingGames.length ?? 0}**`,
        `Endpoint Missing Data Groups: **${endpointMissingData.length}**`,
        `Warnings: **${warnings.length + commitWarnings.length}**`,
        `Errors: **${errors.length}**`,
        "",
        summary.payouts ?? "Payouts deferred until league advance."
      ].join("\n"))
  ];

  // Surface endpoint failures and commit warnings prominently — these are the errors that
  // previously only appeared as a status icon with no message.
  if (failedEndpoints.length || commitWarnings.length) {
    embeds.push(
      new EmbedBuilder()
        .setTitle("Import Preview - Errors & Failures")
        .setDescription(truncateLines([
          ...failedEndpoints.map((endpoint: any) => [
            `**${endpoint.endpointLabel ?? endpoint.endpointKey}** ${endpoint.status === "skipped" ? "was skipped" : "FAILED"}`,
            `> ${endpoint.errorMessage ?? endpoint.responseSummary?.error ?? "No error message reported."}`
          ].join("\n")),
          ...commitWarnings.map((warning: string) => `**Commit warning:** ${warning}`)
        ]))
    );
  }

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
    ...warnings.map((warning: any, index: number) => `${index + 1}. WARN ${warning.message ?? warning.code ?? String(warning)}`),
    ...errors.map((error: any, index: number) => `${index + 1}. ERROR ${error.message ?? error.code ?? String(error)}`)
  ];
  embeds.push(
    new EmbedBuilder()
      .setTitle("Import Preview - Validation Notes")
      .setDescription(noteLines.length ? truncateLines(noteLines) : "No validation warnings or errors.")
  );

  return embeds;
}

function selectedEndpointKeys(draft: ImportDraft) {
  const keys = draft.endpointKeys?.length ? draft.endpointKeys : CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key);
  if (keys.includes(ALL_ENDPOINTS_KEY)) return CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key);
  return keys;
}

function selectedWeekSummary(draft: ImportDraft) {
  if (draft.weekScope === "full_regular_season_schedule") return "Full regular season schedule (Weeks 1-18)";
  const weeks = draft.selectedWeeks?.length ? draft.selectedWeeks : [draft.weekFrom ?? 1];
  return weeks.map(importWeekLabel).join(", ");
}

function normalizeSelectedWeeks(draft: ImportDraft) {
  if (draft.weekScope === "full_regular_season_schedule") return Array.from({ length: 18 }, (_, index) => index + 1);
  const weeks = draft.selectedWeeks?.length ? draft.selectedWeeks : [draft.weekFrom ?? 1];
  return [...new Set(weeks.map((week) => Number(week)).filter((week) => Number.isFinite(week) && week >= 1))].sort((a, b) => a - b);
}

function buildImportDraftSummary(draft: ImportDraft) {
  return [
    `Mode: **${String(draft.importMode ?? "").replaceAll("_", " ")}**`,
    draft.eaExternalLeagueName ? `EA League: **${draft.eaExternalLeagueName}**` : undefined,
    `Weeks: **${selectedWeekSummary(draft)}**`,
    `Endpoints: **${selectedEndpointKeys(draft).join(", ")}**`,
    "",
    "When you continue, REC will create the import job and stage selected endpoints."
  ].filter(Boolean).join("\n");
}

async function renderImportHome(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const active = await recApi.getActiveImport(interaction.guildId!);
  const history = await recApi.getImportHistory(interaction.guildId!);
  const activeJob = active?.job;
  const recent = history?.jobs ?? [];

  const lines = [
    activeJob ? "**Active Import**" : "**No Active Import**",
    activeJob ? formatImportJob(activeJob) : "Start a new import or review recent history.",
    "",
    "**Recent Imports**",
    recent.length
      ? recent.slice(0, 5).map((job: any, index: number) => `${index + 1}. ${String(job.status).replaceAll("_", " ")} - ${job.created_at ? new Date(job.created_at).toLocaleString() : "Unknown"}`).join("\n")
      : "No recent imports found."
  ];

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Import Data").setDescription(lines.join("\n"))],
    components: activeJob ? buildPendingImportRows() : buildImportPanelRows()
  });
}

async function discoverAndRenderFranchises(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const draft = importSessions.get(interaction.user.id) ?? {};
  const result = await recApi.discoverEaFranchises({ discordId: interaction.user.id, console: draft.eaConsole ?? "pc" });
  const franchises = result.franchises ?? [];

  importSessions.set(interaction.user.id, {
    ...draft,
    franchises,
    eaLoginUrl: result.loginUrl ?? draft.eaLoginUrl
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Select EA Franchise").setDescription(buildFranchiseDiscoveryDescription(result))],
    components: franchises.length ? [buildFranchiseSelectRow(franchises), ...buildImportFlowNavigationRows()] : buildEaConnectRows(result.loginUrl)
  });
}

async function requireCurrentImportJob(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const session = importSessions.get(interaction.user.id);
  const importJobId = session?.importJobId;
  if (importJobId) return importJobId;

  const active = await recApi.getActiveImport(interaction.guildId!);
  if (active?.job?.id) {
    importSessions.set(interaction.user.id, { ...(session ?? {}), importJobId: active.job.id });
    return active.job.id as string;
  }

  await interaction.reply({ content: "No active import job found. Start a new import first.", ephemeral: true });
  return null;
}

async function startImportMode(interaction: ButtonInteraction, importMode: RecImportMode) {
  await interaction.deferUpdate();
  importSessions.set(interaction.user.id, {
    ...(importSessions.get(interaction.user.id) ?? {}),
    importMode,
    pendingStartMode: importMode,
    weekScope: "single_week",
    weekFrom: 1,
    weekTo: 1,
    selectedWeeks: [1],
    endpointKeys: CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key),
    eaConsole: "pc"
  });

  const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id, console: "pc" });

  if (status.connected) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Choose EA Franchise")
          .setDescription("Your EA account is connected. Click Discover Franchises to load available Madden franchises.")
      ],
      components: buildDiscoverFranchisesRows()
    });
    return;
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Connect EA Account").setDescription(buildEaConnectDescription(status))],
    components: buildEaConnectRows(status.loginUrl)
  });
}

function isImportControl(interaction: Interaction) {
  return interaction.isButton() && Object.values(IMPORT_CUSTOM_IDS).some((id) => interaction.customId === id || interaction.customId.startsWith(id));
}

export async function handleImportButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This import command can only be used inside a Discord server.", ephemeral: true });
    return;
  }

  if (!isImportControl(interaction)) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only server admins can use import controls.", ephemeral: true });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.openPanel) {
    await interaction.deferReply({ ephemeral: true });
    const active = await recApi.getActiveImport(interaction.guildId);
    const history = await recApi.getImportHistory(interaction.guildId);
    const activeJob = active?.job;
    const recent = history?.jobs ?? [];

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Data")
          .setDescription([
            activeJob ? "**Active Import**" : "**No Active Import**",
            activeJob ? formatImportJob(activeJob) : "Start a new import or review recent history.",
            "",
            "**Recent Imports**",
            recent.length
              ? recent.slice(0, 5).map((job: any, index: number) => `${index + 1}. ${String(job.status).replaceAll("_", " ")} - ${job.created_at ? new Date(job.created_at).toLocaleString() : "Unknown"}`).join("\n")
              : "No recent imports found."
          ].join("\n"))
      ],
      components: activeJob ? buildPendingImportRows() : buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.cancelActive) {
    await interaction.deferReply({ ephemeral: true });
    const result = await recApi.cancelActiveImport({ guildId: interaction.guildId, reason: "Cancelled from Discord import panel." });
    importSessions.delete(interaction.user.id);
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Active Import Cancelled").setDescription(formatImportJob(result.job))], components: buildImportPanelRows() });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.reviewStatus) {
    await interaction.deferUpdate();
    const active = await recApi.getActiveImport(interaction.guildId);
    const job = active?.job;
    const attempts = active?.endpointAttempts ?? [];
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Status")
          .setDescription([
            formatImportJob(job),
            "",
            "**Endpoint Attempts**",
            formatEndpointAttempts(attempts)
          ].join("\n"))
      ],
      components: buildPendingImportRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.viewMissingResults) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();

    const result = await recApi.getImportMissingResults(importJobId);
    const games = result.games ?? [];
    const lines = games.length
      ? games.map((game: any, index: number) => [
          `${index + 1}. **${game.matchup ?? "Unknown Matchup"}**${game.week ? ` - Week ${game.week}` : ""}`,
          `Missing: ${(game.missingFields ?? ["score/result"]).join(", ")}`,
          game.externalGameId ? `External Game ID: ${game.externalGameId}` : undefined,
          `Game ID: ${game.id}`
        ].filter(Boolean).join("\n"))
      : ["No missing game result scores are currently detected."];

    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Missing Imported Game Results").setDescription(truncateLines(lines))],
      components: buildPendingImportRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.refreshHistory) {
    await interaction.deferUpdate();
    await renderImportHome(interaction);
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.startWeekImport) {
    await startImportMode(interaction, "week");
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.startSeasonImport) {
    await startImportMode(interaction, "season");
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.startFullSync) {
    await startImportMode(interaction, "full_sync");
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.backToImportHome) {
    await interaction.deferUpdate();
    await renderImportHome(interaction);
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.configureWeeks) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Choose Import Weeks")
          .setDescription([
            "Select an import week scope.",
            "",
            `Current selection: **${selectedWeekSummary(draft)}**`
          ].join("\n"))
      ],
      components: [buildWeekScopeRow(), buildWeekSelectRow(draft.selectedWeeks ?? [draft.weekFrom ?? 1]), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.configureEndpoints) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Choose Import Endpoints")
          .setDescription([
            "Select which EA endpoints to stage for this import.",
            "",
            `Current endpoints: **${selectedEndpointKeys(draft).join(", ")}**`
          ].join("\n"))
      ],
      components: [buildEndpointSelectRow(draft.endpointKeys), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.confirmImportSetup) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    if (!draft.importMode) {
      await interaction.reply({ content: "Import mode missing. Start again from the import panel.", ephemeral: true });
      return;
    }
    if (!draft.eaExternalLeagueId) {
      await interaction.reply({ content: "Select an EA franchise before creating the import job.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    const selectedWeeks = normalizeSelectedWeeks(draft);
    const job = await recApi.createImportJob({
      guildId: interaction.guildId,
      importMode: draft.importMode,
      importLabel: `${draft.importMode} import - ${selectedWeekSummary(draft)}`,
      requestedByDiscordId: interaction.user.id,
      eaExternalLeagueId: draft.eaExternalLeagueId,
      eaExternalLeagueName: draft.eaExternalLeagueName,
      importScope: draft.weekScope,
      weekFrom: selectedWeeks[0],
      weekTo: selectedWeeks[selectedWeeks.length - 1],
      selectedWeeks,
      selectedEndpointKeys: selectedEndpointKeys(draft)
    });

    importSessions.set(interaction.user.id, { ...draft, importJobId: job.job.id });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Job Created")
          .setDescription([
            formatImportJob(job.job),
            "",
            "Click Stage Selected Endpoints to pull EA data into staging."
          ].join("\n"))
      ],
      components: buildImportJobCreatedRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.stageSelectedEndpoints) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;
    await interaction.deferUpdate();

    const draft = importSessions.get(interaction.user.id) ?? {};
    const endpointKeys = selectedEndpointKeys(draft);
    const progressLines: string[] = [];

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Staging Selected Endpoints")
          .setDescription("Starting endpoint staging. This may take a few minutes.")
      ],
      components: []
    });

    for (const endpointKey of endpointKeys) {
      const step = IMPORT_PROGRESS_STEPS.find((item) => item.key === endpointKey);
      const label = step?.label ?? endpointKey;
      progressLines.push(`RUNNING ${label}`);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Staging Selected Endpoints")
            .setDescription(progressLines.join("\n"))
        ],
        components: []
      });

      try {
        const result = await recApi.stageImportEndpoint({ importJobId, endpointKey });
        const summary = previewSummary(result.job);
        const latest = summary.latestEndpoint ?? {};
        progressLines[progressLines.length - 1] = `${statusIcon(latest.status ?? "success")} ${label} - ${latest.recordsFound ?? "?"} records`;
      } catch (error) {
        const message = extractApiErrorMessage(error);
        progressLines[progressLines.length - 1] = `FAILED ${label} - ${message}`;
        if (isEaReconnectRequired(error)) {
          const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id, console: draft.eaConsole ?? "pc" }).catch(() => null);
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("EA Login Refresh Required")
                .setDescription([
                  ...progressLines,
                  "",
                  "The import stopped before preview because EA could not create or keep a valid Blaze session.",
                  "Successful endpoints remain staged and Resume Import will skip them.",
                  "No data was committed.",
                  "",
                  `Error: ${message}`,
                  "",
                  "Click **Open EA Login**, complete EA sign-in, then click **Enter EA Auth Code** and paste the fresh redirect URL/code before trying again."
                ].join("\n"))
            ],
            components: status?.loginUrl ? buildEaConnectRows(status.loginUrl) : buildDiscoverFranchisesRows()
          });
          return;
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Import Staging Failed")
              .setDescription([
                ...progressLines,
                "",
                "The import stopped before preview because one EA endpoint failed.",
                "Successful endpoints remain staged and Resume Import will skip them.",
                "No data was committed.",
                "",
                `Error: ${message}`
              ].join("\n"))
          ],
          components: buildImportJobCreatedRows()
        });
        return;
      }
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Generating Import Preview")
          .setDescription([
            "Selected EA endpoint staging steps completed.",
            "",
            ...progressLines,
            "",
            "Generating preview now..."
          ].join("\n"))
      ],
      components: []
    });

    const preview = await recApi.previewImportJob(importJobId);

    await interaction.editReply({
      embeds: buildPreviewEmbeds(preview),
      components: buildImportPreviewRows(preview)
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.executeJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;

    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Executing Import Job...").setDescription("Running the import job. This may take a moment.")], components: [] });
    const executed = await recApi.executeImportJob(importJobId);
    const refreshed = await recApi.getImportJob(importJobId).catch(() => executed);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Committed")
          .setDescription([
            "The staged import commit request completed.",
            "",
            formatImportJob(refreshed.job ?? executed.job),
            "",
            "Review Import Status before final approval."
          ].join("\n"))
      ],
      components: buildImportExecutedRows({ importJobId })
    });
    return;
  }

  if (interaction.customId.startsWith(IMPORT_CUSTOM_IDS.approveJob)) {
    const embeddedJobId = parseApproveImportCustomId(interaction.customId);
    const importJobId = embeddedJobId ?? await requireCurrentImportJob(interaction);
    if (!importJobId) {
      await interaction.reply({ content: "Import job session expired and this button does not include an import id. Regenerate the import screen, then approve again.", ephemeral: true });
      return;
    }

    // Use update() (not deferUpdate) so the source message immediately shows a processing state
    // and the buttons disappear — deferUpdate acknowledges silently with no visual feedback, so
    // users assumed it stalled and clicked Approve repeatedly during the commit.
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Committing Import…")
          .setDescription("Approving and committing this import into REC Core. Large rosters can take a moment — please wait, do not click again.")
      ],
      components: []
    });
    try {
      const approved = await recApi.approveImportJob(importJobId);
      importSessions.delete(interaction.user.id);

      const summary = previewSummary(approved.job);
      const counts = summary.committedCounts ?? {};
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Import Approved")
            .setDescription([
              "Import preview approved and committed into REC Core.",
              "",
              formatImportJob(approved.job),
              "",
              "**Committed Counts**",
              `Teams: **${counts.teams ?? 0}**`,
              `Games: **${counts.games ?? summary.gamesAdded ?? 0}**`,
              `League Games Stored: **${counts.leagueGamesStored ?? counts.committedLeagueGames ?? 0}**`,
              `Game Results: **${counts.gameResults ?? 0}**`,
              `Players: **${counts.players ?? 0}**`,
              `Roster Snapshots: **${counts.rosterSnapshots ?? 0}**`,
              `Player Weekly Stats: **${counts.playerWeeklyStats ?? 0}**`,
              `Team Weekly Stats: **${counts.teamWeeklyStats ?? 0}**`
            ].join("\n"))
        ],
        components: buildImportPanelRows()
      });
    } catch (error) {
      console.error("Import approval failed", error);
      const message = extractApiErrorMessage(error);
      const detail = parseApiErrorPayload(error);
      const detailText = detail ? typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1500) : null;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Import Approval Failed")
            .setDescription([
              message,
              detailText ? "" : undefined,
              detailText ? `Details: ${detailText}` : undefined,
              "",
              `Job: **${importJobId}**`
            ].filter(Boolean).join("\n"))
        ],
        components: buildImportExecutedRows({ importJobId })
      });
    }
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.cancelJob) {
    const importJobId = await requireCurrentImportJob(interaction);
    if (!importJobId) return;

    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Cancelling Import...").setDescription("Cancelling the active import job.")], components: [] });
    const cancelled = await recApi.cancelImportJob({ importJobId, reason: "Cancelled from Discord import workflow." });
    importSessions.delete(interaction.user.id);

    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Cancelled").setDescription(formatImportJob(cancelled.job))],
      components: buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.connectEaAccount) {
    await interaction.showModal(buildEaConnectCodeModal());
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.discoverFranchises) {
    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Discovering Franchises...").setDescription("Connecting to EA and looking up your Madden franchises. This may take a moment.")], components: [] });

    try {
      await discoverAndRenderFranchises(interaction);
    } catch (error) {
      const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id }).catch(() => null);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Connect EA Account")
            .setDescription(status?.loginUrl ? buildEaConnectDescription(status) : extractApiErrorMessage(error))
        ],
        components: buildEaConnectRows(status?.loginUrl)
      });
    }
    return;
  }
}

export async function handleImportSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This import command can only be used inside a Discord server.", ephemeral: true });
    return;
  }

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only server admins can use import controls.", ephemeral: true });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.selectConsole) {
    const consoleValue = interaction.values[0] as ImportDraft["eaConsole"];
    const draft = importSessions.get(interaction.user.id) ?? {};
    importSessions.set(interaction.user.id, { ...draft, eaConsole: consoleValue });
    await interaction.deferUpdate();
    const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id, console: consoleValue });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Connect EA Account").setDescription(status.connected ? "EA account connected. Discover franchises to continue." : buildEaConnectDescription(status))],
      components: status.connected ? buildDiscoverFranchisesRows() : buildEaConnectRows(status.loginUrl)
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.selectFranchise) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    const selected = draft.franchises?.find((franchise: any) => String(franchise.external_league_id ?? franchise.id) === interaction.values[0]);
    if (!selected) {
      await interaction.reply({ content: "Selected franchise was not found. Discover franchises again.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    const selectResult = await recApi.selectEaFranchise({
      guildId: interaction.guildId,
      eaFranchiseId: selected.id,
      selectedByDiscordId: interaction.user.id
    });

    importSessions.set(interaction.user.id, {
      ...draft,
      eaFranchiseId: selected.id,
      eaExternalLeagueId: String(selected.external_league_id),
      eaExternalLeagueName: selected.league_name ?? selected.leagueName ?? "Madden Franchise"
    });

    const franchise = selectResult.franchise ?? selected;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Configure Import")
          .setDescription([
            `Selected EA Franchise: **${franchise.league_name ?? selected.league_name ?? "Madden Franchise"}**`,
            "",
            "Recent import history:",
            formatRecentImports(franchise),
            "",
            buildImportDraftSummary(importSessions.get(interaction.user.id) ?? {})
          ].join("\n"))
      ],
      components: [
        buildWeekScopeRow(),
        buildWeekSelectRow(importSessions.get(interaction.user.id)?.selectedWeeks ?? [1]),
        buildEndpointSelectRow(importSessions.get(interaction.user.id)?.endpointKeys),
        ...buildImportFlowNavigationRows()
      ]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.selectWeekScope) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    const scope = interaction.values[0] as ImportDraft["weekScope"];
    const selectedWeeks = scope === "full_regular_season_schedule" ? Array.from({ length: 18 }, (_, index) => index + 1) : draft.selectedWeeks?.length ? draft.selectedWeeks : [draft.weekFrom ?? 1];
    importSessions.set(interaction.user.id, {
      ...draft,
      weekScope: scope,
      selectedWeeks,
      weekFrom: selectedWeeks[0],
      weekTo: selectedWeeks[selectedWeeks.length - 1]
    });
    await interaction.deferUpdate();
    const updated = importSessions.get(interaction.user.id) ?? {};
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Configure Import").setDescription(buildImportDraftSummary(updated))],
      components: [buildWeekScopeRow(), buildWeekSelectRow(updated.selectedWeeks ?? [updated.weekFrom ?? 1]), buildEndpointSelectRow(updated.endpointKeys), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.selectWeeks) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    const weeks = interaction.values.map((value) => Number(value)).filter((week) => Number.isFinite(week)).sort((a, b) => a - b);
    importSessions.set(interaction.user.id, {
      ...draft,
      weekScope: draft.weekScope === "full_regular_season_schedule" ? "single_week" : draft.weekScope ?? "single_week",
      selectedWeeks: weeks,
      weekFrom: weeks[0],
      weekTo: weeks[weeks.length - 1]
    });
    await interaction.deferUpdate();
    const updated = importSessions.get(interaction.user.id) ?? {};
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Configure Import").setDescription(buildImportDraftSummary(updated))],
      components: [buildWeekScopeRow(), buildWeekSelectRow(updated.selectedWeeks ?? [updated.weekFrom ?? 1]), buildEndpointSelectRow(updated.endpointKeys), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.selectEndpoints) {
    const draft = importSessions.get(interaction.user.id) ?? {};
    let endpoints = interaction.values;
    if (endpoints.includes(ALL_ENDPOINTS_KEY)) endpoints = CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key);
    importSessions.set(interaction.user.id, { ...draft, endpointKeys: endpoints });
    await interaction.deferUpdate();
    const updated = importSessions.get(interaction.user.id) ?? {};
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Configure Import").setDescription(buildImportDraftSummary(updated))],
      components: [buildWeekScopeRow(), buildWeekSelectRow(updated.selectedWeeks ?? [updated.weekFrom ?? 1]), buildEndpointSelectRow(updated.endpointKeys), ...buildImportFlowNavigationRows()]
    });
    return;
  }
}

export async function handleEaConnectCodeSubmit(interaction: any) {
  const raw = interaction.fields.getTextInputValue("ea_auth_code");
  const code = normalizeEaAuthCode(raw);
  const draft = importSessions.get(interaction.user.id) ?? {};

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await recApi.connectEaAccount({ discordId: interaction.user.id, code, console: draft.eaConsole ?? "pc" });
    importSessions.set(interaction.user.id, { ...draft, eaLoginUrl: result.loginUrl });

    const message = [
      "EA account connected successfully.",
      "",
      "Return to the import panel and discover franchises."
    ].join("\n");

    await interaction.editReply({ content: message });
  } catch (error) {
    const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id, console: draft.eaConsole ?? "pc" }).catch(() => null);
    await interaction.editReply({
      content: [
        "EA connection failed.",
        "",
        extractApiErrorMessage(error),
        "",
        status?.loginUrl ? `Open a fresh login URL and try again: ${status.loginUrl}` : "Open a fresh login URL from the import panel and try again."
      ].join("\n")
    });
  }
}
