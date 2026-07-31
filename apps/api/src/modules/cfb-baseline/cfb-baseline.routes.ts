// CFB Baseline routes — dataset registry and league copy flow.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import {
  listCfbDatasets,
  getCfbDataset,
  createCfbDataset,
  updateCfbDataset,
  deleteCfbDataset,
  listCfbBaselineTeams,
  listCfbBaselinePlayers,
  getCfbBaselinePlayerAttributes,
  applyCfbBaselineToLeague,
  type CfbDatasetCreateInput,
  type CfbDatasetUpdateInput,
  type ApplyBaselineToLeagueInput,
} from "./cfb-baseline.service.js";

export async function cfbBaselineRoutes(app: FastifyInstance) {
  // Dataset registry (commissioner/admin only)
  app.post("/v1/cfb-baseline/datasets", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const body = z
        .object({
          game_title: z.string().min(1),
          provider: z.string().min(1),
          published_date: z.string().date(),
          source_version: z.string().min(1),
          checksum: z.string().min(1),
          attribution_config: z.record(z.unknown()).optional(),
          legal_review_notes: z.string().optional(),
        })
        .parse(request.body);
      const dataset = await createCfbDataset(body as CfbDatasetCreateInput);
      return reply.send(dataset);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/cfb-baseline/datasets", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const datasets = await listCfbDatasets();
      return reply.send({ datasets });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/cfb-baseline/datasets/:datasetId", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { datasetId } = z.object({ datasetId: z.string().uuid() }).parse(request.params);
      const dataset = await getCfbDataset(datasetId);
      if (!dataset) return reply.code(404).send({ error: "Dataset not found" });
      return reply.send(dataset);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/v1/cfb-baseline/datasets/:datasetId", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { datasetId } = z.object({ datasetId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          game_title: z.string().min(1).optional(),
          provider: z.string().min(1).optional(),
          published_date: z.string().date().optional(),
          source_version: z.string().min(1).optional(),
          checksum: z.string().min(1).optional(),
          attribution_config: z.record(z.unknown()).optional(),
          legal_review_status: z.enum(["pending", "approved", "rejected"]).optional(),
          legal_review_notes: z.string().optional(),
          is_active: z.boolean().optional(),
        })
        .parse(request.body);
      const dataset = await updateCfbDataset(datasetId, body as CfbDatasetUpdateInput);
      return reply.send(dataset);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/v1/cfb-baseline/datasets/:datasetId", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { datasetId } = z.object({ datasetId: z.string().uuid() }).parse(request.params);
      await deleteCfbDataset(datasetId);
      return reply.send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Browse baseline teams
  app.get("/v1/cfb-baseline/datasets/:datasetId/teams", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "member",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { datasetId } = z.object({ datasetId: z.string().uuid() }).parse(request.params);
      const teams = await listCfbBaselineTeams(datasetId);
      return reply.send({ teams });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Browse baseline players
  app.get("/v1/cfb-baseline/datasets/:datasetId/players", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "member",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { datasetId } = z.object({ datasetId: z.string().uuid() }).parse(request.params);
      const query = z.object({ team_id: z.string().uuid().optional() }).parse(request.query);
      const players = await listCfbBaselinePlayers(datasetId, query.team_id);
      return reply.send({ players });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Player attributes
  app.get("/v1/cfb-baseline/players/:playerId/attributes", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => "system",
        permission: "member",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const { playerId } = z.object({ playerId: z.string().uuid() }).parse(request.params);
      const attrs = await getCfbBaselinePlayerAttributes(playerId);
      return reply.send({ attributes: attrs });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Apply baseline to league (commissioner action)
  app.post("/v1/cfb-baseline/apply-to-league", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: (r: any) => r.body?.league_id,
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");
      const body = z
        .object({
          league_id: z.string().uuid(),
          dataset_id: z.string().uuid(),
        })
        .parse(request.body);
      const result = await applyCfbBaselineToLeague({
        league_id: body.league_id,
        dataset_id: body.dataset_id,
        requested_by_user_id: auth.discordId,
      } as ApplyBaselineToLeagueInput);
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}