import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type LinkProfileResponse,
} from "../lib/site-api.js";
import { AccountHub } from "./AccountHub.js";

export function Account() {
  const auth = useAuth();
  const authUserId = auth.status === "signed-in" ? auth.user.id : "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptionActivating, setSubscriptionActivating] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkProfileResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameNotice, setUsernameNotice] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameCheckBusy, setUsernameCheckBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    // Ensures a rec_users row for email-only accounts (admin-visible) and refreshes Discord link state.
    siteApi
      .linkDiscordOAuth()
      .then((profile) => {
        if (!active) return;
        setLinked(profile);
        if (profile.entitlements) {
          setEntitlements(profile.entitlements);
        } else if (profile.linked) {
          return siteApi.getEntitlements().then((summary) => {
            if (active) setEntitlements(summary);
          });
        } else {
          setEntitlements(null);
        }
      })
      .catch((error) => {
        if (!active) return;
        setProfileError(error instanceof Error ? error.message : "Failed to load account.");
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.status, authUserId]);

  // Continues the Welcome page's guest checkout: payment already happened on Stripe before
  // the account existed, and /signup/complete just finished creating (or logging into) the
  // account. This lands here with the paid checkout session id in the query string and
  // attaches it to the now-existing account — no new Stripe redirect needed, payment is done.
  useEffect(() => {
    if (auth.status !== "signed-in") return;
    const sessionId = searchParams.get("checkoutSessionId");
    if (!sessionId) return;
    setSubscriptionActivating(true);
    setCheckoutError(null);
    siteApi
      .attachCheckoutSession(sessionId)
      .then((summary) => {
        setEntitlements(summary);
        setSubscriptionActivating(false);
        setSearchParams((params) => {
          params.delete("checkoutSessionId");
          return params;
        }, { replace: true });
      })
      .catch((error) => {
        setSubscriptionActivating(false);
        setCheckoutError(error instanceof Error ? error.message : "Failed to finish activating your subscription.");
      });
  }, [auth.status, searchParams, setSearchParams]);

  useEffect(() => {
    if (linked?.linked) {
      setUsernameDraft(linked.username ?? "");
    }
  }, [linked?.linked, linked?.username]);

  useEffect(() => {
    if (!linked?.linked || linked.username) return;
    const username = usernameDraft.trim();
    if (!username) {
      setUsernameAvailable(null);
      setUsernameNotice(null);
      setUsernameCheckBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setUsernameCheckBusy(true);
      siteApi
        .checkUsername(username)
        .then((result) => {
          if (!active) return;
          setUsernameAvailable(result.available);
          setUsernameNotice(result.reason);
        })
        .catch((error) => {
          if (!active) return;
          setUsernameAvailable(false);
          setUsernameNotice(
            error instanceof Error ? error.message : "Could not check username.",
          );
        })
        .finally(() => {
          if (active) setUsernameCheckBusy(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [linked?.linked, linked?.username, usernameDraft]);

  async function saveUsername() {
    const username = usernameDraft.trim();
    if (!username) return;
    setUsernameBusy(true);
    setUsernameNotice(null);
    try {
      const profile = await siteApi.setUsername(username);
      setLinked(profile);
      if (profile.entitlements) setEntitlements(profile.entitlements);
      setUsernameDraft(profile.username ?? "");
      setUsernameNotice("Username saved.");
    } catch (error) {
      setUsernameNotice(error instanceof Error ? error.message : "Could not save username.");
    } finally {
      setUsernameBusy(false);
    }
  }

  if (subscriptionActivating) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Activating your subscription</h1>
          <p className="site-muted">Finishing up — this only takes a second.</p>
        </div>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Loading account</h1>
          <p className="site-muted">Checking your REC account.</p>
        </div>
      </div>
    );
  }

  if (auth.status !== "signed-in") return null;

  if (profileError) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Account error</h1>
          <p className="site-auth-error">{profileError}</p>
          <button className="site-btn site-btn-ghost" onClick={() => void auth.signOut()}>
            Log Out
          </button>
        </div>
      </div>
    );
  }

  const linkedAccount = linked?.linked;
  const subscribed =
    entitlements != null &&
    (entitlements.tier === "gold" || entitlements.tier === "platinum");

  // No free tier — unfinished signups go pay (or redeem a promo) before Account Hub.
  // The retired "Link your REC identity" dropdown is never shown.
  if (!linkedAccount || !subscribed) {
    return <Navigate to="/pricing" replace />;
  }

  return (
    <div className="site-page site-auth-page">
      <div className={`site-auth-card${linked?.username ? " site-account-card" : ""}`}>
        {checkoutError && <p className="site-auth-error">{checkoutError}</p>}

        {!linked?.username ? (
          <>
            <h1>Choose your username</h1>
            <p>
              Signed in as <strong>{auth.user.email}</strong>.
            </p>
            <p className="site-muted">
              Finish setup by choosing a unique username (3–24 characters:
              letters, numbers, dots, underscores).
            </p>
            <label className="site-field">
              <span>Username</span>
              <input
                value={usernameDraft}
                placeholder="ex: rec.coach21"
                autoComplete="username"
                onChange={(event) => setUsernameDraft(event.target.value)}
              />
            </label>
            {usernameCheckBusy && (
              <p className="site-muted">Checking availability…</p>
            )}
            {!usernameCheckBusy && usernameAvailable === true && (
              <p className="site-auth-success">Username is available.</p>
            )}
            <button
              className="site-btn site-btn-primary"
              disabled={
                usernameBusy ||
                usernameCheckBusy ||
                usernameAvailable !== true
              }
              onClick={() => void saveUsername()}
            >
              {usernameBusy ? "Saving…" : "Save username"}
            </button>
            {usernameNotice && usernameNotice !== "Username saved." && (
              <p className="site-auth-error">{usernameNotice}</p>
            )}
          </>
        ) : (
          <>
            <h1>My Account</h1>
            <AccountHub
              linked={linked}
              entitlements={entitlements}
              billingBusy={billingBusy}
              billingError={billingError}
              onOpenBilling={() => {
                setBillingBusy(true);
                setBillingError(null);
                void siteApi
                  .openBillingPortal()
                  .then((res) => {
                    if (res.url) window.location.href = res.url;
                  })
                  .catch((error) => {
                    setBillingError(
                      error instanceof Error ? error.message : "Could not open billing.",
                    );
                  })
                  .finally(() => setBillingBusy(false));
              }}
            />
          </>
        )}

        <button className="site-btn site-btn-ghost" onClick={() => void auth.signOut()}>
          Log Out
        </button>
      </div>
    </div>
  );
}
