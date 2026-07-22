import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type SubscriptionTier,
} from "../lib/site-api.js";

const PLANS: Array<{
  tier: "gold" | "platinum";
  name: string;
  price: string;
  blurb: string;
  features: string[];
}> = [
  {
    tier: "gold",
    name: "Gold",
    price: "$3/mo",
    blurb: "Join leagues and compete across seasons.",
    features: ["Join up to 5 leagues per game", "Full site access", "Stats, inbox, and friends"],
  },
  {
    tier: "platinum",
    name: "Platinum",
    price: "$6/mo",
    blurb: "Create leagues and run Discord with the bot.",
    features: [
      "Create up to 5 leagues per game",
      "Join up to 20 leagues per game",
      "Discord bot for your leagues",
      "Everything in Gold",
    ],
  },
];

function tierLabel(tier: SubscriptionTier): string {
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  return "None";
}

export function Pricing() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const checkout = searchParams.get("checkout");
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [busyTier, setBusyTier] = useState<"gold" | "platinum" | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setEntitlements(null);
      return;
    }
    let active = true;
    setEntitlementsLoading(true);
    siteApi
      .getEntitlements()
      .then((summary) => {
        if (active) setEntitlements(summary);
      })
      .catch(() => {
        // Unlinked accounts may not have entitlements yet.
        if (active) setEntitlements(null);
      })
      .finally(() => {
        if (active) setEntitlementsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.status]);

  async function startCheckout(tier: "gold" | "platinum") {
    setError(null);
    setBusyTier(tier);
    try {
      const { url } = await siteApi.createCheckout(tier);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBusyTier(null);
    }
  }

  async function openPortal() {
    setError(null);
    setPortalBusy(true);
    try {
      const { url } = await siteApi.openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal.");
      setPortalBusy(false);
    }
  }

  const signedIn = auth.status === "signed-in";
  const subscribed =
    entitlements != null &&
    (entitlements.tier === "gold" || entitlements.tier === "platinum");

  return (
    <div className="site-page site-landing">
      <header className="site-nav">
        <Link className="site-wordmark" to="/">
          REC League
        </Link>
        <nav>
          {signedIn ? (
            <>
              <Link className="site-btn site-btn-ghost" to="/account">
                Account
              </Link>
              <Link className="site-btn site-btn-primary" to="/home">
                Home
              </Link>
            </>
          ) : (
            <>
              <Link className="site-btn site-btn-ghost" to="/login">
                Log In
              </Link>
              <Link className="site-btn site-btn-primary" to="/signup">
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="site-pricing">
        <div className="site-page-card site-pricing-intro">
          <h1>Plans</h1>
          <p>
            Pick a subscription to unlock the REC League hub. Cancel anytime from
            Manage billing.
          </p>
          {checkout === "success" && (
            <p className="site-auth-success">
              Checkout complete. Your plan updates within a few seconds after Stripe
              confirms.
            </p>
          )}
          {checkout === "cancel" && (
            <p className="site-muted">Checkout canceled. No charge was made.</p>
          )}
          {error && <p className="site-auth-error">{error}</p>}
          {signedIn && subscribed && !entitlementsLoading && entitlements && (
            <div className="site-billing-panel">
              <p>
                Current plan: <strong>{tierLabel(entitlements.tier)}</strong>
                {" · "}
                Status: <strong>{entitlements.billingStatus}</strong>
              </p>
              {entitlements.graceUntil && (
                <p className="site-muted">
                  Grace until {new Date(entitlements.graceUntil).toLocaleDateString()}
                </p>
              )}
              <button
                className="site-btn site-btn-primary site-btn-lg"
                disabled={portalBusy}
                onClick={() => void openPortal()}
              >
                {portalBusy ? "Opening…" : "Manage billing"}
              </button>
            </div>
          )}
        </div>

        <div className="site-pricing-grid">
          {PLANS.map((plan) => {
            const isCurrent = entitlements?.tier === plan.tier;
            return (
              <article
                key={plan.tier}
                className={`site-page-card site-plan-card${isCurrent ? " is-current" : ""}`}
              >
                <h2>{plan.name}</h2>
                <p className="site-plan-price">{plan.price}</p>
                <p className="site-muted">{plan.blurb}</p>
                <ul className="site-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {signedIn ? (
                  subscribed && isCurrent ? (
                    <button
                      className="site-btn site-btn-ghost site-btn-lg"
                      disabled={portalBusy}
                      onClick={() => void openPortal()}
                    >
                      Manage billing
                    </button>
                  ) : (
                    <button
                      className="site-btn site-btn-primary site-btn-lg"
                      disabled={busyTier != null}
                      onClick={() => void startCheckout(plan.tier)}
                    >
                      {busyTier === plan.tier
                        ? "Redirecting…"
                        : subscribed
                          ? `Switch to ${plan.name}`
                          : `Subscribe to ${plan.name}`}
                    </button>
                  )
                ) : (
                  <div className="site-plan-auth-ctas">
                    <Link className="site-btn site-btn-primary site-btn-lg" to="/signup">
                      Sign up for {plan.name}
                    </Link>
                    <Link className="site-btn site-btn-ghost" to="/login">
                      Log in
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}