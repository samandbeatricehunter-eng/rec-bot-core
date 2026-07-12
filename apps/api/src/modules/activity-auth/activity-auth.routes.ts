import type { FastifyInstance } from "fastify";
import { sendError } from "../../lib/errors.js";
import { ExchangeActivityAuthSchema } from "./activity-auth.schemas.js";
import { exchangeActivityAuthCode } from "./activity-auth.service.js";

export async function activityAuthRoutes(app: FastifyInstance) {
  // Unauthenticated by design — this IS the login entry point for the Activity, so it
  // can't require a session yet. Rate-limited instead of key/session-gated, since it's
  // now reachable by anyone who loads the Activity.
  app.post(
    "/v1/activity/auth/exchange",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        return reply.send(await exchangeActivityAuthCode(ExchangeActivityAuthSchema.parse(request.body)));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
