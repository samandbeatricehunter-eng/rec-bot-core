import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import {
  listEaFranchisesForGuild,
  selectEaFranchiseForGuild
} from "./ea-franchise-selection.service.js";

const SelectEaFranchiseBodySchema = z.object({
  guildId: z.string().min(1),
  eaFranchiseId: z.string().uuid(),
  selectedByDiscordId: z.string().min(1),
  replacementReason: z.string().optional().nullable()
});

export async function eaFranchiseRoutes(app: FastifyInstance) {
  app.get("/v1/imports/guild/:guildId/ea-franchises", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      return reply.send(await listEaFranchisesForGuild(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/imports/ea-franchise/select", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await selectEaFranchiseForGuild(SelectEaFranchiseBodySchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
