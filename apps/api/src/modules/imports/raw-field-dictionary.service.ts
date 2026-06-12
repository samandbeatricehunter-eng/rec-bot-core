import { supabase } from "../../lib/supabase.js";

type CaptureInput = {
  leagueId: string;
  importJobId: string;
  endpointKey: string;
  careerModeGet?: string | null;
  payloadGroup?: string | null;
  payload: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function safeExampleValue(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === "bigint") return String(value);
  return value;
}

type RawField = { sourcePath: string; rawKey: string; value: unknown };

// Accumulate the union of fields across the whole payload, deduped by sourcePath.
// EA arrays are heterogeneous (position-specific roster attributes, optional stat
// fields), so we walk *every* element rather than sampling the first — otherwise
// keys absent from element 0 never reach the dictionary. Deduping by sourcePath
// also keeps the downstream upsert safe (no repeated onConflict target in a batch).
function collectFields(value: unknown, prefix: string, acc: Map<string, RawField>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item != null) collectFields(item, `${prefix}[]`, acc);
    }
    return;
  }

  if (!isPlainObject(value)) return;

  for (const [rawKey, child] of Object.entries(value)) {
    const sourcePath = prefix ? `${prefix}.${rawKey}` : rawKey;
    const existing = acc.get(sourcePath);
    if (!existing) {
      acc.set(sourcePath, { sourcePath, rawKey, value: child });
    } else if (existing.value == null && child != null) {
      // Prefer a non-null example so value_type reflects the real field type.
      existing.value = child;
    }

    if (isPlainObject(child) || Array.isArray(child)) {
      collectFields(child, sourcePath, acc);
    }
  }
}

function walkPayload(value: unknown): RawField[] {
  const acc = new Map<string, RawField>();
  collectFields(value, "", acc);
  return [...acc.values()];
}

export async function captureImportRawFields(input: CaptureInput) {
  const fields = walkPayload(input.payload);
  if (!fields.length) return { captured: 0 };

  const now = new Date().toISOString();
  const rows = fields.map((field) => ({
    league_id: input.leagueId,
    import_job_id: input.importJobId,
    endpoint_key: input.endpointKey,
    career_mode_get: input.careerModeGet ?? null,
    payload_group: input.payloadGroup ?? "",
    source_path: field.sourcePath,
    raw_key: field.rawKey,
    value_type: valueType(field.value),
    example_value: safeExampleValue(field.value),
    sample_count: 1,
    last_seen_at: now
  }));

  const { error } = await supabase
    .from("rec_import_raw_field_dictionary")
    .upsert(rows, {
      onConflict: "league_id,endpoint_key,payload_group,source_path",
      ignoreDuplicates: false
    });

  if (error) {
    console.warn("[IMPORT RAW FIELD DICTIONARY CAPTURE FAILED]", {
      importJobId: input.importJobId,
      endpointKey: input.endpointKey,
      payloadGroup: input.payloadGroup,
      error: error.message
    });
    return { captured: 0, error: error.message };
  }

  return { captured: rows.length };
}

export async function listImportRawFieldDictionary(input: {
  leagueId: string;
  importJobId?: string;
  endpointKey?: string;
  mapped?: boolean;
  limit?: number;
}) {
  let query = supabase
    .from("rec_import_raw_field_dictionary")
    .select("*")
    .eq("league_id", input.leagueId)
    .order("endpoint_key", { ascending: true })
    .order("payload_group", { ascending: true })
    .order("source_path", { ascending: true })
    .limit(input.limit ?? 5000);

  if (input.importJobId) query = query.eq("import_job_id", input.importJobId);
  if (input.endpointKey) query = query.eq("endpoint_key", input.endpointKey);
  if (typeof input.mapped === "boolean") query = query.eq("mapped", input.mapped);

  const { data, error } = await query;
  if (error) throw error;

  return {
    leagueId: input.leagueId,
    count: data?.length ?? 0,
    fields: data ?? []
  };
}
