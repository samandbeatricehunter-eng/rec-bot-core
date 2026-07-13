import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { addHubStoryComment, getHub, HUB_REACTION_KEYS, listHubStoryComments, publishHubStory, recordHubAnnouncement, recordHubHighlightView, toggleHubGameReaction, toggleHubHighlightReaction, toggleHubStoryReaction } from "./hub.service.js";

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

  app.post("/v1/hub/highlights/view", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), highlightId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight views require a user session.");
      return reply.send(await recordHubHighlightView({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid(), reactionKey: z.enum(["like", "dislike"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Story reactions require a user session.");
      return reply.send(await toggleHubStoryReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/games/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid(), reactionKey: z.enum(["like", "dislike"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Game reactions require a user session.");
      return reply.send(await toggleHubGameReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/comments/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listHubStoryComments(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/comments/add", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Comments require a user session.");
      return reply.send(await addHubStoryComment({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/announcements/record", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), title: z.string().min(1), body: z.string().min(1), discordChannelId: z.string().optional().nullable(), discordMessageId: z.string().optional().nullable() }).parse(request.body);
      return reply.send(await recordHubAnnouncement(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/announcements/publish", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), title: z.string().min(1).max(140), body: z.string().min(1).max(4000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "Use the announcement record endpoint for bot publishing.");
      return reply.send(await recordHubAnnouncement(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/publish", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), headline: z.string().min(1).max(180), body: z.string().min(1).max(6000), storyType: z.enum(["headline", "article"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "League stories require a commissioner session.");
      return reply.send(await publishHubStory({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });
}
