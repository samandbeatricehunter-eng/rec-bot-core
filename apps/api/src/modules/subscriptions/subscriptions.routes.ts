import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { supabase } from "../../lib/supabase.js";
import {
  canEnableDiscordBot,
  canCreateLeague,
  ensureRecUserForAuthUser,
  getEntitlementSummary,
  isIdentityClaimDropdownOpen,
  resolveRecUserIdByAuthUserId,
  setIdentityClaimDropdownClosed,
} from "./entitlements.service.js";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  handleStripeWebhook,
} from "./stripe.service.js";
import { claimBotInvite } from "./bot-invite.service.js";
import { requireInternalApiKey } from "../../lib/auth.js";


async function resolveCheckoutRecUserId(authUserId: string, email: string | null): Promise<string> {
  const existing = await resolveRecUserIdByAuthUserId(authUserId);
  if (existing) return existing;
  // When the grandfather claim dropdown is closed, paid signup creates a free-standing
  // rec_users row. While the dropdown is open, require claiming Discord identity first.
  if (await isIdentityClaimDropdownOpen()) {
    throw new ApiError(404, "Link a REC profile before managing subscriptions.");
  }
  return ensureRecUserForAuthUser(authUserId, email);
}
async function requireLinkedRecUserId(authUserId: string): Promise<string> {
  const recUserId = await resolveRecUserIdByAuthUserId(authUserId);
  if (!recUserId) {
    throw new ApiError(404, "Link a REC profile before managing subscriptions.");
  }
  return recUserId;
}

async function loadUserEntitlements(userId: string) {
  const result = await supabase
    .from("rec_users")
    .select("id,subscription_tier,billing_status,subscription_grace_until")
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load user.", result.error);
  if (!result.data) throw new ApiError(404, "User was not found.");
  return result.data;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get("/v1/subscriptions/me", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const recUserId = await requireLinkedRecUserId(session.authUserId);
      return reply.send(await getEntitlementSummary(recUserId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/me", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const recUserId = await requireLinkedRecUserId(session.authUserId);
      return reply.send(await getEntitlementSummary(recUserId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/checkout", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          tier: z.enum(["gold", "platinum"]),
          successUrl: z.string().url().optional(),
          cancelUrl: z.string().url().optional(),
        })
        .parse(request.body ?? {});
      const recUserId = await resolveCheckoutRecUserId(session.authUserId, session.email);
      return reply.send(
        await createCheckoutSession({
          userId: recUserId,
          email: session.email,
          tier: body.tier,
          successUrl: body.successUrl,
          cancelUrl: body.cancelUrl,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/portal", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          returnUrl: z.string().url().optional(),
        })
        .parse(request.body ?? {});
      const recUserId = await resolveCheckoutRecUserId(session.authUserId, session.email);
      return reply.send(
        await createCustomerPortalSession({
          userId: recUserId,
          returnUrl: body.returnUrl,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/subscriptions/registration-gate", async (_request, reply) => {
    try {
      const claimDropdownOpen = await isIdentityClaimDropdownOpen();
      return reply.send({
        claimDropdownOpen,
        requiresPaidSubscriptionToRegister: !claimDropdownOpen,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/claim-dropdown/status", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z
        .object({
          closed: z.boolean(),
        })
        .parse(request.body ?? {});
      await setIdentityClaimDropdownClosed(body.closed);
      return reply.send({
        claimDropdownOpen: await isIdentityClaimDropdownOpen(),
        closed: body.closed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/stripe-webhook", async (request, reply) => {
    try {
      const signature = request.headers["stripe-signature"];
      if (typeof signature !== "string" || !signature) {
        throw new ApiError(400, "Missing Stripe-Signature header.");
      }
      const rawBody = (request as { rawBody?: string }).rawBody;
      if (!rawBody) {
        throw new ApiError(400, "Missing raw request body for Stripe webhook.");
      }
      return reply.send(await handleStripeWebhook(rawBody, signature));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/leagues/:leagueId/bot/enable", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const params = z.object({ leagueId: z.string().uuid() }).parse(request.params);
      const recUserId = await requireLinkedRecUserId(session.authUserId);
      const user = await loadUserEntitlements(recUserId);
      if (!canEnableDiscordBot(user)) {
        throw new ApiError(403, "Platinum subscription required to enable the Discord bot.");
      }

      const league = await supabase
        .from("rec_leagues")
        .select("id,owner_user_id,discord_bot_enabled,discord_bot_invite_token")
        .eq("id", params.leagueId)
        .maybeSingle();
      if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
      if (!league.data) throw new ApiError(404, "League was not found.");
      if (league.data.owner_user_id !== recUserId) {
        throw new ApiError(403, "Only the league owner can enable the Discord bot.");
      }

      const token = randomUUID();
      const now = new Date().toISOString();
      const updated = await supabase
        .from("rec_leagues")
        .update({
          discord_bot_enabled: true,
          discord_bot_invite_token: token,
          discord_bot_invite_created_at: now,
          updated_at: now,
        })
        .eq("id", params.leagueId)
        .select("id,discord_bot_enabled,discord_bot_invite_token,discord_bot_invite_created_at")
        .single();
      if (updated.error) throw new ApiError(500, "Failed to enable Discord bot.", updated.error);
      return reply.send({ league: updated.data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/leagues/:leagueId/bot/disable", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const params = z.object({ leagueId: z.string().uuid() }).parse(request.params);
      const recUserId = await requireLinkedRecUserId(session.authUserId);

      const league = await supabase
        .from("rec_leagues")
        .select("id,owner_user_id")
        .eq("id", params.leagueId)
        .maybeSingle();
      if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
      if (!league.data) throw new ApiError(404, "League was not found.");
      if (league.data.owner_user_id !== recUserId) {
        throw new ApiError(403, "Only the league owner can disable the Discord bot.");
      }

      const now = new Date().toISOString();
      const updated = await supabase
        .from("rec_leagues")
        .update({
          discord_bot_enabled: false,
          discord_bot_invite_token: null,
          discord_bot_invite_created_at: null,
          updated_at: now,
        })
        .eq("id", params.leagueId)
        .select("id,discord_bot_enabled")
        .single();
      if (updated.error) throw new ApiError(500, "Failed to disable Discord bot.", updated.error);
      return reply.send({ league: updated.data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/leagues/:leagueId/transfer-owner", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const params = z.object({ leagueId: z.string().uuid() }).parse(request.params);
      const body = z.object({ toUserId: z.string().uuid() }).parse(request.body ?? {});
      const fromUserId = await requireLinkedRecUserId(session.authUserId);

      const league = await supabase
        .from("rec_leagues")
        .select("id,owner_user_id,game")
        .eq("id", params.leagueId)
        .maybeSingle();
      if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
      if (!league.data) throw new ApiError(404, "League was not found.");
      if (league.data.owner_user_id !== fromUserId) {
        throw new ApiError(403, "Only the current owner can transfer ownership.");
      }

      const [fromUser, toUser] = await Promise.all([
        loadUserEntitlements(fromUserId),
        loadUserEntitlements(body.toUserId),
      ]);
      if (!canCreateLeague(fromUser) || !canCreateLeague(toUser)) {
        throw new ApiError(403, "Both users must have active Platinum access to transfer ownership.");
      }

      const now = new Date().toISOString();
      const updated = await supabase
        .from("rec_leagues")
        .update({ owner_user_id: body.toUserId, updated_at: now })
        .eq("id", params.leagueId)
        .select("id,owner_user_id,game")
        .single();
      if (updated.error) throw new ApiError(500, "Failed to transfer league ownership.", updated.error);
      return reply.send({ league: updated.data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/subscriptions/bot/claim-invite", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z
        .object({
          token: z.string().min(1),
          guildId: z.string().min(1),
          serverName: z.string().min(1).optional(),
          requestedByDiscordId: z.string().min(1).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(await claimBotInvite(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });


}
