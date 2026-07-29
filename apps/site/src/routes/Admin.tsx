import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { startImpersonation } from "../lib/impersonation.js";
import {
  siteApi,
  type AdminAnnouncement,
  type AdminLeagueMember,
  type AdminLeagueSummary,
  type AdminStats,
  type AdminUserSummary,
} from "../lib/site-api.js";

type AdminTab = "stats" | "ticker" | "leagues" | "impersonate";

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "stats", label: "Stats" },
  { id: "ticker", label: "Ticker" },
  { id: "leagues", label: "Leagues" },
  { id: "impersonate", label: "View As" },
];

const EMPTY_DRAFT = {
  title: "",
  body: "",
  href: "",
  published: true,
  sortOrder: 0,
};

function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    siteApi
      .getAdminStats()
      .then((result) => {
        if (active) setStats(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load stats.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="site-auth-error">{error}</p>;
  if (!stats) return <p className="site-muted">Loading…</p>;

  const notLinked = stats.totalUsers - stats.siteLinkedUsers;
  const topRows: Array<[string, number]> = [
    ["Total accounts", stats.totalUsers],
    ["Registered on site", stats.siteLinkedUsers],
    ["Discord-only (not registered)", notLinked],
    ["New accounts (7d)", stats.usersLast7d],
  ];
  const subRows: Array<[string, number]> = [
    ["Platinum — registered", stats.linkedPlatinum],
    ["Platinum — unclaimed (Discord-only)", stats.unlinkedPlatinum],
    ["Gold — registered", stats.linkedGold],
    ["Gold — unclaimed (Discord-only)", stats.unlinkedGold],
  ];
  const leagueRows: Array<[string, number]> = [
    ["Total leagues", stats.totalLeagues],
    ["New leagues (7d)", stats.leaguesLast7d],
  ];

  function grid(rows: Array<[string, number]>) {
    return (
      <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {rows.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {grid(topRows)}
      <p className="site-muted">
        Subscription tier and site registration are independent — a user can hold free
        lifetime Platinum without ever creating a site login (that's who the free-claim DM
        campaign targets). {stats.platinumSubscribers} total Platinum subscribers:{" "}
        {stats.linkedPlatinum} registered, {stats.unlinkedPlatinum} unclaimed.
      </p>
      {grid(subRows)}
      {grid(leagueRows)}
    </div>
  );
}

function TickerPanel() {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return siteApi.listAdminAnnouncements().then((res) => setItems(res.announcements));
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load ticker items."));
  }, []);

  function startEdit(item: AdminAnnouncement) {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      body: item.body,
      href: item.href ?? "",
      published: item.published,
      sortOrder: item.sort_order,
    });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!draft.title.trim() || !draft.body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        href: draft.href.trim() || null,
        published: draft.published,
        sortOrder: draft.sortOrder,
      };
      if (editingId) {
        await siteApi.updateAdminAnnouncement({ id: editingId, ...payload });
      } else {
        await siteApi.createAdminAnnouncement(payload);
      }
      await reload();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save ticker item.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await siteApi.deleteAdminAnnouncement(id);
      await reload();
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete ticker item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-billing-panel">
      <h2>{editingId ? "Edit ticker item" : "New ticker item"}</h2>
      {error && <p className="site-auth-error">{error}</p>}
      <label className="site-field">
        <span>Title</span>
        <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
      </label>
      <label className="site-field">
        <span>Body</span>
        <input value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
      </label>
      <label className="site-field">
        <span>Link (optional)</span>
        <input value={draft.href} onChange={(e) => setDraft((d) => ({ ...d, href: e.target.value }))} />
      </label>
      <label className="site-field">
        <span>Sort order</span>
        <input
          type="number"
          value={draft.sortOrder}
          onChange={(e) => setDraft((d) => ({ ...d, sortOrder: Number(e.target.value) || 0 }))}
        />
      </label>
      <label className="site-field-checkbox">
        <input
          type="checkbox"
          checked={draft.published}
          onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
        />
        <span>Published</span>
      </label>
      <div className="site-profile-actions">
        <button className="site-btn site-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : editingId ? "Save changes" : "Add to ticker"}
        </button>
        {editingId ? (
          <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={resetForm}>
            Cancel
          </button>
        ) : null}
      </div>

      <h3>Current items</h3>
      {items.length === 0 ? (
        <p className="site-muted">No ticker items yet.</p>
      ) : (
        <ul className="site-account-notif-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>
                {item.title} {item.published ? "" : "(unpublished)"}
              </strong>
              <span>{item.body}</span>
              <div className="site-profile-actions">
                <button className="site-btn site-btn-ghost" type="button" onClick={() => startEdit(item)}>
                  Edit
                </button>
                <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={() => void remove(item.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeaguesPanel() {
  const [leagues, setLeagues] = useState<AdminLeagueSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminLeagueSummary | null>(null);
  const [members, setMembers] = useState<AdminLeagueMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  function reload() {
    return siteApi.listAdminLeagues({ query: query.trim() || undefined }).then((res) => setLeagues(res.leagues));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load leagues."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function openLeague(league: AdminLeagueSummary) {
    setSelected(league);
    setConfirmText("");
    setError(null);
    try {
      const res = await siteApi.listAdminLeagueMembers(league.id);
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load league members.");
    }
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.removeAdminLeagueMember({ leagueId: selected.id, userId });
      const res = await siteApi.listAdminLeagueMembers(selected.id);
      setMembers(res.members);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLeague() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.deleteAdminLeague({ leagueId: selected.id, confirmationText: confirmText });
      setSelected(null);
      setMembers([]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete league.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-billing-panel">
      <label className="site-field">
        <span>Search leagues</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="League name" />
      </label>
      {error && <p className="site-auth-error">{error}</p>}
      <ul className="site-account-notif-list">
        {leagues.map((league) => (
          <li key={league.id}>
            <strong>{league.name}</strong>
            <span>
              {league.game} · {league.currentPhase} · {league.memberCount} members · {league.teamCount} teams
              {league.ownerUsername ? ` · Owner @${league.ownerUsername}` : ""}
            </span>
            <div className="site-profile-actions">
              <button className="site-btn site-btn-ghost" type="button" onClick={() => void openLeague(league)}>
                Manage
              </button>
            </div>
          </li>
        ))}
      </ul>

      {selected ? (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
          <h3>{selected.name}</h3>
          <h4>Members</h4>
          {members.length === 0 ? (
            <p className="site-muted">No members on record.</p>
          ) : (
            <ul className="site-account-notif-list">
              {members.map((member) => (
                <li key={member.userId}>
                  <strong>@{member.username ?? member.displayName}</strong>
                  <span>
                    {member.teamName ?? "No team"} {member.membershipRole ? `· ${member.membershipRole}` : ""}
                  </span>
                  <div className="site-profile-actions">
                    <button
                      className="site-btn site-btn-ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeMember(member.userId)}
                    >
                      Remove from league
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h4>Delete league</h4>
          <p className="site-muted">
            Permanently deletes this league and every row scoped to it. Type the league name exactly to confirm.
          </p>
          <label className="site-field">
            <span>Type "{selected.name}" to confirm</span>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
          <button
            className="site-btn site-btn-ghost"
            type="button"
            disabled={busy || confirmText.trim().toLowerCase() !== selected.name.trim().toLowerCase()}
            onClick={() => void deleteLeague()}
          >
            {busy ? "Working…" : "Delete league permanently"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ImpersonatePanel() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      siteApi
        .searchAdminUsers({ query: query.trim() || undefined })
        .then((res) => setUsers(res.users))
        .catch((err) => setError(err instanceof Error ? err.message : "Could not search users."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function viewAs(user: AdminUserSummary) {
    setBusyId(user.id);
    setError(null);
    try {
      const result = await siteApi.impersonateUser(user.id);
      await startImpersonation(result);
      window.location.assign("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start impersonation.");
      setBusyId(null);
    }
  }

  return (
    <div className="site-billing-panel">
      <p className="site-muted">
        Loads the site as the selected user for support/debugging. Use "Return to admin account" in the
        banner to switch back.
      </p>
      <label className="site-field">
        <span>Search users</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username" />
      </label>
      {error && <p className="site-auth-error">{error}</p>}
      <ul className="site-account-notif-list">
        {users.map((user) => (
          <li key={user.id}>
            <strong>@{user.username ?? user.displayName}</strong>
            <span>
              {user.subscriptionTier} {user.hasSiteAccount ? "" : "· no site account"}
            </span>
            <div className="site-profile-actions">
              <button
                className="site-btn site-btn-ghost"
                type="button"
                disabled={!user.hasSiteAccount || busyId === user.id}
                onClick={() => void viewAs(user)}
              >
                {busyId === user.id ? "Loading…" : "View as"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminPage() {
  const [status, setStatus] = useState<"loading" | "allowed" | "denied">("loading");
  const [tab, setTab] = useState<AdminTab>("stats");

  useEffect(() => {
    let active = true;
    siteApi
      .getAdminStatus()
      .then((res) => {
        if (active) setStatus(res.isAdmin ? "allowed" : "denied");
      })
      .catch(() => {
        if (active) setStatus("denied");
      });
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return <div className="site-page site-loading">Loading…</div>;
  }
  if (status === "denied") {
    return <Navigate to="/account" replace />;
  }

  return (
    <div className="site-page-card">
      <h1>Admin Management</h1>
      <div className="site-account-tabs" role="tablist" aria-label="Admin sections">
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
      </div>

      {tab === "stats" ? <StatsPanel /> : null}
      {tab === "ticker" ? <TickerPanel /> : null}
      {tab === "leagues" ? <LeaguesPanel /> : null}
      {tab === "impersonate" ? <ImpersonatePanel /> : null}
    </div>
  );
}
