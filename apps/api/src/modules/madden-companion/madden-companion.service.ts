// Madden Companion receiver — Editorial Master Plan §6.2
// Per-league HTTPS endpoints for Companion export ingestion.

import { supabase } from "../../lib/supabase.js";
import { z } from "zod";
import crypto from "crypto";

export type MaddenEndpointKey =
  | "league_metadata"
  | "teams"
  | "standings"
  | "schedule"
  | "rosters"
  | "player_stats"
  | "team_stats";

export const MADDEN_ENDPOINT_KEYS: MaddenEndpointKey[] = [
  "league_metadata",
  "teams",
  "standings",
  "schedule",
  "rosters",
  "player_stats",
  "team_stats",
];

export type CompanionConnection = {
  id: string;
  league_id: string;
  connection_token: string; // hashed
  config: {
    token_hash: string;
    endpoint_keys: MaddenEndpointKey[];
    rate_limit_per_minute: number;
    max_payload_bytes: number;
  };
  status: "active" | "disabled" | "error";
  last_health_check_at: string | null;
  last_health_status: string | null;
  created_at: string;
  updated_at: string;
};

export type IngestResult = {
  accepted: boolean;
  import_job_id: string | null;
  error?: string;
};

/**
 * Validate connection token and return connection if valid.
 * Tokens are stored as SHA-256 hashes (never plaintext).
 */
export async function validateCompanionConnection(
  connectionToken: string,
  endpointKey: MaddenEndpointKey
): Promise<CompanionConnection | null> {
  const tokenHash = crypto.createHash("sha256").update(connectionToken).digest("hex");

  const { data, error } = await supabase
    .from("rec_import_connections")
    .select("*")
    .eq("connection_type", "madden_companion")
    .eq("config->>token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`Failed to validate connection: ${error.message}`);
  if (!data) return null;

  // Check if this endpoint key is allowed for this connection
  const allowedKeys = (data.config?.endpoint_keys as MaddenEndpointKey[]) ?? [];
  if (!allowedKeys.includes(endpointKey)) return null;

  return data as CompanionConnection;
}

/**
 * Store immutable raw payload and create import job.
 * Returns import_job_id for async processing.
 */
export async function ingestCompanionPayload(
  connection: CompanionConnection,
  endpointKey: MaddenEndpointKey,
  payload: unknown,
  requestHeaders: Record<string, string>
): Promise<IngestResult> {
  const leagueId = connection.league_id;
  const adapterKey = `madden_companion_${endpointKey}`;
  const adapterVersion = "1.0.0"; // increment when parser changes

  // Compute checksum for idempotency
  const payloadStr = JSON.stringify(payload);
  const checksum = crypto.createHash("sha256").update(payloadStr).digest("hex");

  // Check for duplicate (same connection + endpoint + checksum within 24h)
  const { data: existing } = await supabase
    .from("rec_import_payloads")
    .select("id, import_job_id")
    .eq("adapter_key", adapterKey)
    .eq("payload", payload)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();

  if (existing) {
    return { accepted: true, import_job_id: existing.import_job_id };
  }

  // Create import job
  const { data: job, error: jobError } = await supabase
    .from("rec_import_jobs")
    .insert({
      league_id: leagueId,
      connection_id: connection.id,
      source_type: "madden_companion",
      task_key: endpointKey,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobError) throw new Error(`Failed to create import job: ${jobError.message}`);

  const importJobId = job.id;

  // Store raw file (payload as JSON)
  const { error: fileError } = await supabase.from("rec_import_files").insert({
    import_job_id: importJobId,
    storage_key: `companion/${leagueId}/${endpointKey}/${importJobId}.json`,
    mime_type: "application/json",
    size_bytes: Buffer.byteLength(payloadStr),
    checksum,
  });
  if (fileError) throw new Error(`Failed to store import file: ${fileError.message}`);

  // Store immutable payload
  const { error: payloadError } = await supabase.from("rec_import_payloads").insert({
    import_job_id: importJobId,
    payload,
    adapter_key: adapterKey,
    adapter_version: adapterVersion,
  });
  if (payloadError) throw new Error(`Failed to store import payload: ${payloadError.message}`);

  // Log audit event
  await supabase.from("rec_import_audit_log").insert({
    import_job_id: importJobId,
    event_type: "companion_ingest",
    details: {
      endpoint_key: endpointKey,
      connection_id: connection.id,
      payload_size: payloadStr.length,
      checksum,
      request_headers: Object.fromEntries(
        Object.entries(requestHeaders).filter(([k]) => !k.toLowerCase().includes("authorization"))
      ),
    },
  });

  return { accepted: true, import_job_id: importJobId };
}

/**
 * Process the ingested Companion payload through the endpoint adapter
 * and create staged import records. Called after ingest (sync or async).
 */
export async function processCompanionPayload(
  importJobId: string,
  leagueId: string,
  endpointKey: MaddenEndpointKey,
  payload: unknown
): Promise<{ recordsCreated: number; conflictsDetected: number }> {
  const { processCompanionPayload: processAdapter } = await import("./madden-companion.adapters.js");
  return processAdapter(importJobId, leagueId, endpointKey, payload);
}

/**
 * Register a new Companion connection for a league.
 * Called by commissioner during setup.
 */
export async function registerCompanionConnection(
  leagueId: string,
  requestedByUserId: string,
  endpointKeys: MaddenEndpointKey[] = MADDEN_ENDPOINT_KEYS,
  rateLimitPerMinute = 60,
  maxPayloadBytes = 10 * 1024 * 1024 // 10MB
): Promise<{ connectionToken: string; connection: CompanionConnection }> {
  // Generate secure token
  const connectionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(connectionToken).digest("hex");

  const { data, error } = await supabase
    .from("rec_import_connections")
    .insert({
      league_id: leagueId,
      connection_type: "madden_companion",
      status: "active",
      config: {
        token_hash: tokenHash,
        endpoint_keys: endpointKeys,
        rate_limit_per_minute: rateLimitPerMinute,
        max_payload_bytes: maxPayloadBytes,
      },
      created_by_user_id: requestedByUserId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to register companion connection: ${error.message}`);

  return {
    connectionToken, // Only returned once — commissioner must save it
    connection: data as CompanionConnection,
  };
}

/**
 * Rotate connection token (commissioner action).
 */
export async function rotateCompanionToken(
  connectionId: string,
  requestedByUserId: string
): Promise<{ connectionToken: string }> {
  const connectionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(connectionToken).digest("hex");

  // Fetch current config, update token_hash, then update
  const { data: current, error: fetchError } = await supabase
    .from("rec_import_connections")
    .select("config")
    .eq("id", connectionId)
    .single();

  if (fetchError) throw new Error(`Failed to fetch connection: ${fetchError.message}`);

  const updatedConfig = {
    ...(current.config as Record<string, unknown>),
    token_hash: tokenHash,
  };

  const { error } = await supabase
    .from("rec_import_connections")
    .update({
      config: updatedConfig,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (error) throw new Error(`Failed to rotate token: ${error.message}`);

  return { connectionToken };
}

/**
 * Get connection status for health monitoring.
 */
export async function getCompanionConnectionStatus(leagueId: string): Promise<CompanionConnection[]> {
  const { data, error } = await supabase
    .from("rec_import_connections")
    .select("*")
    .eq("league_id", leagueId)
    .eq("connection_type", "madden_companion")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to get connection status: ${error.message}`);
  return (data ?? []) as CompanionConnection[];
}