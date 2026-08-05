import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type PromoCodeEffectType = "lifetime_platinum" | "lifetime_gold" | "bonus_coins";

export type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  effectType: PromoCodeEffectType;
  effectValue: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function mapRow(row: any): PromoCode {
  return {
    id: row.id,
    code: row.code,
    description: row.description ?? null,
    effectType: row.effect_type,
    effectValue: row.effect_value ?? null,
    maxRedemptions: row.max_redemptions ?? null,
    redemptionCount: row.redemption_count,
    active: row.active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPromoCodes(): Promise<PromoCode[]> {
  const result = await supabase
    .from("rec_promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (result.error) throw new ApiError(500, "Failed to load promo codes.", result.error);
  return (result.data ?? []).map(mapRow);
}

export async function createPromoCode(input: {
  code: string;
  description: string | null;
  effectType: PromoCodeEffectType;
  effectValue: number | null;
  maxRedemptions: number | null;
  startsAt: string | null;
  endsAt: string | null;
  createdByUserId: string | null;
}): Promise<PromoCode> {
  if (input.effectType === "bonus_coins" && (!input.effectValue || input.effectValue <= 0)) {
    throw new ApiError(400, "Bonus coin codes need a positive coin amount.");
  }
  const result = await supabase
    .from("rec_promo_codes")
    .insert({
      code: normalizeCode(input.code),
      description: input.description,
      effect_type: input.effectType,
      effect_value: input.effectValue,
      max_redemptions: input.maxRedemptions,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      created_by: input.createdByUserId,
    })
    .select("*")
    .single();
  if (result.error) {
    if (result.error.code === "23505") throw new ApiError(409, "A promo code with that code already exists.");
    throw new ApiError(500, "Failed to create promo code.", result.error);
  }
  return mapRow(result.data);
}

export async function updatePromoCode(input: {
  id: string;
  code?: string;
  description?: string | null;
  effectType?: PromoCodeEffectType;
  effectValue?: number | null;
  maxRedemptions?: number | null;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<PromoCode> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.code !== undefined) update.code = normalizeCode(input.code);
  if (input.description !== undefined) update.description = input.description;
  if (input.effectType !== undefined) update.effect_type = input.effectType;
  if (input.effectValue !== undefined) update.effect_value = input.effectValue;
  if (input.maxRedemptions !== undefined) update.max_redemptions = input.maxRedemptions;
  if (input.active !== undefined) update.active = input.active;
  if (input.startsAt !== undefined) update.starts_at = input.startsAt;
  if (input.endsAt !== undefined) update.ends_at = input.endsAt;

  const result = await supabase.from("rec_promo_codes").update(update).eq("id", input.id).select("*").single();
  if (result.error) {
    if (result.error.code === "23505") throw new ApiError(409, "A promo code with that code already exists.");
    throw new ApiError(500, "Failed to update promo code.", result.error);
  }
  return mapRow(result.data);
}

export async function deletePromoCode(id: string): Promise<{ ok: true }> {
  const result = await supabase.from("rec_promo_codes").delete().eq("id", id);
  if (result.error) throw new ApiError(500, "Failed to delete promo code.", result.error);
  return { ok: true };
}

async function applyPromoEffect(userId: string, promo: { id: string; effect_type: PromoCodeEffectType; effect_value: number | null; code: string }) {
  if (promo.effect_type === "bonus_coins") {
    await supabase.rpc("add_to_wallet", {
      p_user_id: userId,
      p_amount: promo.effect_value ?? 0,
      p_league_id: null,
      p_description: `Promo code ${promo.code}`,
      p_transaction_type: "promo_code_redeem",
      p_source: "manual_admin_entry",
      p_source_reference: { promoCodeId: promo.id, code: promo.code },
    });
    return;
  }

  // lifetime_platinum / lifetime_gold — never downgrade an active paid Stripe subscriber.
  const user = await supabase.from("rec_users").select("billing_status").eq("id", userId).maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load user for promo redemption.", user.error);
  if (user.data?.billing_status === "active") return;

  const tier = promo.effect_type === "lifetime_platinum" ? "platinum" : "gold";
  const updated = await supabase
    .from("rec_users")
    .update({ subscription_tier: tier, billing_status: "lifetime_comp", updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (updated.error) throw new ApiError(500, "Failed to apply promo code.", updated.error);
}

export async function redeemPromoCode(input: { userId: string; code: string }): Promise<{ effectType: PromoCodeEffectType; description: string | null }> {
  const code = normalizeCode(input.code);
  const promo = await supabase.from("rec_promo_codes").select("*").eq("code", code).maybeSingle();
  if (promo.error) throw new ApiError(500, "Failed to look up promo code.", promo.error);
  const row = promo.data;
  if (!row || !row.active) throw new ApiError(404, "That promo code isn't valid.");

  const now = new Date();
  if (row.starts_at && new Date(row.starts_at) > now) throw new ApiError(400, "That promo code isn't active yet.");
  if (row.ends_at && new Date(row.ends_at) < now) throw new ApiError(400, "That promo code has expired.");
  if (row.max_redemptions != null && row.redemption_count >= row.max_redemptions) {
    throw new ApiError(400, "That promo code has reached its redemption limit.");
  }

  const existingRedemption = await supabase
    .from("rec_promo_code_redemptions")
    .select("id")
    .eq("promo_code_id", row.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingRedemption.data) throw new ApiError(400, "You've already redeemed that promo code.");

  const inserted = await supabase
    .from("rec_promo_code_redemptions")
    .insert({ promo_code_id: row.id, user_id: input.userId })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") throw new ApiError(400, "You've already redeemed that promo code.");
    throw new ApiError(500, "Failed to record promo code redemption.", inserted.error);
  }

  await applyPromoEffect(input.userId, row);
  await supabase
    .from("rec_promo_codes")
    .update({ redemption_count: row.redemption_count + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  return { effectType: row.effect_type, description: row.description };
}
