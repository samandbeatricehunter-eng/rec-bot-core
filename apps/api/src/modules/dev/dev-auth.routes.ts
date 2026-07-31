import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { ApiError, sendError } from "../../lib/errors.js";

// Local-dev-only session mint — lets a developer (or an assistant driving the browser) land on
// an authenticated page without ever typing a password. Never reachable outside a machine that
// explicitly opts in: NODE_ENV must not be "production" AND DEV_AUTH_BYPASS_ENABLED must be set
// to "true" AND the caller must present DEV_AUTH_BYPASS_SECRET. All three are read straight off
// process.env (not the shared Zod schema) so there is no way to accidentally wire them into the
// Railway production service's config by following the pattern of a "real" env var — they only
// do anything if someone deliberately sets them in a local .env.
//
// If any gate fails, this route is never registered at all — a request to it in production
// 404s exactly like any other unknown path, it does not exist as code that could be reached by
// bypassing a check.
function devBypassConfig(): { secret: string; email: string } | null {
  if (env.NODE_ENV === "production") return null;
  if (String(process.env.DEV_AUTH_BYPASS_ENABLED ?? "").toLowerCase() !== "true") return null;
  const secret = process.env.DEV_AUTH_BYPASS_SECRET;
  const email = process.env.DEV_AUTH_BYPASS_EMAIL;
  if (!secret || !email) return null;
  return { secret, email };
}

export async function devAuthRoutes(app: FastifyInstance) {
  const config = devBypassConfig();
  if (!config) return;

  app.log.warn(
    { email: config.email },
    "[dev-auth-bypass] ENABLED — /v1/dev/auth-bypass will mint sessions. This must never run against a production deployment.",
  );

  // A dedicated admin client, not the shared one from lib/supabase.ts — this one exists only
  // to call auth.admin, and only while the route above is registered.
  const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  app.post("/v1/dev/auth-bypass", async (request, reply) => {
    try {
      const presented = (request.headers["x-dev-bypass-secret"] as string | undefined) ?? "";
      // Fixed-time-ish comparison isn't critical here (this never runs in production and the
      // secret is a local-only shared value, not a real credential), but there's no reason not
      // to just compare directly since both are short-lived local strings.
      if (presented !== config.secret) throw new ApiError(403, "Forbidden.");

      const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: config.email });
      if (link.error || !link.data) throw new ApiError(500, "Failed to generate a dev session link.", link.error);
      const hashedToken = link.data.properties?.hashed_token;
      if (!hashedToken) throw new ApiError(500, "No token returned from Supabase.");

      const verified = await supabaseAdmin.auth.verifyOtp({ type: "email", token_hash: hashedToken });
      if (verified.error || !verified.data.session) throw new ApiError(500, "Failed to verify the dev session.", verified.error);

      return reply.send({
        accessToken: verified.data.session.access_token,
        refreshToken: verified.data.session.refresh_token,
        email: config.email,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
