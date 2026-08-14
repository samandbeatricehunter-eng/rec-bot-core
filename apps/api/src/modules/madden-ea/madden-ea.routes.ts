import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  beginEaLogin,
  bindEaLeague,
  disconnectEaConnection,
  getEaConnectionStatus,
  importEaDatasets,
  listEaImportJobs,
  listEaLeagues,
  selectEaPersona,
  submitEaCode,
  updateEaConnectionSettings,
  type EaDataset,
} from "./ea-connections.service.js";
import { EA_DATASETS } from "./ea-datasets.js";
import { validateWeekRef } from "./ea-weeks.js";

const datasetSchema = z.enum(EA_DATASETS as [EaDataset, ...EaDataset[]]);

async function requireLeagueCommissioner(request: FastifyRequest, guildId: string, leagueId: string) {
  const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
  if (auth.mode === "bot") throw new ApiError(403, "Browser session required.");
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== leagueId) throw new ApiError(403, "League does not belong to this server context.");
  return auth;
}

export async function maddenEaRoutes(app: FastifyInstance) {
  // Whether the server is configured to offer direct EA linking at all.
  app.get("/v1/import/madden/ea/health", async (_request, reply) => {
    try {
      const { isEaImportConfigured } = await import("./ea-constants.js");
      return reply.send({ ok: true, configured: isEaImportConfigured(), datasets: EA_DATASETS });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 1 of the link flow: returns the EA login URL the commissioner opens in a browser.
  app.post("/v1/import/madden/ea/login", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await beginEaLogin(body.league_id, auth.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 2: exchange the pasted redirect URL/code for the temporary token and list personas.
  app.post("/v1/import/madden/ea/code", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), pasted: z.string().min(8).max(2000) }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await submitEaCode(body.league_id, auth.discordId, body.pasted));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 3: pick a gamertag; the persona-scoped token is sealed and persisted.
  app.post("/v1/import/madden/ea/persona", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(),
        pending_auth_id: z.string().uuid(), persona_id: z.number().int().positive(),
      }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await selectEaPersona(body.league_id, auth.discordId, body.pending_auth_id, body.persona_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/status", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await getEaConnectionStatus(body.league_id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // List the EA franchises the bound persona owns, so the commissioner can pick the one that
  // maps to this REC league.
  app.post("/v1/import/madden/ea/leagues", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ leagues: await listEaLeagues(body.connection_id, body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/bind", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(), ea_league_id: z.number().int().positive() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await bindEaLeague(body.connection_id, body.league_id, body.ea_league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/settings", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
        datasets: z.array(datasetSchema).min(1).optional(), auto_import: z.boolean().optional(),
      }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await updateEaConnectionSettings(body.connection_id, body.league_id, body.datasets, body.auto_import) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Pull the enabled datasets from EA and run them through the ingest pipeline.
  app.post("/v1/import/madden/ea/import", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
        datasets: z.array(datasetSchema).min(1).optional(),
        stage: z.union([z.literal(0), z.literal(1)]).optional(),
        week_index: z.number().int().min(0).max(22).optional(),
      }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      if (body.stage !== undefined && body.week_index !== undefined) validateWeekRef({ stageIndex: body.stage, weekIndex: body.week_index });
      return reply.send({ imports: await importEaDatasets(body.connection_id, body.league_id, { datasets: body.datasets, stage: body.stage, weekIndex: body.week_index }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/jobs", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ jobs: await listEaImportJobs(body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/disconnect", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      await disconnectEaConnection(body.connection_id, body.league_id);
      return reply.send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
