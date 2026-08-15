import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { recUserIdFromDiscordId } from "../madden-companion/madden-companion.service.js";
import {
  listFriendships,
  listSharedLeagueFriendSuggestions,
  removeFriendship,
  requestFriendship,
  requireLinkedSiteUser,
  respondFriendship,
} from "./site-friends.service.js";

// The friends list is also read from the league management dashboard ("Invite Friend"
// dropdown), whose bot-minted session isn't a Supabase session — fall back to it with
// co-commissioner permission, same approach as the league-invite routes.
async function resolveFriendActor(request: FastifyRequest, guildId?: string): Promise<{ recUserId: string }> {
  try {
    const session = await requireSiteUserSession(request);
    const user = await requireLinkedSiteUser(session.authUserId);
    return { recUserId: user.recUserId };
  } catch (siteError) {
    const auth = await requireBotOrUserSession(request, {
      resolveGuildId: () => guildId ?? "",
      permission: "co_commissioner",
    });
    if (auth.mode !== "user") throw siteError;
    return { recUserId: await recUserIdFromDiscordId(auth.discordId) };
  }
}

export async function siteFriendsRoutes(app: FastifyInstance) {
  app.post("/v1/site-friends/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1).optional() }).parse(request.body ?? {});
      const actor = await resolveFriendActor(request, body.guildId);
      return reply.send(await listFriendships({ recUserId: actor.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-friends/suggestions", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          query: z.string().trim().max(40).optional(),
          limit: z.number().int().min(1).max(60).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await listSharedLeagueFriendSuggestions({
          recUserId: user.recUserId,
          query: body.query,
          limit: body.limit,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-friends/request", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          userId: z.string().uuid().optional(),
          username: z.string().trim().min(1).max(24).optional(),
        })
        .refine((value) => Boolean(value.userId || value.username), {
          message: "username or userId is required",
        })
        .parse(request.body ?? {});
      return reply.send(
        await requestFriendship({
          recUserId: user.recUserId,
          userId: body.userId,
          username: body.username,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-friends/respond", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          friendshipId: z.string().uuid(),
          action: z.enum(["accept", "decline"]),
        })
        .parse(request.body ?? {});
      return reply.send(
        await respondFriendship({
          recUserId: user.recUserId,
          friendshipId: body.friendshipId,
          action: body.action,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-friends/remove", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          friendshipId: z.string().uuid().optional(),
          userId: z.string().uuid().optional(),
        })
        .refine((value) => Boolean(value.friendshipId || value.userId), {
          message: "friendshipId or userId is required",
        })
        .parse(request.body ?? {});
      return reply.send(
        await removeFriendship({
          recUserId: user.recUserId,
          friendshipId: body.friendshipId,
          userId: body.userId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
