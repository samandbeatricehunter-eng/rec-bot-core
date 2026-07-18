import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { getPgPool } from "../db/client.js";
import { env } from "../config/env.js";

type QueryResult = {
  data: any;
  error: any;
  count?: any;
};

type Filter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "not" | "contains" | "or";
  value: unknown;
  notOp?: string;
};

type Order = { column: string; ascending: boolean };
type Mode = "select" | "insert" | "update" | "upsert" | "delete";
type SelectOptions = { count?: "exact" | string; head?: boolean };
type UpsertOptions = { onConflict?: string; ignoreDuplicates?: boolean };

type SelectPart =
  | { kind: "all" }
  | { kind: "column"; name: string }
  | { kind: "relation"; alias: string; table: string; columns: SelectPart[] };

const webSocketTransport = WebSocket as unknown as typeof globalThis.WebSocket;
const storageClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  realtime: {
    transport: webSocketTransport
  }
});

function assertIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported SQL identifier: ${value}`);
  }
  return value;
}

function ident(value: string): string {
  return `"${assertIdent(value)}"`;
}

function splitTopLevel(input: string, delimiter = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === delimiter && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseSelect(input = "*"): SelectPart[] {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "*") return [{ kind: "all" }];
  return splitTopLevel(trimmed).map((part) => {
    if (part === "*") return { kind: "all" };
    const nested = /^([A-Za-z_][A-Za-z0-9_]*)\:([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z_][A-Za-z0-9_]*)?\((.*)\)$/.exec(part);
    if (nested) {
      return { kind: "relation", alias: nested[1], table: nested[2], columns: parseSelect(nested[3]) };
    }
    return { kind: "column", name: assertIdent(part) };
  });
}

function selectedBaseColumns(parts: SelectPart[]): string[] | null {
  if (parts.some((part) => part.kind === "all")) return null;
  const cols = new Set<string>();
  for (const part of parts) {
    if (part.kind === "column") cols.add(part.name);
    if (part.kind === "relation") cols.add(`${part.alias}_id`);
  }
  return [...cols];
}

function projectRow(row: Record<string, unknown>, parts: SelectPart[]): Record<string, unknown> {
  if (parts.some((part) => part.kind === "all")) return { ...row };
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (part.kind === "column") out[part.name] = row[part.name];
    if (part.kind === "relation") out[part.alias] = row[part.alias];
  }
  return out;
}

function relationKey(alias: string): string {
  return `${alias}_id`;
}

// node-postgres serializes any JS array as a Postgres array-literal ("{a,b,c}"), regardless
// of the target column's real type — correct for a native `text[]`/`integer[]` column, but
// broken for `jsonb` (its parser rejects array-literal syntax as invalid JSON), and this
// most schema arrays are jsonb and must be JSON-stringified before reaching the driver.
// Native Postgres array columns are explicitly allowlisted below so they retain the array
// encoding node-postgres expects.
const nativeArrayColumns = new Set([
  "rec_box_score_submissions.extra_discord_message_ids",
]);

function serializeValue(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value) && nativeArrayColumns.has(`${table}.${column}`)) return value;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}

function emptyResult(data: any = null): QueryResult {
  return { data: data as QueryResult["data"], error: null };
}

function errorResult(error: unknown): QueryResult {
  return { data: null, error };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return error;
}

class PostgresQueryBuilder {
  private mode: Mode = "select";
  private selectParts: SelectPart[] = [{ kind: "all" }];
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  private returning = false;
  private singleMode: "single" | "maybeSingle" | null = null;
  private selectOptions: SelectOptions = {};
  private upsertOptions: UpsertOptions = {};

  constructor(private readonly table: string) {
    assertIdent(table);
  }

  select(columns = "*", options: SelectOptions = this.selectOptions): this {
    this.returning = this.mode !== "select";
    this.selectParts = parseSelect(columns);
    this.selectOptions = options;
    return this;
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>, options: UpsertOptions = {}): this {
    this.mode = "upsert";
    this.payload = payload;
    this.upsertOptions = options;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: "neq", value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: "gt", value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: "gte", value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: "lt", value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: "lte", value });
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ column, op: "in", value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ column, op: "not", value, notOp: operator });
    return this;
  }

  filter(column: string, operator: string, value: unknown): this {
    if (operator === "eq") return this.eq(column, value);
    if (operator === "neq") return this.neq(column, value);
    if (operator === "gt") return this.gt(column, value);
    if (operator === "gte") return this.gte(column, value);
    if (operator === "lt") return this.lt(column, value);
    if (operator === "lte") return this.lte(column, value);
    if (operator === "is") return this.is(column, value);
    throw new Error(`Unsupported filter() operator: ${operator}`);
  }

  contains(column: string, value: unknown): this {
    this.filters.push({ column, op: "contains", value });
    return this;
  }

  or(expression: string): this {
    this.filters.push({ column: "", op: "or", value: expression });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = Math.max(0, to - from + 1);
    return this;
  }

  single(): this {
    this.singleMode = "single";
    // Fetch 2 (not 1) so finishRows can still detect and error on an unexpectedly
    // non-unique match, matching real supabase-js .single() semantics — forcing
    // LIMIT 1 here would silently return an arbitrary row instead of surfacing the bug.
    this.limitValue ??= 2;
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    this.limitValue ??= 2;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  async throwOnError(): Promise<QueryResult> {
    const result = await this.execute();
    if (result.error) throw result.error;
    return result;
  }

  private whereSql(values: unknown[]): string {
    if (!this.filters.length) return "";
    const clauses = this.filters.map((filter) => this.filterSql(filter, values));
    return ` WHERE ${clauses.join(" AND ")}`;
  }

  private filterSql(filter: Filter, values: unknown[]): string {
    if (filter.op === "or") return this.orSql(String(filter.value), values);
    const column = ident(filter.column);
    switch (filter.op) {
      case "eq":
        values.push(filter.value);
        return `${column} = $${values.length}`;
      case "neq":
        values.push(filter.value);
        return `${column} <> $${values.length}`;
      case "gt":
        values.push(filter.value);
        return `${column} > $${values.length}`;
      case "gte":
        values.push(filter.value);
        return `${column} >= $${values.length}`;
      case "lt":
        values.push(filter.value);
        return `${column} < $${values.length}`;
      case "lte":
        values.push(filter.value);
        return `${column} <= $${values.length}`;
      case "in":
        values.push(filter.value);
        return `${column} = ANY($${values.length})`;
      case "is":
        if (filter.value === null) return `${column} IS NULL`;
        if (filter.value === true) return `${column} IS TRUE`;
        if (filter.value === false) return `${column} IS FALSE`;
        throw new Error(`Unsupported is() value for ${filter.column}`);
      case "not":
        return this.notSql(column, filter.notOp ?? "", filter.value, values);
      case "contains":
        values.push(JSON.stringify(filter.value));
        return `${column} @> $${values.length}::jsonb`;
    }
  }

  private notSql(columnSql: string, operator: string, value: unknown, values: unknown[]): string {
    if (operator === "is" && value === null) return `${columnSql} IS NOT NULL`;
    if (operator === "eq") {
      values.push(value);
      return `${columnSql} <> $${values.length}`;
    }
    throw new Error(`Unsupported not() operator: ${operator}`);
  }

  private orSql(expression: string, values: unknown[]): string {
    const clauses = splitTopLevel(expression).map((part) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z]+)\.(.*)$/.exec(part);
      if (!match) throw new Error(`Unsupported or() expression: ${part}`);
      const [, column, op, rawValue] = match;
      if (op === "eq") {
        values.push(rawValue);
        return `${ident(column)} = $${values.length}`;
      }
      if (op === "is" && rawValue === "null") return `${ident(column)} IS NULL`;
      if (op === "in") {
        const valuesList = rawValue.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
        values.push(valuesList);
        return `${ident(column)} = ANY($${values.length})`;
      }
      throw new Error(`Unsupported or() operator: ${op}`);
    });
    return `(${clauses.join(" OR ")})`;
  }

  private orderSql(): string {
    if (!this.orders.length) return "";
    return ` ORDER BY ${this.orders.map((order) => `${ident(order.column)} ${order.ascending ? "ASC" : "DESC"}`).join(", ")}`;
  }

  private limitSql(values: unknown[]): string {
    const parts: string[] = [];
    if (this.limitValue != null) {
      values.push(this.limitValue);
      parts.push(`LIMIT $${values.length}`);
    }
    if (this.offsetValue != null) {
      values.push(this.offsetValue);
      parts.push(`OFFSET $${values.length}`);
    }
    return parts.length ? ` ${parts.join(" ")}` : "";
  }

  private returningSql(): string {
    if (!this.returning) return "";
    const cols = selectedBaseColumns(this.selectParts);
    return ` RETURNING ${cols ? cols.map(ident).join(", ") : "*"}`;
  }

  private async execute(): Promise<QueryResult> {
    try {
      const result = await this.executeUnsafe();
      return result;
    } catch (error) {
      return errorResult(serializeError(error));
    }
  }

  private async executeUnsafe(): Promise<QueryResult> {
    if (this.mode === "select") return this.executeSelect();
    if (this.mode === "insert") return this.executeInsert(false);
    if (this.mode === "upsert") return this.executeInsert(true);
    if (this.mode === "update") return this.executeUpdate();
    return this.executeDelete();
  }

  private async executeSelect(): Promise<QueryResult> {
    const values: unknown[] = [];
    const cols = selectedBaseColumns(this.selectParts);
    const selectSql = this.selectOptions.count && this.selectOptions.head ? "count(*)::int as count" : cols ? cols.map(ident).join(", ") : "*";
    const sql = `SELECT ${selectSql} FROM ${ident(this.table)}${this.whereSql(values)}${this.orderSql()}${this.limitSql(values)}`;
    const result = await getPgPool().query(sql, values);
    if (this.selectOptions.count && this.selectOptions.head) {
      return { data: null, error: null, count: Number(result.rows[0]?.count ?? 0) };
    }
    return this.finishRows(result.rows as Array<Record<string, unknown>>);
  }

  private async executeInsert(isUpsert: boolean): Promise<QueryResult> {
    const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
    if (!rows.length) return emptyResult(this.returning ? [] : null);
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(assertIdent);
    const values: unknown[] = [];
    const tuples = rows.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(serializeValue(this.table, column, (row as Record<string, unknown>)[column] ?? null));
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const conflictColumns = (this.upsertOptions.onConflict ?? "").split(",").map((col) => col.trim()).filter(Boolean);
    const conflictSql = isUpsert ? this.upsertSql(columns, conflictColumns) : "";
    const sql = `INSERT INTO ${ident(this.table)} (${columns.map(ident).join(", ")}) VALUES ${tuples.join(", ")}${conflictSql}${this.returningSql()}`;
    const result = await getPgPool().query(sql, values);
    if (!this.returning) return emptyResult(null);
    return this.finishRows(result.rows as Array<Record<string, unknown>>);
  }

  private upsertSql(columns: string[], conflictColumns: string[]): string {
    if (!conflictColumns.length) return " ON CONFLICT DO NOTHING";
    const target = `(${conflictColumns.map(ident).join(", ")})`;
    if (this.upsertOptions.ignoreDuplicates) return ` ON CONFLICT ${target} DO NOTHING`;
    const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
    if (!updateColumns.length) return ` ON CONFLICT ${target} DO NOTHING`;
    return ` ON CONFLICT ${target} DO UPDATE SET ${updateColumns.map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`).join(", ")}`;
  }

  private async executeUpdate(): Promise<QueryResult> {
    const row = (this.payload ?? {}) as Record<string, unknown>;
    const columns = Object.keys(row).map(assertIdent);
    const values: unknown[] = [];
    const setSql = columns.map((column) => {
      values.push(serializeValue(this.table, column, row[column]));
      return `${ident(column)} = $${values.length}`;
    });
    const sql = `UPDATE ${ident(this.table)} SET ${setSql.join(", ")}${this.whereSql(values)}${this.returningSql()}`;
    const result = await getPgPool().query(sql, values);
    if (!this.returning) return emptyResult(null);
    return this.finishRows(result.rows as Array<Record<string, unknown>>);
  }

  private async executeDelete(): Promise<QueryResult> {
    const values: unknown[] = [];
    const sql = `DELETE FROM ${ident(this.table)}${this.whereSql(values)}${this.returningSql()}`;
    const result = await getPgPool().query(sql, values);
    if (!this.returning) return emptyResult(null);
    return this.finishRows(result.rows as Array<Record<string, unknown>>);
  }

  private async finishRows(rows: Array<Record<string, unknown>>): Promise<QueryResult> {
    const hydrated = await this.hydrateRelations(rows);
    const projected = hydrated.map((row) => projectRow(row, this.selectParts));
    if (this.singleMode === "single") {
      if (projected.length !== 1) return errorResult({ message: `Expected one row, received ${projected.length}.` });
      return emptyResult(projected[0]);
    }
    if (this.singleMode === "maybeSingle") {
      if (projected.length > 1) return errorResult({ message: `Expected zero or one row, received ${projected.length}.` });
      return emptyResult(projected[0] ?? null);
    }
    return emptyResult(projected);
  }

  private async hydrateRelations(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
    const relationParts = this.selectParts.filter((part): part is Extract<SelectPart, { kind: "relation" }> => part.kind === "relation");
    if (!relationParts.length || !rows.length) return rows;
    const out = rows.map((row) => ({ ...row }));
    for (const relation of relationParts) {
      const fk = relationKey(relation.alias);
      const ids = [...new Set(out.map((row) => row[fk]).filter((value): value is string => typeof value === "string"))];
      if (!ids.length) {
        for (const row of out) row[relation.alias] = null;
        continue;
      }
      const cols = selectedBaseColumns(relation.columns);
      const selectSql = cols ? [...new Set(["id", ...cols])].map(ident).join(", ") : "*";
      const result = await getPgPool().query(`SELECT ${selectSql} FROM ${ident(relation.table)} WHERE "id" = ANY($1)`, [ids]);
      const byId = new Map<string, Record<string, unknown>>();
      for (const relatedRow of result.rows as Array<Record<string, unknown>>) {
        byId.set(String(relatedRow.id), projectRow(relatedRow, relation.columns));
      }
      for (const row of out) row[relation.alias] = typeof row[fk] === "string" ? byId.get(String(row[fk])) ?? null : null;
    }
    return out;
  }
}

// Only RPCs declared `returns table (...)` / `returns setof ...` belong here — calling them via
// `SELECT * FROM fn(...)` turns each result row into a row of `result.rows`. RPCs that `returns
// jsonb` (or another scalar) must NOT be listed: `rec_roster_league_conferences` returns a single
// jsonb value, so it needs the `SELECT fn(...) AS data` branch below to unwrap it correctly —
// listing it here wrapped the payload as `[{ rec_roster_league_conferences: {...} }]` instead of
// `{ conferences: [...] }`, which made every league (not just CFB) appear to have zero conferences.
const tableRpcs = new Set(["rec_eos_rank_payouts"]);

async function executeRpc(name: string, args: Record<string, unknown> = {}): Promise<QueryResult> {
  try {
    assertIdent(name);
    const values = Object.values(args);
    const namedArgs = Object.keys(args).map((key, index) => `${ident(key)} => $${index + 1}`).join(", ");
    const sql = tableRpcs.has(name)
      ? `SELECT * FROM ${ident(name)}(${namedArgs})`
      : `SELECT ${ident(name)}(${namedArgs}) AS data`;
    const result = await getPgPool().query(sql, values);
    if (tableRpcs.has(name)) return emptyResult(result.rows);
    return emptyResult(result.rows[0]?.data ?? null);
  } catch (error) {
    return errorResult(serializeError(error));
  }
}

function rpc(name: string, args: Record<string, unknown> = {}) {
  const run = () => executeRpc(name, args);
  return {
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
      return run().then(onfulfilled, onrejected);
    },
    async throwOnError(): Promise<QueryResult> {
      const result = await run();
      if (result.error) throw result.error;
      return result;
    }
  };
}

export const supabase = {
  from(table: string) {
    return new PostgresQueryBuilder(table);
  },
  rpc,
  storage: storageClient.storage
};
