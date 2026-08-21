import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type LinkCandidate,
  type LinkProfileResponse,
} from "../lib/site-api.js";
import { AccountHub } from "./AccountHub.js";

function tierLabel(tier: EntitlementSummary["tier"]): string {
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  return "None";
}

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
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [selectedDiscordAccountId, setSelectedDiscordAccountId] = useState("");
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [claimCodeSent, setClaimCodeSent] = useState(false);
  const [claimCode, setClaimCode] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameNotice, setUsernameNotice] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameCheckBusy, setUsernameCheckBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [claimableLeagues, setClaimableLeagues] = useState<
    Array<{ id: string; name: string; game: string; frozenAt: string | null }>
  >([]);
  const [takeoverBusyId, setTakeoverBusyId] = useState<string | null>(null);
  const [takeoverNotice, setTakeoverNotice] = useState<string | null>(null);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);

  function applyLinkedProfile(profile: LinkProfileResponse) {
    setLinked(profile);
    if (profile.entitlements) {
      setEntitlements(profile.entitlements);
    } else if (!profile.linked) {
      setEntitlements(null);
    }
  }

  async function refreshLinkedProfile() {
    const profile = await siteApi.getLinkProfile();
    applyLinkedProfile(profile);
    if (!profile.entitlements && profile.linked) {
      setEntitlements(await siteApi.getEntitlements());
    }
  }

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    siteApi
      .getLinkProfile()
      .then(async (profile) => {
        if (!active) return;
        applyLinkedProfile(profile);
        if (!profile.entitlements && profile.linked) {
          const summary = await siteApi.getEntitlements();
          if (active) setEntitlements(summary);
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
    if (auth.status !== "signed-in") return;
    if (!linked?.linked || !linked.username) return;
    let active = true;
    siteApi
      .listClaimableLeagues()
      .then((response) => {
        if (active) setClaimableLeagues(response.leagues);
      })
      .catch(() => {
        if (active) setClaimableLeagues([]);
      });
    return () => {
      active = false;
    };
  }, [auth.status, authUserId, linked?.linked, linked?.username, entitlements?.tier]);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    if (linked == null || linked.linked) return;
    if (linked.claimDropdownOpen === false) {
      setCandidates([]);
      setCandidatesTotal(0);
      setSelectedDiscordAccountId("");
      setCandidateBusy(false);
      return;
    }
    let active = true;
    setCandidateBusy(true);
    setCandidateError(null);
    siteApi
      .listLinkCandidates({ limit: 100, offset: 0 })
      .then((response) => {
        if (!active) return;
        setCandidates(response.candidates);
        setCandidatesTotal(response.total);
        setSelectedDiscordAccountId((current) =>
          response.candidates.some(
            (candidate) => candidate.discordAccountId === current,
          )
            ? current
            : response.candidates[0]?.discordAccountId ?? "",
        );
      })
      .catch((error) => {
        if (!active) return;
        setCandidates([]);
        setCandidatesTotal(0);
        setCandidateError(
          error instanceof Error ? error.message : "Could not load identities.",
        );
      })
      .finally(() => {
        if (active) setCandidateBusy(false);
      });
    return () => {
      active = false;
    };
  }, [auth.status, linked?.linked, linked?.claimDropdownOpen]);

  useEffect(() => {
    if (linked?.linked) {
      setUsernameDraft(linked.username ?? "");
    }
  }, [linked?.linked, linked?.username]);

  useEffect(() => {
    setClaimCodeSent(false);
    setClaimCode("");
    setClaimNotice(null);
  }, [selectedDiscordAccountId]);

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

  async function requestClaimCode() {
    if (!selectedDiscordAccountId) return;
    setClaimBusy(true);
    setClaimNotice(null);
    try {
      const result = await siteApi.requestIdentityClaimCode(
        selectedDiscordAccountId,
      );
      setClaimCodeSent(true);
      setClaimNotice(
        `Verification code sent by Discord DM to @${result.discordUsername}.`,
      );
    } catch (error) {
      setClaimNotice(
        error instanceof Error ? error.message : "Could not send verification code.",
      );
    } finally {
      setClaimBusy(false);
    }
  }

  async function verifyClaimCode() {
    if (!selectedDiscordAccountId || !/^\d{6}$/.test(claimCode)) return;
    setClaimBusy(true);
    setClaimNotice(null);
    try {
      const profile = await siteApi.verifyIdentityClaimCode(
        selectedDiscordAccountId,
        claimCode,
      );
      setLinked(profile);
      if (profile.entitlements) setEntitlements(profile.entitlements);
      setClaimNotice("Identity linked. Continue to choose your username.");
    } catch (error) {
      setClaimNotice(
        error instanceof Error ? error.message : "Could not link this identity.",
      );
    } finally {
      setClaimBusy(false);
    }
  }

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

  async function openPortal() {
    setBillingError(null);
    setBillingBusy(true);
    try {
      const { url } = await siteApi.openBillingPortal();
      window.location.assign(url);
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : "Could not open billing portal.",
      );
      setBillingBusy(false);
    }
  }

  async function claimLeagueTakeover(leagueId: string) {
    setTakeoverError(null);
    setTakeoverNotice(null);
    setTakeoverBusyId(leagueId);
    try {
      const { league } = await siteApi.claimLeagueOwnership(leagueId);
      setTakeoverNotice(`You are now the owner of ${league.name}. The league is unfrozen.`);
      setClaimableLeagues((current) => current.filter((row) => row.id !== leagueId));
    } catch (error) {
      setTakeoverError(
        error instanceof Error ? error.message : "Could not claim league ownership.",
      );
      const refreshed = await siteApi.listClaimableLeagues().catch(() => null);
      if (refreshed) setClaimableLeagues(refreshed.leagues);
    } finally {
      setTakeoverBusyId(null);
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
          <p className="site-muted">Checking your REC link status.</p>
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
  const onboardingStep = !linkedAccount ? 1 : linked?.username ? 3 : 2;
  const claimClosed = linked?.claimDropdownOpen === false;
  const showSubscribeInsteadOfClaim =
    !linkedAccount && (claimClosed || (!candidateBusy && candidatesTotal === 0));
  const subscribed =
    entitlements != null &&
    (entitlements.tier === "gold" || entitlements.tier === "platinum");

  return (
    <div className="site-page site-auth-page">
      <div className={`site-auth-card${linked?.username ? " site-account-card" : ""}`}>
        {checkoutError && <p className="site-auth-error">{checkoutError}</p>}
        {!linked?.username ? (
          <div className="site-onboarding-steps" aria-label="Account setup progress">
            {["Link identity", "Choose username", "Complete"].map((label, index) => (
              <span
                key={label}
                className={onboardingStep >= index + 1 ? "is-active" : ""}
              >
                {index + 1}. {label}
              </span>
            ))}
          </div>
        ) : null}

        {!linkedAccount || !linked?.username ? (
          <>
            <h1>
              {!linkedAccount
                ? "Link your REC identity"
                : "Choose your username"}
            </h1>
            <p>
              Signed in as <strong>{auth.user.email}</strong>.
            </p>
          </>
        ) : (
          <h1>My Account</h1>
        )}

        {linkedAccount && linked?.username ? (
          <AccountHub
            linked={linked}
            entitlements={entitlements}
            billingBusy={billingBusy}
            billingError={billingError}
            onLinkedProfileRefresh={() => {
              void refreshLinkedProfile().catch(() => undefined);
            }}
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
        ) : linkedAccount ? (
          <>
            <p className="site-muted">
              Linked REC profile:{" "}
              <strong>{linked?.displayName ?? "REC Member"}</strong>
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
        ) : showSubscribeInsteadOfClaim ? (
          <>
            <p className="site-muted">
              {claimClosed
                ? "Identity claiming from Discord is closed. Subscribe to create your REC account, then finish setup here."
                : "No claimable Discord identities found. If you are new to REC, subscribe to get started."}
            </p>
            <div className="site-profile-actions">
              <Link className="site-btn site-btn-primary site-btn-lg" to="/pricing">
                View plans
              </Link>
            </div>
            {candidateError && <p className="site-auth-error">{candidateError}</p>}
          </>
        ) : (
          <>
            <p className="site-muted">
              Pick your Discord username, then confirm with a code sent to that
              Discord account by DM. Claimed identities leave the list immediately
              and cannot be claimed twice.
            </p>
            <label className="site-field">
              <span>Linkable identities ({candidatesTotal})</span>
              <select
                className="site-select"
                value={selectedDiscordAccountId}
                onChange={(event) =>
                  setSelectedDiscordAccountId(event.target.value)
                }
                disabled={!candidates.length || candidateBusy || claimBusy}
              >
                {candidates.length ? (
                  candidates.map((candidate) => (
                    <option
                      key={candidate.discordAccountId}
                      value={candidate.discordAccountId}
                    >
                      {candidate.discordUsername}
                      {candidate.teamLabel ? ` · ${candidate.teamLabel}` : ""}
                    </option>
                  ))
                ) : (
                  <option value="">No claimable identities found</option>
                )}
              </select>
            </label>
            {candidateError && <p className="site-auth-error">{candidateError}</p>}
            {!claimCodeSent ? (
              <button
                className="site-btn site-btn-primary"
                disabled={!selectedDiscordAccountId || claimBusy || candidateBusy}
                onClick={() => void requestClaimCode()}
              >
                {claimBusy ? "Sending…" : "Send verification code"}
              </button>
            ) : (
              <>
                <label className="site-field">
                  <span>Discord verification code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={claimCode}
                    placeholder="6-digit code"
                    onChange={(event) =>
                      setClaimCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </label>
                <button
                  className="site-btn site-btn-primary"
                  disabled={claimBusy || !/^\d{6}$/.test(claimCode)}
                  onClick={() => void verifyClaimCode()}
                >
                  {claimBusy ? "Verifying…" : "Verify and link"}
                </button>
                <button
                  className="site-btn site-btn-ghost"
                  disabled={claimBusy}
                  onClick={() => void requestClaimCode()}
                >
                  Send a new code
                </button>
              </>
            )}
            {claimNotice && (
              <p
                className={
                  claimNotice.includes("sent") || claimNotice.includes("linked")
                    ? "site-auth-success"
                    : "site-auth-error"
                }
              >
                {claimNotice}
              </p>
            )}
            <p className="site-muted">
              New to REC? <Link to="/pricing">View subscription plans</Link>
            </p>
          </>
        )}

        <button className="site-btn site-btn-ghost" onClick={() => void auth.signOut()}>
          Log Out
        </button>
      </div>
    </div>
  );
}