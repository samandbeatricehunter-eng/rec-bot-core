import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { MintWebSessionSchema } from "./web-session.schemas.js";
import { mintWebSession } from "./web-session.service.js";

export async function webSessionRoutes(app: FastifyInstance) {
  // Bot-only, like every other route — the bot mints a session right after it verifies
  // the click via a real Discord interaction and the commissioner/co-commissioner check,
  // then embeds the token in the Link button's URL.
  app.post("/v1/web-session/mint", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await mintWebSession(MintWebSessionSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
