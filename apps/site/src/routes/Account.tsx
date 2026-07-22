import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type LinkCandidate,
  type LinkProfileResponse,
} from "../lib/site-api.js";

function tierLabel(tier: EntitlementSummary["tier"]): string {
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  return "None";
}

export function Account() {
  const auth = useAuth();
  const authUserId = auth.status === "signed-in" ? auth.user.id : "";
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkProfileResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);
  const [query, setQuery] = useState("");
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

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    siteApi
      .getLinkProfile()
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
    const timer = window.setTimeout(() => {
      setCandidateBusy(true);
      setCandidateError(null);
      siteApi
        .listLinkCandidates({ query, limit: 50, offset: 0 })
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
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [auth.status, linked?.linked, linked?.claimDropdownOpen, query]);

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
    !linkedAccount && (claimClosed || (!candidateBusy && candidatesTotal === 0 && !query));
  const subscribed =
    entitlements != null &&
    (entitlements.tier === "gold" || entitlements.tier === "platinum");

  return (
    <div className="site-page site-auth-page">
      <div className="site-auth-card">
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

        <h1>
          {!linkedAccount
            ? "Link your REC identity"
            : linked?.username
              ? "Account complete"
              : "Choose your username"}
        </h1>
        <p>
          Signed in as <strong>{auth.user.email}</strong>.
        </p>

        {linkedAccount ? (
          <>
            <p className="site-muted">
              Linked REC profile:{" "}
              <strong>{linked?.displayName ?? "REC Member"}</strong>
              {linked?.username ? ` · @${linked.username}` : ""}
            </p>

            {linked?.username ? (
              <>
                <p className="site-auth-success">
                  Setup finished. Your stats, badges, records, and wallet now follow
                  this account.
                </p>
                <div className="site-profile-actions">
                  <Link className="site-btn site-btn-primary" to="/inbox">
                    Inbox
                  </Link>
                  <Link className="site-btn site-btn-ghost" to="/friends">
                    Friends
                  </Link>
                </div>

                <div className="site-billing-panel">
                  <h2>Billing</h2>
                  {entitlements ? (
                    <>
                      <p>
                        Plan: <strong>{tierLabel(entitlements.tier)}</strong>
                        {" · "}
                        Status: <strong>{entitlements.billingStatus}</strong>
                      </p>
                      {entitlements.graceUntil && (
                        <p className="site-muted">
                          Grace until{" "}
                          {new Date(entitlements.graceUntil).toLocaleDateString()}
                        </p>
                      )}
                      <div className="site-profile-actions">
                        {subscribed ? (
                          <button
                            className="site-btn site-btn-primary"
                            disabled={billingBusy}
                            onClick={() => void openPortal()}
                          >
                            {billingBusy ? "Opening…" : "Manage billing"}
                          </button>
                        ) : null}
                        {entitlements.tier !== "platinum" ? (
                          <Link className="site-btn site-btn-ghost" to="/pricing">
                            {subscribed ? "Upgrade" : "View plans"}
                          </Link>
                        ) : (
                          <Link className="site-btn site-btn-ghost" to="/pricing">
                            View plans
                          </Link>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="site-muted">
                      Could not load billing status.{" "}
                      <Link to="/pricing">View plans</Link>
                    </p>
                  )}
                  {billingError && <p className="site-auth-error">{billingError}</p>}
                </div>

                <p className="site-muted">
                  Inbox and Friends live here for now. Notifications will join this
                  account area later.
                </p>
              </>
            ) : (
              <>
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
            {!claimClosed && (
              <label className="site-field">
                <span>Search again</span>
                <input
                  value={query}
                  placeholder="Search username..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
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
              <span>Find your Discord username</span>
              <input
                value={query}
                placeholder="Search username..."
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
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