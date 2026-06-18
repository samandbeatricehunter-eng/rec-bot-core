import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { CreateLeagueSchema, RegisterServerSchema, UpdateServerRoutesSchema } from "./setup.schemas.js";
import { createLeagueForServer } from "./setup-season.service.js";
import { registerServer, updateServerRoutes, getLeagueConfigAsDraft, updateLeagueConfig, deleteLeagueData } from "./setup.service.js";

export async function setupRoutes(app: FastifyInstance) {
  app.post("/v1/setup/server/register", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await registerServer(RegisterServerSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createLeagueForServer(CreateLeagueSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/v1/setup/server/routes", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateServerRoutes(UpdateServerRoutesSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/config", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getLeagueConfigAsDraft((request.body as any).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/config/update", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateLeagueConfig(CreateLeagueSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/delete", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await deleteLeagueData(request.body as any));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
