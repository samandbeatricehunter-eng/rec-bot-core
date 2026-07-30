import assert from "node:assert/strict";
import test from "node:test";
import { billingStatusForStripeStatus, isPaidActiveCheckout } from "./billing-policy.js";

test("checkout redemption requires paid payment and an active subscription", () => {
  assert.equal(isPaidActiveCheckout("paid", "active"), true);
  assert.equal(isPaidActiveCheckout("paid", "trialing"), true);
  assert.equal(isPaidActiveCheckout("paid", "incomplete"), false);
  assert.equal(isPaidActiveCheckout("unpaid", "active"), false);
});

test("Stripe statuses map conservatively to REC entitlement states", () => {
  assert.equal(billingStatusForStripeStatus("trialing"), "active");
  assert.equal(billingStatusForStripeStatus("past_due"), "past_due");
  assert.equal(billingStatusForStripeStatus("canceled"), "canceled");
  assert.equal(billingStatusForStripeStatus("incomplete_expired"), "inactive");
});
