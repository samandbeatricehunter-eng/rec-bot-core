import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { safeInternalNext } from "../lib/safe-next.js";
import { siteApi } from "../lib/site-api.js";

/**
 * Single, unified promo-code step for every new registration — Discord or email — reached
 * right after AuthCallback confirms a brand-new rec_users row exists. A lifetime grant
 * (platinum/gold) finishes the account here with no payment method ever collected; anything
 * else (a time-limited trial, bonus coins, or no code at all via Skip) still needs a card on
 * file for when the trial ends, so it continues into Stripe checkout.
 */
export function OnboardingPromo() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeInternalNext(params.get("next")) ?? "/account";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goToCheckout() {
    navigate("/pricing?checkoutRequired=1", { replace: true });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { goToCheckout(); return; }
    setError(null);
    setBusy(true);
    try {
      const result = await siteApi.redeemPromoCode(trimmed);
      const grantsLifetime = result.effectType === "lifetime_platinum" || result.effectType === "lifetime_gold";
      if (grantsLifetime) {
        navigate(next, { replace: true });
        return;
      }
      // Trial codes and bonus-coin codes still need a card on file for after the trial —
      // Pricing already recognizes the promo-trial state and skips straight to "add payment".
      goToCheckout();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "That promo code didn't apply.");
    }
  }

  return (
    <div className="site-page site-auth-page">
      <form className="site-auth-card" onSubmit={handleSubmit}>
        <h1>Have a promo code?</h1>
        <p className="site-muted">
          A code granting a free lifetime Platinum or Gold account skips payment entirely. Any
          other code (or none) continues to Stripe to put a card on file for after your trial.
        </p>
        {error && <p className="site-auth-error">{error}</p>}
        <label className="site-field">
          <span>Promo code</span>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your code"
            disabled={busy}
          />
        </label>
        <button className="site-btn site-btn-primary site-btn-lg" type="submit" disabled={busy}>
          {busy ? "Applying…" : "Apply code"}
        </button>
        <button className="site-btn site-btn-ghost site-btn-lg" type="button" disabled={busy} onClick={goToCheckout}>
          Skip — I don't have a code
        </button>
      </form>
    </div>
  );
}
