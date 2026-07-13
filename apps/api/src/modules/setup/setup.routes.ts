import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { CreateLeagueSchema, GetLeagueTeamConferencesSchema, RegisterServerSchema, UpdateServerRoutesSchema, UpdateTeamConferenceSchema } from "./setup.schemas.js";

const DeleteLeagueSchema = z.object({
  guildId: z.string().min(1),
  requestedByDiscordId: z.string().min(1).optional(),
  confirmationText: z.string().min(1),
});
import { createLeagueForServer } from "./setup-season.service.js";
import {
  registerServer,
  updateServerRoutes,
  getLeagueConfigAsDraft,
  updateLeagueConfig,
  deleteLeagueData,
  getLeagueTeamConferences,
  updateTeamConference
} from "./setup.service.js";

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
      const body = DeleteLeagueSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") body.requestedByDiscordId = auth.discordId;
      return reply.send(await deleteLeagueData(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/teams/conferences", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = GetLeagueTeamConferencesSchema.parse(request.body);
      return reply.send(await getLeagueTeamConferences(input.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/teams/conference", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateTeamConference(UpdateTeamConferenceSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
