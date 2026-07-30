export type RecBillingStatus = "active" | "past_due" | "canceled" | "inactive";

export function billingStatusForStripeStatus(status: string): RecBillingStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  return "inactive";
}

export function isPaidActiveCheckout(paymentStatus: string | null | undefined, subscriptionStatus: string | null | undefined): boolean {
  return paymentStatus === "paid" && (subscriptionStatus === "active" || subscriptionStatus === "trialing");
}
