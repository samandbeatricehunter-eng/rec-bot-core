import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export function getDrizzleDb() {
  if (!env.REC_DATABASE_URL) {
    throw new Error("REC_DATABASE_URL is required before using the Drizzle database client.");
  }
  if (!pool) {
    pool = new Pool({ connectionString: env.REC_DATABASE_URL });
    db = drizzle(pool, { schema });
  }
  return db!;
}

export type RecDrizzleDb = NodePgDatabase<typeof schema>;
