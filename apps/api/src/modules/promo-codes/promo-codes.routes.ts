import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireSiteAdmin } from "../../lib/site-admin.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { supabase } from "../../lib/supabase.js";
import { createPromoCode, deletePromoCode, listPromoCodes, redeemPromoCode, updatePromoCode } from "./promo-codes.service.js";

const EffectType = z.enum(["lifetime_platinum", "lifetime_gold", "bonus_coins"]);

export async function promoCodeRoutes(app: FastifyInstance) {
  app.post("/v1/admin/promo-codes/list", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send({ codes: await listPromoCodes() });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/promo-codes/create", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const body = z
        .object({
          code: z.string().trim().min(3).max(40),
          description: z.string().trim().max(500).nullable().optional(),
          effectType: EffectType,
          effectValue: z.number().int().positive().nullable().optional(),
          maxRedemptions: z.number().int().positive().nullable().optional(),
          startsAt: z.string().nullable().optional(),
          endsAt: z.string().nullable().optional(),
        })
        .parse(request.body ?? {});
      const admin = await supabase.from("rec_users").select("id").eq("supabase_auth_user_id", session.authUserId).maybeSingle();
      return reply.send(
        await createPromoCode({
          code: body.code,
          description: body.description ?? null,
          effectType: body.effectType,
          effectValue: body.effectValue ?? null,
          maxRedemptions: body.maxRedemptions ?? null,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          createdByUserId: admin.data?.id ?? null,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/promo-codes/update", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z
        .object({
          id: z.string().uuid(),
          code: z.string().trim().min(3).max(40).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          effectType: EffectType.optional(),
          effectValue: z.number().int().positive().nullable().optional(),
          maxRedemptions: z.number().int().positive().nullable().optional(),
          active: z.boolean().optional(),
          startsAt: z.string().nullable().optional(),
          endsAt: z.string().nullable().optional(),
        })
        .parse(request.body ?? {});
      return reply.send(await updatePromoCode(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin/promo-codes/delete", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ id: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await deletePromoCode(body.id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Registration-time redemption — any signed-in site user, not admin-only.
  app.post("/v1/promo-codes/redeem", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({ code: z.string().trim().min(1).max(40) }).parse(request.body ?? {});
      const user = await supabase.from("rec_users").select("id").eq("supabase_auth_user_id", session.authUserId).maybeSingle();
      if (user.error || !user.data?.id) throw new ApiError(404, "No REC account found for this session.");
      return reply.send(await redeemPromoCode({ userId: user.data.id, code: body.code }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
