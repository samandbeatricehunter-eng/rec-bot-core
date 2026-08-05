import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type SubscriptionTier,
} from "../lib/site-api.js";
import { annualSavingsPercent, PLANS, priceLabel, type BillingInterval } from "../lib/plans.js";
import { SiteFooter } from "../components/SiteFooter.js";

function tierLabel(tier: SubscriptionTier): string {
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  return "None";
}

export function Pricing() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const checkout = searchParams.get("checkout");
  const [interval, setInterval] = useState<BillingInterval>("month");
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
      const { url } = await siteApi.createCheckout(tier, interval);
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
          {!subscribed && (
            <>
              <p className="site-trial-badge">New subscribers get a 7-day free trial — no charge until it ends.</p>
              <p className="site-muted site-trial-note">
                During the trial: Gold can join 1 league per game; Platinum can join 1 and create
                1 league per game. Full limits unlock once the trial ends or converts.
              </p>
            </>
          )}
          <div className="site-billing-interval" role="tablist" aria-label="Billing interval">
            <button
              type="button"
              role="tab"
              aria-selected={interval === "month"}
              className={interval === "month" ? "is-active" : ""}
              onClick={() => setInterval("month")}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={interval === "year"}
              className={interval === "year" ? "is-active" : ""}
              onClick={() => setInterval("year")}
            >
              Annual
            </button>
          </div>
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
            const price = priceLabel(plan, interval);
            return (
              <article
                key={plan.tier}
                className={`site-page-card site-plan-card${isCurrent ? " is-current" : ""}`}
              >
                <h2>{plan.name}</h2>
                <p className="site-plan-price">{price}</p>
                {interval === "year" && <p className="site-plan-savings">Save {annualSavingsPercent(plan)}% vs. monthly</p>}
                <p className="site-muted">{plan.blurb}</p>
                <ul className="site-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {signedIn ? (
                  subscribed ? (
                    <button
                      className="site-btn site-btn-ghost site-btn-lg"
                      disabled={portalBusy}
                      onClick={() => void openPortal()}
                    >
                      {isCurrent ? "Manage billing" : `Switch to ${plan.name} in billing portal`}
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

      <SiteFooter />
    </div>
  );
}
