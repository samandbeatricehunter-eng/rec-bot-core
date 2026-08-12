import { createHash } from "node:crypto";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Incident recording
// ---------------------------------------------------------------------------

export type IncidentInput = {
  leagueId?: string | null;
  guildId?: string | null;
  process: string;
  severity?: string;
  title: string;
  detail?: string | null;
  errorName?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  context?: Record<string, unknown>;
};

/**
 * Record (or increment) an admin incident. Uses a fingerprint (hash of
 * process + errorName + errorMessage + leagueId) so a repeat of the same error
 * increments occurrence_count and updates last_seen_at instead of creating a
 * duplicate row. This keeps the admin error log clean while still showing volume.
 *
 * Returns the incident id (existing or new).
 */
export async function recordIncident(input: IncidentInput): Promise<string | null> {
  const fingerprint = incidentFingerprint(input);
  const now = new Date().toISOString();
  const context = input.context ?? {};

  // Try to find an existing open incident with the same fingerprint.
  const existing = await supabase
    .from("rec_admin_incidents")
    .select("id")
    .eq("fingerprint", fingerprint)
    .eq("status", "open")
    .maybeSingle();

  if (existing.error) {
    console.error("[ERROR] Failed to look up existing incident for dedup:", existing.error);
    // Fall through to insert — better to have a duplicate than to lose the error.
  }

  if (existing.data?.id) {
    // Increment the existing incident.
    const updated = await supabase
      .from("rec_admin_incidents")
      .update({
        occurrence_count: (await getOccurrenceCount(existing.data.id)) + 1,
        last_seen_at: now,
        updated_at: now,
        // Refresh the detail/stack to the most recent occurrence so the admin sees
        // the latest stack trace, not a stale one from the first occurrence.
        detail: input.detail ?? null,
        error_stack: input.errorStack ?? null,
      })
      .eq("id", existing.data.id)
      .select("id")
      .single();
    if (updated.error) {
      console.error("[ERROR] Failed to increment incident occurrence:", updated.error);
    }
    return existing.data.id;
  }

  // Insert a new incident.
  const inserted = await supabase
    .from("rec_admin_incidents")
    .insert({
      league_id: input.leagueId ?? null,
      guild_id: input.guildId ?? null,
      process: input.process,
      severity: input.severity ?? "high",
      status: "open",
      title: input.title,
      detail: input.detail ?? null,
      error_name: input.errorName ?? null,
      error_message: input.errorMessage ?? null,
      error_stack: input.errorStack ?? null,
      context,
      fingerprint,
      occurrence_count: 1,
      first_seen_at: now,
      last_seen_at: now,
      occurred_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (inserted.error) {
    console.error("[ERROR] Failed to record admin incident:", inserted.error);
    return null;
  }
  return inserted.data.id;
}

async function getOccurrenceCount(id: string): Promise<number> {
  const { data } = await supabase
    .from("rec_admin_incidents")
    .select("occurrence_count")
    .eq("id", id)
    .maybeSingle();
  return Number(data?.occurrence_count ?? 1);
}

function incidentFingerprint(input: IncidentInput): string {
  const raw = [
    input.process ?? "",
    input.errorName ?? "",
    input.errorMessage ?? "",
    input.leagueId ?? "",
  ].join("|");
  return createHash("md5").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Incident management (resolve / ignore / workorder)
// ---------------------------------------------------------------------------

export async function resolveIncident(input: { incidentId: string; resolvedByUserId: string }) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_admin_incidents")
    .update({
      status: "resolved",
      resolved_at: now,
      resolved_by_user_id: input.resolvedByUserId,
      updated_at: now,
    })
    .eq("id", input.incidentId)
    .select("id, status")
    .single();
  if (result.error) throw new ApiError(500, "Failed to resolve incident.", result.error);
  return { id: result.data.id, status: result.data.status };
}

export async function ignoreIncident(input: { incidentId: string; resolvedByUserId: string }) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_admin_incidents")
    .update({
      status: "ignored",
      resolved_at: now,
      resolved_by_user_id: input.resolvedByUserId,
      updated_at: now,
    })
    .eq("id", input.incidentId)
    .select("id, status")
    .single();
  if (result.error) throw new ApiError(500, "Failed to ignore incident.", result.error);
  return { id: result.data.id, status: result.data.status };
}

export async function startWorkorder(input: {
  incidentId: string;
  startedByUserId: string;
  conversationId: string;
  note?: string | null;
}) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_admin_incidents")
    .update({
      workorder_status: "contacted",
      workorder_conversation_id: input.conversationId,
      workorder_started_at: now,
      workorder_started_by: input.startedByUserId,
      workorder_note: input.note ?? null,
      updated_at: now,
    })
    .eq("id", input.incidentId)
    .select("id, workorder_status, workorder_conversation_id")
    .single();
  if (result.error) throw new ApiError(500, "Failed to start workorder.", result.error);
  return result.data;
}

export async function closeWorkorder(input: { incidentId: string; resolvedByUserId: string }) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_admin_incidents")
    .update({
      workorder_status: "closed",
      status: "resolved",
      resolved_at: now,
      resolved_by_user_id: input.resolvedByUserId,
      updated_at: now,
    })
    .eq("id", input.incidentId)
    .select("id, workorder_status, status")
    .single();
  if (result.error) throw new ApiError(500, "Failed to close workorder.", result.error);
  return result.data;
}

// ---------------------------------------------------------------------------
// Incident listing + pattern/volume analytics
// ---------------------------------------------------------------------------

export type IncidentFilter = {
  status?: string; // open | resolved | ignored
  severity?: string;
  leagueId?: string;
  process?: string;
  limit?: number;
};

export async function listIncidents(filter: IncidentFilter = {}) {
  let query = supabase
    .from("rec_admin_incidents")
    .select(
      "id, league_id, guild_id, process, severity, status, title, detail, error_name, error_message, error_stack, context, occurred_at, resolved_at, resolved_by_user_id, fingerprint, occurrence_count, first_seen_at, last_seen_at, workorder_status, workorder_conversation_id, workorder_started_at, workorder_note",
    )
    .order("last_seen_at", { ascending: false })
    .limit(filter.limit ?? 100);

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.severity) query = query.eq("severity", filter.severity);
  if (filter.leagueId) query = query.eq("league_id", filter.leagueId);
  if (filter.process) query = query.eq("process", filter.process);

  const result = await query;
  if (result.error) throw new ApiError(500, "Failed to load incidents.", result.error);
  return result.data ?? [];
}

export type IncidentPatternSummary = {
  total: number;
  open: number;
  resolved: number;
  ignored: number;
  last24h: number;
  last7d: number;
  byProcess: Array<{ process: string; count: number; openCount: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  topPatterns: Array<{
    fingerprint: string;
    process: string;
    title: string;
    errorMessage: string | null;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    status: string;
    leagueId: string | null;
  }>;
  // Daily volume for the sparkline (last 14 days, oldest first).
  dailyVolume: Array<{ date: string; count: number }>;
};

export async function getIncidentPatternSummary(): Promise<IncidentPatternSummary> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all incidents (up to 500 for analytics) — the table is expected to stay
  // small enough that a single fetch + in-memory grouping is fine.
  const { data, error } = await supabase
    .from("rec_admin_incidents")
    .select("id, process, severity, status, title, error_message, fingerprint, occurrence_count, first_seen_at, last_seen_at, league_id")
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) throw new ApiError(500, "Failed to load incident analytics.", error);

  const incidents = data ?? [];
  const byProcessMap = new Map<string, { count: number; openCount: number }>();
  const bySeverityMap = new Map<string, number>();
  const fingerprintMap = new Map<string, { fingerprint: string; process: string; title: string; errorMessage: string | null; occurrenceCount: number; firstSeenAt: string; lastSeenAt: string; status: string; leagueId: string | null }>();

  let total = 0;
  let open = 0;
  let resolved = 0;
  let ignored = 0;
  let last24h = 0;
  let last7d = 0;

  // Build daily volume buckets for the last 14 days.
  const dailyBuckets: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dailyBuckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }

  for (const inc of incidents) {
    total++;
    if (inc.status === "open") open++;
    else if (inc.status === "resolved") resolved++;
    else if (inc.status === "ignored") ignored++;

    if (inc.last_seen_at && inc.last_seen_at >= since24h) last24h++;
    if (inc.last_seen_at && inc.last_seen_at >= since7d) last7d++;

    // By process.
    const proc = byProcessMap.get(inc.process) ?? { count: 0, openCount: 0 };
    proc.count++;
    if (inc.status === "open") proc.openCount++;
    byProcessMap.set(inc.process, proc);

    // By severity.
    bySeverityMap.set(inc.severity, (bySeverityMap.get(inc.severity) ?? 0) + 1);

    // Daily volume (by first_seen_at date).
    if (inc.first_seen_at) {
      const dateKey = inc.first_seen_at.slice(0, 10);
      const bucket = dailyBuckets.find((b) => b.date === dateKey);
      if (bucket) bucket.count++;
    }

    // Top patterns (group by fingerprint, keep highest occurrence_count).
    const existing = fingerprintMap.get(inc.fingerprint);
    if (!existing || inc.occurrence_count > existing.occurrenceCount) {
      fingerprintMap.set(inc.fingerprint, {
        fingerprint: inc.fingerprint,
        process: inc.process,
        title: inc.title,
        errorMessage: inc.error_message,
        occurrenceCount: inc.occurrence_count,
        firstSeenAt: inc.first_seen_at,
        lastSeenAt: inc.last_seen_at,
        status: inc.status,
        leagueId: inc.league_id,
      });
    }
  }

  return {
    total,
    open,
    resolved,
    ignored,
    last24h,
    last7d,
    byProcess: [...byProcessMap.entries()]
      .map(([process, v]) => ({ process, count: v.count, openCount: v.openCount }))
      .sort((a, b) => b.count - a.count),
    bySeverity: [...bySeverityMap.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    topPatterns: [...fingerprintMap.values()]
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .slice(0, 20),
    dailyVolume: dailyBuckets,
  };
}
