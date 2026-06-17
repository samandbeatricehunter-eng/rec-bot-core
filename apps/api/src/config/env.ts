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
  EA_MCA_CLIENT_ID: z.string().default("MCA_26_COMP_APP"),
  EA_MCA_CLIENT_SECRET: z.string().optional(),
  EA_MCA_AUTH_SOURCE: z.coerce.number().int().default(317239),
  EA_MCA_MACHINE_KEY: z.string().default("444d362e8e067fe2"),
  EA_MCA_REDIRECT_URL: z.string().default("http://127.0.0.1/success"),
  EA_MCA_TWO_DIGIT_YEAR: z.string().default("26"),
  EA_MCA_FULL_YEAR: z.string().default("2026"),
  EA_MCA_DEFAULT_CONSOLE: z.enum(["xone", "ps4", "pc", "ps5", "xbsx", "stadia"]).default("pc")
});
export const env = EnvSchema.parse(process.env);
