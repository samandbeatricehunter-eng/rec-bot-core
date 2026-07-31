import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";

function tierName(tier: "gold" | "platinum"): string {
  return tier === "platinum" ? "Platinum" : "Gold";
}

// Lands here straight from Stripe after a guest checkout succeeds — payment has already
// happened, so this page only ever collects a password to finish creating the account
// (or points the user at logging in if they somehow already have one). No account exists
// yet at this point; a declined/abandoned Stripe checkout never reaches this page at all.
export function SignUpComplete() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get("checkout_session_id");
  const nextAfterAuth = sessionId ? `/account?checkoutSessionId=${encodeURIComponent(sessionId)}` : "/account";
  const loginHref = `/login?next=${encodeURIComponent(nextAfterAuth)}`;

  const [redeemState, setRedeemState] = useState<"loading" | "paid" | "unpaid" | "error">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<"gold" | "platinum">("gold");
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setRedeemState("unpaid");
      return;
    }
    let active = true;
    siteApi
      .redeemCheckoutSession(sessionId)
      .then((result) => {
        if (!active) return;
        setEmail(result.email);
        setTier(result.tier);
        setRedeemState(result.paid && result.email ? "paid" : "unpaid");
      })
      .catch((err) => {
        if (!active) return;
        setRedeemError(err instanceof Error ? err.message : "Failed to verify checkout session.");
        setRedeemState("error");
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  if (auth.status === "signed-in") return <Navigate to={nextAfterAuth} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSignupError(null);
    if (password.length < 8) { setSignupError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setSignupError("Passwords don't match."); return; }
    if (!email) return;
    setBusy(true);
    const result = await auth.signUp(email, password, nextAfterAuth);
    setBusy(false);
    if (result.error) { setSignupError(result.error); return; }
    if (result.needsEmailConfirmation) setConfirmationSent(true);
  }

  if (redeemState === "loading") {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Confirming your payment…</h1>
          <p className="site-muted">Checking your checkout with Stripe.</p>
        </div>
      </div>
    );
  }

  if (redeemState === "unpaid" || redeemState === "error") {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>We couldn't confirm that payment</h1>
          <p className="site-auth-error">
            {redeemError ?? "This checkout link is missing, expired, or the payment wasn't completed."}
          </p>
          <Link className="site-btn site-btn-primary" to="/pricing">Back to plans</Link>
        </div>
      </div>
    );
  }

  if (confirmationSent) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Check your email</h1>
          <p>
            Payment confirmed for <strong>{tierName(tier)}</strong>. We sent a confirmation link to{" "}
            <strong>{email}</strong> — click it, then log in to finish setting up your account.
          </p>
          <Link className="site-btn site-btn-ghost" to={loginHref}>Back to log in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="site-page site-auth-page">
      <form className="site-auth-card" onSubmit={handleSubmit}>
        <h1>Payment confirmed</h1>
        <p className="site-muted">
          You're subscribing to <strong>{tierName(tier)}</strong>. Set a password for <strong>{email}</strong> to finish
          creating your account.
        </p>
        {signupError && <p className="site-auth-error">{signupError}</p>}
        <label className="site-field">
          <span>Password</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="site-field">
          <span>Confirm password</span>
          <input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        <button className="site-btn site-btn-primary site-btn-lg" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Finish creating your account"}
        </button>
        <p className="site-auth-switch">Already have an account with this email? <Link to={loginHref}>Log in</Link></p>
      </form>
    </div>
  );
}
