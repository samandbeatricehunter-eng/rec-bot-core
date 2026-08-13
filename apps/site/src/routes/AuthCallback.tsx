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

  // A brand-new "Continue with Discord" account (first time this Discord identity has ever
  // linked to REC — see isNewDiscordLink from the API) is the one case where the /login and
  // /signup pages' own promo-code fields are easy to miss entirely: /login has no obvious
  // "you're signing up" framing, and any signed-out visit to a gated route lands there by
  // default. So a returning-Discord-user's session skips this outright, but a first-time link
  // with no code already stashed blocks here and asks once, directly.
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

        setMessage("Linking your Discord account…");
        // The API safely no-ops when no Discord identity exists; real reconciliation errors
        // must remain visible instead of silently stranding league and team records.
        const linkResult = await siteApi.linkDiscordOAuth();
        if (cancelled) return;

        // A "Link Discord account" round-trip (rec_link=discord) that comes back WITHOUT a
        // Discord identity attached is a failed link, not a fresh sign-in or email confirm —
        // previously it fell through to a silent navigate back to /account ("nothing happens").
        // Supabase's linkIdentity needs "Manual linking" enabled in Auth settings; when that
        // (or the OAuth callback) misbehaves the identity is simply never persisted, so the
        // working alternative is the DM-code identity claim on the account page.
        if (url.searchParams.get("rec_link") === "discord" && !linkResult.discordLinked) {
          throw new Error(
            "Discord wasn't linked. Identity linking needs to be enabled on the auth provider — use the " +
              "'I already have a Discord identity' code flow on your account page instead, or contact support.",
          );
        }

        let pendingPromoCode = sessionStorage.getItem("rec_pending_promo_code");
        sessionStorage.removeItem("rec_pending_promo_code");

        // No code was pre-entered on /login or /signup, and this Discord identity has never
        // linked to REC before — ask once, right here, instead of letting them fall through
        // silently with no promo ever applied.
        if (!pendingPromoCode && linkResult.isNewDiscordLink) {
          setMessage("You're in.");
          pendingPromoCode = await waitForPromoDecision();
          if (cancelled) return;
          if (!pendingPromoCode) {
            // No code offered — they still need a Gold/Platinum tier since REC has no free
            // tier, so send them into the plan-selection step rather than the app.
            navigate("/pricing", { replace: true });
            return;
          }
        }

        let redeemedTrialEffect = false;
        if (pendingPromoCode) {
          setMessage("Applying your promo code…");
          try {
            const result = await siteApi.redeemPromoCode(pendingPromoCode);
            // A lifetime grant needs nothing further — skip straight into the app below. A
            // time-limited trial still needs a card on file for when it ends, so it must go
            // through Stripe checkout now rather than being waved straight in with no payment
            // method captured at all.
            redeemedTrialEffect = result.effectType === "trial_gold" || result.effectType === "trial_platinum";
          } catch (promoError) {
            // A bad/expired/already-used code shouldn't block sign-in, but silently eating the
            // failure left users believing a code worked when it never redeemed at all — show it,
            // then continue in instead of navigating away before they can read it.
            if (cancelled) return;
            const reason = promoError instanceof Error ? promoError.message : "That promo code didn't apply.";
            setMessage(`Signed in, but ${reason} Continuing to REC Leagues…`);
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
          }
          if (cancelled) return;
        }

        if (redeemedTrialEffect) {
          navigate("/pricing?checkoutRequired=1", { replace: true });
          return;
        }

        // We don't offer a free tier — every real account needs Gold or Platinum (via the
        // 7-day trial or a lifetime grant). Signing up with email or "Continue with Discord"
        // both create a real, usable rec_users row before any of that happens, so without this
        // check a user can land in the app on tier "none" and silently hit walls later (e.g.
        // team-request approval rejecting them) with no idea why. Re-check after the promo
        // code attempt above, since a code may have just granted the tier that was missing.
        const profile = await siteApi.getLinkProfile().catch(() => null);
        if (cancelled) return;
        if (!profile?.entitlements || profile.entitlements.tier === "none") {
          navigate("/pricing", { replace: true });
          return;
        }

        setMessage("You're in. Taking you to REC Leagues…");
        navigate(next, { replace: true });
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

  // If auth context already caught the session (hash flow), still proceed once.
  useEffect(() => {
    if (auth.status !== "signed-in") return;
  }, [auth.status]);

  if (promoPrompt) {
    return (
      <div className="site-page site-auth-page">
        <form className="site-auth-card" onSubmit={submitPromoPrompt}>
          <h1>Have a promo code?</h1>
          <p className="site-muted">First time signing in with Discord — enter a code now if you have one.</p>
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
