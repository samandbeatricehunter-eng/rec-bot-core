import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listConversations,
  listMessages,
  markConversationRead,
  openCommissionerThread,
  openDm,
  purgeExpiredSiteMessages,
  reportMessage,
  requireLinkedSiteUser,
  searchDmTargets,
  sendMessage,
} from "./site-inbox.service.js";

export async function siteInboxRoutes(app: FastifyInstance) {
  app.post("/v1/site-inbox/conversations", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      return reply.send(await listConversations({ recUserId: user.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/dm-targets", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          query: z.string().trim().max(100).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await searchDmTargets({
          recUserId: user.recUserId,
          query: body.query,
          limit: body.limit ?? 20,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/conversations/open-dm", async (request, reply) => {
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
        await openDm({
          recUserId: user.recUserId,
          userId: body.userId,
          username: body.username,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/conversations/open-commissioner", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          leagueId: z.string().uuid(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await openCommissionerThread({
          recUserId: user.recUserId,
          leagueId: body.leagueId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/messages/list", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          conversationId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).optional(),
          before: z.string().datetime({ offset: true }).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await listMessages({
          recUserId: user.recUserId,
          conversationId: body.conversationId,
          limit: body.limit ?? 50,
          before: body.before,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/messages/send", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          conversationId: z.string().uuid(),
          body: z.string().min(1).max(4000),
        })
        .parse(request.body ?? {});
      return reply.send(
        await sendMessage({
          recUserId: user.recUserId,
          conversationId: body.conversationId,
          body: body.body,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/conversations/mark-read", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          conversationId: z.string().uuid(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await markConversationRead({
          recUserId: user.recUserId,
          conversationId: body.conversationId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/messages/report", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          messageId: z.string().uuid(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await reportMessage({
          recUserId: user.recUserId,
          messageId: body.messageId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-inbox/purge-expired", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await purgeExpiredSiteMessages({ pruneEmptyConversations: true }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
