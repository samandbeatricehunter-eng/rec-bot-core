import Stripe from "stripe";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getPgPool } from "../../db/client.js";
import {
  GRACE_DAYS,
  type SubscriptionTier,
  unfreezeOwnedLeagues,
} from "./entitlements.service.js";
import { billingStatusForStripeStatus, isPaidActiveCheckout } from "./billing-policy.js";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, "Stripe is not configured.");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function priceIdForTier(tier: "gold" | "platinum", interval: "month" | "year" = "month"): string {
  const priceId =
    interval === "year"
      ? tier === "gold"
        ? env.STRIPE_PRICE_GOLD_ANNUAL
        : env.STRIPE_PRICE_PLATINUM_ANNUAL
      : tier === "gold"
        ? env.STRIPE_PRICE_GOLD
        : env.STRIPE_PRICE_PLATINUM;
  if (!priceId) {
    throw new ApiError(
      503,
      `Stripe ${interval === "year" ? "annual" : "monthly"} price for ${tier} is not configured.`,
    );
  }
  return priceId;
}

function tierFromPriceId(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null;
  if (env.STRIPE_PRICE_GOLD && priceId === env.STRIPE_PRICE_GOLD) return "gold";
  if (env.STRIPE_PRICE_PLATINUM && priceId === env.STRIPE_PRICE_PLATINUM) return "platinum";
  if (env.STRIPE_PRICE_GOLD_ANNUAL && priceId === env.STRIPE_PRICE_GOLD_ANNUAL) return "gold";
  if (env.STRIPE_PRICE_PLATINUM_ANNUAL && priceId === env.STRIPE_PRICE_PLATINUM_ANNUAL) {
    return "platinum";
  }
  return null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoFromUnix(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  return toIsoFromUnix(itemEnd ?? null);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSub = invoice.parent?.subscription_details?.subscription;
  if (!parentSub) return null;
  return typeof parentSub === "string" ? parentSub : parentSub.id;
}

export async function ensureStripeCustomer(userId: string, email: string | null): Promise<string> {
  const stripe = getStripe();
  const user = await supabase
    .from("rec_users")
    .select("id,stripe_customer_id,display_name")
    .eq("id", userId)
    .maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load user for Stripe customer.", user.error);
  if (!user.data) throw new ApiError(404, "User was not found.");

  if (user.data.stripe_customer_id) {
    return String(user.data.stripe_customer_id);
  }

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    name: user.data.display_name || undefined,
    metadata: { rec_user_id: userId },
  });

  const now = new Date().toISOString();
  const updated = await supabase
    .from("rec_users")
    .update({ stripe_customer_id: customer.id, updated_at: now })
    .eq("id", userId);
  if (updated.error) throw new ApiError(500, "Failed to save Stripe customer id.", updated.error);
  return customer.id;
}

export async function createCheckoutSession(input: {
  userId: string;
  email: string | null;
  tier: "gold" | "platinum";
  interval?: "month" | "year";
}) {
  const stripe = getStripe();
  const existing = await supabase
    .from("rec_users")
    .select("stripe_subscription_id,billing_status,trial_used_at")
    .eq("id", input.userId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check the current subscription.", existing.error);
  if (existing.data?.stripe_subscription_id && ["active", "trialing", "past_due", "grace"].includes(String(existing.data.billing_status))) {
    throw new ApiError(409, "Manage or change your existing subscription through the billing portal.");
  }
  const customerId = await ensureStripeCustomer(input.userId, input.email);
  const interval = input.interval ?? "month";
  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: input.userId,
    line_items: [{ price: priceIdForTier(input.tier, interval), quantity: 1 }],
    success_url: `${base}/account?checkout=success`,
    cancel_url: `${base}/account?checkout=cancel`,
    metadata: {
      rec_user_id: input.userId,
      tier: input.tier,
      interval,
    },
    subscription_data: {
      // Checkout Sessions don't apply Dashboard-configured Trial Offers — those only kick
      // in when creating subscriptions via the Subscriptions API directly. This is the
      // Checkout-compatible equivalent, applied once per account (trial_used_at gets set
      // by the webhook the first time a subscription actually enters "trialing").
      ...(existing.data?.trial_used_at ? {} : { trial_period_days: 7 }),
      metadata: {
        rec_user_id: input.userId,
        tier: input.tier,
        interval,
      },
    },
  });
  return { url: session.url, sessionId: session.id };
}

// Guest checkout (no rec_users row, no Supabase Auth account) — Stripe collects the email
// itself on its own hosted page. Nothing is created on our side until the payment actually
// succeeds and the user redeems this session (see redeemPublicCheckoutSession /
// attachCheckoutSessionToUser below), so a declined card never leaves behind an account
// that looks like a broken signup.
export async function createPublicCheckoutSession(input: {
  tier: "gold" | "platinum";
  interval?: "month" | "year";
}) {
  const stripe = getStripe();
  const interval = input.interval ?? "month";
  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceIdForTier(input.tier, interval), quantity: 1 }],
    success_url: `${base}/signup/complete?checkout_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/pricing?checkout=cancel`,
    metadata: { tier: input.tier, interval },
    // No rec_users row exists yet on the guest path, so there's nothing to check
    // trial_used_at against here — this is the pre-signup entry point, always a first
    // trial for whoever completes it.
    subscription_data: { trial_period_days: 7 },
  });
  return { url: session.url, sessionId: session.id };
}

export type RedeemedCheckoutSession = {
  paid: boolean;
  email: string | null;
  tier: "gold" | "platinum";
  interval: "month" | "year";
};

/** Read-only lookup — safe to call from a public (unauthenticated) route. */
export async function redeemPublicCheckoutSession(sessionId: string): Promise<RedeemedCheckoutSession> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const subscription = typeof session.subscription === "object" ? session.subscription : null;
  const paid = isPaidActiveCheckout(session.payment_status, subscription?.status);
  const email = session.customer_details?.email ?? null;
  const tier = session.metadata?.tier === "platinum" ? "platinum" : "gold";
  const interval = session.metadata?.interval === "year" ? "year" : "month";
  return { paid, email, tier, interval };
}

/**
 * Applies an already-paid guest checkout session to a just-created (or existing) rec_user —
 * called right after the user sets a password / signs in for the first time post-payment.
 * Re-verifies payment status itself rather than trusting the caller.
 */
export async function attachCheckoutSessionToUser(input: { userId: string; sessionId: string }): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(input.sessionId, { expand: ["subscription"] });
  const subscription = session.subscription;
  const paid = isPaidActiveCheckout(
    session.payment_status,
    subscription !== null && typeof subscription === "object" ? subscription.status : null,
  );
  if (!paid) throw new ApiError(402, "This checkout session has not completed payment yet.");
  if (!subscription || typeof subscription === "string") {
    throw new ApiError(500, "Checkout session has no subscription attached.");
  }
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customerId) {
    const updated = await supabase
      .from("rec_users")
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("id", input.userId);
    if (updated.error) throw new ApiError(500, "Failed to link Stripe customer.", updated.error);
  }
  await applyActiveSubscription(input.userId, subscription);
}

export async function createCustomerPortalSession(input: {
  userId: string;
}) {
  const stripe = getStripe();
  const user = await supabase
    .from("rec_users")
    .select("stripe_customer_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load Stripe customer.", user.error);
  if (!user.data?.stripe_customer_id) {
    throw new ApiError(400, "No Stripe customer on file for this account.");
  }
  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");
  const session = await stripe.billingPortal.sessions.create({
    customer: String(user.data.stripe_customer_id),
    return_url: `${base}/account`,
  });
  return { url: session.url };
}

async function findUserIdForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  const metaUserId = subscription.metadata?.rec_user_id;
  if (metaUserId) return metaUserId;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return null;
  const result = await supabase
    .from("rec_users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to resolve user from Stripe customer.", result.error);
  return result.data?.id ? String(result.data.id) : null;
}

function primaryPriceId(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

async function applyActiveSubscription(userId: string, subscription: Stripe.Subscription) {
  const priceId = primaryPriceId(subscription);
  const tier = tierFromPriceId(priceId) ?? (subscription.metadata?.tier as SubscriptionTier | undefined) ?? "gold";
  const periodEnd = subscriptionPeriodEnd(subscription);
  const now = new Date().toISOString();
  const billingStatus = billingStatusForStripeStatus(subscription.status);

  const update: Record<string, unknown> = {
    subscription_tier: tier === "platinum" || tier === "gold" ? tier : "gold",
    billing_status: billingStatus,
    stripe_subscription_id: subscription.id,
    subscription_current_period_end: periodEnd,
    updated_at: now,
  };
  if (subscription.status === "trialing") {
    update.trial_used_at = now;
    update.trial_ends_at = toIsoFromUnix(subscription.trial_end ?? null);
  } else {
    // Any non-trialing status (converted to paid, canceled, etc.) means the trial-period
    // league limits no longer apply, regardless of subscription.trial_end's historical value.
    update.trial_ends_at = null;
  }

  if (billingStatus === "active") {
    update.subscription_grace_until = null;
  } else if (billingStatus === "past_due") {
    update.subscription_grace_until =
      periodEnd ?? addDays(new Date(), GRACE_DAYS).toISOString();
  }

  const result = await supabase.from("rec_users").update(update).eq("id", userId);
  if (result.error) throw new ApiError(500, "Failed to update subscription entitlements.", result.error);

  if (billingStatus === "active" && (tier === "platinum" || update.subscription_tier === "platinum")) {
    await unfreezeOwnedLeagues(userId);
  }
}

async function applySubscriptionDeleted(userId: string, subscription: Stripe.Subscription) {
  // Guard against a stale/delayed webhook (including the one fired by our own promo-code
  // redemption canceling a still-trialing Stripe subscription — see promo-codes.service.ts)
  // knocking a still-valid free-trial promo down to a 14-day grace period mid-window.
  const current = await supabase.from("rec_users").select("billing_status,promo_trial_ends_at").eq("id", userId).maybeSingle();
  if (current.data?.billing_status === "promo_trial") {
    const promoTrialEndsAt = current.data.promo_trial_ends_at ? new Date(current.data.promo_trial_ends_at) : null;
    if (promoTrialEndsAt && promoTrialEndsAt.getTime() > Date.now()) return;
  }

  const now = new Date();
  const graceUntil = addDays(now, GRACE_DAYS).toISOString();
  const result = await supabase
    .from("rec_users")
    .update({
      billing_status: "grace",
      subscription_grace_until: graceUntil,
      subscription_current_period_end: subscriptionPeriodEnd(subscription),
      stripe_subscription_id: subscription.id,
      updated_at: now.toISOString(),
    })
    .eq("id", userId);
  if (result.error) throw new ApiError(500, "Failed to apply subscription cancellation grace.", result.error);
}

async function applyPaymentFailed(userId: string, subscriptionId: string | null) {
  const graceUntil = addDays(new Date(), GRACE_DAYS).toISOString();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    billing_status: "past_due",
    subscription_grace_until: graceUntil,
    updated_at: now,
  };
  if (subscriptionId) update.stripe_subscription_id = subscriptionId;
  const result = await supabase.from("rec_users").update(update).eq("id", userId);
  if (result.error) throw new ApiError(500, "Failed to mark subscription past due.", result.error);
}

export async function handleStripeWebhook(rawBody: string, signature: string): Promise<{ received: true }> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError(503, "Stripe webhook secret is not configured.");
  }
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    throw new ApiError(400, "Invalid Stripe webhook signature.", error);
  }

  const inserted = await getPgPool().query(
    `insert into rec_stripe_webhook_events(event_id,event_type,status)
     values($1,$2,'processing')
     on conflict(event_id) do nothing
     returning status`,
    [event.id, event.type],
  );
  if (!inserted.rows[0]) {
    const retry = await getPgPool().query(
      `update rec_stripe_webhook_events
       set status='processing',attempts=attempts+1,error_message=null
       where event_id=$1 and status='failed'
       returning status`,
      [event.id],
    );
    if (!retry.rows[0]) return { received: true };
  }

  try {
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId =
        session.client_reference_id ||
        session.metadata?.rec_user_id ||
        null;
      if (!userId) break;
      if (session.mode === "subscription" && session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const subscription = await stripe.subscriptions.retrieve(subId);
        await applyActiveSubscription(userId, subscription);
      }
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await findUserIdForSubscription(subscription);
      if (!userId) break;
      if (subscription.status === "canceled") {
        await applySubscriptionDeleted(userId, subscription);
      } else {
        await applyActiveSubscription(userId, subscription);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await findUserIdForSubscription(subscription);
      if (!userId) break;
      await applySubscriptionDeleted(userId, subscription);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) break;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = await findUserIdForSubscription(subscription);
      if (userId && (subscription.status === "active" || subscription.status === "trialing")) {
        await applyActiveSubscription(userId, subscription);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
const subscriptionId = invoiceSubscriptionId(invoice);
      let userId: string | null = null;
      if (customerId) {
        const result = await supabase
          .from("rec_users")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        if (result.error) throw new ApiError(500, "Failed to resolve user for failed payment.", result.error);
        userId = result.data?.id ? String(result.data.id) : null;
      }
      if (userId) await applyPaymentFailed(userId, subscriptionId);
      break;
    }
    default:
      break;
    }
    await getPgPool().query(
      `update rec_stripe_webhook_events set status='processed',processed_at=now(),error_message=null where event_id=$1`,
      [event.id],
    );
  } catch (error) {
    await getPgPool().query(
      `update rec_stripe_webhook_events set status='failed',error_message=$2 where event_id=$1`,
      [event.id, error instanceof Error ? error.message.slice(0, 1000) : "Unknown webhook failure"],
    );
    throw error;
  }

  return { received: true };
}
