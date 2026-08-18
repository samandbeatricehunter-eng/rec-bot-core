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
        // Supabase's linkIdentity needs "Manual linking" enabled in Auth settings, or this
        // Discord identity is already attached to a different auth user (e.g. one created via
        // the bot/Activity handoff before this person ever visited the site) — either way the
        // identity is never persisted onto this session. The DM-code "I already have a Discord
        // identity" claim flow on the account page is NOT a real fallback here: it's gated to
        // accounts that haven't finished onboarding yet, and this user already has (that's how
        // they got here), so pointing them at it is a dead end. Surface a clear message and let
        // them retry or reach a human instead of promising a self-serve fix that doesn't exist
        // for this state.
        if (url.searchParams.get("rec_link") === "discord" && !linkResult.discordLinked) {
          throw new Error(
            "Discord wasn't linked — this is a known server-side issue, not something wrong on your end. " +
              "Retrying won't fix it. Please reach out in the Discord server or to support with your account " +
              "email so we can link it manually.",
          );
        }

        // Registration is unified across both entry points: whichever path this session took,
        // it must land on a real rec_users row before anything else happens. The Discord path
        // creates it synchronously inside linkDiscordOAuth; a plain email/password path never
        // touched Discord at all (discordLinked is false), so it needs its own explicit call —
        // previously this was deferred all the way to first Stripe checkout, which left a
        // signed-in-but-no-profile window where promo redemption and other linked-user
        // endpoints all 404'd.
        if (!linkResult.discordLinked) {
          await siteApi.ensureAccount();
          if (cancelled) return;
        }

        // We don't offer a free tier — every real account needs Gold or Platinum (via the
        // 7-day trial or a lifetime grant). Gate the promo-code step on "does this signed-in
        // user have an entitlement yet", not on linkResult.isNewDiscordLink — that flag only
        // means "this Discord snowflake never appeared in rec_discord_accounts before", which
        // undercounts real first-time site signups: a user can already have a
        // rec_discord_accounts row from an unrelated bot/Activity handoff (e.g. opening the
        // in-Discord Activity) despite never creating a site account, and that used to make
        // their actual first site registration skip the promo prompt and land straight in
        // Stripe checkout with no chance to redeem a comp code. Anyone without an entitlement —
        // truly new or not — still needs either a promo code or a subscription, so they all get
        // the same next step; a returning, already-entitled user lands straight in the app.
        const profile = await siteApi.getLinkProfile().catch(() => null);
        if (cancelled) return;
        if (!profile?.entitlements || profile.entitlements.tier === "none") {
          navigate(`/onboarding/promo?next=${encodeURIComponent(next)}`, { replace: true });
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
