// Minimal in-memory fake of the custom Postgres query builder in lib/supabase.ts, for tests
// that need to assert query *semantics* (e.g. season isolation) without a live database.
// Supports only the read surface the query helpers use: select/eq/in/lte/gte/lt/gt/is/not/or/
// order/limit/single/maybeSingle, plus being awaitable to { data, error }.
//
// It is deliberately small — it is NOT a general Postgres emulator. Add operators here only as
// tests need them.

type Row = Record<string, any>;
type QueryResult = { data: any; error: any; count?: number };

type Constraint = (row: Row) => boolean;

function compare(a: any, b: any): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  private constraints: Constraint[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private countHead = false;

  constructor(private readonly rows: Row[]) {}

  select(_columns = "*", options: { count?: string; head?: boolean } = {}): this {
    this.countHead = Boolean(options.count && options.head);
    return this;
  }

  eq(column: string, value: any): this {
    this.constraints.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: any): this {
    this.constraints.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: any[]): this {
    this.constraints.push((row) => values.includes(row[column]));
    return this;
  }

  lte(column: string, value: any): this {
    this.constraints.push((row) => row[column] != null && row[column] <= value);
    return this;
  }

  gte(column: string, value: any): this {
    this.constraints.push((row) => row[column] != null && row[column] >= value);
    return this;
  }

  lt(column: string, value: any): this {
    this.constraints.push((row) => row[column] != null && row[column] < value);
    return this;
  }

  gt(column: string, value: any): this {
    this.constraints.push((row) => row[column] != null && row[column] > value);
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.constraints.push((row) => row[column] === value);
    return this;
  }

  not(column: string, operator: string, value: any): this {
    if (operator === "is") {
      this.constraints.push((row) => row[column] !== value);
    } else if (operator === "eq") {
      this.constraints.push((row) => row[column] !== value);
    } else {
      throw new Error(`fake-supabase: unsupported not() operator ${operator}`);
    }
    return this;
  }

  // Mirrors the real builder's `col.op.value,col.op.value` OR grammar (eq / is.null / in).
  or(expression: string): this {
    const clauses = splitTopLevel(expression).map((part): Constraint => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z]+)\.(.*)$/.exec(part);
      if (!match) throw new Error(`fake-supabase: unsupported or() expression ${part}`);
      const [, column, op, raw] = match;
      if (op === "eq") return (row) => String(row[column]) === raw;
      if (op === "is" && raw === "null") return (row) => row[column] == null;
      if (op === "in") {
        const list = raw.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
        return (row) => list.includes(String(row[column]));
      }
      throw new Error(`fake-supabase: unsupported or() operator ${op}`);
    });
    this.constraints.push((row) => clauses.some((clause) => clause(row)));
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

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  private resolve(): QueryResult {
    let out = this.rows.filter((row) => this.constraints.every((constraint) => constraint(row)));
    for (const order of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => (order.ascending ? 1 : -1) * compare(a[order.column], b[order.column]));
    }
    if (this.countHead) return { data: null, error: null, count: out.length };
    if (this.limitValue != null) out = out.slice(0, this.limitValue);
    if (this.singleMode === "single") {
      if (out.length !== 1) return { data: null, error: { message: `Expected one row, received ${out.length}.` } };
      return { data: out[0], error: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (out.length > 1) return { data: null, error: { message: `Expected zero or one row, received ${out.length}.` } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
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

export function createFakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      return new FakeQueryBuilder(tables[table] ?? []);
    },
  };
}
