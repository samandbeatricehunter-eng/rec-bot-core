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
  deactivateAdminUser,
  deleteAdminAnnouncement,
  getAdminStats,
  grantAdminUserCoins,
  grantAdminUserTier,
  listAdminLeagueMembers,
  listAdminLeagues,
  listRecentAdminUsers,
  listAdminAnnouncements,
  searchAdminUsers,
  updateAdminAnnouncement,
} from "./admin.service.js";
import {
  resolveIncident,
  ignoreIncident,
  startWorkorder,
  closeWorkorder,
  listIncidents,
  getIncidentPatternSummary,
  recordIncident,
} from "./incident.service.js";
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

  app.post("/v1/admin/users/recent", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await listRecentAdminUsers());
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

  app.post("/v1/admin/users/grant-tier", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z
        .object({ userId: z.string().uuid(), tier: z.enum(["gold", "platinum", "none"]) })
        .parse(request.body ?? {});
      return reply.send(
        await grantAdminUserTier({ targetUserId: body.userId, tier: body.tier, adminAuthUserId: session.authUserId }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/users/grant-coins", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      // grantAdminUserCoins already supports a negative amount as a deduction/correction
      // (add_to_wallet with p_allow_negative) — this schema just needs to let one through.
      const body = z
        .object({ userId: z.string().uuid(), amount: z.number().int().refine((v) => v !== 0, "Amount must be a non-zero whole number.") })
        .parse(request.body ?? {});
      return reply.send(
        await grantAdminUserCoins({ targetUserId: body.userId, amount: body.amount, adminAuthUserId: session.authUserId }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/users/deactivate", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z.object({ userId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await deactivateAdminUser({ targetUserId: body.userId, adminAuthUserId: session.authUserId }));
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

  // ── Incident management (error log) ──

  app.post("/v1/admin/incidents/list", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({
          status: z.string().optional(),
          severity: z.string().optional(),
          leagueId: z.string().uuid().optional(),
          process: z.string().optional(),
          limit: z.number().int().optional(),
        })
        .parse(request.body ?? {});
      return reply.send({ incidents: await listIncidents(body) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/incidents/patterns", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await getIncidentPatternSummary());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/incidents/resolve", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z.object({ incidentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await resolveIncident({ incidentId: body.incidentId, resolvedByUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/incidents/ignore", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z.object({ incidentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await ignoreIncident({ incidentId: body.incidentId, resolvedByUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/incidents/start-workorder", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z
        .object({
          incidentId: z.string().uuid(),
          conversationId: z.string().uuid(),
          note: z.string().trim().max(2000).nullable().optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await startWorkorder({
          incidentId: body.incidentId,
          startedByUserId: session.authUserId,
          conversationId: body.conversationId,
          note: body.note ?? null,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/incidents/close-workorder", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z.object({ incidentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await closeWorkorder({ incidentId: body.incidentId, resolvedByUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // User-facing: any signed-in league member can report an issue to the admin inbox.
  app.post("/v1/admin/report-issue", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        guild_id: z.string().min(1),
        message: z.string().min(10).max(5000),
      }).parse(request.body ?? {});
      const incidentId = await recordIncident({
        leagueId: null,
        guildId: body.guild_id,
        process: "user_report",
        severity: "user_report",
        title: `User report from ${session.authUserId}`,
        detail: body.message,
        context: { reportedByUserId: session.authUserId },
      });
      return reply.send({ ok: true, incidentId });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
