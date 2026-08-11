import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { isSiteAdminEmail, requireSiteAdmin } from "../../lib/site-admin.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  adminDeleteLeague,
  adminImpersonateUser,
  sendAdminUserMessage,
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
import { getDiscordGovernanceSnapshot, getSiteDiscordConfig, syncAllRecruitingAds, updateSiteDiscordConfig } from "./site-discord-config.service.js";
import { getGlobalEconomyConfig, updateGlobalEconomyConfig } from "../economy/global-economy-config.service.js";

const optionalDiscordSnowflake = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return value;
  },
  z.union([z.string().regex(/^\d{17,20}$/, "Must be a Discord snowflake ID"), z.null()]).optional(),
);

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

  app.post("/v1/admin/economy-config/get", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await getGlobalEconomyConfig({ fresh: true }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/economy/global-values", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      return reply.send(await getGlobalEconomyConfig());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/economy-config/set", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      return reply.send(await updateGlobalEconomyConfig(request.body ?? {}, session.authUserId));
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

  app.post("/v1/admin/users/message", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({ userId: z.string().uuid(), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(2000) })
        .parse(request.body ?? {});
      return reply.send(await sendAdminUserMessage({ targetUserId: body.userId, title: body.title, body: body.body }));
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

  app.post("/v1/admin/discord-config/get", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await getSiteDiscordConfig());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/discord-config/set", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({
          managementGuildId: optionalDiscordSnowflake,
          leaguePostChannels: z
            .object({
              madden_26: optionalDiscordSnowflake,
              madden_27: optionalDiscordSnowflake,
              cfb_27: optionalDiscordSnowflake,
            })
            .partial()
            .optional(),
        })
        .parse(request.body ?? {});
      return reply.send(await updateSiteDiscordConfig(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/discord-config/sync-ads", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await syncAllRecruitingAds());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Bot-only — its daily unlinked-guild sweep fetches this once per cycle and diffs against
  // the guilds it's actually sitting in (see apps/bot's client.guilds.cache walk).
  app.post("/v1/admin/discord-governance/snapshot", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getDiscordGovernanceSnapshot());
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
