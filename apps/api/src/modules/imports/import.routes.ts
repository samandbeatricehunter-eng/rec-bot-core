import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import {
  CreateImportJobSchema,
  UpdateEndpointAttemptSchema,
  UpdateImportJobStatusSchema
} from "./import.schemas.js";
import {
  createImportJob,
  getImportJob,
  getLatestImportJobForGuild,
  listImportJobsForGuild,
  updateEndpointAttempt,
  updateImportJobStatus
} from "./import.service.js";

export async function importRoutes(app: FastifyInstance) {
  app.post("/v1/imports/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createImportJob(CreateImportJobSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/:jobId", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { jobId } = request.params as { jobId: string };
      return reply.send(await getImportJob(jobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/guild/:guildId/status", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      return reply.send(await getLatestImportJobForGuild(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/guild/:guildId/history", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      return reply.send(await listImportJobsForGuild(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/status", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateImportJobStatus(UpdateImportJobStatusSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/endpoint", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateEndpointAttempt(UpdateEndpointAttemptSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
