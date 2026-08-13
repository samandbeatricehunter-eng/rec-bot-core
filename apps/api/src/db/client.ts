import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export function getPgPool() {
  if (!env.REC_DATABASE_URL) {
    throw new Error("REC_DATABASE_URL is required before using the API database client.");
  }
  if (!pool) {
    // Supabase session pooler caps concurrent clients (often 15). Stay under that limit so
    // parallel Drizzle + raw pg queries don't hit EMAXCONNSESSION under load.
    pool = new Pool({
      connectionString: env.REC_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export function getDrizzleDb() {
  if (!db) {
    const pool = getPgPool();
    db = drizzle(pool, { schema });
  }
  return db!;
}

export type RecDrizzleDb = NodePgDatabase<typeof schema>;
