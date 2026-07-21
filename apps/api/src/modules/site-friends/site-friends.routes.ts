import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listFriendships,
  removeFriendship,
  requestFriendship,
  requireLinkedSiteUser,
  respondFriendship,
} from "./site-friends.service.js";

export async function siteFriendsRoutes(app: FastifyInstance) {
  app.post("/v1/site-friends/list", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      return reply.send(await listFriendships({ recUserId: user.recUserId }));
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
