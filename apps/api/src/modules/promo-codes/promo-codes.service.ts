import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getStripe } from "../subscriptions/stripe.service.js";

export type PromoCodeEffectType = "lifetime_platinum" | "lifetime_gold" | "bonus_coins" | "trial_gold" | "trial_platinum";

function isTrialEffect(effectType: PromoCodeEffectType): boolean {
  return effectType === "trial_gold" || effectType === "trial_platinum";
}

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
  if (isTrialEffect(input.effectType)) {
    if (!input.effectValue || input.effectValue <= 0) throw new ApiError(400, "Free-trial codes need a positive number of months.");
    if (input.maxRedemptions !== 1) throw new ApiError(400, "Free-trial codes must be one-time use (max redemptions = 1).");
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
  if (input.effectType !== undefined || input.effectValue !== undefined || input.maxRedemptions !== undefined) {
    const existing = await supabase.from("rec_promo_codes").select("effect_type,effect_value,max_redemptions").eq("id", input.id).maybeSingle();
    if (existing.error) throw new ApiError(500, "Failed to load promo code.", existing.error);
    if (!existing.data) throw new ApiError(404, "Promo code not found.");
    const effectiveType = input.effectType ?? (existing.data.effect_type as PromoCodeEffectType);
    const effectiveValue = input.effectValue !== undefined ? input.effectValue : existing.data.effect_value;
    const effectiveMaxRedemptions = input.maxRedemptions !== undefined ? input.maxRedemptions : existing.data.max_redemptions;
    if (isTrialEffect(effectiveType)) {
      if (!effectiveValue || effectiveValue <= 0) throw new ApiError(400, "Free-trial codes need a positive number of months.");
      if (effectiveMaxRedemptions !== 1) throw new ApiError(400, "Free-trial codes must be one-time use (max redemptions = 1).");
    }
  }

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

  // lifetime_platinum / lifetime_gold / trial_gold / trial_platinum — never downgrade an
  // active paid Stripe subscriber or an existing lifetime comp.
  const user = await supabase.from("rec_users").select("billing_status,trial_ends_at,stripe_subscription_id").eq("id", userId).maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load user for promo redemption.", user.error);
  if (user.data?.billing_status === "lifetime_comp") return;

  // "active" covers both a genuinely paid subscription and Stripe's own 7-day checkout
  // trial (billingStatusForStripeStatus maps "trialing" to "active" too) — trial_ends_at in
  // the future is what actually distinguishes the two.
  const stripeTrialEndsAt = user.data?.trial_ends_at ? new Date(user.data.trial_ends_at) : null;
  const onStripeTrial = user.data?.billing_status === "active" && stripeTrialEndsAt !== null && stripeTrialEndsAt.getTime() > Date.now();
  const isPaidActive = user.data?.billing_status === "active" && !onStripeTrial;

  if (isTrialEffect(promo.effect_type)) {
    // A promo free-trial code is meant to override the shorter 7-day Stripe checkout trial,
    // not stack behind it — cancel the still-trialing subscription (no charge has happened
    // yet) so the card on file never gets billed before the promo's own free window ends.
    // A genuinely paid, non-trialing subscriber is left alone; they're already getting more
    // than a free trial would give them.
    if (isPaidActive) return;
    if (onStripeTrial && user.data?.stripe_subscription_id) {
      try {
        await getStripe().subscriptions.cancel(String(user.data.stripe_subscription_id));
      } catch (error) {
        console.error("[WARN] Failed to cancel Stripe trial subscription while applying a free-trial promo code (non-fatal):", error);
      }
    }
    const tier = promo.effect_type === "trial_platinum" ? "platinum" : "gold";
    const months = promo.effect_value ?? 0;
    const trialEndsAt = new Date();
    trialEndsAt.setMonth(trialEndsAt.getMonth() + months);
    const updated = await supabase
      .from("rec_users")
      .update({
        subscription_tier: tier,
        billing_status: "promo_trial",
        promo_trial_ends_at: trialEndsAt.toISOString(),
        // Clear Stripe's own trial bookkeeping so isCurrentlyTrialing() doesn't also impose
        // the tighter 7-day-trial league limits on top of the promo's full-tier access.
        trial_ends_at: null,
        stripe_subscription_id: onStripeTrial ? null : user.data?.stripe_subscription_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (updated.error) throw new ApiError(500, "Failed to apply promo code.", updated.error);
    return;
  }

  // lifetime_platinum / lifetime_gold — only skip for a member who is ACTUALLY currently
  // paying (isPaidActive); they already have equal-or-better access, so there's nothing to
  // grant. Skipping on billing_status === "active" alone used to also catch someone still
  // inside Stripe's own 7-day checkout trial (onStripeTrial) — if that trial was later
  // abandoned/canceled without ever converting to a real payment, the redemption row was
  // already recorded as used, but the grant itself was silently dropped forever, with no
  // retry path (confirmed: a real user redeemed a valid lifetime_platinum code while mid-trial,
  // the trial lapsed, and they were left on subscription_tier "none" with no way to redeem the
  // same code again). A lifetime grant should always land unless it would actively downgrade
  // someone who is genuinely paying right now.
  if (isPaidActive) return;
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

  const inserted = await supabase
    .from("rec_promo_code_redemptions")
    .insert({ promo_code_id: row.id, user_id: input.userId })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") throw new ApiError(400, "You've already redeemed that promo code.");
    throw new ApiError(500, "Failed to record promo code redemption.", inserted.error);
  }

  // Atomic conditional increment — the earlier redemption_count read is now just an early-exit
  // hint, not the actual enforcement. Without this, two concurrent redemptions near the cap
  // could both pass the pre-check against the same stale count and over-redeem a capped code.
  const capped = await supabase.rpc("increment_promo_code_redemption", { p_promo_code_id: row.id });
  if (capped.error) throw new ApiError(500, "Failed to record promo code redemption.", capped.error);
  if (!capped.data) {
    // Cap was hit by a concurrent request between our read and this increment — undo the
    // redemption row so the user isn't left with a "redeemed" record for an effect they
    // never actually got.
    await supabase.from("rec_promo_code_redemptions").delete().eq("promo_code_id", row.id).eq("user_id", input.userId);
    throw new ApiError(400, "That promo code has reached its redemption limit.");
  }

  await applyPromoEffect(input.userId, row);

  return { effectType: row.effect_type, description: row.description };
}
