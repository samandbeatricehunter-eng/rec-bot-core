// Drizzle's schema (apps/api/src/db/schema.ts) uses idiomatic camelCase property names,
// but nearly everything that consumes a query result today — other API modules, and the
// bot reading JSON API responses — expects the raw snake_case shape matching Postgres
// column names (the exact contract the old supabase-js client returned). Rather than
// hand-writing a converter per table (96 of them, error-prone), these generic helpers
// convert a Drizzle row (or array of rows) between the two shapes at the boundary.
//
// Only the row's OWN top-level keys are converted — jsonb column values are left
// untouched, since their internal shape is application-defined (e.g. source_reference
// payloads), not derived from a DB column name.

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function shallowRekey(row: unknown, rekey: (key: string) => string): unknown {
  if (row === null || typeof row !== "object" || row instanceof Date) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[rekey(key)] = value;
  }
  return out;
}

/** Converts a Drizzle result (camelCase) to the snake_case shape every existing consumer expects. */
export function toSnakeRow<T = Record<string, unknown>>(row: unknown): T {
  if (row == null) return row as T;
  if (Array.isArray(row)) return row.map((r) => shallowRekey(r, camelToSnake)) as unknown as T;
  return shallowRekey(row, camelToSnake) as T;
}

/** Converts a snake_case-keyed input (e.g. a legacy-shaped payload) to camelCase for Drizzle insert/update calls. */
export function toCamelRow<T = Record<string, unknown>>(row: unknown): T {
  if (row == null) return row as T;
  if (Array.isArray(row)) return row.map((r) => shallowRekey(r, snakeToCamel)) as unknown as T;
  return shallowRekey(row, snakeToCamel) as T;
}
