import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import {
  CreateImportJobSchema,
  ImportProfileSchema,
  UpdateEndpointAttemptSchema,
  UpdateImportJobStatusSchema
} from "./import.schemas.js";
import { cancelActiveImportForGuild, createImportJob, getActiveImportJobForGuild, resolveImportProfileForGuild } from "./import-locked.service.js";
import { executeImportEndpoint, executeImportJob } from "./import-executor.service.js";
import {
  approveImportPreview,
  cancelImportJob,
  generateImportPreview
} from "./import-preview.service.js";
import {
  ignoreMissingImportedGameScore,
  listMissingImportedGameScores,
  manuallyResolveImportedGameScore,
  requestMissingGameScoreReimport
} from "./import-resolution.service.js";
import {
  getImportJob,
  getLatestImportJobForGuild,
  listImportJobsForGuild,
  updateEndpointAttempt,
  updateImportJobStatus
} from "./import.service.js";
import { listImportRawFieldDictionary } from "./raw-field-dictionary.service.js";
import { getImportFieldMap, getStatDefinitionsCatalog, getUnmappedStatKeys } from "./stat-definitions.service.js";

const ImportJobIdBodySchema = z.object({ importJobId: z.string().uuid() });
const ResolveImportProfileBodySchema = z.object({
  guildId: z.string().min(1),
  requestedProfile: ImportProfileSchema.optional().nullable()
});
const StageImportEndpointBodySchema = z.object({
  importJobId: z.string().uuid(),
  endpointKey: z.string().min(1)
});
const CancelImportJobSchema = z.object({ importJobId: z.string().uuid(), reason: z.string().optional().nullable() });
const CancelActiveImportSchema = z.object({ guildId: z.string().min(1), reason: z.string().optional().nullable() });
const MissingScoreParamsSchema = z.object({ gameId: z.string().uuid() });
const ReimportMissingScoreBodySchema = z.object({ requestedByDiscordId: z.string().min(1), notes: z.string().optional().nullable() });
const IgnoreMissingScoreBodySchema = z.object({ requestedByDiscordId: z.string().min(1), notes: z.string().optional().nullable() });
const ManualScoreBodySchema = z.object({
  homeScore: z.number().int().min(0).max(255),
  awayScore: z.number().int().min(0).max(255),
  resolvedByDiscordId: z.string().min(1),
  notes: z.string().optional().nullable()
});

export async function importRoutes(app: FastifyInstance) {
  app.post("/v1/imports/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createImportJob(CreateImportJobSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/profile/resolve", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await resolveImportProfileForGuild(ResolveImportProfileBodySchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/stat-definitions", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(getStatDefinitionsCatalog());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/raw-field-dictionary", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId, importJobId, endpointKey, mapped, limit } = (request.query ?? {}) as {
        leagueId?: string;
        importJobId?: string;
        endpointKey?: string;
        mapped?: string;
        limit?: string;
      };
      if (!leagueId) return reply.status(400).send({ error: "leagueId query parameter is required." });
      return reply.send(await listImportRawFieldDictionary({
        leagueId,
        importJobId,
        endpointKey,
        mapped: mapped == null ? undefined : mapped === "true",
        limit: Number.isFinite(Number(limit)) ? Number(limit) : undefined
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/field-map", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId, maxPages } = (request.query ?? {}) as { leagueId?: string; maxPages?: string };
      if (!leagueId) return reply.status(400).send({ error: "leagueId query parameter is required." });
      const parsedMaxPages = Number(maxPages ?? 20);
      return reply.send(await getImportFieldMap(leagueId, Number.isFinite(parsedMaxPages) ? parsedMaxPages : 20));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/imports/unmapped-stat-keys", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId } = (request.query ?? {}) as { leagueId?: string };
      if (!leagueId) return reply.status(400).send({ error: "leagueId query parameter is required." });
      return reply.send(await getUnmappedStatKeys(leagueId));
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

  app.get("/v1/imports/:jobId/missing-results", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { jobId } = request.params as { jobId: string };
      return reply.send(await listMissingImportedGameScores(jobId));
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

  app.get("/v1/imports/guild/:guildId/active", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      return reply.send(await getActiveImportJobForGuild(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/guild/cancel-active", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await cancelActiveImportForGuild(CancelActiveImportSchema.parse(request.body)));
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

  app.post("/v1/imports/job/stage-endpoint", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { importJobId, endpointKey } = StageImportEndpointBodySchema.parse(request.body);
      return reply.send(await executeImportEndpoint(importJobId, endpointKey));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/execute", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { importJobId } = ImportJobIdBodySchema.parse(request.body);
      return reply.send(await executeImportJob(importJobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/preview", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { importJobId } = ImportJobIdBodySchema.parse(request.body);
      return reply.send(await generateImportPreview(importJobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/approve", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { importJobId } = ImportJobIdBodySchema.parse(request.body);
      return reply.send(await approveImportPreview(importJobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/job/cancel", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { importJobId, reason } = CancelImportJobSchema.parse(request.body);
      return reply.send(await cancelImportJob(importJobId, reason));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/missing-results/:gameId/reimport", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { gameId } = MissingScoreParamsSchema.parse(request.params);
      const body = ReimportMissingScoreBodySchema.parse(request.body);
      return reply.send(await requestMissingGameScoreReimport({ stagingGameId: gameId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/missing-results/:gameId/manual-score", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { gameId } = MissingScoreParamsSchema.parse(request.params);
      const body = ManualScoreBodySchema.parse(request.body);
      return reply.send(await manuallyResolveImportedGameScore({ stagingGameId: gameId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/missing-results/:gameId/ignore", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { gameId } = MissingScoreParamsSchema.parse(request.params);
      const body = IgnoreMissingScoreBodySchema.parse(request.body);
      return reply.send(await ignoreMissingImportedGameScore({ stagingGameId: gameId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
