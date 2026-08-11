import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  getCompanionConnectionStatus,
  getCompanionWeekStatus,
  ingestCompanionBundle,
  listCompanionImportJobs,
  MADDEN_ENDPOINT_KEYS,
  recUserIdFromDiscordId,
  registerCompanionConnection,
  rollbackCompanionImportJob,
  rotateCompanionToken,
  validateCompanionConnection,
  type MaddenEndpointKey,
} from "./madden-companion.service.js";

const endpointKeySchema = z.enum(MADDEN_ENDPOINT_KEYS as [MaddenEndpointKey, ...MaddenEndpointKey[]]);

async function requireLeagueCommissioner(request: FastifyRequest, guildId: string, leagueId: string) {
  const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
  if (auth.mode === "bot") throw new ApiError(403, "Browser session required.");
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== leagueId) throw new ApiError(403, "League does not belong to this server context.");
  return auth;
}

export async function maddenCompanionRoutes(app: FastifyInstance) {
  app.get("/v1/import/madden/companion/health", async () => ({ ok: true, receiver: "single_url", datasets: MADDEN_ENDPOINT_KEYS }));

  // One league-owned URL accepts a full bundle or any identifiable subset. The receiver splits
  // the envelope internally; commissioners never configure one URL per dataset.
  app.post("/v1/import/madden/companion/:connectionToken", { config: { bodyLimit: 50 * 1024 * 1024 } }, async (request, reply) => {
    try {
      const { connectionToken } = z.object({ connectionToken: z.string().min(30).max(200) }).parse(request.params);
      const connection = await validateCompanionConnection(connectionToken);
      if (!connection) return reply.code(401).send({ error: "Invalid or disabled Companion import URL." });
      const contentLength = Number(request.headers["content-length"] ?? 0);
      if (contentLength > (connection.config.max_payload_bytes ?? 10 * 1024 * 1024)) return reply.code(413).send({ error: "Payload exceeds this league's import limit." });
      const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
      return reply.send(await ingestCompanionBundle(connection, request.body, headers));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/companion/register", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), endpoint_keys: z.array(endpointKeySchema).min(1).optional(),
        rate_limit_per_minute: z.number().int().positive().max(300).optional(),
        max_payload_bytes: z.number().int().positive().max(50 * 1024 * 1024).optional(),
      }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const created = await registerCompanionConnection(body.league_id, auth.discordId, body.endpoint_keys, body.rate_limit_per_minute, body.max_payload_bytes);
      return reply.send({ connection_token: created.connectionToken, import_path: `/v1/import/madden/companion/${created.connectionToken}`, connection: created.connection });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/companion/rotate", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const rotated = await rotateCompanionToken(body.connection_id, body.league_id);
      return reply.send({ connection_token: rotated.connectionToken, import_path: `/v1/import/madden/companion/${rotated.connectionToken}` });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/companion/connections", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connections: await getCompanionConnectionStatus(body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Powers the Advance Readiness status card — one URL, one status line, current week's
  // imported scores for pre-filling the score-entry form.
  app.post("/v1/import/madden/companion/week-status", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), week_number: z.number().int().positive() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await getCompanionWeekStatus(body.league_id, body.week_number));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/companion/jobs", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ jobs: await listCompanionImportJobs(body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/companion/rollback", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), job_id: z.string().uuid() }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const userId = await recUserIdFromDiscordId(auth.discordId);
      return reply.send(await rollbackCompanionImportJob(body.job_id, body.league_id, userId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
