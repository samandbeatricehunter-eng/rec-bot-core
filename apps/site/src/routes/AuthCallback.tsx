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

        // Registration is unified across both entry points: whichever path this session took,
        // it must land on a real rec_users row before anything else happens. The Discord path
        // creates it synchronously inside linkDiscordOAuth; a plain email/password path never
        // touched Discord at all (discordLinked is false), so it needs its own explicit call —
        // previously this was deferred all the way to first Stripe checkout, which left a
        // signed-in-but-no-profile window where promo redemption and other linked-user
        // endpoints all 404'd.
        let isNewAccount = linkResult.isNewDiscordLink;
        if (!linkResult.discordLinked) {
          const ensured = await siteApi.ensureAccount();
          if (cancelled) return;
          isNewAccount = ensured.isNew;
        }

        // Every brand-new registration — Discord or email — routes through the same promo-code
        // step next (skip button included), which itself decides whether to send the user into
        // Stripe checkout for a card on file or straight into the app on a lifetime grant.
        if (isNewAccount) {
          navigate(`/onboarding/promo?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }

        // We don't offer a free tier — every real account needs Gold or Platinum (via the
        // 7-day trial or a lifetime grant). A returning user landing back here (re-confirming
        // email, re-linking Discord) should still be checked in case their tier lapsed.
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
