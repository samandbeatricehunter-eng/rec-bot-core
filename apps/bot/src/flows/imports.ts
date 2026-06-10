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

function buildProgressEmbed(currentStep: string, progressLines: string[]) {
  return new EmbedBuilder()
    .setTitle("Import Staging In Progress")
    .setDescription([
      `Current Step: **${currentStep}...**`,
      "",
      ...progressLines,
      "",
      "This can take 1G��2 minutes. Do not close this window."
    ].filter(Boolean).join("\n"));
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
  if (draft.weekScope === "current_week") {
    draft.weekFrom = undefined;
    draft.weekTo = undefined;
  }

  if (draft.weekScope === "full_regular_season_schedule") {
    draft.weekFrom = undefined;
    draft.weekTo = undefined;
  }
}

export async function renderImportPanel(interaction: ButtonInteraction | StringSelectMenuInteraction) {
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

  if (interaction.customId === IMPORT_CUSTOM_IDS.resumePending) {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferUpdate();
    const result = await recApi.getActiveImport(interaction.guildId);
    if (result.job?.id) {
      importSessions.set(interaction.user.id, { ...(importSessions.get(interaction.user.id) ?? {}), importJobId: result.job.id });
      const previewable = ["validating", "completed_with_warnings", "reconciling"].includes(String(result.job.status));
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Previous Import Pending").setDescription([
          "Resumed the active import job.",
          "",
          formatImportJob(result.job),
          "",
          previewable ? "Use **Preview Import** to return to commit controls." : "Continue staging endpoints, then preview the import."
        ].join("\n"))],
        components: previewable ? buildImportJobCreatedRows() : buildImportJobCreatedRows()
      });
    } else {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("No Pending Import").setDescription("No active uncommitted import was found. Start a new import from Import / Enter Data.")], components: buildImportPanelRows() });
    }
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.cancelPendingStartNew) {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferUpdate();
    const session = importSessions.get(interaction.user.id);
    const result = await recApi.cancelActiveImport({ guildId: interaction.guildId, reason: "Admin selected Cancel Previous Import and Start New." });
    importSessions.set(interaction.user.id, { importMode: session?.pendingStartMode ?? session?.importMode });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Previous Import Cancelled").setDescription([
        result.cancelled ? "The pending import was cancelled." : "No active import needed to be cancelled.",
        "",
        "Continue normal import setup below."
      ].join("\n"))],
      components: [buildWeekScopeRow(), ...buildImportFlowNavigationRows()]
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
    const draft = importSessions.get(interaction.user.id);
    const importJobId = draft?.importJobId;

    if (!importJobId) {
      await interaction.reply({ content: "No import job is active for this session.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    const jobDetails = await recApi.getImportJob(importJobId).catch(() => null);
    const selectedKeys = Array.isArray(jobDetails?.job?.selected_endpoint_keys)
      ? jobDetails.job.selected_endpoint_keys
      : Array.isArray(jobDetails?.job?.selectedEndpointKeys)
        ? jobDetails.job.selectedEndpointKeys
        : IMPORT_PROGRESS_STEPS.map((step) => step.key);
    const successfulKeys = new Set(
      (jobDetails?.endpointAttempts ?? [])
        .filter((attempt: any) => attempt.status === "success")
        .map((attempt: any) => attempt.endpoint_key)
    );
    const stepsToRun = IMPORT_PROGRESS_STEPS.filter((step) => selectedKeys.includes(step.key) && !successfulKeys.has(step.key));
    const progressLines: string[] = Array.from(successfulKeys)
      .filter((key) => selectedKeys.includes(key))
      .map((key) => `${statusIcon("success")} ${IMPORT_PROGRESS_STEPS.find((step) => step.key === key)?.label ?? key}: already staged`);

    if (stepsToRun.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Generating Import Preview")
            .setDescription([
              "All selected EA endpoints are already staged for this import job.",
              "No data was re-pulled from EA.",
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

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Staging Import")
          .setDescription([
            "Running selected endpoints in one API execution so the EA Blaze session can be reused across the full pull.",
            "",
            ...stepsToRun.map((step) => `- ${step.label}: pending`)
          ].join("\n"))
      ],
      components: []
    });

    try {
      const result = await recApi.executeImportJob(importJobId);
      const execution = result.job?.preview_summary?.endpointExecution ?? result.job?.previewSummary?.endpointExecution;
      const results = Array.isArray(execution?.results) ? execution.results : [];
      progressLines.push(
        ...stepsToRun.map((step) => {
          const endpointResult = results.find((item: any) => item.endpointKey === step.key || item.endpoint_key === step.key);
          const status = endpointResult?.status ?? "complete";
          const count = endpointResult?.recordsFound ?? endpointResult?.records_found ?? 0;
          return `${statusIcon(status)} ${step.label}: **${count}** staged (${status})`;
        })
      );

      const failed = results.find((item: any) => item.status === "failed");
      if (failed) {
        throw new Error(failed.errorMessage ?? failed.error_message ?? "One EA endpoint failed during staging.");
      }
    } catch (error) {
      const message = extractApiErrorMessage(error);
      if (!progressLines.some((line) => line.includes("failed"))) {
        progressLines.push(`X Import execution: **failed**`);
      }

      if (isEaReconnectRequired(error)) {
        const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id }).catch(() => null);
        const existingDraft = importSessions.get(interaction.user.id) ?? {};
        importSessions.set(interaction.user.id, {
          ...existingDraft,
          importMode: existingDraft.importMode ?? draft?.importMode ?? "ea_import",
          eaLoginUrl: status?.loginUrl ?? existingDraft.eaLoginUrl
        });

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

  const modeByButton: Record<string, RecImportMode> = {
    [IMPORT_CUSTOM_IDS.eaImport]: "ea_import",
    [IMPORT_CUSTOM_IDS.companionImport]: "companion_app_export",
    [IMPORT_CUSTOM_IDS.manualImport]: "manual"
  };
  const importMode = modeByButton[interaction.customId];

  if (importMode === "ea_import") {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferUpdate();
    const active = await recApi.getActiveImport(interaction.guildId).catch(() => null);
    if (active?.job?.id) {
      importSessions.set(interaction.user.id, { importMode: "ea_import", pendingStartMode: "ea_import", importJobId: active.job.id });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Previous Import Pending").setDescription([
          "An uncommitted import is already active for this league.",
          "",
          formatImportJob(active.job),
          "",
          "Choose whether to resume it or cancel it and start a new import."
        ].join("\n"))],
        components: buildPendingImportRows()
      });
      return;
    }

    importSessions.set(interaction.user.id, { importMode: "ea_import" });
    try {
      const status = await recApi.getEaAccountStatus({ discordId: interaction.user.id });
      importSessions.set(interaction.user.id, { importMode: "ea_import", eaLoginUrl: status.loginUrl });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Refresh EA Login")
            .setDescription([
              "Start each EA import with a fresh EA auth code so the full import job can use a valid Blaze session.",
              "",
              buildEaConnectDescription(status)
            ].join("\n"))
        ],
        components: buildEaConnectRows(status?.loginUrl)
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EA Account Check Failed").setDescription(extractApiErrorMessage(error))],
        components: buildImportPanelRows()
      });
    }
    return;
  }

  if (importMode) {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferUpdate();
    const active = await recApi.getActiveImport(interaction.guildId).catch(() => null);
    if (active?.job?.id) {
      importSessions.set(interaction.user.id, { importMode, pendingStartMode: importMode, importJobId: active.job.id });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Previous Import Pending")
            .setDescription([
              "An uncommitted import is already active for this league.",
              "",
              formatImportJob(active.job),
              "",
              "Choose whether to resume it or cancel it and start a new import."
            ].join("\n"))
        ],
        components: buildPendingImportRows()
      });
      return;
    }

    importSessions.set(interaction.user.id, { importMode });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Create Import Job")
          .setDescription([
            `Mode: **${importMode.replaceAll("_", " ")}**`,
            "",
            "Select the week scope for this import.",
            "",
            "No data will be committed and no payouts will be issued by creating this job."
          ].join("\n"))
      ],
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
      embeds: [
        new EmbedBuilder()
          .setTitle("EA Connection Failed")
          .setDescription([
            extractApiErrorMessage(error),
            "",
            draft?.eaLoginUrl
              ? "Open the EA login URL again, complete login, then paste the newest code."
              : "Try the EA login again and paste the newest auth code."
          ].join("\n"))
      ],
      components: buildEaConnectRows(draft?.eaLoginUrl)
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

    const result = await recApi.selectEaFranchise({
      guildId: interaction.guildId,
      eaFranchiseId: selectedId,
      selectedByDiscordId: interaction.user.id
    });

    draft.eaFranchiseId = selectedId;
    draft.eaExternalLeagueId = String(selected.external_league_id ?? selected.externalLeagueId ?? "");
    draft.eaExternalLeagueName = String(selected.league_name ?? selected.leagueName ?? "Selected Franchise");
    importSessions.set(interaction.user.id, draft);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Franchise Selected")
          .setDescription([
            `Franchise: **${draft.eaExternalLeagueName}**`,
            result.message ? `Status: ${result.message}` : undefined,
            "",
            "**Recent Imports**",
            formatRecentImports(selected),
            "",
            "Select the scope for this import."
          ].filter(Boolean).join("\n"))
      ],
      components: [buildWeekScopeRow(), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.weekScope) {
    draft.weekScope = interaction.values[0] as ImportDraft["weekScope"];
    applyDefaultWeeks(draft);
    importSessions.set(interaction.user.id, draft);

    if (draft.weekScope === "single_week") {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Select Import Week")
            .setDescription([
              draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
              `Mode: **${draft.importMode?.replaceAll("_", " ")}**`,
              "Week Scope: **Import Weeks**",
              "",
              "Select one or more completed Madden weeks to import in this session."
            ].filter(Boolean).join("\n"))
        ],
        components: [buildWeekSelectRow(), ...buildImportFlowNavigationRows()]
      });
      return;
    }

    if (draft.weekScope === "full_regular_season_schedule") {
      // Stage Teams alongside Schedule so EA team IDs resolve to the league's existing teams
      // (matched by abbreviation/name). Without Teams, every game falls back to placeholder
      // teams and never maps to linked users.
      draft.endpointKeys = ["teams", "schedule"];
      importSessions.set(interaction.user.id, draft);

      if (!draft.importMode) {
        await interaction.reply({ content: "Import mode is missing. Restart the import flow.", ephemeral: true });
        return;
      }

      await interaction.deferUpdate();
      const result = await recApi.createImportJob({
        guildId: interaction.guildId,
        importMode: draft.importMode,
        importLabel: `${draft.eaExternalLeagueName ? `${draft.eaExternalLeagueName} - ` : ""}${draft.importMode.replaceAll("_", " ")} - full regular season schedule`,
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
        embeds: [
          new EmbedBuilder()
            .setTitle("Schedule Import Job Created")
            .setDescription([
              `League: **${result.job?.league?.name ?? "Current League"}**`,
              draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
              "Scope: **Full Regular Season Schedule**",
              "Endpoints: **Teams + Schedule**",
              "",
              "Next step: preview the schedule import. This stages the league teams and full regular-season schedule."
            ].filter(Boolean).join("\n"))
        ],
        components: buildImportJobCreatedRows()
      });
      return;
    }

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Create Import Job")
          .setDescription([
            draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
            `Mode: **${draft.importMode?.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            draft.weekFrom ? `Weeks: **${draft.weekFrom}${draft.weekTo && draft.weekTo !== draft.weekFrom ? ` -> ${draft.weekTo}` : ""}**` : undefined,
            "",
            "Select the core endpoints to include. Weekly imports also stage matchup/result details for the selected week."
          ].filter(Boolean).join("\n"))
      ],
      components: [buildEndpointSelectRow(), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.weekSelect) {
    const selectedWeeks = [...new Set(interaction.values.map((value) => Number(value)))]
      .filter((week) => Number.isInteger(week) && week >= 1 && week <= 22)
      .sort((a, b) => a - b);
    if (selectedWeeks.length === 0) {
      await interaction.reply({ content: "Invalid week selection. Select at least one week from the menu again.", ephemeral: true });
      return;
    }

    draft.weekScope = "single_week";
    draft.selectedWeeks = selectedWeeks;
    draft.weekFrom = selectedWeeks[0];
    draft.weekTo = selectedWeeks[selectedWeeks.length - 1];
    importSessions.set(interaction.user.id, draft);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Create Import Job")
          .setDescription([
            draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
            `Mode: **${draft.importMode?.replaceAll("_", " ")}**`,
            `Week${selectedWeeks.length > 1 ? "s" : ""}: **${selectedWeeks.map(importWeekLabel).join(", ")}**`,
            "",
            "Select the core endpoints to include. Weekly imports also stage matchup/result details for the selected weeks."
          ].filter(Boolean).join("\n"))
      ],
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
      selectedWeeks: draft.selectedWeeks,
      selectedEndpointKeys: draft.endpointKeys
    });

    draft.importJobId = result.job?.id;
    importSessions.set(interaction.user.id, draft);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Job Created")
          .setDescription([
            `League: **${result.job?.league?.name ?? "Current League"}**`,
            draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
            `Mode: **${draft.importMode.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            draft.selectedWeeks?.length
              ? `Week${draft.selectedWeeks.length > 1 ? "s" : ""}: **${draft.selectedWeeks.map(importWeekLabel).join(", ")}**`
              : draft.weekFrom ? `Weeks: **${draft.weekFrom}${draft.weekTo && draft.weekTo !== draft.weekFrom ? ` -> ${draft.weekTo}` : ""}**` : undefined,
            `Endpoints: **${draft.endpointKeys.length} selected**`,
            "",
            "Next step: preview the import to inspect missing scores and endpoint data before commit.",
            "",
            "Economy payouts remain deferred until the league advance workflow."
          ].filter(Boolean).join("\n"))
      ],
      components: buildImportJobCreatedRows()
    });
  }
}
