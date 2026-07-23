import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listMySiteLeagues,
  openSiteLeagueHub,
  requireLinkedRecUser,
  retireFromSiteLeague,
  searchSiteLeagues,
} from "./site-leagues.service.js";

export async function siteLeaguesRoutes(app: FastifyInstance) {
  app.post("/v1/site-leagues/mine", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      return reply.send(await listMySiteLeagues({ recUserId: user.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/search", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z
        .object({
          q: z.string().trim().max(80).optional(),
          game: z.enum(["cfb_27", "madden_26", "madden_27"]).optional(),
          difficulty: z.string().trim().max(40).optional(),
          streamingRequirement: z.enum(["required", "recommended", "disabled"]).optional(),
          coinEconomyEnabled: z.boolean().optional(),
          acceleratedClockEnabled: z.boolean().optional(),
          tradeApprovalPolicy: z.string().trim().max(60).optional(),
          offensivePlayCallLimitsEnabled: z.boolean().optional(),
          defensivePlayCallLimitsEnabled: z.boolean().optional(),
          sort: z.enum(["name_asc", "name_desc", "open_teams", "newest"]).optional(),
          limit: z.number().int().min(1).max(80).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await searchSiteLeagues({
          recUserId: user.recUserId,
          filters: body,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/open-hub", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z
        .object({
          leagueId: z.string().uuid(),
          view: z.enum(["buzz", "matchups", "team", "store", "mgmt"]).optional(),
          embed: z.boolean().optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await openSiteLeagueHub({
          recUserId: user.recUserId,
          leagueId: body.leagueId,
          view: body.view,
          embed: body.embed,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/retire", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z
        .object({
          leagueId: z.string().uuid(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await retireFromSiteLeague({
          recUserId: user.recUserId,
          leagueId: body.leagueId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
