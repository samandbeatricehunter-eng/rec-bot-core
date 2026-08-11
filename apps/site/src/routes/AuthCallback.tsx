import { useEffect, useState } from "react";
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
        await siteApi.linkDiscordOAuth();
        if (cancelled) return;

        const pendingPromoCode = sessionStorage.getItem("rec_pending_promo_code");
        if (pendingPromoCode) {
          sessionStorage.removeItem("rec_pending_promo_code");
          setMessage("Applying your promo code…");
          try {
            await siteApi.redeemPromoCode(pendingPromoCode);
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
