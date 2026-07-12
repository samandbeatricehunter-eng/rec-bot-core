import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";


const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });
dotenv.config({ path: path.resolve(currentDir, "../../.env"), override: false });

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REC_DATABASE_URL: z.string().url().optional(),
  REC_INTERNAL_API_KEY: z.string().optional(),
  // Discord Activity auth (apps/web) — code exchange, session signing, and server-side
  // guild role/permission lookups. Optional so the API still boots without the Activity
  // configured; routes that need them fail closed via the zod checks in their own modules.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  ACTIVITY_JWT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional()
});
export const env = EnvSchema.parse(process.env);
