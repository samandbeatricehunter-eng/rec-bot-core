/**
 * node-postgres serializes any JS array as a Postgres array-literal (`{a,b,c}`),
 * regardless of the target column's real type. That is correct for a native
 * `text[]` / `integer[]` column, but broken for `jsonb` (its parser rejects
 * array-literal syntax as invalid JSON). Most schema arrays are jsonb and must
 * be JSON-stringified before reaching the driver.
 *
 * Native Postgres array columns are explicitly allowlisted so they retain the
 * array encoding node-postgres expects. Keep this list in sync with live
 * `information_schema` columns where `data_type = 'ARRAY'`.
 */
export const NATIVE_PG_ARRAY_COLUMNS = new Set([
  "rec_box_score_submissions.extra_discord_message_ids",
  "rec_league_configuration.force_win_rules_regular",
  "rec_league_configuration.force_win_rules_postseason",
  "rec_league_configuration.fair_sim_rules_regular",
  "rec_league_configuration.fair_sim_rules_postseason",
  "rec_user_league_history.roles",
]);

export function serializePgValue(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value) && NATIVE_PG_ARRAY_COLUMNS.has(`${table}.${column}`)) return value;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}
