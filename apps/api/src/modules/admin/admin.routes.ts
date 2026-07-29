import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { isSiteAdminEmail, requireSiteAdmin } from "../../lib/site-admin.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  adminDeleteLeague,
  adminImpersonateUser,
  adminRemoveUserFromLeague,
  createAdminAnnouncement,
  deleteAdminAnnouncement,
  getAdminStats,
  listAdminLeagueMembers,
  listAdminLeagues,
  listAdminAnnouncements,
  searchAdminUsers,
  updateAdminAnnouncement,
} from "./admin.service.js";

export async function adminRoutes(app: FastifyInstance) {
  app.post("/v1/admin/whoami", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send({ isAdmin: isSiteAdminEmail(session.email) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/stats", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await getAdminStats());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/announcements/list", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await listAdminAnnouncements());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/announcements/create", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({
          title: z.string().trim().min(1).max(200),
          body: z.string().trim().min(1).max(2000),
          href: z.string().trim().max(500).nullable().optional(),
          published: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
          startsAt: z.string().nullable().optional(),
          endsAt: z.string().nullable().optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await createAdminAnnouncement({
          title: body.title,
          body: body.body,
          href: body.href ?? null,
          published: body.published ?? true,
          sortOrder: body.sortOrder ?? 0,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          createdByUserId: null,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/announcements/update", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({
          id: z.string().uuid(),
          title: z.string().trim().min(1).max(200).optional(),
          body: z.string().trim().min(1).max(2000).optional(),
          href: z.string().trim().max(500).nullable().optional(),
          published: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
          startsAt: z.string().nullable().optional(),
          endsAt: z.string().nullable().optional(),
        })
        .parse(request.body ?? {});
      return reply.send(await updateAdminAnnouncement(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/announcements/delete", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ id: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await deleteAdminAnnouncement(body.id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/leagues/list", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({ query: z.string().trim().max(120).optional(), limit: z.number().int().optional() })
        .parse(request.body ?? {});
      return reply.send(await listAdminLeagues(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/leagues/members", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ leagueId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await listAdminLeagueMembers(body.leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/leagues/remove-member", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({ leagueId: z.string().uuid(), userId: z.string().uuid() })
        .parse(request.body ?? {});
      return reply.send(await adminRemoveUserFromLeague(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/leagues/delete", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({ leagueId: z.string().uuid(), confirmationText: z.string().trim().min(1) })
        .parse(request.body ?? {});
      return reply.send(await adminDeleteLeague(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/users/search", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({ query: z.string().trim().max(80).optional(), limit: z.number().int().optional() })
        .parse(request.body ?? {});
      return reply.send(await searchAdminUsers(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/impersonate", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z.object({ userId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(
        await adminImpersonateUser({ targetUserId: body.userId, adminAuthUserId: session.authUserId }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
