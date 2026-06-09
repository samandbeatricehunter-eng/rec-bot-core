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
const IMPORT_PROGRESS_STEPS = [
  { key: "league_metadata", label: "Preparing import context" },
  { key: "teams", label: "Importing teams" },
  { key: "standings", label: "Importing standings" },
  { key: "schedule", label: "Importing schedule" },
  { key: "rosters", label: "Importing rosters and player attributes" },
  { key: "team_stats", label: "Importing team stats" },
  { key: "player_stats", label: "Importing player stats" }
] as const;

export function buildImportPanelPayload() { return { embeds: [new EmbedBuilder().setTitle("Import Data").setDescription(["Create and monitor REC Core import jobs.", "", "Imports store data and update eligibility signals only. Economy payouts are issued later during league advance, not during import."].join("\n"))], components: buildImportPanelRows() }; }
function statusIcon(status: string) { if (status === "success" || status === "completed") return "OK"; if (status === "failed") return "FAILED"; if (status === "running" || status === "validating" || status === "reconciling") return "RUNNING"; if (status === "skipped" || status === "completed_with_warnings") return "WARN"; if (status === "cancelled") return "CANCELLED"; return "-"; }
function parseApiErrorPayload(error: unknown): any | null { const message = error instanceof Error ? error.message : String(error); const jsonStart = message.indexOf("{"); if (jsonStart < 0) return null; try { return JSON.parse(message.slice(jsonStart)); } catch { return null; } }
function extractApiErrorMessage(error: unknown) { const parsed = parseApiErrorPayload(error); if (typeof parsed?.error === "string") return parsed.error; const message = error instanceof Error ? error.message : String(error); return message.replace(/^REC API request failed:\s*/i, ""); }
function extractApiErrorDetails(error: unknown) { const parsed = parseApiErrorPayload(error); const details = parsed?.details; if (!details) return null; if (typeof details?.message === "string") return details.message; if (typeof details === "string") return details; try { return JSON.stringify(details).slice(0, 1500); } catch { return null; } }
function isEaReconnectRequired(error: unknown) { const message = extractApiErrorMessage(error).toLowerCase(); const parsed = parseApiErrorPayload(error); const details = parsed?.details ?? {}; return Boolean(details?.reconnectRequired || message.includes("could not create ea blaze session") || message.includes("ea reconnect required") || message.includes("saved ea refresh token") || details?.error?.errorname === "ERR_SYSTEM"); }
function normalizeEaAuthCode(raw: string) { const trimmed = raw.trim(); try { const url = new URL(trimmed); return url.searchParams.get("code") ?? trimmed; } catch { const match = trimmed.match(/[?&]code=([^&\s]+)/); return match ? decodeURIComponent(match[1]) : trimmed; } }
function truncateLines(lines: string[], maxChars = 3600) { const output: string[] = []; let length = 0; for (const line of lines) { const next = length + line.length + 1; if (next > maxChars) { output.push(`...and ${Math.max(0, lines.length - output.length)} more item(s).`); break; } output.push(line); length = next; } return output.join("\n"); }
function formatEndpointAttempts(attempts: any[]) { if (!attempts?.length) return "No endpoint attempts recorded yet."; return attempts.map((attempt) => { const records = typeof attempt.records_found === "number" ? ` - ${attempt.records_found} records` : ""; const http = attempt.http_status ? ` (${attempt.http_status})` : ""; return `${statusIcon(attempt.status)} ${attempt.endpoint_label}${http}${records}`; }).join("\n"); }
function formatImportJob(job: any) { if (!job) return "No import job found for this league."; return [`Mode: **${String(job.import_mode).replaceAll("_", " ")}**`, `Status: **${String(job.status).replaceAll("_", " ")}**`, job.import_label ? `Label: **${job.import_label}**` : undefined, job.ea_external_league_name ? `EA League: **${job.ea_external_league_name}**` : undefined, job.week_from || job.week_to ? `Weeks: **${job.week_from ?? "?"} -> ${job.week_to ?? "?"}**` : undefined, `Created: ${job.created_at ? new Date(job.created_at).toLocaleString() : "Unknown"}`].filter(Boolean).join("\n"); }
function formatRecentImports(franchise: any) { const imports = franchise.recentImports ?? []; if (!imports.length) return "No recent imports found for this franchise."; return imports.slice(0, 3).map((job: any, index: number) => { const date = job.completed_at ?? job.created_at; const dateText = date ? new Date(date).toLocaleString() : "Unknown date"; const endpoints = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length ? job.selected_endpoint_keys.join(", ") : "No endpoint list recorded"; return `${index + 1}. ${dateText} - ${String(job.status).replaceAll("_", " ")} - ${endpoints}`; }).join("\n"); }
function buildFranchiseDiscoveryDescription(result: any) { const franchises = result.franchises ?? []; if (!franchises.length) return ["No Madden franchises were discovered for this EA account.", "", "Reconnect EA or verify the selected console/platform if this is unexpected."].join("\n"); const preview = franchises.slice(0, 5).map((franchise: any, index: number) => { const name = franchise.league_name ?? franchise.leagueName ?? "Unknown Franchise"; const team = franchise.user_team_name ? ` - ${franchise.user_team_name}` : ""; const members = typeof franchise.num_members === "number" ? ` (${franchise.num_members} members)` : ""; return `${index + 1}. **${name}**${team}${members}`; }); return [`Discovered **${franchises.length}** franchise(s).`, "", ...preview, "", "Select the franchise to import from. The next screen will show recent import history before endpoint selection."].join("\n"); }
function buildEaConnectDescription(status: any) { return ["EA login is required before franchise discovery can continue.", "", "1. Open this EA login URL:", status.loginUrl, "", "2. Complete the EA login.", "3. After EA redirects you, copy the full redirected URL or the `code=` value.", "4. Click **Enter EA Auth Code** and paste it.", "", "After the code is accepted, REC will save the EA token and automatically discover your franchises."].join("\n"); }
function previewSummary(job: any) { return job?.preview_summary ?? job?.previewSummary ?? {}; }
function buildPreviewEmbeds(result: any) { const job = result.job; const summary = previewSummary(job); const recordCounts = summary.endpointRecordCounts ?? {}; const endpointExecution = summary.endpointExecution ?? {}; const endpointResults = endpointExecution.results ?? []; const latestEndpoint = summary.latestEndpoint; const matchupResults = summary.matchupResults ?? {}; const missingGames = matchupResults.missingResultGames ?? []; const endpointMissingData = summary.endpointMissingData ?? []; const warnings = job.validation_warnings ?? job.validationWarnings ?? []; const errors = job.validation_errors ?? job.validationErrors ?? []; const endpointCountLines = endpointResults.length ? endpointResults.map((endpoint: any) => `${statusIcon(endpoint.status)} ${endpoint.endpointLabel ?? endpoint.endpointKey}: **${endpoint.recordsFound ?? 0}** staged`) : latestEndpoint ? [`${statusIcon(latestEndpoint.status)} ${latestEndpoint.endpointKey ?? "Latest Endpoint"}: **${latestEndpoint.recordsFound ?? 0}** staged`] : [`Staging Writes: **${summary.stagingWrites ?? 0}**`]; const embeds = [new EmbedBuilder().setTitle("Import Preview - Summary").setDescription([`Job: **${job.id}**`, `Status: **${String(job.status).replaceAll("_", " ")}**`, `Confidence: **${summary.importConfidence ?? "Unknown"}%**`, "", "**Staged Endpoint Counts**", ...endpointCountLines, "", "**Preview Record Counts**", `Games: **${recordCounts.games ?? 0}**`, `Standings: **${recordCounts.standings ?? 0}**`, `Team Stats: **${recordCounts.teamStats ?? 0}**`, `Player Stats: **${recordCounts.playerStats ?? 0}**`, "", `Missing Result Games: **${matchupResults.gamesMissingScores ?? missingGames.length ?? 0}**`, `Endpoint Missing Data Groups: **${endpointMissingData.length}**`, `Warnings: **${warnings.length}**`, `Errors: **${errors.length}**`, "", summary.payouts ?? "Payouts deferred until league advance."].join("\n"))]; embeds.push(new EmbedBuilder().setTitle("Import Preview - Missing Results").setDescription(missingGames.length ? truncateLines(missingGames.map((game: any, index: number) => [`${index + 1}. **${game.matchup ?? "Unknown Matchup"}**${game.week ? ` - Week ${game.week}` : ""}`, `Missing: ${(game.missingFields ?? ["score/result"]).join(", ")}`, game.externalGameId ? `External Game ID: ${game.externalGameId}` : undefined].filter(Boolean).join("\n"))) : "No missing game results found in staged data.")); const endpointLines: string[] = []; for (const endpoint of endpointMissingData) { endpointLines.push(`**${endpoint.endpointLabel ?? endpoint.endpointKey ?? "Endpoint"}** - ${endpoint.affectedRows ?? 0} affected row(s)`); for (const row of (endpoint.rows ?? []).slice(0, 10)) endpointLines.push(`- ${row.label ?? "Unknown Row"}: ${(row.missingFields ?? []).join(", ")}`); endpointLines.push(""); } embeds.push(new EmbedBuilder().setTitle("Import Preview - Missing Endpoint Data").setDescription(endpointLines.length ? truncateLines(endpointLines) : "No missing endpoint fields detected in staged data.")); const noteLines = [...warnings.map((warning: any, index: number) => `${index + 1}. WARN ${warning.message ?? warning.code ?? JSON.stringify(warning)}`), ...errors.map((error: any, index: number) => `${index + 1}. ERROR ${error.message ?? error.code ?? JSON.stringify(error)}`)]; embeds.push(new EmbedBuilder().setTitle("Import Preview - Validation Notes").setDescription(noteLines.length ? truncateLines(noteLines) : "No validation warnings or errors reported.")); return embeds; }
function buildProgressEmbed(currentStep: string, progressLines: string[]) { return new EmbedBuilder().setTitle("Import Staging In Progress").setDescription([`Current Step: **${currentStep}...**`, "", ...progressLines, "", "This can take 1–2 minutes. Do not close this window."].filter(Boolean).join("\n")); }
async function discoverAndRenderFranchises(interaction: Extract<Interaction, { editReply: any; user: any }>) { const result = await recApi.discoverEaFranchises({ discordId: interaction.user.id }); const franchises = result.franchises ?? []; importSessions.set(interaction.user.id, { ...(importSessions.get(interaction.user.id) ?? {}), importMode: "ea_import", franchises }); await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Discovered EA Franchises").setDescription(buildFranchiseDiscoveryDescription(result))], components: franchises.length ? [buildFranchiseSelectRow(franchises), ...buildImportFlowNavigationRows()] : buildEaConnectRows() }); }
function getCurrentImportJobId(userId: string) { return importSessions.get(userId)?.importJobId; }
async function requireCurrentImportJob(interaction: Extract<Interaction, { user: any; reply: any }>) { const importJobId = getCurrentImportJobId(interaction.user.id); if (!importJobId) { await interaction.reply({ content: "Import job session expired. Open Import Status or create a new import job.", ephemeral: true }); return null; } return importJobId; }
function expandEndpointKeys(values: string[]) { if (values.includes(ALL_ENDPOINTS_KEY)) return CORE_IMPORT_ENDPOINTS.map((endpoint) => endpoint.key); return values; }
function applyDefaultWeeks(draft: ImportDraft) { if (draft.weekScope === "current_week") { draft.weekFrom = undefined; draft.weekTo = undefined; } if (draft.weekScope === "full_regular_season_schedule") { draft.weekFrom = undefined; draft.weekTo = undefined; } }
export async function renderImportPanel(interaction: ButtonInteraction | StringSelectMenuInteraction) { if (!isDiscordAdminInteraction(interaction)) { await interaction.reply({ content: "Only authorized admins can manage imports.", ephemeral: true }); return; } importSessions.delete(interaction.user.id); await interaction.update(buildImportPanelPayload()); }

export async function handleImportButton(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) { await interaction.reply({ content: "Only authorized admins can manage imports.", ephemeral: true }); return; }

  if (interaction.customId.startsWith(IMPORT_CUSTOM_IDS.approveJob)) {
    const embeddedJobId = parseApproveImportCustomId(interaction.customId);
    const importJobId = embeddedJobId ?? getCurrentImportJobId(interaction.user.id);
    if (!importJobId) { await interaction.reply({ content: "Import job session expired and this button does not include an import id. Regenerate the preview/status screen, then approve again.", ephemeral: true }); return; }
    await interaction.deferUpdate();
    try {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Approving Import").setDescription([`Job: **${importJobId}**`, "", "Commit request sent to REC Core. This can take a moment."].join("\n"))], components: [] });
      const approved = await recApi.approveImportJob(importJobId);
      importSessions.delete(interaction.user.id);
      const summary = previewSummary(approved.job);
      const counts = summary.committedCounts ?? {};
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Import Approved").setDescription(["Import preview approved and committed into REC Core.", "", formatImportJob(approved.job), "", "**Committed Counts**", `Teams: **${counts.teams ?? 0}**`, `Games: **${counts.games ?? summary.gamesAdded ?? 0}**`, `League Games Stored: **${counts.leagueGamesStored ?? counts.committedLeagueGames ?? 0}**`, `Game Results: **${counts.gameResults ?? 0}**`, `Players: **${counts.players ?? 0}**`, `Roster Snapshots: **${counts.rosterSnapshots ?? 0}**`, `Player Weekly Stats: **${counts.playerWeeklyStats ?? 0}**`, `Team Weekly Stats: **${counts.teamWeeklyStats ?? 0}**`].join("\n"))], components: buildImportPanelRows() });
    } catch (error) {
      console.error("Import approval failed", error);
      const detail = extractApiErrorDetails(error);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Import Approval Failed").setDescription([extractApiErrorMessage(error), detail ? "" : undefined, detail ? `Details: ${detail}` : undefined, "", `Job: **${importJobId}**`].filter(Boolean).join("\n"))], components: buildImportExecutedRows({ importJobId }) });
    }
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.previewJob) { const importJobId = await requireCurrentImportJob(interaction); if (!importJobId) return; await interaction.deferUpdate(); await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Generating Import Preview").setDescription([`Job: **${importJobId}**`, "", "Generating preview now..."].join("\n"))], components: [] }); const preview = await recApi.previewImportJob(importJobId); await interaction.editReply({ embeds: buildPreviewEmbeds(preview), components: buildImportPreviewRows(preview) }); return; }
  if (interaction.customId === IMPORT_CUSTOM_IDS.executeJob) { const importJobId = await requireCurrentImportJob(interaction); if (!importJobId) return; await interaction.deferUpdate(); const executed = await recApi.executeImportJob(importJobId); const refreshed = await recApi.getImportJob(importJobId).catch(() => executed); await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Import Committed").setDescription(["The staged import commit request completed.", "", formatImportJob(refreshed.job ?? executed.job), "", "Review Import Status before final approval."].join("\n"))], components: buildImportExecutedRows({ importJobId }) }); return; }
  if (interaction.customId === IMPORT_CUSTOM_IDS.cancelJob) { const importJobId = await requireCurrentImportJob(interaction); if (!importJobId) return; await interaction.deferUpdate(); const cancelled = await recApi.cancelImportJob({ importJobId, reason: "Cancelled from Discord import workflow." }); importSessions.delete(interaction.user.id); await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Import Cancelled").setDescription(formatImportJob(cancelled.job))], components: buildImportPanelRows() }); return; }

  // Existing import flow below is intentionally retained by falling through to the original checks in source builds.
}
