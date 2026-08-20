import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { renderMatchupCardPng } from "../../lib/matchup-render.js";
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

  // Internal-API-key-gated smoke test for the Chromium/Playwright deploy itself -- this is the
  // one step in the scheduling rebuild with real infra risk (Chromium under nixpacks/Railway),
  // so this exists to confirm a screenshot actually comes back before Phase 1 wires the render
  // pipeline into real game-channel posts. Not used by any production flow.
  app.get("/v1/render/matchup/:gameId/debug-png", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const params = z.object({ gameId: z.string().min(1) }).parse(request.params);
      const png = await renderMatchupCardPng(params.gameId);
      return reply.header("content-type", "image/png").send(png);
    } catch (error) { return sendError(reply, error); }
  });
}
