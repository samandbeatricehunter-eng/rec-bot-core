import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });
dotenv.config({ path: path.resolve(currentDir, "../../.env"), override: false });
const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  REC_CORE_API_URL: z.string().url().default("http://localhost:3000"),
  REC_INTERNAL_API_KEY: z.string().optional(),
  WEB_APP_URL: z.string().url().optional(),
  // Public site (apps/site) — Discord-only /app users get login/signup here.
  SITE_PUBLIC_URL: z.string().url().default("https://rec-leagues.com"),
});
export const env = EnvSchema.parse(process.env);
