import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getHub, HUB_REACTION_KEYS, recordHubAnnouncement, toggleHubHighlightReaction } from "./hub.service.js";

export async function hubRoutes(app: FastifyInstance) {
  app.post("/v1/hub/view", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Hub view is a browser-only endpoint.");
      return reply.send(await getHub(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/highlights/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), highlightId: z.string().uuid(), reactionKey: z.enum(HUB_REACTION_KEYS) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight reactions require a user session.");
      return reply.send(await toggleHubHighlightReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/announcements/record", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), title: z.string().min(1), body: z.string().min(1), discordChannelId: z.string().optional().nullable(), discordMessageId: z.string().optional().nullable() }).parse(request.body);
      return reply.send(await recordHubAnnouncement(body));
    } catch (error) { return sendError(reply, error); }
  });
}
