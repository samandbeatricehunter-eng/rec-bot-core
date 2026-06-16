import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueForGuild } from "../team-ownership/team-ownership.service.js";
import type {
  CreateImportJobInput,
  UpdateEndpointAttemptInput,
  UpdateImportJobStatusInput
} from "./import.schemas.js";

const CORE_EA_ENDPOINTS = [
  { endpoint_key: "league_metadata", endpoint_label: "League Metadata" },
  { endpoint_key: "teams", endpoint_label: "Teams" },
  { endpoint_key: "standings", endpoint_label: "Standings" },
  { endpoint_key: "schedule", endpoint_label: "Schedule" },
  { endpoint_key: "rosters", endpoint_label: "Rosters" },
  { endpoint_key: "players", endpoint_label: "Players" },
  { endpoint_key: "player_stats", endpoint_label: "Player Stats" },
  { endpoint_key: "team_stats", endpoint_label: "Team Stats" },
  { endpoint_key: "news", endpoint_label: "League News" },
  { endpoint_key: "transactions", endpoint_label: "Transactions" },
  { endpoint_key: "injuries", endpoint_label: "Injuries" }
] as const;

function buildInitialPreviewSummary(input: CreateImportJobInput) {
  return {
    importMode: input.importMode,
    coreEndpoints: input.importMode === "ea_import" ? CORE_EA_ENDPOINTS : [],
    excludedEndpoints: [
      "Kick Returns",
      "Punt Returns",
      "Awards",
      "Draft Picks",
      "Depth Charts",
      "Position Changes",
      "Ability Updates"
    ],
    message: "Import job created. No production data has been changed."
  };
}

export async function createImportJob(input: CreateImportJobInput) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);

  const created = await supabase
    .from("rec_import_jobs")
    .insert({
      league_id: league.id,
      server_id: server.id,
      requested_by_discord_id: input.requestedByDiscordId ?? null,
      import_mode: input.importMode,
      status: "created",
      import_label: input.importLabel ?? null,
      preview_summary: buildInitialPreviewSummary(input),
      validation_warnings: [],
      validation_errors: [],
      payload: {}
    })
    .select("*")
    .single();

  if (created.error) {
    throw new ApiError(500, "Failed to create import job.", created.error);
  }

  if (input.importMode === "ea_import") {
    const endpointRows = CORE_EA_ENDPOINTS.map((endpoint) => ({
      import_job_id: created.data.id,
      endpoint_key: endpoint.endpoint_key,
      endpoint_label: endpoint.endpoint_label,
      status: "pending",
      attempt_number: 1
    }));

    const attempts = await supabase
      .from("rec_import_endpoint_attempts")
      .insert(endpointRows)
      .select("*");

    if (attempts.error) {
      throw new ApiError(500, "Failed to initialize endpoint attempts.", attempts.error);
    }
  }

  await writeAuditLog({
    action: "import.job.created",
    entityType: "rec_import_jobs",
    entityId: created.data.id,
    newValue: {
      guildId: input.guildId,
      leagueId: league.id,
      importMode: input.importMode,
      importLabel: input.importLabel ?? null
    },
    reason: "Import job created from Admin Panel.",
    source: "manual_admin_entry"
  });

  return getImportJob(created.data.id);
}

export async function getImportJob(importJobId: string) {
  const job = await supabase
    .from("rec_import_jobs")
    .select("*, league:rec_leagues(id,name), server:rec_discord_servers(id,guild_id,name)")
    .eq("id", importJobId)
    .single();

  if (job.error) {
    throw new ApiError(404, "Import job was not found.", job.error);
  }

  const attempts = await supabase
    .from("rec_import_endpoint_attempts")
    .select("*")
    .eq("import_job_id", importJobId)
    .order("created_at", { ascending: true });

  if (attempts.error) {
    throw new ApiError(500, "Failed to load import endpoint attempts.", attempts.error);
  }

  return { job: job.data, endpointAttempts: attempts.data ?? [] };
}

export async function listImportJobsForGuild(guildId: string, limit = 10) {
  const { server, league } = await getCurrentLeagueForGuild(guildId);

  const jobs = await supabase
    .from("rec_import_jobs")
    .select("*")
    .eq("server_id", server.id)
    .eq("league_id", league.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (jobs.error) {
    throw new ApiError(500, "Failed to load import jobs.", jobs.error);
  }

  return { server, league, jobs: jobs.data ?? [] };
}

export async function getLatestImportJobForGuild(guildId: string) {
  const { server, league } = await getCurrentLeagueForGuild(guildId);

  const job = await supabase
    .from("rec_import_jobs")
    .select("*")
    .eq("server_id", server.id)
    .eq("league_id", league.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (job.error) {
    throw new ApiError(500, "Failed to load latest import job.", job.error);
  }

  if (!job.data) {
    return { server, league, job: null, endpointAttempts: [] };
  }

  const details = await getImportJob(job.data.id);
  return { server, league, ...details };
}

export async function updateEndpointAttempt(input: UpdateEndpointAttemptInput) {
  const now = new Date().toISOString();

  const existing = await supabase
    .from("rec_import_endpoint_attempts")
    .select("id")
    .eq("import_job_id", input.importJobId)
    .eq("endpoint_key", input.endpointKey)
    .eq("attempt_number", input.attemptNumber)
    .maybeSingle();

  if (existing.error) {
    throw new ApiError(500, "Failed to check endpoint attempt.", existing.error);
  }

  const payload = {
    import_job_id: input.importJobId,
    endpoint_key: input.endpointKey,
    endpoint_label: input.endpointLabel,
    status: input.status,
    http_status: input.httpStatus ?? null,
    attempt_number: input.attemptNumber,
    started_at: input.status === "running" ? now : undefined,
    completed_at: ["success", "failed", "skipped"].includes(input.status) ? now : undefined,
    duration_ms: input.durationMs ?? null,
    records_found: input.recordsFound ?? null,
    error_message: input.errorMessage ?? null,
    response_summary: input.responseSummary
  };

  const query = existing.data
    ? supabase.from("rec_import_endpoint_attempts").update(payload).eq("id", existing.data.id)
    : supabase.from("rec_import_endpoint_attempts").insert(payload);

  const result = await query.select("*").single();

  if (result.error) {
    throw new ApiError(500, "Failed to update endpoint attempt.", result.error);
  }

  return getImportJob(input.importJobId);
}

export async function updateImportJobStatus(input: UpdateImportJobStatusInput) {
  const timestampField: Record<string, string | undefined> = {
    running: "started_at",
    validating: "validated_at",
    reconciling: "reconciled_at",
    completed: "completed_at",
    completed_with_warnings: "completed_at",
    failed: "failed_at"
  };

  const updatePayload: Record<string, unknown> = {
    status: input.status,
    failure_reason: input.failureReason ?? null
  };

  if (input.previewSummary) updatePayload.preview_summary = input.previewSummary;
  if (input.validationErrors) updatePayload.validation_errors = input.validationErrors;
  if (input.validationWarnings) updatePayload.validation_warnings = input.validationWarnings;

  const field = timestampField[input.status];
  if (field) updatePayload[field] = new Date().toISOString();

  const result = await supabase
    .from("rec_import_jobs")
    .update(updatePayload)
    .eq("id", input.importJobId)
    .select("*")
    .single();

  if (result.error) {
    throw new ApiError(500, "Failed to update import job status.", result.error);
  }

  await writeAuditLog({
    action: "import.job.status_updated",
    entityType: "rec_import_jobs",
    entityId: input.importJobId,
    newValue: updatePayload,
    reason: "Import job status updated.",
    source: "internal_import"
  });

  return getImportJob(input.importJobId);
}
