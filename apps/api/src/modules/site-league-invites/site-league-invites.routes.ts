import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { recUserIdFromDiscordId } from "../madden-companion/madden-companion.service.js";
import {
  listDiscordInviteTargets,
  listLeagueInvites,
  listPendingInvitesForUser,
  requireLinkedSiteUser,
  respondToLeagueInvite,
  searchInviteTargets,
  sendLeagueInvite,
} from "./site-league-invites.service.js";

/** Invites are sent from both surfaces: the site (Supabase session) and the league
 *  management dashboard (bot-minted session). Try the site session first; a 401 falls
 *  through to the dashboard session, which requires co-commissioner permission. */
async function resolveInviteActor(request: FastifyRequest, guildId?: string): Promise<{ recUserId: string }> {
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

export async function siteLeagueInvitesRoutes(app: FastifyInstance) {
  app.post("/v1/site-league-invites/search", async (request, reply) => {
    try {
      const body = z
        .object({
          query: z.string().trim().max(40).optional(),
          limit: z.number().int().min(1).max(50).optional(),
          guildId: z.string().min(1).optional(),
        })
        .parse(request.body ?? {});
      const actor = await resolveInviteActor(request, body.guildId);
      return reply.send(
        await searchInviteTargets({
          recUserId: actor.recUserId,
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
      const body = z
        .object({
          leagueId: z.string().uuid(),
          userId: z.string().uuid().optional(),
          username: z.string().trim().min(1).max(24).optional(),
          teamId: z.string().uuid().optional(),
          message: z.string().trim().max(500).optional(),
          guildId: z.string().min(1).optional(),
        })
        .refine((value) => Boolean(value.userId || value.username), {
          message: "username or userId is required",
        })
        .parse(request.body ?? {});
      const actor = await resolveInviteActor(request, body.guildId);
      return reply.send(
        await sendLeagueInvite({
          recUserId: actor.recUserId,
          leagueId: body.leagueId,
          userId: body.userId,
          username: body.username,
          teamId: body.teamId,
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

  // Discord-server member picker for the Manage League "Invite from Discord Server" flow:
  // guild members who have a linked site account but no active team in this league.
  app.post("/v1/site-league-invites/discord-members", async (request, reply) => {
    try {
      const body = z.object({ leagueId: z.string().uuid(), guildId: z.string().min(1) }).parse(request.body ?? {});
      const actor = await resolveInviteActor(request, body.guildId);
      return reply.send(await listDiscordInviteTargets({ recUserId: actor.recUserId, ...body }));
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
