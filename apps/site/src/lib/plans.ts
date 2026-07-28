export type BillingInterval = "month" | "year";
export type PlanTier = "gold" | "platinum";

export type Plan = {
  tier: PlanTier;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  blurb: string;
  features: string[];
};

// Kept in one place so the Welcome page and the /pricing page can never quietly drift
// apart on price or feature copy — both prices come straight from what Stripe actually
// charges (see apps/api STRIPE_PRICE_* env vars).
export const PLANS: Plan[] = [
  {
    tier: "gold",
    name: "Gold",
    monthlyPriceCents: 300,
    annualPriceCents: 3000,
    blurb: "Join leagues and compete across seasons.",
    features: ["Join up to 5 leagues per game", "Full site access", "Stats, inbox, and friends"],
  },
  {
    tier: "platinum",
    name: "Platinum",
    monthlyPriceCents: 600,
    annualPriceCents: 6000,
    blurb: "Create leagues and run Discord with the bot.",
    features: [
      "Create up to 5 leagues per game",
      "Join up to 20 leagues per game",
      "Discord bot add-on for your leagues",
      "Everything in Gold",
    ],
  },
];

export function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function priceLabel(plan: Plan, interval: BillingInterval): string {
  return interval === "year" ? `${formatCents(plan.annualPriceCents)}/yr` : `${formatCents(plan.monthlyPriceCents)}/mo`;
}

/** % saved by paying annually vs. 12x the monthly price, rounded to the nearest whole percent. */
export function annualSavingsPercent(plan: Plan): number {
  const fullYearCents = plan.monthlyPriceCents * 12;
  if (fullYearCents <= 0) return 0;
  return Math.round((1 - plan.annualPriceCents / fullYearCents) * 100);
}
