import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLD_JOIN_LIMIT,
  PLATINUM_JOIN_LIMIT,
  PLATINUM_OWN_LIMIT,
  TRIAL_JOIN_LIMIT,
  TRIAL_OWN_LIMIT,
  canCreateLeague,
  canEnableDiscordBot,
  hasSiteAccess,
  isCurrentlyTrialing,
  isFreeLifetimeClaimOpen,
  joinLimitFor,
  ownLimitFor,
  type EntitlementUser,
} from "./entitlements.service.js";

function user(overrides: Partial<EntitlementUser> = {}): EntitlementUser {
  return {
    id: "user-1",
    subscription_tier: "platinum",
    billing_status: "active",
    subscription_grace_until: null,
    trial_ends_at: null,
    promo_trial_ends_at: null,
    ...overrides,
  };
}

const now = new Date("2026-06-01T12:00:00.000Z");
const future = "2026-07-01T12:00:00.000Z";
const past = "2026-05-01T12:00:00.000Z";

test("hasSiteAccess allows gold/platinum when active, lifetime_comp, or valid grace", () => {
  assert.equal(hasSiteAccess(user({ subscription_tier: "gold", billing_status: "active" }), now), true);
  assert.equal(hasSiteAccess(user({ subscription_tier: "platinum", billing_status: "lifetime_comp" }), now), true);
  assert.equal(
    hasSiteAccess(user({ billing_status: "grace", subscription_grace_until: future }), now),
    true,
  );
  assert.equal(
    hasSiteAccess(user({ billing_status: "grace", subscription_grace_until: past }), now),
    false,
  );
  assert.equal(hasSiteAccess(user({ subscription_tier: "none", billing_status: "active" }), now), false);
});

test("hasSiteAccess allows past_due only while grace window is open", () => {
  assert.equal(
    hasSiteAccess(user({ billing_status: "past_due", subscription_grace_until: future }), now),
    true,
  );
  assert.equal(
    hasSiteAccess(user({ billing_status: "past_due", subscription_grace_until: past }), now),
    false,
  );
  assert.equal(hasSiteAccess(user({ billing_status: "past_due", subscription_grace_until: null }), now), false);
});

test("hasSiteAccess allows promo_trial only while promo_trial_ends_at is in the future", () => {
  assert.equal(
    hasSiteAccess(user({ billing_status: "promo_trial", promo_trial_ends_at: future }), now),
    true,
  );
  assert.equal(
    hasSiteAccess(user({ billing_status: "promo_trial", promo_trial_ends_at: past }), now),
    false,
  );
});

test("canCreateLeague and canEnableDiscordBot require platinum with site access", () => {
  assert.equal(canCreateLeague(user({ subscription_tier: "platinum", billing_status: "active" }), now), true);
  assert.equal(canEnableDiscordBot(user({ subscription_tier: "platinum", billing_status: "active" }), now), true);
  assert.equal(canCreateLeague(user({ subscription_tier: "gold", billing_status: "active" }), now), false);
  assert.equal(canEnableDiscordBot(user({ subscription_tier: "gold", billing_status: "active" }), now), false);
  assert.equal(canCreateLeague(user({ subscription_tier: "none", billing_status: "active" }), now), false);
  assert.equal(
    canCreateLeague(user({ subscription_tier: "platinum", billing_status: "canceled" }), now),
    false,
  );
});

test("joinLimitFor and ownLimitFor respect tier, access, and Stripe trial caps", () => {
  assert.equal(joinLimitFor(user({ subscription_tier: "platinum", billing_status: "active" }), now), PLATINUM_JOIN_LIMIT);
  assert.equal(ownLimitFor(user({ subscription_tier: "platinum", billing_status: "active" }), now), PLATINUM_OWN_LIMIT);
  assert.equal(joinLimitFor(user({ subscription_tier: "gold", billing_status: "active" }), now), GOLD_JOIN_LIMIT);
  assert.equal(ownLimitFor(user({ subscription_tier: "gold", billing_status: "active" }), now), 0);
  assert.equal(joinLimitFor(user({ subscription_tier: "none", billing_status: "none" }), now), 0);
  assert.equal(ownLimitFor(user({ subscription_tier: "none", billing_status: "none" }), now), 0);

  const stripeTrial = user({
    subscription_tier: "platinum",
    billing_status: "active",
    trial_ends_at: future,
  });
  assert.equal(isCurrentlyTrialing(stripeTrial, now), true);
  assert.equal(joinLimitFor(stripeTrial, now), TRIAL_JOIN_LIMIT);
  assert.equal(ownLimitFor(stripeTrial, now), TRIAL_OWN_LIMIT);

  const goldTrial = user({
    subscription_tier: "gold",
    billing_status: "active",
    trial_ends_at: future,
  });
  assert.equal(joinLimitFor(goldTrial, now), TRIAL_JOIN_LIMIT);
  assert.equal(ownLimitFor(goldTrial, now), 0); // gold cannot create leagues even on trial
});

test("isCurrentlyTrialing ignores promo_trial and expired Stripe trials", () => {
  assert.equal(
    isCurrentlyTrialing(
      user({ billing_status: "promo_trial", trial_ends_at: future, promo_trial_ends_at: future }),
      now,
    ),
    false,
  );
  assert.equal(isCurrentlyTrialing(user({ billing_status: "active", trial_ends_at: past }), now), false);
  assert.equal(isCurrentlyTrialing(user({ billing_status: "active", trial_ends_at: null }), now), false);
  assert.equal(isCurrentlyTrialing(user({ billing_status: "active", trial_ends_at: future }), now), true);
});

test("promo_trial users get normal tier limits, not Stripe trial caps", () => {
  const promoPlatinum = user({
    subscription_tier: "platinum",
    billing_status: "promo_trial",
    promo_trial_ends_at: future,
    trial_ends_at: future,
  });
  assert.equal(isCurrentlyTrialing(promoPlatinum, now), false);
  assert.equal(joinLimitFor(promoPlatinum, now), PLATINUM_JOIN_LIMIT);
  assert.equal(ownLimitFor(promoPlatinum, now), PLATINUM_OWN_LIMIT);
});

test("isFreeLifetimeClaimOpen is true before deadline and false after", () => {
  assert.equal(isFreeLifetimeClaimOpen(new Date("2026-07-31T16:59:59.000Z")), true);
  assert.equal(isFreeLifetimeClaimOpen(new Date("2026-07-31T17:00:00.000Z")), false);
  assert.equal(isFreeLifetimeClaimOpen(new Date("2026-08-01T00:00:00.000Z")), false);
});
