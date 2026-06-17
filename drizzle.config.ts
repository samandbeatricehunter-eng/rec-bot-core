import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: resolve(rootDir, "apps/api/src/db/schema.ts"),
  out: resolve(rootDir, "supabase/drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.REC_DATABASE_URL ?? "postgres://rec:rec@localhost:5432/rec"
  }
});
