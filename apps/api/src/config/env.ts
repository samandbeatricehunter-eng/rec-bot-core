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
  // Main app pool — points at Supabase's transaction-mode pooler (port 6543). Transaction
  // mode multiplexes many app clients onto a small shared set of backend connections instead
  // of holding one dedicated backend connection per client, so this pool no longer competes
  // for the session-mode pooler's low client cap (EMAXCONNSESSION under import + deploy load).
  REC_DATABASE_URL: z.string().url().optional(),
  // A LISTEN/NOTIFY connection (chat-database-listener.ts) needs a real session-mode
  // connection — transaction-mode pooling reclaims the backend connection between
  // transactions, so notifications sent later never reach a listener held on it. This single
  // dedicated connection uses only one of the session pooler's client slots. Falls back to
  // REC_DATABASE_URL if unset (dev, or before this var is configured in Railway).
  REC_DATABASE_URL_SESSION: z.string().url().optional(),
  REC_INTERNAL_API_KEY: z.string().min(1).optional(),
  // Web dashboard (apps/web) auth — session signing, and server-side guild role/permission
  // lookups for requests coming from the browser. Optional so the API still boots without
  // these configured; routes that need them fail closed via the zod checks in their own modules.
  ACTIVITY_JWT_SECRET: z.string().min(1).optional(),
  // Same bot token apps/bot authenticates with (DISCORD_TOKEN there) — one source of truth
  // instead of a second env var that has to be kept in sync across every environment.
  // Also accept DISCORD_BOT_TOKEN (Railway naming used on some services).
  DISCORD_TOKEN: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.DISCORD_BOT_TOKEN),
    z.string().optional(),
  ),
  // Cloudflare Stream (web highlight uploads). Optional so the API boots without Stream;
  // direct-upload / webhook / cleanup call sites fail closed when unset.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_ACCOUNT_HASH: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: z.string().optional(),
  CLOUDFLARE_STREAM_ALLOWED_ORIGINS: z.string().optional(),
  // Base URL the custom-player card renders are served from (Cloudflare Images delivery host,
  // e.g. https://imagedelivery.net/<account-hash>). Optional: empty means the API writes the
  // local /assets/custom-player-renders path into rec_players.photo_url (dev).
  CUSTOM_PLAYER_RENDER_BASE_URL: z.string().optional(),
  // Stripe billing (site subscriptions). Optional so the API boots without Stripe;
  // checkout / portal / webhook routes fail closed when unset.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_GOLD: z.string().optional(),
  STRIPE_PRICE_PLATINUM: z.string().optional(),
  STRIPE_PRICE_GOLD_ANNUAL: z.string().optional(),
  STRIPE_PRICE_PLATINUM_ANNUAL: z.string().optional(),
  SITE_PUBLIC_URL: z.string().url().default("https://rec-leagues.com"),
  // Signs the short-lived token the Playwright matchup-card render pipeline uses to fetch
  // render data without a signed-in viewer (apps/api/src/lib/render-token.ts). Optional --
  // falls back to SUPABASE_SERVICE_ROLE_KEY (always set) so this never needs a separate secret.
  MATCHUP_RENDER_SECRET: z.string().optional(),
  API_CORS_ALLOWED_ORIGINS: z.string().optional(),
  // Web Push (Account page notification toggle). Optional so the API boots without it;
  // /v1/push/public-key returns null and the frontend just hides the button.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:samandbeatricehunter@gmail.com"),
  // Discord Activity hub (apps/web) — used when exchanging a site session for a hub JWT.
  WEB_APP_URL: z.string().url().optional(),
  // EA / Madden direct import (companion-app alternative). All optional so the API boots
  // without them; the EA import routes report "not configured" until EA_CLIENT_SECRET is set.
  // Defaults for the non-secret values live in modules/madden-ea/ea-constants.ts.
  //
  // Accept both the EA_* names and the EA_MCA_* aliases (Railway currently stores the latter),
  // mirroring how DISCORD_TOKEN falls back to DISCORD_BOT_TOKEN.
  EA_CLIENT_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_CLIENT_SECRET),
    z.string().optional(),
  ),
  EA_CLIENT_ID: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_CLIENT_ID),
    z.string().optional(),
  ),
  EA_YEAR: z.string().optional(),
  EA_TWO_DIGIT_YEAR: z.string().optional(),
  EA_AUTH_SOURCE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_AUTH_SOURCE),
    z.string().optional(),
  ),
  EA_MACHINE_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_MACHINE_KEY),
    z.string().optional(),
  ),
  EA_REDIRECT_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_REDIRECT_URL),
    z.string().optional(),
  ),
  EA_BLAZE_COMPONENT_NAME: z.string().optional(),
  EA_BLAZE_BASE_URL: z.string().optional(),
  // Overrides a single export command name, e.g. EA_EXPORT_TEAMS=FranchiseMode_GetLeagueTeamsExport.
  EA_EXPORT_TEAMS: z.string().optional(),
  EA_EXPORT_STANDINGS: z.string().optional(),
  EA_EXPORT_WEEKLY_SCHEDULE: z.string().optional(),
  EA_EXPORT_RUSHING_STATS: z.string().optional(),
  EA_EXPORT_TEAM_STATS: z.string().optional(),
  EA_EXPORT_PUNTING_STATS: z.string().optional(),
  EA_EXPORT_RECEIVING_STATS: z.string().optional(),
  EA_EXPORT_DEFENSIVE_STATS: z.string().optional(),
  EA_EXPORT_KICKING_STATS: z.string().optional(),
  EA_EXPORT_PASSING_STATS: z.string().optional(),
  EA_EXPORT_TEAM_ROSTER: z.string().optional(),
  // 64-char hex (32 bytes) AES-256-GCM key for the EA token vault. Without it, tokens
  // cannot be stored and the EA import stays disabled. Railway stores it as EA_MCA_TOKEN_ENC_KEY.
  EA_TOKEN_ENC_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : process.env.EA_MCA_TOKEN_ENC_KEY),
    z.string().optional(),
  ),
  EA_REFRESHER_ENABLED: z.string().optional(),
});
export const env = EnvSchema.parse(process.env);

export function shouldMigrateMirroredHighlightsOnBoot(): boolean {
  const raw = String(process.env.MIGRATE_MIRRORED_HIGHLIGHTS_ON_BOOT ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
