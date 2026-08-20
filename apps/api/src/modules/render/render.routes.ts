import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { verifyMatchupRenderToken } from "../../lib/render-token.js";
import { getMatchupCardRenderData } from "../hub/hub.service.js";

// Unauthenticated (token-gated, 60s expiry) -- backs apps/site's chromeless
// /render/matchup/:gameId route, which the Playwright screenshot pipeline
// (apps/api/src/lib/matchup-render.ts) navigates to headlessly. No signed-in viewer exists
// at render time, so a normal session/bot auth check can't apply here.
export async function renderRoutes(app: FastifyInstance) {
  app.get("/v1/render/matchup/:gameId", async (request, reply) => {
    try {
      const params = z.object({ gameId: z.string().min(1) }).parse(request.params);
      const query = z.object({ token: z.string().min(1) }).parse(request.query);
      if (!verifyMatchupRenderToken(params.gameId, query.token)) {
        return reply.code(403).send({ error: "Invalid or expired render token." });
      }
      return reply.send(await getMatchupCardRenderData(params.gameId));
    } catch (error) { return sendError(reply, error); }
  });
}
