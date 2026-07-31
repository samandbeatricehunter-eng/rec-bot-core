// Editorial & Import Master Plan §4.3/§4.4 — shared between apps/api's import-pipeline
// service and any future adapter (CFB baseline, Madden Companion, Direct Sync, screenshot
// extraction). Kept here so an adapter package can depend on the type without depending on
// the API's service code.

export type ImportSourceType =
  | "cfb_screenshot"
  | "cfb_baseline"
  | "madden_companion"
  | "madden_direct_sync"
  | "manual";

export type ImportConnectionType = ImportSourceType;

export type ImportJobStatus = "pending" | "processing" | "completed" | "failed" | "superseded";

export type ImportRecordStatus = "pending_review" | "approved" | "rejected" | "applied";

// Suggested default ordering (master plan §4.4). Trust guides review priority — it never
// silently resolves a material conflict; every rec_import_conflicts row still starts
// 'pending' regardless of which side has the higher trust level.
export const IMPORT_TRUST_HIERARCHY = [
  "commissioner_approved_import",
  "trusted_automated_import",
  "approved_screenshot_import",
  "approved_manual_entry",
  "unreviewed_extraction",
  "external_cfb_baseline",
] as const;
export type ImportTrustLevel = (typeof IMPORT_TRUST_HIERARCHY)[number];

export function trustRank(level: ImportTrustLevel): number {
  return IMPORT_TRUST_HIERARCHY.indexOf(level);
}

/** Higher trust wins on rank; ties are not a silent resolution — caller must still route to
 * conflict review rather than picking a winner. */
export function isHigherTrust(a: ImportTrustLevel, b: ImportTrustLevel): boolean {
  return trustRank(a) < trustRank(b);
}

export type FieldProvenance = {
  sourceId: string;
  sourceType: ImportSourceType;
  sourcePath?: string;
  sourceRegion?: { x: number; y: number; width: number; height: number };
  adapterKey: string;
  adapterVersion: string;
  confidence?: number;
  extractedValue: unknown;
  approvedValue: unknown;
  approvedBy?: string;
  approvedAt?: string;
};

export type ImportConflictResolution = "pending" | "kept_existing" | "accepted_import" | "manual_override";
