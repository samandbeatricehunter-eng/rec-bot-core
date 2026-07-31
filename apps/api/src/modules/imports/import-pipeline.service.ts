// Editorial & Import Master Plan, Phase 1: canonical import staging pipeline.
//
// This module owns the staging tables only (rec_import_jobs/files/payloads/records/fields/
// conflicts/corrections/adapter_versions/audit_log) — it never writes to a canonical domain
// table (standings, rosters, schedules, box scores) itself. A future adapter (Phase 2+) reads
// approved rec_import_records rows and calls the *existing* domain services (box-score,
// schedule, roster) the normal way; "applying" an import means calling that domain service and
// then marking the record `applied`, not this module reaching into those tables directly.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { ImportConflictResolution, ImportJobStatus, ImportRecordStatus, ImportSourceType, ImportTrustLevel } from "@rec/shared";

export async function createImportJob(input: {
  leagueId: string;
  connectionId?: string | null;
  sourceType: ImportSourceType;
  taskKey?: string | null;
  requestedByUserId?: string | null;
}) {
  const { data, error } = await supabase
    .from("rec_import_jobs")
    .insert({
      league_id: input.leagueId,
      connection_id: input.connectionId ?? null,
      source_type: input.sourceType,
      task_key: input.taskKey ?? null,
      requested_by_user_id: input.requestedByUserId ?? null,
      status: "pending" satisfies ImportJobStatus,
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to create import job.", error);
  await logImportEvent({ importJobId: data.id, actorUserId: input.requestedByUserId ?? null, eventType: "job_created", details: { sourceType: input.sourceType, taskKey: input.taskKey ?? null } });
  return data;
}

export async function setImportJobStatus(input: { importJobId: string; status: ImportJobStatus; error?: string | null }) {
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "processing") patch.started_at = new Date().toISOString();
  if (input.status === "completed" || input.status === "failed") patch.completed_at = new Date().toISOString();
  if (input.error !== undefined) patch.error = input.error;
  const { error } = await supabase.from("rec_import_jobs").update(patch).eq("id", input.importJobId);
  if (error) throw new ApiError(500, "Failed to update import job status.", error);
}

/** Immutable raw upload — never call this twice for the same file; re-uploads are a new row. */
export async function recordImportFile(input: { importJobId: string; storageKey: string; originalUrl?: string | null; mimeType?: string | null; sizeBytes?: number | null; checksum?: string | null }) {
  const { data, error } = await supabase
    .from("rec_import_files")
    .insert({ import_job_id: input.importJobId, storage_key: input.storageKey, original_url: input.originalUrl ?? null, mime_type: input.mimeType ?? null, size_bytes: input.sizeBytes ?? null, checksum: input.checksum ?? null })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to record import file.", error);
  return data;
}

/** Immutable raw payload (Companion export blob, OCR/vision extraction result). */
export async function recordImportPayload(input: { importJobId: string; payload: Record<string, unknown>; adapterKey: string; adapterVersion: string }) {
  const { data, error } = await supabase
    .from("rec_import_payloads")
    .insert({ import_job_id: input.importJobId, payload: input.payload, adapter_key: input.adapterKey, adapter_version: input.adapterVersion })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to record import payload.", error);
  return data;
}

/** One normalized staging record for a domain entity — a game result, a team-stat line, a
 * roster player, a standing row. entityKey should be a stable natural key for that record type
 * (e.g. `${leagueId}:${weekNumber}:${homeTeamId}:${awayTeamId}` for a game result) so re-running
 * the same source against an existing job is a no-op rather than a duplicate. */
export async function createImportRecord(input: {
  importJobId: string;
  leagueId: string;
  recordType: string;
  entityKey: string;
  trustLevel: ImportTrustLevel;
}) {
  const { data, error } = await supabase
    .from("rec_import_records")
    .insert({
      import_job_id: input.importJobId,
      league_id: input.leagueId,
      record_type: input.recordType,
      entity_key: input.entityKey,
      trust_level: input.trustLevel,
      status: "pending_review" satisfies ImportRecordStatus,
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to create import record.", error);
  return data;
}

/** Field-level provenance for one field within a record (master plan §4.3). */
export async function recordImportField(input: {
  importRecordId: string;
  fieldKey: string;
  sourceType: ImportSourceType;
  adapterKey: string;
  adapterVersion: string;
  extractedValue: unknown;
  sourcePath?: string | null;
  sourceRegion?: { x: number; y: number; width: number; height: number } | null;
  confidence?: number | null;
}) {
  const { data, error } = await supabase
    .from("rec_import_fields")
    .upsert(
      {
        import_record_id: input.importRecordId,
        field_key: input.fieldKey,
        source_type: input.sourceType,
        adapter_key: input.adapterKey,
        adapter_version: input.adapterVersion,
        extracted_value: input.extractedValue as never,
        approved_value: input.extractedValue as never,
        source_path: input.sourcePath ?? null,
        source_region: input.sourceRegion ?? null,
        confidence: input.confidence ?? null,
      },
      { onConflict: "import_record_id,field_key" },
    )
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to record import field.", error);
  return data;
}

/** Detected conflict between an incoming field value and existing canonical/other-source data.
 * Trust level guides review priority but never silently resolves this — resolution starts (and
 * stays) 'pending' until a human, or an explicit trusted-import-wins policy, acts on it. */
export async function recordImportConflict(input: { importRecordId: string; fieldKey: string; incomingValue: unknown; existingValue: unknown; existingSource?: string | null }) {
  const { data, error } = await supabase
    .from("rec_import_conflicts")
    .insert({
      import_record_id: input.importRecordId,
      field_key: input.fieldKey,
      incoming_value: input.incomingValue as never,
      existing_value: input.existingValue as never,
      existing_source: input.existingSource ?? null,
      resolution: "pending" satisfies ImportConflictResolution,
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to record import conflict.", error);
  return data;
}

export async function resolveImportConflict(input: { conflictId: string; resolution: Exclude<ImportConflictResolution, "pending">; resolvedByUserId: string }) {
  const { data, error } = await supabase
    .from("rec_import_conflicts")
    .update({ resolution: input.resolution, resolved_by_user_id: input.resolvedByUserId, resolved_at: new Date().toISOString() })
    .eq("id", input.conflictId)
    .eq("resolution", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to resolve import conflict.", error);
  if (!data) throw new ApiError(409, "Conflict was already resolved, or does not exist.");
  return data;
}

/** A human edit to an already-extracted field value. Distinct from the original extraction so
 * "what did the adapter say" and "what did a reviewer change it to, and why" both survive. */
export async function correctImportField(input: { importFieldId: string; correctedValue: unknown; correctedByUserId: string; reason?: string | null }) {
  const field = await supabase.from("rec_import_fields").select("approved_value").eq("id", input.importFieldId).maybeSingle();
  if (field.error) throw new ApiError(500, "Failed to load field for correction.", field.error);
  if (!field.data) throw new ApiError(404, "Import field not found.");

  const correction = await supabase
    .from("rec_import_corrections")
    .insert({ import_field_id: input.importFieldId, previous_value: field.data.approved_value, corrected_value: input.correctedValue as never, corrected_by_user_id: input.correctedByUserId, reason: input.reason ?? null })
    .select("*")
    .single();
  if (correction.error) throw new ApiError(500, "Failed to record correction.", correction.error);

  const updated = await supabase
    .from("rec_import_fields")
    .update({ approved_value: input.correctedValue as never, approved_by_user_id: input.correctedByUserId, approved_at: new Date().toISOString() })
    .eq("id", input.importFieldId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to apply correction.", updated.error);
  return { field: updated.data, correction: correction.data };
}

/** Review gate: approve or reject a staging record. Approval does NOT apply it to a canonical
 * table — that's a separate step a Phase 2+ adapter performs by calling the relevant domain
 * service, then calling markImportRecordApplied below. */
export async function reviewImportRecord(input: { importRecordId: string; decision: "approved" | "rejected"; reviewedByUserId: string }) {
  const { data, error } = await supabase
    .from("rec_import_records")
    .update({ status: input.decision satisfies ImportRecordStatus, reviewed_by_user_id: input.reviewedByUserId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.importRecordId)
    .eq("status", "pending_review")
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to review import record.", error);
  if (!data) throw new ApiError(409, "Record is not awaiting review (already decided, or does not exist).");
  await logImportEvent({ importJobId: data.import_job_id, actorUserId: input.reviewedByUserId, eventType: `record_${input.decision}`, details: { recordId: data.id, recordType: data.record_type } });
  return data;
}

export async function markImportRecordApplied(input: { importRecordId: string }) {
  const { data, error } = await supabase
    .from("rec_import_records")
    .update({ status: "applied" satisfies ImportRecordStatus, applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.importRecordId)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to mark import record applied.", error);
  if (!data) throw new ApiError(409, "Record must be approved (and not already applied) before it can be applied.");
  return data;
}

export async function logImportEvent(input: { importJobId?: string | null; actorUserId?: string | null; eventType: string; details?: Record<string, unknown> }) {
  const { error } = await supabase.from("rec_import_audit_log").insert({ import_job_id: input.importJobId ?? null, actor_user_id: input.actorUserId ?? null, event_type: input.eventType, details: input.details ?? {} });
  if (error) console.error("[ERROR] Failed to write import audit log entry (non-fatal):", error);
}

export async function listPendingImportRecords(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_import_records")
    .select("*, rec_import_fields(*), rec_import_conflicts(*)")
    .eq("league_id", leagueId)
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load pending import records.", error);
  return data ?? [];
}
