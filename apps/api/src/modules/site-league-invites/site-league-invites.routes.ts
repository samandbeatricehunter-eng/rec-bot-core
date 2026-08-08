import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listLeagueInvites,
  listPendingInvitesForUser,
  requireLinkedSiteUser,
  respondToLeagueInvite,
  searchInviteTargets,
  sendLeagueInvite,
} from "./site-league-invites.service.js";

export async function siteLeagueInvitesRoutes(app: FastifyInstance) {
  app.post("/v1/site-league-invites/search", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          query: z.string().trim().max(40).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await searchInviteTargets({
          recUserId: user.recUserId,
          query: body.query,
          limit: body.limit,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-league-invites/send", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          leagueId: z.string().uuid(),
          userId: z.string().uuid().optional(),
          username: z.string().trim().min(1).max(24).optional(),
          message: z.string().trim().max(500).optional(),
        })
        .refine((value) => Boolean(value.userId || value.username), {
          message: "username or userId is required",
        })
        .parse(request.body ?? {});
      return reply.send(
        await sendLeagueInvite({
          recUserId: user.recUserId,
          leagueId: body.leagueId,
          userId: body.userId,
          username: body.username,
          message: body.message,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-league-invites/list", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z.object({ leagueId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(
        await listLeagueInvites({ recUserId: user.recUserId, leagueId: body.leagueId }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-league-invites/mine", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      return reply.send(await listPendingInvitesForUser({ recUserId: user.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-league-invites/respond", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          inviteId: z.string().uuid(),
          action: z.enum(["accept", "decline"]),
        })
        .parse(request.body ?? {});
      return reply.send(
        await respondToLeagueInvite({
          recUserId: user.recUserId,
          inviteId: body.inviteId,
          action: body.action,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
