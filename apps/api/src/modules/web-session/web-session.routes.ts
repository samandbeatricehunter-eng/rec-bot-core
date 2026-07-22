import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { sendError } from "../../lib/errors.js";
import { ExchangeAppHandoffSchema, MintWebSessionSchema } from "./web-session.schemas.js";
import { exchangeAppHandoff, mintAppHandoff, mintWebSession } from "./web-session.service.js";

export async function webSessionRoutes(app: FastifyInstance) {
  app.post("/v1/web-session/mint", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await mintWebSession(MintWebSessionSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/web-session/handoff/mint", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await mintAppHandoff(MintWebSessionSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/web-session/handoff/exchange", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = ExchangeAppHandoffSchema.parse(request.body);
      return reply.send(
        await exchangeAppHandoff({
          ...body,
          authUserId: session.authUserId,
          email: session.email,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}