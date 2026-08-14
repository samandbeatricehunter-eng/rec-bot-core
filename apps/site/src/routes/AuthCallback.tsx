import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";
import { siteApi } from "../lib/site-api.js";
import { supabase } from "../lib/supabase-client.js";

/**
 * Landing page for Supabase Auth email confirmation / Discord OAuth / magic links.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeInternalNext(params.get("next")) ?? "/account";
  const auth = useAuth();
  const [message, setMessage] = useState("Confirming your session…");
  const [failed, setFailed] = useState(false);
  const [promoPrompt, setPromoPrompt] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const resumeRef = useRef<((code: string | null) => void) | null>(null);

  function waitForPromoDecision(): Promise<string | null> {
    setPromoPrompt(true);
    return new Promise((resolve) => {
      resumeRef.current = resolve;
    });
  }

  function submitPromoPrompt(event: FormEvent) {
    event.preventDefault();
    setPromoPrompt(false);
    resumeRef.current?.(promoCodeInput.trim() || null);
  }

  function skipPromoPrompt() {
    setPromoPrompt(false);
    resumeRef.current?.(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const isDiscordLinkOnly = url.searchParams.get("rec_link") === "discord";
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            throw new Error("No session found after confirmation. Try signing in.");
          }
        }
        if (cancelled) return;

        setMessage(isDiscordLinkOnly ? "Linking your Discord account…" : "Setting up your account…");
        // Ensures rec_users for email-only signups; binds Discord when an OAuth identity exists.
        const linkResult = await siteApi.linkDiscordOAuth();
        if (cancelled) return;

        // Additive "Link Discord account" from My Account: OAuth callback establishes the link
        // and we're done — no identity-claim screen, no promo/pricing detour.
        if (isDiscordLinkOnly) {
          if (!linkResult.discordLinked) {
            throw new Error(
              "Discord wasn't linked. Make sure Manual identity linking is enabled for this auth project, then try Link Discord again from My Account.",
            );
          }
          setMessage("Discord linked. Taking you back…");
          navigate(next, { replace: true });
          return;
        }

        let pendingPromoCode = sessionStorage.getItem("rec_pending_promo_code");
        sessionStorage.removeItem("rec_pending_promo_code");

        let profile = linkResult.linked
          ? linkResult
          : await siteApi.getLinkProfile().catch(() => null);
        if (cancelled) return;

        // REC OG lifetime (or any existing grant) — skip promo/pricing and enter the app.
        if (profile?.entitlements && profile.entitlements.tier !== "none") {
          setMessage("You're in. Taking you to REC Leagues…");
          navigate(next, { replace: true });
          return;
        }

        // Email and first-time Discord signups both get one promo prompt when nothing was
        // stashed on /signup or /login, then Stripe if the code did not comp the account.
        if (!pendingPromoCode) {
          setMessage("You're in.");
          pendingPromoCode = await waitForPromoDecision();
          if (cancelled) return;
        }

        let redeemedTrialEffect = false;
        if (pendingPromoCode) {
          setMessage("Applying your promo code…");
          try {
            const result = await siteApi.redeemPromoCode(pendingPromoCode);
            redeemedTrialEffect = result.effectType === "trial_gold" || result.effectType === "trial_platinum";
          } catch (promoError) {
            if (cancelled) return;
            const reason = promoError instanceof Error ? promoError.message : "That promo code didn't apply.";
            setMessage(`Signed in, but ${reason} Continuing…`);
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
          }
          if (cancelled) return;
        }

        if (redeemedTrialEffect) {
          navigate("/pricing?checkoutRequired=1", { replace: true });
          return;
        }

        profile = await siteApi.getLinkProfile().catch(() => null);
        if (cancelled) return;
        if (profile?.entitlements && profile.entitlements.tier !== "none") {
          setMessage("You're in. Taking you to REC Leagues…");
          navigate(next, { replace: true });
          return;
        }

        navigate("/pricing", { replace: true });
      } catch (cause) {
        if (cancelled) return;
        setFailed(true);
        setMessage(cause instanceof Error ? cause.message : "Could not finish sign-in.");
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate, next]);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
  }, [auth.status]);

  if (promoPrompt) {
    return (
      <div className="site-page site-auth-page">
        <form className="site-auth-card" onSubmit={submitPromoPrompt}>
          <h1>Have a promo code?</h1>
          <p className="site-muted">Enter a code now if you have one — otherwise continue to plans.</p>
          <label className="site-field">
            <span>Promo code</span>
            <input
              autoFocus
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value)}
              placeholder="Enter your code"
            />
          </label>
          <button className="site-btn site-btn-primary site-btn-lg" type="submit">Apply code</button>
          <button className="site-btn site-btn-ghost site-btn-lg" type="button" onClick={skipPromoPrompt}>
            I don't have a code
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="site-page site-auth-callback">
      <h1>{failed ? "Sign-in failed" : "Almost there"}</h1>
      <p>{message}</p>
      {failed ? (
        <p>
          <Link to="/login">Back to log in</Link>
          {" · "}
          <Link to="/signup">Sign up again</Link>
        </p>
      ) : null}
    </div>
  );
}
