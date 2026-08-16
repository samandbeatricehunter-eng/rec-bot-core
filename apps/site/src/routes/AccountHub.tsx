import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { sitePublicUrl, supabase } from "../lib/supabase-client.js";
import { MobileAppSetup } from "../components/MobileAppSetup.js";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushSubscription,
  pushSupported,
} from "../lib/push-notifications.js";
import {
  siteApi,
  type EntitlementSummary,
  type LinkProfileResponse,
  type SiteFriendship,
  type SiteHomeCard,
  type SiteNotificationItem,
} from "../lib/site-api.js";
import { formatUserIdentity } from "../lib/user-identity.js";

type AccountTab = "profile" | "stats" | "friends" | "inbox";

const TABS: Array<{ id: AccountTab; label: string }> = [
  { id: "profile", label: "Profile & Account" },
  { id: "stats", label: "Stats" },
  { id: "friends", label: "Friends" },
  { id: "inbox", label: "Inbox" },
];

function tierLabel(tier: EntitlementSummary["tier"]): string {
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  return "None";
}

function monthlyFee(tier: EntitlementSummary["tier"], billingStatus: string): string {
  if (billingStatus === "lifetime_comp") return "Comp / lifetime";
  if (billingStatus === "promo_trial") return "Free trial";
  if (tier === "platinum") return "$6/mo";
  if (tier === "gold") return "$3/mo";
  return "—";
}

function tabFromSearch(): AccountTab {
  const raw = new URLSearchParams(window.location.search).get("tab");
  if (raw === "stats" || raw === "friends" || raw === "inbox" || raw === "profile") return raw;
  return "profile";
}

export function AccountHub({
  linked,
  entitlements,
  onOpenBilling,
  billingBusy,
  billingError,
}: {
  linked: LinkProfileResponse;
  entitlements: EntitlementSummary | null;
  onOpenBilling: () => void;
  billingBusy: boolean;
  billingError: string | null;
}) {
  const auth = useAuth();
  const [tab, setTab] = useState<AccountTab>(() => tabFromSearch());
  const [homeCard, setHomeCard] = useState<SiteHomeCard | null>(null);
  const [careerGames, setCareerGames] = useState<
    Array<{
      game: string;
      gameLabel: string;
      gamesLogged: number;
      passingYards: number;
      rushingYards: number;
      totalYards: number;
      firstDowns: number;
      turnoversGenerated: number;
      turnoversCommitted: number;
      turnoverDifferential: number;
    }>
  >([]);
  const [friends, setFriends] = useState<{
    accepted: SiteFriendship[];
    pendingIncoming: SiteFriendship[];
    pendingOutgoing: SiteFriendship[];
  }>({ accepted: [], pendingIncoming: [], pendingOutgoing: [] });
  const [suggestions, setSuggestions] = useState<
    Array<{ userId: string; username: string; displayName: string }>
  >([]);
  const [friendQuery, setFriendQuery] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [friendNotice, setFriendNotice] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<{
    regular: SiteNotificationItem[];
  }>({ regular: [] });
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [discordLinkBusy, setDiscordLinkBusy] = useState(false);
  const [discordLinkError, setDiscordLinkError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const email =
    auth.status === "signed-in" ? auth.user.email ?? null : null;
  const initial = String(linked.username ?? linked.displayName ?? "R")
    .slice(0, 1)
    .toUpperCase();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      siteApi.getHomeCard().catch(() => null),
      siteApi.listCareerStatsByGame().catch(() => ({ games: [] })),
      siteApi.listFriends().catch(() => ({
        accepted: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      })),
      siteApi.listFriendSuggestions({ limit: 40 }).catch(() => ({ suggestions: [] })),
      siteApi.listNotifications().catch(() => ({
        regular: [],
        commissioner: [],
        unreadCount: 0,
      })),
    ]).then(([card, careerPayload, friendPayload, suggestionPayload, notifPayload]) => {
      if (cancelled) return;
      setHomeCard(card);
      setCareerGames(careerPayload.games ?? []);
      setFriends(friendPayload);
      setSuggestions(suggestionPayload.suggestions ?? []);
      setNotifications({ regular: notifPayload.regular ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    siteApi
      .getAdminStatus()
      .then((res) => {
        if (!cancelled) setIsAdmin(res.isAdmin);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pushSupported()) return;
    let cancelled = false;
    getPushSubscription()
      .then((sub) => {
        if (!cancelled) setPushEnabled(Boolean(sub));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePushNotifications() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        setPushEnabled(true);
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Could not update push notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      siteApi
        .listFriendSuggestions({ query: friendQuery.trim() || undefined, limit: 40 })
        .then((res) => setSuggestions(res.suggestions ?? []))
        .catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [friendQuery]);

  const filteredSuggestions = useMemo(() => {
    const q = friendQuery.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter(
      (item) =>
        item.username.toLowerCase().includes(q) ||
        item.displayName.toLowerCase().includes(q),
    );
  }, [friendQuery, suggestions]);

  const tabIndex = TABS.findIndex((item) => item.id === tab);

  function shiftTab(delta: number) {
    const next = (tabIndex + delta + TABS.length) % TABS.length;
    setTab(TABS[next]!.id);
  }

  async function changePassword() {
    if (auth.status !== "signed-in" || !email) return;
    if (!passwordForm.current || !passwordForm.next) {
      setPasswordError("Enter your current and new password.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordNotice(null);
    try {
      const signIn = await supabase.auth.signInWithPassword({
        email,
        password: passwordForm.current,
      });
      if (signIn.error) throw new Error("Current password is incorrect.");
      const update = await supabase.auth.updateUser({ password: passwordForm.next });
      if (update.error) throw update.error;
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordNotice("Password updated.");
    setPasswordEditorOpen(false);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function linkDiscordAccount() {
    setDiscordLinkBusy(true);
    setDiscordLinkError(null);
    const { error } = await auth.linkDiscord("/account?tab=profile");
    if (error) {
      setDiscordLinkError(error);
      setDiscordLinkBusy(false);
    }
    // On success the browser navigates away to Discord's OAuth page, so nothing else to do here.
  }

  async function sendReset() {
    if (!email) {
      setResetNotice(
        "No email on this account. If you signed in with Discord only, open Discord settings and add a verified email, then try again.",
      );
      return;
    }
    setResetBusy(true);
    setResetNotice(null);
    try {
      const redirectTo = `${sitePublicUrl() || window.location.origin}/auth/callback?next=${encodeURIComponent("/account?tab=profile")}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setResetNotice(
        "Reset link sent. It expires in a few hours — open it to set a new password immediately.",
      );
    } catch (err) {
      setResetNotice(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setResetBusy(false);
    }
  }

  async function sendFriendRequest(username: string) {
    const value = username.trim().replace(/^@/, "");
    if (!value) return;
    setFriendBusy(true);
    setFriendError(null);
    setFriendNotice(null);
    try {
      const result = await siteApi.requestFriend({ username: value });
      setFriendQuery("");
      setFriendNotice(
        result.autoAccepted
          ? `You are now friends with @${result.peer.username}.`
          : `Friend request sent to @${result.peer.username}.`,
      );
      const refreshed = await siteApi.listFriends();
      setFriends(refreshed);
    } catch (err) {
      setFriendError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setFriendBusy(false);
    }
  }

  const inboxItems = notifications.regular;

  return (
    <div className="site-account-hub">
      <div className="site-account-tabs" role="tablist" aria-label="Account sections">
        <button
          type="button"
          className="site-account-tab-arrow"
          aria-label="Previous tab"
          onClick={() => shiftTab(-1)}
        >
          ‹
        </button>
        <div className="site-account-tab-track">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "is-active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="site-account-tab-arrow"
          aria-label="Next tab"
          onClick={() => shiftTab(1)}
        >
          ›
        </button>
      </div>

      {tab === "profile" ? (
        <section className="site-account-panel">
          <div className="site-account-identity">
            {linked.avatarUrl ? (
              <img className="site-account-avatar" src={linked.avatarUrl} alt="" />
            ) : (
              <span className="site-account-avatar is-fallback" aria-hidden>
                {initial}
              </span>
            )}
            <div className="site-account-identity-info">
              <h2>@{formatUserIdentity(linked)}</h2>
              {linked.discordUsername ? (
                <p className="site-muted">Discord linked</p>
              ) : (
                <div className="site-account-discord-link">
                  <p className="site-muted">Discord not linked</p>
                  <button
                    type="button"
                    className="site-btn site-btn-primary"
                    disabled={discordLinkBusy}
                    onClick={() => void linkDiscordAccount()}
                  >
                    {discordLinkBusy ? "Redirecting…" : "Link Discord account"}
                  </button>
                </div>
              )}
              {discordLinkError ? <p className="site-auth-error">{discordLinkError}</p> : null}
            </div>
            {isAdmin ? (
              <Link className="site-btn site-btn-ghost" to="/admin" style={{ marginLeft: "auto" }}>
                Admin Management
              </Link>
            ) : null}
          </div>

          <div className="site-account-block">
            <h3>Sign-in</h3>
            <p>
              Email: <strong>{email ?? "Not provided"}</strong>
            </p>
            <div className="site-account-password">
              <p>
                Password{" "}
                <button
                  type="button"
                  className="site-text-link"
                  onClick={() => {
                    setPasswordEditorOpen((open) => !open);
                    setPasswordError(null);
                    setPasswordNotice(null);
                  }}
                >
                  {passwordEditorOpen ? "Cancel" : "Change"}
                </button>
                {" · "}
                <button
                  type="button"
                  className="site-text-link"
                  disabled={resetBusy}
                  onClick={() => void sendReset()}
                >
                  Reset
                </button>
              </p>
              {passwordEditorOpen ? (
                <div className="site-account-password-fields">
                  <input
                    type="password"
                    placeholder="Current password"
                    value={passwordForm.current}
                    onChange={(e) =>
                      setPasswordForm((current) => ({ ...current, current: e.target.value }))
                    }
                  />
                  <input
                    type="password"
                    placeholder="New password"
                    value={passwordForm.next}
                    onChange={(e) =>
                      setPasswordForm((current) => ({ ...current, next: e.target.value }))
                    }
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={passwordForm.confirm}
                    onChange={(e) =>
                      setPasswordForm((current) => ({ ...current, confirm: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="site-btn site-btn-primary"
                    disabled={passwordBusy}
                    onClick={() => void changePassword()}
                  >
                    {passwordBusy ? "Saving..." : "Save password"}
                  </button>
                </div>
              ) : null}
              {passwordError ? <p className="site-auth-error">{passwordError}</p> : null}
              {passwordNotice ? <p className="site-auth-success">{passwordNotice}</p> : null}
              {resetNotice ? <p className="site-muted">{resetNotice}</p> : null}
              <p className="site-muted">
                Discord OAuth usually includes a verified Discord email (`identify email`
                scope). Reset emails go there when available.
              </p>
            </div>
          </div>

          <div className="site-billing-panel">
            <h2>Billing</h2>
            {entitlements ? (
              <>
                <p>
                  Plan: <strong>{tierLabel(entitlements.tier)}</strong>
                  {" · "}
                  Fee: <strong>{monthlyFee(entitlements.tier, entitlements.billingStatus)}</strong>
                </p>
                <p className="site-muted">
                  Status: {entitlements.billingStatus}
                  {entitlements.billingStatus === "promo_trial" && entitlements.promoTrialEndsAt
                    ? ` · Free until ${new Date(entitlements.promoTrialEndsAt).toLocaleDateString()}, then payment is required`
                    : entitlements.currentPeriodEnd
                      ? ` · Next renewal ${new Date(entitlements.currentPeriodEnd).toLocaleDateString()}`
                      : entitlements.billingStatus === "lifetime_comp"
                        ? " · No renewal"
                        : ""}
                </p>
                {billingError ? <p className="site-auth-error">{billingError}</p> : null}
                <div className="site-profile-actions">
                  <button
                    type="button"
                    className="site-btn site-btn-ghost"
                    disabled={billingBusy}
                    onClick={onOpenBilling}
                  >
                    {billingBusy ? "Opening…" : "Manage billing"}
                  </button>
                  <Link className="site-btn site-btn-ghost" to="/pricing">
                    View plans
                  </Link>
                </div>
              </>
            ) : (
              <p className="site-muted">Billing details unavailable.</p>
            )}
          </div>

          {pushSupported() ? (
            <div className="site-account-block">
              <h3>Notifications</h3>
              <button
                type="button"
                className="site-btn site-btn-ghost"
                disabled={pushBusy}
                onClick={() => void togglePushNotifications()}
              >
                {pushBusy
                  ? "Working…"
                  : pushEnabled
                    ? "Disable Push Notifications"
                    : "Enable Push Notifications"}
              </button>
              {pushError ? <p className="site-auth-error">{pushError}</p> : null}
            </div>
          ) : null}

          <MobileAppSetup />
        </section>
      ) : null}

            {tab === "stats" ? (
        <section className="site-account-panel">
          <h2>Global stats</h2>
          <div className="site-account-stat-grid">
            <article>
              <span>All-time record</span>
              <strong>{homeCard?.globalRecord?.text ?? "0-0"}</strong>
            </article>
            <article>
              <span>User rating</span>
              <strong>
                {homeCard?.userRating?.displayAsGrade
                  ? homeCard.userRating.grade
                  : homeCard?.userRating?.rating ?? "-"}
              </strong>
            </article>
          </div>

          <h3>Stats by game</h3>
          {careerGames.length ? (
            <div className="site-account-game-stats">
              {careerGames.map((game) => (
                <details key={game.game} className="site-account-game-block">
                  <summary>{game.gameLabel}</summary>
                  <div className="site-account-stat-grid">
                    <article><span>Games logged</span><strong>{game.gamesLogged}</strong></article>
                    <article><span>Passing yards</span><strong>{game.passingYards.toLocaleString()}</strong></article>
                    <article><span>Rushing yards</span><strong>{game.rushingYards.toLocaleString()}</strong></article>
                    <article><span>Total yards</span><strong>{game.totalYards.toLocaleString()}</strong></article>
                    <article><span>First downs</span><strong>{game.firstDowns.toLocaleString()}</strong></article>
                    <article><span>TO generated</span><strong>{game.turnoversGenerated}</strong></article>
                    <article><span>TO committed</span><strong>{game.turnoversCommitted}</strong></article>
                    <article><span>TO differential</span><strong>{game.turnoverDifferential}</strong></article>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="site-muted">No box-score career stats logged yet.</p>
          )}

          <p className="site-muted">
            League awards live on each league&apos;s My Team page.
          </p>
        </section>
      ) : null}

      {tab === "friends" ? (
        <section className="site-account-panel">
          <h2>Friends</h2>
          <div className="site-account-friend-search">
            <input
              value={friendQuery}
              onChange={(e) => setFriendQuery(e.target.value)}
              placeholder="Search username or shared-league coaches"
              list="site-friend-suggestions"
            />
            <datalist id="site-friend-suggestions">
              {filteredSuggestions.map((item) => (
                <option key={item.userId} value={item.username}>
                  {item.displayName}
                </option>
              ))}
            </datalist>
            <button
              type="button"
              className="site-btn site-btn-primary"
              disabled={friendBusy || !friendQuery.trim()}
              onClick={() => void sendFriendRequest(friendQuery)}
            >
              Send request
            </button>
          </div>
          {friendError ? <p className="site-auth-error">{friendError}</p> : null}
          {friendNotice ? <p className="site-auth-success">{friendNotice}</p> : null}
          {filteredSuggestions.length ? (
            <div className="site-account-suggestion-list">
              <p className="site-muted">Shared-league coaches</p>
              {filteredSuggestions.slice(0, 12).map((item) => (
                <button
                  key={item.userId}
                  type="button"
                  className="site-account-suggestion"
                  onClick={() => void sendFriendRequest(item.username)}
                >
                  @{item.username}
                  <span>{item.displayName}</span>
                </button>
              ))}
            </div>
          ) : null}
          <h3>Your friends</h3>
          {friends.accepted.length ? (
            <ul className="site-account-friend-list">
              {friends.accepted.map((friend) => (
                <li key={friend.friendshipId}>
                  <strong>@{friend.peer.username}</strong>
                  <span>{friend.peer.displayName}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">No friends yet.</p>
          )}
          {friends.pendingIncoming.length ? (
            <>
              <h3>Incoming requests</h3>
              <ul className="site-account-friend-list">
                {friends.pendingIncoming.map((friend) => (
                  <li key={friend.friendshipId}>
                    <strong>@{friend.peer.username}</strong>
                    <span className="site-profile-actions">
                      <button
                        type="button"
                        className="site-btn site-btn-primary"
                        onClick={() =>
                          void siteApi
                            .respondFriend(friend.friendshipId, "accept")
                            .then(() => siteApi.listFriends())
                            .then(setFriends)
                        }
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="site-btn site-btn-ghost"
                        onClick={() =>
                          void siteApi
                            .respondFriend(friend.friendshipId, "decline")
                            .then(() => siteApi.listFriends())
                            .then(setFriends)
                        }
                      >
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === "inbox" ? (
        <section className="site-account-panel">
          <div className="site-profile-actions">
            <Link className="site-btn site-btn-primary" to="/inbox">
              Open messages
            </Link>
          </div>
          <p className="site-muted">
            Commissioner review items (box scores, highlights, payouts, and more) now live in
            the Commissioner&apos;s Office chat window&apos;s Payouts tab under League Mgmt.
          </p>
          <h3>Notifications</h3>
          {inboxItems.length ? (
            <ul className="site-account-notif-list">
              {inboxItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  {item.body ? <span>{item.body}</span> : null}
                  <Link to={item.href}>Open</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">No notifications in this inbox.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
