import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getServerConfig, setServerConfig } from "./server-config.service.js";

const ViewConfigSchema = z.object({
  guildId: z.string().min(1)
});

const SetConfigSchema = z.object({
  guildId: z.string().min(1),
  pendingEconomyChannelId: z.string().optional().nullable(),
  pendingPayoutsChannelId: z.string().optional().nullable(),
  pendingPurchasesChannelId: z.string().optional().nullable(),
  boxScoresChannelId: z.string().optional().nullable(),
  headlinesChannelId: z.string().optional().nullable(),
  gameChannelsCategoryId: z.string().optional().nullable(),
  commissionerOfficeChannelId: z.string().optional().nullable(),
  streamsChannelId: z.string().optional().nullable(),
  highlightsChannelId: z.string().optional().nullable(),
  announcementsChannelId: z.string().optional().nullable(),
  votingPollsChannelId: z.string().optional().nullable(),
  commissionerRoleId: z.string().optional().nullable(),
  compCommitteeRoleId: z.string().optional().nullable()
});

export async function serverConfigRoutes(app: FastifyInstance) {
  app.post("/v1/economy/config/view", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getServerConfig(ViewConfigSchema.parse(request.body).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/economy/config/set", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await setServerConfig(SetConfigSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
