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
  // Web dashboard (apps/web) auth — session signing, and server-side guild role/permission
  // lookups for requests coming from the browser. Optional so the API still boots without
  // these configured; routes that need them fail closed via the zod checks in their own modules.
  ACTIVITY_JWT_SECRET: z.string().optional(),
  // Same bot token apps/bot authenticates with (DISCORD_TOKEN there) — one source of truth
  // instead of a second env var that has to be kept in sync across every environment.
  DISCORD_TOKEN: z.string().optional(),
  // Cloudflare Stream (web highlight uploads). Optional so the API boots without Stream;
  // direct-upload / webhook / cleanup call sites fail closed when unset.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: z.string().optional(),
  CLOUDFLARE_STREAM_ALLOWED_ORIGINS: z.string().optional()
});
export const env = EnvSchema.parse(process.env);
