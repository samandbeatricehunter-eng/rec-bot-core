import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { renderMatchupCardPng } from "../../lib/matchup-render.js";
import { renderPlayerOfWeekPng } from "../../lib/player-of-week-render.js";
import { renderNflPlayoffBracketPng } from "../../lib/nfl-playoff-bracket-render.js";
import { renderWeeklyMatchupBoardPng } from "../../lib/weekly-matchup-board-render.js";
import { verifyMatchupRenderToken, verifyNflPlayoffBracketRenderToken, verifyPlayerOfWeekRenderToken, verifyWeeklyMatchupBoardRenderToken } from "../../lib/render-token.js";
import { getMatchupCardRenderData, getWeeklyMatchupBoardRenderData } from "../hub/hub.service.js";
import { getPlayerOfWeekRenderData } from "../league-week/player-of-week-award.service.js";
import { getNflPlayoffBracketRenderData } from "../standings/nfl-bracket.service.js";

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

  app.get("/v1/render/player-of-week/:storyId", async (request, reply) => {
    try {
      const params = z.object({ storyId: z.string().min(1) }).parse(request.params);
      const query = z.object({ token: z.string().min(1) }).parse(request.query);
      if (!verifyPlayerOfWeekRenderToken(params.storyId, query.token)) {
        return reply.code(403).send({ error: "Invalid or expired render token." });
      }
      return reply.send(await getPlayerOfWeekRenderData(params.storyId));
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/render/player-of-week/:storyId/debug-png", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const params = z.object({ storyId: z.string().min(1) }).parse(request.params);
      const png = await renderPlayerOfWeekPng(params.storyId);
      return reply.header("content-type", "image/png").send(png);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/render/nfl-playoff-bracket/:leagueId", async (request, reply) => {
    try {
      const params = z.object({ leagueId: z.string().min(1) }).parse(request.params);
      const query = z.object({ token: z.string().min(1) }).parse(request.query);
      if (!verifyNflPlayoffBracketRenderToken(params.leagueId, query.token)) {
        return reply.code(403).send({ error: "Invalid or expired render token." });
      }
      return reply.send(await getNflPlayoffBracketRenderData(params.leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/render/nfl-playoff-bracket/:leagueId/debug-png", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const params = z.object({ leagueId: z.string().min(1) }).parse(request.params);
      const png = await renderNflPlayoffBracketPng(params.leagueId);
      return reply.header("content-type", "image/png").send(png);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/render/weekly-matchup-board/:leagueId/:weekNumber", async (request, reply) => {
    try {
      const params = z.object({ leagueId: z.string().min(1), weekNumber: z.coerce.number().int() }).parse(request.params);
      const query = z.object({ token: z.string().min(1) }).parse(request.query);
      if (!verifyWeeklyMatchupBoardRenderToken(params.leagueId, params.weekNumber, query.token)) {
        return reply.code(403).send({ error: "Invalid or expired render token." });
      }
      return reply.send(await getWeeklyMatchupBoardRenderData(params.leagueId, params.weekNumber));
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/render/weekly-matchup-board/:leagueId/:weekNumber/debug-png", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const params = z.object({ leagueId: z.string().min(1), weekNumber: z.coerce.number().int() }).parse(request.params);
      const png = await renderWeeklyMatchupBoardPng(params.leagueId, params.weekNumber);
      return reply.header("content-type", "image/png").send(png);
    } catch (error) { return sendError(reply, error); }
  });
}
