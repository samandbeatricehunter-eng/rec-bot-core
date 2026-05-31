import { EmbedBuilder, Interaction } from "discord.js";
import type { RecImportMode } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  buildImportPanelRows,
  buildWeekScopeRow,
  buildEndpointSelectRow,
  buildImportFlowNavigationRows,
  IMPORT_CUSTOM_IDS
} from "../ui/imports.js";

export type ImportDraft = {
  importMode?: RecImportMode;
  weekScope?: "single_week" | "selected_weeks" | "full_available";
  endpointKeys?: string[];
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

  const modeByButton: Record<string, RecImportMode> = {
    [IMPORT_CUSTOM_IDS.eaImport]: "ea_import",
    [IMPORT_CUSTOM_IDS.companionImport]: "companion_app_export",
    [IMPORT_CUSTOM_IDS.manualImport]: "manual"
  };

  const importMode = modeByButton[interaction.customId];

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

  if (interaction.customId === IMPORT_CUSTOM_IDS.weekScope) {
    draft.weekScope = interaction.values[0] as ImportDraft["weekScope"];
    importSessions.set(interaction.user.id, draft);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Create Import Job")
          .setDescription([
            `Mode: **${draft.importMode?.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            "",
            "Select the core endpoints to include."
          ].join("\n"))
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
      importLabel: `${draft.importMode.replaceAll("_", " ")} — ${draft.weekScope?.replaceAll("_", " ") ?? "selected scope"}`,
      requestedByDiscordId: interaction.user.id
    });

    importSessions.delete(interaction.user.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Import Job Created")
          .setDescription([
            `League: **${result.job?.league?.name ?? result.job?.league?.name ?? "Current League"}**`,
            `Mode: **${draft.importMode.replaceAll("_", " ")}**`,
            `Week Scope: **${draft.weekScope?.replaceAll("_", " ")}**`,
            `Endpoints: **${draft.endpointKeys.length} selected**`,
            "",
            "The job has been created. Endpoint execution and preview approval will be wired in the next import package.",
            "",
            "Economy payouts remain deferred until the league advance workflow."
          ].join("\n"))
      ],
      components: buildImportPanelRows()
    });
  }
}
