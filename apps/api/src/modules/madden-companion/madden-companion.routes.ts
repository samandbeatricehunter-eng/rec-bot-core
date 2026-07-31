// Madden Companion receiver routes — §6.2
// POST /v1/import/madden/companion/{connectionToken}/{endpointKey}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  validateCompanionConnection,
  ingestCompanionPayload,
  registerCompanionConnection,
  rotateCompanionToken,
  getCompanionConnectionStatus,
  MADDEN_ENDPOINT_KEYS,
  type MaddenEndpointKey,
} from "./madden-companion.service.js";

const endpointKeySchema = z.enum(MADDEN_ENDPOINT_KEYS as [MaddenEndpointKey, ...MaddenEndpointKey[]]);

export async function maddenCompanionRoutes(app: FastifyInstance) {
  // Health check endpoint (no auth, for monitoring)
  app.get("/v1/import/madden/companion/health", async () => ({
    ok: true,
    endpoints: MADDEN_ENDPOINT_KEYS,
  }));

  // Ingest endpoint — authenticated via connection token in URL path
  app.post(
    "/v1/import/madden/companion/:connectionToken/:endpointKey",
    {
      config: {
        // Allow large payloads (10MB default, configurable per connection)
        bodyLimit: 10 * 1024 * 1024,
      },
    },
    async (request, reply) => {
      try {
        const { connectionToken, endpointKey } = z
          .object({
            connectionToken: z.string().min(1),
            endpointKey: endpointKeySchema,
          })
          .parse(request.params);

        const connection = await validateCompanionConnection(connectionToken, endpointKey);
        if (!connection) {
          return reply.code(401).send({ error: "Invalid connection token or endpoint not allowed" });
        }

        // Check payload size against connection limit
        const contentLength = request.headers["content-length"];
        if (contentLength && parseInt(contentLength, 10) > connection.config.max_payload_bytes) {
          return reply.code(413).send({ error: "Payload too large" });
        }

        const payload = request.body;
        // Normalize headers to Record<string, string> (Fastify headers can be string | string[])
        const normalizedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === "string") normalizedHeaders[key] = value;
          else if (Array.isArray(value) && value.length > 0) normalizedHeaders[key] = value[0];
        }
        const result = await ingestCompanionPayload(connection, endpointKey, payload, normalizedHeaders);

        return reply.code(202).send({
          accepted: result.accepted,
          import_job_id: result.import_job_id,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  // Commissioner: register new companion connection
  app.post("/v1/import/madden/companion/register", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: (r: any) => r.body?.league_id,
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");

      const body = z
        .object({
          league_id: z.string().uuid(),
          endpoint_keys: z.array(endpointKeySchema).optional(),
          rate_limit_per_minute: z.number().int().positive().max(300).optional(),
          max_payload_bytes: z.number().int().positive().max(50 * 1024 * 1024).optional(),
        })
        .parse(request.body);

      const { connectionToken, connection } = await registerCompanionConnection(
        body.league_id,
        auth.discordId,
        body.endpoint_keys as MaddenEndpointKey[] | undefined,
        body.rate_limit_per_minute,
        body.max_payload_bytes
      );

      return reply.send({
        connection_token: connectionToken, // Only returned once!
        connection: {
          ...connection,
          config: { ...connection.config, token_hash: undefined }, // Don't expose hash
        },
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner: rotate token
  app.post("/v1/import/madden/companion/rotate", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: (r: any) => r.body?.league_id,
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");

      const body = z
        .object({
          league_id: z.string().uuid(),
          connection_id: z.string().uuid(),
        })
        .parse(request.body);

      const { connectionToken } = await rotateCompanionToken(body.connection_id, auth.discordId);

      return reply.send({ connection_token: connectionToken });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner: list connections
  app.get("/v1/import/madden/companion/connections/:leagueId", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: (r: any) => r.params.leagueId,
        permission: "commissioner",
      });
      if (auth.mode === "bot") throw new Error("Browser session required");

      const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(request.params);
      const connections = await getCompanionConnectionStatus(leagueId);

      // Don't expose token hashes
      return reply.send({
        connections: connections.map((c) => ({ ...c, config: { ...c.config, token_hash: undefined } })),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}