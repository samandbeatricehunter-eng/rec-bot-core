import { EmbedBuilder, Interaction } from "discord.js";
import type { RecImportMode } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  buildDiscoverFranchisesRows,
  buildEndpointSelectRow,
  buildFranchiseSelectRow,
  buildImportFlowNavigationRows,
  buildImportPanelRows,
  buildWeekScopeRow,
  IMPORT_CUSTOM_IDS
} from "../ui/imports.js";

export type ImportDraft = {
  importMode?: RecImportMode;
  weekScope?: "single_week" | "selected_weeks" | "full_available" | "full_regular_season_schedule";
  endpointKeys?: string[];
  eaFranchiseId?: string;
  eaExternalLeagueId?: string;
  eaExternalLeagueName?: string;
  franchises?: any[];
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
  if (status === "success" || status === "completed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running" || status === "validating" || status === "reconciling") return "⏳";
  if (status === "skipped" || status === "completed_with_warnings") return "⚠️";
  if (status === "cancelled") return "🚫";
  return "•";
}

function extractApiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");

  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      // Keep the raw message if the API response cannot be parsed.
    }
  }

  return message.replace(/^REC API request failed:\s*/i, "");
}

function formatEndpointAttempts(attempts: any[]) {
  if (!attempts?.length) return "No endpoint attempts recorded yet.";

  return attempts
    .map((attempt) => {
      const records = typeof attempt.records_found === "number" ? ` — ${attempt.records_found} records` : "";
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
    job.week_from || job.week_to ? `Weeks: **${job.week_from ?? "?"} → ${job.week_to ?? "?"}**` : undefined,
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
    return `${index + 1}. ${dateText} — ${String(job.status).replaceAll("_", " ")} — ${endpoints}`;
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
    const team = franchise.user_team_name ? ` — ${franchise.user_team_name}` : "";
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
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Status")
          .setDescription([
            `League: **${result.league?.name ?? "Unknown"}**`,
            "",
            formatImportJob(result.job),
            "",
            "**Endpoint Attempts**",
            formatEndpointAttempts(result.endpointAttempts ?? [])
          ].join("\n"))
      ],
      components: buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.history) {
    await interaction.deferUpdate();
    const result = await recApi.getImportHistory(interaction.guildId);
    const rows = (result.jobs ?? []).slice(0, 10).map((job: any, index: number) => {
      const label = job.import_label ? ` — ${job.import_label}` : "";
      return `${index + 1}. ${statusIcon(job.status)} **${String(job.import_mode).replaceAll("_", " ")}** — ${String(job.status).replaceAll("_", " ")}${label}`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import History")
          .setDescription([
            `League: **${result.league?.name ?? "Unknown"}**`,
            "",
            rows.length ? rows.join("\n") : "No current-season import jobs found."
          ].join("\n"))
      ],
      components: buildImportPanelRows()
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.discoverFranchises) {
    await interaction.deferUpdate();

    try {
      const result = await recApi.discoverEaFranchises({ discordId: interaction.user.id });
      const franchises = result.franchises ?? [];
      importSessions.set(interaction.user.id, {
        importMode: "ea_import",
        franchises
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Discovered EA Franchises")
            .setDescription(buildFranchiseDiscoveryDescription(result))
        ],
        components: franchises.length ? [buildFranchiseSelectRow(franchises), ...buildImportFlowNavigationRows()] : buildDiscoverFranchisesRows()
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("EA Franchise Discovery Needs Setup")
            .setDescription([
              extractApiErrorMessage(error),
              "",
              "This means the Discord import workflow is connected, but this REC user does not yet have a usable EA account/OAuth connection for franchise discovery.",
              "",
              "Next build target: EA account connection / OAuth setup."
            ].join("\n"))
        ],
        components: buildDiscoverFranchisesRows()
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
    importSessions.set(interaction.user.id, { importMode });
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Franchise")
          .setDescription([
            "Start by discovering the Madden franchises available from the connected EA account.",
            "",
            "After discovery, select the franchise to import from, review recent imports, choose scope/endpoints, then run the import."
          ].join("\n"))
      ],
      components: buildDiscoverFranchisesRows()
    });
    return;
  }

  if (importMode) {
    importSessions.set(interaction.user.id, { importMode });
    await interaction.update({
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

export async function handleImportSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;

  const draft = importSessions.get(interaction.user.id);

  if (!draft) {
    await interaction.reply({ content: "Import session expired. Open Admin Panel → Import Data again.", ephemeral: true });
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
    importSessions.set(interaction.user.id, draft);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Create Import Job")
          .setDescription([
            draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
            `Mode: **${draft.importMode?.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            "",
            "Select the core endpoints to include."
          ].filter(Boolean).join("\n"))
      ],
      components: [buildEndpointSelectRow(), ...buildImportFlowNavigationRows()]
    });
    return;
  }

  if (interaction.customId === IMPORT_CUSTOM_IDS.endpoints) {
    draft.endpointKeys = interaction.values;
    importSessions.set(interaction.user.id, draft);

    if (!draft.importMode) {
      await interaction.reply({ content: "Import mode is missing. Restart the import flow.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    const result = await recApi.createImportJob({
      guildId: interaction.guildId,
      importMode: draft.importMode,
      importLabel: `${draft.eaExternalLeagueName ? `${draft.eaExternalLeagueName} — ` : ""}${draft.importMode.replaceAll("_", " ")} — ${draft.weekScope?.replaceAll("_", " ") ?? "selected scope"}`,
      requestedByDiscordId: interaction.user.id,
      eaExternalLeagueId: draft.eaExternalLeagueId,
      eaExternalLeagueName: draft.eaExternalLeagueName,
      importScope: draft.weekScope,
      selectedEndpointKeys: draft.endpointKeys
    });

    importSessions.delete(interaction.user.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Job Created")
          .setDescription([
            `League: **${result.job?.league?.name ?? result.job?.league?.name ?? "Current League"}**`,
            draft.eaExternalLeagueName ? `Franchise: **${draft.eaExternalLeagueName}**` : undefined,
            `Mode: **${draft.importMode.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            `Endpoints: **${draft.endpointKeys.length} selected**`,
            "",
            "The job has been created. Use Import Status to monitor execution and preview approval.",
            "",
            "Economy payouts remain deferred until the league advance workflow."
          ].filter(Boolean).join("\n"))
      ],
      components: buildImportPanelRows()
    });
  }
}
