import { useEffect, useState, type ReactNode } from "react";
import type { RecGlobalEconomyConfig } from "@rec/shared";
import { Navigate } from "react-router-dom";
import { startImpersonation } from "../lib/impersonation.js";
import {
  siteApi,
  type AdminAnnouncement,
  type AdminDiscordConfig,
  type AdminIncident,
  type AdminLeagueMember,
  type AdminLeagueSummary,
  type AdminStats,
  type AdminUserSummary,
  type IncidentPatternSummary,
  type PromoCode,
  type PromoCodeEffectType,
} from "../lib/site-api.js";

type AdminTab = "stats" | "ticker" | "leagues" | "impersonate" | "promo-codes" | "economy" | "discord" | "errors";

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "stats", label: "Stats" },
  { id: "ticker", label: "Ticker" },
  { id: "leagues", label: "Leagues" },
  { id: "impersonate", label: "View As" },
  { id: "promo-codes", label: "Promo Codes" },
  { id: "economy", label: "Economy Values" },
  { id: "discord", label: "Discord" },
  { id: "errors", label: "Error Log" },
];

const EMPTY_DRAFT = {
  title: "",
  body: "",
  href: "",
  published: true,
  sortOrder: 0,
};

function ExpandableStatTile({ label, value, expanded, onToggle, children }: { label: string; value: number; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <article style={{ gridColumn: expanded ? "1 / -1" : undefined }}>
      <button type="button" onClick={onToggle} style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}>
        <span>{label} {expanded ? "▾" : "▸"}</span>
        <strong>{value.toLocaleString()}</strong>
      </button>
      {expanded && <div style={{ marginTop: 8 }}>{children}</div>}
    </article>
  );
}

function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<"recentUsers" | "recentLeagues" | null>(null);
  const [recentUsers, setRecentUsers] = useState<AdminUserSummary[] | null>(null);
  const [recentLeagues, setRecentLeagues] = useState<AdminLeagueSummary[] | null>(null);

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

  function toggleRecentUsers() {
    setExpanded((current) => (current === "recentUsers" ? null : "recentUsers"));
    if (!recentUsers) siteApi.listRecentAdminUsers().then((res) => setRecentUsers(res.users)).catch(() => setRecentUsers([]));
  }

  function toggleRecentLeagues() {
    setExpanded((current) => (current === "recentLeagues" ? null : "recentLeagues"));
    if (!recentLeagues) {
      siteApi.listAdminLeagues({ limit: 300 }).then((res) => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        setRecentLeagues(res.leagues.filter((league) => new Date(league.createdAt).getTime() >= cutoff));
      }).catch(() => setRecentLeagues([]));
    }
  }

  if (error) return <p className="site-auth-error">{error}</p>;
  if (!stats) return <p className="site-muted">Loading…</p>;

  const notLinked = stats.totalUsers - stats.siteLinkedUsers;
  const subRows: Array<[string, number]> = [
    ["Platinum — registered", stats.linkedPlatinum],
    ["Platinum — unclaimed (Discord-only)", stats.unlinkedPlatinum],
    ["Gold — registered", stats.linkedGold],
    ["Gold — unclaimed (Discord-only)", stats.unlinkedGold],
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
      <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <article><span>Total accounts</span><strong>{stats.totalUsers.toLocaleString()}</strong></article>
        <article><span>Registered on site</span><strong>{stats.siteLinkedUsers.toLocaleString()}</strong></article>
        <article><span>Discord-only (not registered)</span><strong>{notLinked.toLocaleString()}</strong></article>
        <ExpandableStatTile label="New accounts (7d)" value={stats.usersLast7d} expanded={expanded === "recentUsers"} onToggle={toggleRecentUsers}>
          {recentUsers == null ? <p className="site-muted">Loading…</p> : recentUsers.length === 0 ? <p className="site-muted">No new accounts in the last 7 days.</p> : (
            <ul className="site-account-notif-list">
              {recentUsers.map((user) => (
                <li key={user.id}>
                  <strong>@{user.username || user.displayName || "Unresolved account"}</strong>
                  <span>{user.subscriptionTier}{user.hasSiteAccount ? "" : " · Discord-only"}</span>
                </li>
              ))}
            </ul>
          )}
        </ExpandableStatTile>
      </div>
      <p className="site-muted">
        Subscription tier and site registration are independent — a user can hold free
        lifetime Platinum without ever creating a site login (that's who the free-claim DM
        campaign targets). {stats.platinumSubscribers} total Platinum subscribers:{" "}
        {stats.linkedPlatinum} registered, {stats.unlinkedPlatinum} unclaimed.
      </p>
      {grid(subRows)}
      <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <article><span>Total leagues</span><strong>{stats.totalLeagues.toLocaleString()}</strong></article>
        <ExpandableStatTile label="New leagues (7d)" value={stats.leaguesLast7d} expanded={expanded === "recentLeagues"} onToggle={toggleRecentLeagues}>
          {recentLeagues == null ? <p className="site-muted">Loading…</p> : recentLeagues.length === 0 ? <p className="site-muted">No new leagues in the last 7 days.</p> : (
            <ul className="site-account-notif-list">
              {recentLeagues.map((league) => (
                <li key={league.id}>
                  <strong>{league.name}</strong>
                  <span>{league.game} · {league.currentPhase} · {league.memberCount} members · {league.teamCount} teams{league.ownerUsername ? ` · Owner @${league.ownerUsername}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </ExpandableStatTile>
      </div>
      <section>
        <h3>Open operational incidents ({stats.openIncidents.length})</h3>
        {stats.openIncidents.length ? stats.openIncidents.map((incident) => (
          <article key={incident.id} className="site-card" style={{ marginBottom: 12 }}>
            <strong>[{incident.severity.toUpperCase()}] {incident.title}</strong>
            <p className="site-muted">{incident.process} · {new Date(incident.occurredAt).toLocaleString()} · League {incident.leagueId ?? "deleted/unavailable"}</p>
            {incident.errorMessage && <p><strong>Cause:</strong> {incident.errorName ?? "Error"}: {incident.errorMessage}</p>}
            {(incident.errorStack || incident.detail) && (
              <details>
                <summary>Debug details</summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{incident.errorStack ?? incident.detail}</pre>
              </details>
            )}
          </article>
        )) : <p className="site-muted">No open incidents.</p>}
      </section>
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
    if (!window.confirm("Delete this ticker item?")) return;
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
    if (!window.confirm("Remove this member from the league?")) return;
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

const PROMO_EFFECT_LABELS: Record<PromoCodeEffectType, string> = {
  lifetime_platinum: "Free lifetime Platinum",
  lifetime_gold: "Free lifetime Gold",
  bonus_coins: "Coin bonus",
  trial_gold: "Free trial — Gold",
  trial_platinum: "Free trial — Platinum",
};

function isTrialPromoEffect(effectType: PromoCodeEffectType): boolean {
  return effectType === "trial_gold" || effectType === "trial_platinum";
}

const EMPTY_PROMO_DRAFT = {
  code: "",
  description: "",
  effectType: "lifetime_platinum" as PromoCodeEffectType,
  coinAmount: "1000",
  trialMonths: "1",
  reusable: true,
  hasExpiration: false,
  endsAt: "",
};

function PromoCodesPanel() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [draft, setDraft] = useState(EMPTY_PROMO_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return siteApi.listPromoCodes().then((res) => setCodes(res.codes));
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load promo codes."));
  }, []);

  function startEdit(promo: PromoCode) {
    setEditingId(promo.id);
    setDraft({
      code: promo.code,
      description: promo.description ?? "",
      effectType: promo.effectType,
      coinAmount: String(promo.effectValue ?? 1000),
      trialMonths: String(promo.effectValue ?? 1),
      reusable: promo.maxRedemptions == null,
      hasExpiration: promo.endsAt != null,
      endsAt: promo.endsAt ? promo.endsAt.slice(0, 16) : "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(EMPTY_PROMO_DRAFT);
  }

  async function save() {
    if (!draft.code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const isTrial = isTrialPromoEffect(draft.effectType);
      const payload = {
        code: draft.code.trim(),
        description: draft.description.trim() || null,
        effectType: draft.effectType,
        effectValue: draft.effectType === "bonus_coins" ? Number(draft.coinAmount) || 0 : isTrial ? Number(draft.trialMonths) || 0 : null,
        // Free-trial codes are always one-time use — a single code can't be handed out to
        // many people, since each redemption grants a real (if temporary) paid tier for free.
        maxRedemptions: isTrial ? 1 : draft.reusable ? null : 1,
        endsAt: draft.hasExpiration && draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      };
      if (editingId) {
        await siteApi.updatePromoCode({ id: editingId, ...payload });
      } else {
        await siteApi.createPromoCode(payload);
      }
      await reload();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save promo code.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(promo: PromoCode) {
    setBusy(true);
    setError(null);
    try {
      await siteApi.updatePromoCode({ id: promo.id, active: !promo.active });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update promo code.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this promo code? Anyone who hasn't redeemed it yet won't be able to.")) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.deletePromoCode(id);
      await reload();
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete promo code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-billing-panel">
      <h2>{editingId ? "Edit promo code" : "New promo code"}</h2>
      {error && <p className="site-auth-error">{error}</p>}
      <label className="site-field">
        <span>Code</span>
        <input
          value={draft.code}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
          placeholder="e.g. LAUNCH2026"
        />
      </label>
      <label className="site-field">
        <span>Description (internal note, optional)</span>
        <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
      </label>
      <label className="site-field">
        <span>Triggers</span>
        <select
          className="site-select"
          value={draft.effectType}
          onChange={(e) => setDraft((d) => ({ ...d, effectType: e.target.value as PromoCodeEffectType }))}
        >
          {(Object.keys(PROMO_EFFECT_LABELS) as PromoCodeEffectType[]).map((key) => (
            <option key={key} value={key}>{PROMO_EFFECT_LABELS[key]}</option>
          ))}
        </select>
      </label>
      {draft.effectType === "bonus_coins" ? (
        <label className="site-field">
          <span>Coin amount</span>
          <input
            type="number"
            min={1}
            value={draft.coinAmount}
            onChange={(e) => setDraft((d) => ({ ...d, coinAmount: e.target.value }))}
          />
        </label>
      ) : null}
      {isTrialPromoEffect(draft.effectType) ? (
        <label className="site-field">
          <span>Free trial length (months)</span>
          <input
            type="number"
            min={1}
            value={draft.trialMonths}
            onChange={(e) => setDraft((d) => ({ ...d, trialMonths: e.target.value }))}
          />
        </label>
      ) : null}
      {isTrialPromoEffect(draft.effectType) ? (
        <p className="site-muted">Free-trial codes are always one-time use — this code can only be redeemed once, by one person.</p>
      ) : (
        <label className="site-field-checkbox">
          <input
            type="checkbox"
            checked={draft.reusable}
            onChange={(e) => setDraft((d) => ({ ...d, reusable: e.target.checked }))}
          />
          <span>Reusable (unchecked = one-time use, then no one else can redeem it)</span>
        </label>
      )}
      <label className="site-field-checkbox">
        <input
          type="checkbox"
          checked={draft.hasExpiration}
          onChange={(e) => setDraft((d) => ({ ...d, hasExpiration: e.target.checked }))}
        />
        <span>Set an expiration (unchecked = active indefinitely until deleted/deactivated)</span>
      </label>
      {draft.hasExpiration ? (
        <label className="site-field">
          <span>Expires at</span>
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
          />
        </label>
      ) : null}
      <div className="site-profile-actions">
        <button className="site-btn site-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : editingId ? "Save changes" : "Create promo code"}
        </button>
        {editingId ? (
          <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={resetForm}>
            Cancel
          </button>
        ) : null}
      </div>

      <h3>Existing codes</h3>
      {codes.length === 0 ? (
        <p className="site-muted">No promo codes yet.</p>
      ) : (
        <ul className="site-account-notif-list">
          {codes.map((promo) => (
            <li key={promo.id}>
              <strong>
                {promo.code} {promo.active ? "" : "(inactive)"}
              </strong>
              <span>
                {PROMO_EFFECT_LABELS[promo.effectType]}
                {promo.effectType === "bonus_coins" ? ` · ${promo.effectValue ?? 0} coins` : ""}
                {isTrialPromoEffect(promo.effectType) ? ` · ${promo.effectValue ?? 0} month${promo.effectValue === 1 ? "" : "s"} free, then payment required` : ""}
                {" · "}
                {promo.maxRedemptions == null ? "Reusable" : `One-time (${promo.redemptionCount}/${promo.maxRedemptions} used)`}
                {promo.endsAt ? ` · Expires ${new Date(promo.endsAt).toLocaleString()}` : " · No expiration"}
              </span>
              <div className="site-profile-actions">
                <button className="site-btn site-btn-ghost" type="button" onClick={() => startEdit(promo)}>
                  Edit
                </button>
                <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={() => void toggleActive(promo)}>
                  {promo.active ? "Deactivate" : "Activate"}
                </button>
                <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={() => void remove(promo.id)}>
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

const ECONOMY_LABELS: Record<string, string> = {
  ageReset: "Age reset", legend: "Legend", immortal: "Immortal", devUpgradeStep: "Development upgrade step",
  devUpgradeTopStep: "Top development-tier step", contractReduction: "Contract reduction", contractExtension: "Contract extension",
  coreAttributePoint: "Core attribute point", nonCoreAttributePoint: "Non-core attribute point", boxScoreWin: "Box score — win",
  customPlayerTier1: "Custom player — Tier 1", customPlayerTier2: "Custom player — Tier 2", customPlayerTier3: "Custom player — Tier 3", customPlayerTier4: "Custom player — Tier 4", customPlayerTier5: "Custom player — Tier 5",
  boxScoreLoss: "Box score — loss", badgeBonus: "Badge bonus", highlight: "Highlight", highlightWeeklyPaidLimit: "Paid highlights per week",
  highlightSeasonAward: "Season highlight award", gameOfYear: "Game of the Year",
  highlightWeeklyUploadLimit: "Highlight uploads per week", stream: "Stream", article: "Article", interview: "Interview",
  gotwCorrectVote: "Correct GOTW vote", potw: "Player of the Week", houseWeeklyMaximum: "House wager weekly maximum",
  peerWeeklyMaximum: "User wager weekly maximum", bestPassing: "Best Passing Game", bestRushing: "Best Rushing Game",
  bestDefense: "Best Defense", mvp: "MVP / Heisman", mostSkilled: "Best User Skills", mostHeart: "Most Heart",
};

function EconomyValuesPanel() {
  const [config, setConfig] = useState<RecGlobalEconomyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { siteApi.getAdminEconomyConfig().then(setConfig).catch((err) => setError(err instanceof Error ? err.message : "Could not load economy values.")); }, []);

  function setSectionValue(section: "store" | "submissions" | "wagers" | "awards", key: string, value: number) {
    setConfig((current) => current ? ({ ...current, [section]: { ...current[section], [key]: value } }) : current);
  }

  function section(title: string, key: "store" | "submissions" | "wagers" | "awards") {
    if (!config) return null;
    return <section className="site-billing-panel"><h2>{title}</h2><div className="site-account-stat-grid">
      {Object.entries(config[key]).map(([field, value]) => <label className="site-field" key={field}><span>{ECONOMY_LABELS[field] ?? field}</span>
        <input type="number" min={0} step={1} value={value} onChange={(event) => setSectionValue(key, field, Number(event.target.value))} />
      </label>)}
    </div></section>;
  }

  function setTier(definitionIndex: number, tierIndex: number, field: "threshold" | "amount", value: number) {
    setConfig((current) => {
      if (!current) return current;
      const eos = current.eos.map((definition, di) => di !== definitionIndex ? definition : {
        ...definition, tiers: definition.tiers.map((tier, ti) => ti === tierIndex ? { ...tier, [field]: value } : tier),
      });
      return { ...current, eos };
    });
  }

  async function save() {
    if (!config) return;
    setBusy(true); setError(null); setMessage(null);
    try { const next = await siteApi.updateAdminEconomyConfig(config); setConfig(next); setMessage(`Saved as configuration version ${next.version}. New transactions use these values immediately.`); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save economy values."); }
    finally { setBusy(false); }
  }

  if (!config) return <p className="site-muted">{error ?? "Loading…"}</p>;
  return <div>
    <div className="site-billing-panel"><p className="site-muted">Global, server-authoritative values. Changes affect new purchases, payouts, limits, and EOS calculations; completed ledger entries are never rewritten.</p>
      {error && <p className="site-auth-error">{error}</p>}{message && <p className="site-muted">{message}</p>}
      <button className="site-btn site-btn-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save all economy values"}</button>
    </div>
    {section("Store prices", "store")}{section("Submission and activity payouts", "submissions")}{section("Wager limits", "wagers")}{section("End-of-season awards", "awards")}
    <section className="site-billing-panel"><h2>EOS tier thresholds and payouts</h2>
      {config.eos.map((definition, definitionIndex) => <details key={definition.key} className="site-settings-section"><summary><strong>{definition.label}</strong> <span className="site-muted">({definition.statKey})</span></summary>
        <div className="site-account-stat-grid">{definition.tiers.map((tier, tierIndex) => <div key={tier.tier} className="site-billing-panel"><strong>Tier {tier.tier}</strong>
          <label className="site-field"><span>Threshold ({tier.operator.replaceAll("_", " ")})</span><input type="number" step="any" min={0} value={tier.threshold} onChange={(e) => setTier(definitionIndex, tierIndex, "threshold", Number(e.target.value))} /></label>
          <label className="site-field"><span>Payout</span><input type="number" step={1} min={0} value={tier.amount} onChange={(e) => setTier(definitionIndex, tierIndex, "amount", Number(e.target.value))} /></label>
        </div>)}</div>
      </details>)}
    </section>
  </div>;
}

function DiscordConfigPanel() {
  const [config, setConfig] = useState<AdminDiscordConfig | null>(null);
  const [managementGuildId, setManagementGuildId] = useState("");
  const [madden26Channel, setMadden26Channel] = useState("");
  const [madden27Channel, setMadden27Channel] = useState("");
  const [cfb27Channel, setCfb27Channel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function applyConfig(next: AdminDiscordConfig) {
    setConfig(next);
    setManagementGuildId(next.managementGuildId ?? "");
    setMadden26Channel(next.leaguePostChannels.madden_26 ?? "");
    setMadden27Channel(next.leaguePostChannels.madden_27 ?? "");
    setCfb27Channel(next.leaguePostChannels.cfb_27 ?? "");
  }

  useEffect(() => {
    siteApi.getAdminDiscordConfig().then(applyConfig).catch((err) => setError(err instanceof Error ? err.message : "Could not load Discord config."));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await siteApi.updateAdminDiscordConfig({
        managementGuildId: managementGuildId.trim() || null,
        leaguePostChannels: {
          madden_26: madden26Channel.trim() || null,
          madden_27: madden27Channel.trim() || null,
          cfb_27: cfb27Channel.trim() || null,
        },
      });
      applyConfig(next);
      try {
        const sync = await siteApi.syncAdminDiscordRecruitingAds();
        const games = sync.synced.length ? sync.synced.join(", ") : "none configured";
        setNotice(`Saved. Recruiting ads refreshed (${games}).`);
      } catch (syncErr) {
        setNotice(`Saved, but recruiting-ad refresh failed: ${syncErr instanceof Error ? syncErr.message : "unknown error"}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Discord config.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshAds() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sync = await siteApi.syncAdminDiscordRecruitingAds();
      const games = sync.synced.length ? sync.synced.join(", ") : "none configured";
      setNotice(`Recruiting ads refreshed (${games}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh recruiting ads.");
    } finally {
      setBusy(false);
    }
  }

  if (!config) return <p className="site-muted">Loading…</p>;

  return (
    <div className="site-billing-panel">
      <p className="site-muted">
        The management server is the only Discord server REC Scout is allowed to sit in without being linked to
        an active site league — the bot leaves any other unlinked server automatically once a day. League-post
        channels are where the bot advertises open teams for newly created leagues of that game type.
      </p>
      {error && <p className="site-auth-error">{error}</p>}
      {notice && <p className="site-muted">{notice}</p>}
      <label className="site-field">
        <span>Management server (Discord guild ID)</span>
        <input value={managementGuildId} onChange={(e) => setManagementGuildId(e.target.value)} placeholder="e.g. 1536368873870336071" />
      </label>
      <label className="site-field">
        <span>Madden 26 league-post channel ID</span>
        <input value={madden26Channel} onChange={(e) => setMadden26Channel(e.target.value)} />
      </label>
      <label className="site-field">
        <span>Madden 27 league-post channel ID</span>
        <input value={madden27Channel} onChange={(e) => setMadden27Channel(e.target.value)} />
      </label>
      <label className="site-field">
        <span>CFB 27 league-post channel ID</span>
        <input value={cfb27Channel} onChange={(e) => setCfb27Channel(e.target.value)} />
      </label>
      <div className="site-profile-actions">
        <button className="site-btn site-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="site-btn site-btn-ghost" type="button" disabled={busy} onClick={() => void refreshAds()}>
          {busy ? "Working…" : "Post/refresh ads"}
        </button>
      </div>
    </div>
  );
}

function ImpersonatePanel() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountTab, setAccountTab] = useState<"registered" | "discord">("registered");
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      siteApi
        .searchAdminUsers({ query: query.trim() || undefined })
        .then((res) => setUsers(res.users))
        .catch((err) => setError(err instanceof Error ? err.message : "Could not search users."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="site-billing-panel">
      <p className="site-muted">
        Loads the site as the selected user for support/debugging. Use "Return to admin account" in the
        banner to switch back.
      </p>
      <label className="site-field">
        <span>Search users</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username, email, or Discord name" />
      </label>
      {error && <p className="site-auth-error">{error}</p>}
      <div className="site-account-tabs" role="tablist" aria-label="Account type">
        <div className="site-account-tab-track">
          <button type="button" className={accountTab === "registered" ? "is-active" : ""} onClick={() => setAccountTab("registered")}>Registered users</button>
          <button type="button" className={accountTab === "discord" ? "is-active" : ""} onClick={() => setAccountTab("discord")}>Discord only</button>
        </div>
      </div>
      <ul className="site-account-notif-list admin-user-card-grid">
        {users.filter((user) => accountTab === "registered" ? user.hasSiteAccount : !user.hasSiteAccount).map((user) => (
          <li key={user.id} className="admin-user-card-clickable" role="button" tabIndex={0} onClick={() => setSelectedUser(user)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedUser(user); } }}>
            <strong>@{user.username || user.displayName || "Unresolved account"}</strong>
            <span>
              {user.subscriptionTier}{user.billingStatus === "lifetime_comp" ? " · comp" : ""} {user.hasSiteAccount ? "" : "· no site account"}
            </span>
            {user.email ? <span className="site-muted">{user.email}</span> : null}
            <span className="site-muted">Click to manage →</span>
          </li>
        ))}
      </ul>
      {selectedUser && (
        <AdminPlayerCard
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUserChanged={(replacement) => {
            setUsers((current) => current.map((item) => item.id === replacement.id ? { ...item, ...replacement } : item));
            setSelectedUser((current) => (current ? { ...current, ...replacement } : current));
          }}
        />
      )}
    </div>
  );
}

function AdminPlayerCard({ user, onClose, onUserChanged }: {
  user: AdminUserSummary;
  onClose: () => void;
  onUserChanged: (user: AdminUserSummary) => void;
}) {
  const [busy, setBusy] = useState<"view" | "message" | "tier" | "coins" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [messageTitle, setMessageTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [coinAmount, setCoinAmount] = useState("");

  async function viewAs() {
    setBusy("view");
    setNotice(null);
    try {
      const result = await siteApi.impersonateUser(user.id);
      await startImpersonation(result);
      window.location.assign("/home");
    } catch (err) {
      setNotice({ kind: "error", message: err instanceof Error ? err.message : "Could not start impersonation." });
      setBusy(null);
    }
  }

  async function sendMessage() {
    setBusy("message");
    setNotice(null);
    try {
      const result = await siteApi.sendAdminUserMessage({ userId: user.id, title: messageTitle.trim() || "Message from REC Leagues", body: messageBody.trim() });
      setNotice({ kind: "ok", message: result.channel === "discord" ? "Sent via Discord DM." : "No Discord link — delivered as a site notification instead." });
      setMessaging(false);
      setMessageTitle("");
      setMessageBody("");
    } catch (err) {
      setNotice({ kind: "error", message: err instanceof Error ? err.message : "Could not send message." });
    } finally {
      setBusy(null);
    }
  }

  async function grantTier(tier: "gold" | "platinum" | "none") {
    setBusy("tier");
    setNotice(null);
    try {
      const result = await siteApi.grantUserTier({ userId: user.id, tier });
      onUserChanged({ ...user, subscriptionTier: result.subscriptionTier, billingStatus: result.billingStatus });
      setNotice({ kind: "ok", message: tier === "none" ? "Access revoked." : `Granted ${tier === "platinum" ? "Platinum" : "Gold"} — no subscription required.` });
    } catch (err) {
      setNotice({ kind: "error", message: err instanceof Error ? err.message : "Could not update tier." });
    } finally {
      setBusy(null);
    }
  }

  async function grantCoins() {
    const amount = Number(coinAmount.trim());
    if (!Number.isInteger(amount) || amount <= 0) {
      setNotice({ kind: "error", message: "Enter a positive whole number of coins." });
      return;
    }
    setBusy("coins");
    setNotice(null);
    try {
      const result = await siteApi.grantUserCoins({ userId: user.id, amount });
      setCoinAmount("");
      setNotice({ kind: "ok", message: `Granted ${result.amount.toLocaleString()} coins${result.walletBalance != null ? ` — new balance ${result.walletBalance.toLocaleString()}` : ""}.` });
    } catch (err) {
      setNotice({ kind: "error", message: err instanceof Error ? err.message : "Could not grant coins." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="admin-player-card-title">
      <button type="button" className="site-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="site-modal-panel site-admin-player-card-modal">
        <button type="button" className="site-modal-close" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="admin-player-card-title">@{(user.username || user.displayName || "Unresolved account")}</h2>
        <p className="site-muted">
          {user.subscriptionTier}{user.billingStatus === "lifetime_comp" ? " · comp" : ""}
          {!user.hasSiteAccount ? " · no site account" : " · site account linked"}
        </p>

        {notice && <p className={notice.kind === "error" ? "site-auth-error" : "site-muted"} style={{ marginTop: 8 }}>{notice.message}</p>}

        <div className="site-profile-actions admin-player-card-actions">
          <button
            className="site-btn site-btn-primary"
            type="button"
            disabled={!user.hasSiteAccount || busy === "view"}
            onClick={() => void viewAs()}
          >
            {busy === "view" ? "Loading…" : "View as"}
          </button>
          <button className="site-btn site-btn-ghost" type="button" onClick={() => { setMessaging((m) => !m); setNotice(null); }}>
            Message
          </button>
          <button className="site-btn site-btn-ghost" type="button" disabled={busy === "tier"} onClick={() => void grantTier("gold")}>
            {busy === "tier" ? "…" : "Grant Gold"}
          </button>
          <button className="site-btn site-btn-ghost" type="button" disabled={busy === "tier"} onClick={() => void grantTier("platinum")}>
            {busy === "tier" ? "…" : "Grant Platinum"}
          </button>
          {user.billingStatus === "lifetime_comp" && (
            <button className="site-btn site-btn-ghost" type="button" disabled={busy === "tier"} onClick={() => void grantTier("none")}>
              Revoke comp
            </button>
          )}
        </div>

        {messaging && (
          <div className="site-field" style={{ marginTop: 12 }}>
            <span>Direct message</span>
            <input placeholder="Title" value={messageTitle} onChange={(e) => setMessageTitle(e.target.value)} />
            <textarea rows={4} placeholder="Message body" value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
            <div className="site-profile-actions">
              <button className="site-btn site-btn-primary" type="button" disabled={busy === "message" || !messageBody.trim()} onClick={() => void sendMessage()}>
                {busy === "message" ? "Sending…" : "Send"}
              </button>
              <button className="site-btn site-btn-ghost" type="button" onClick={() => { setMessaging(false); setNotice(null); }}>Cancel</button>
            </div>
          </div>
        )}

        <div className="site-field" style={{ marginTop: 12 }}>
          <span>Grant coins</span>
          <div className="site-profile-actions site-admin-coin-grant-row">
            <input
              type="number"
              min={1}
              step={1}
              placeholder="Amount"
              value={coinAmount}
              onChange={(e) => setCoinAmount(e.target.value)}
              style={{ width: 140 }}
            />
            <button className="site-btn site-btn-primary" type="button" disabled={busy === "coins"} onClick={() => void grantCoins()}>
              {busy === "coins" ? "Granting…" : "Grant coins"}
            </button>
          </div>
        </div>

        <div className="site-modal-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="site-btn site-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Error Log / Incidents Panel ──

function severityColor(severity: string): string {
  if (severity === "critical") return "#dc2626";
  if (severity === "high") return "#ea580c";
  if (severity === "medium") return "#ca8a04";
  return "#65a30d";
}

function statusBadge(status: string): string {
  if (status === "open") return "🔴 Open";
  if (status === "resolved") return "✅ Resolved";
  if (status === "ignored") return "⚪ Ignored";
  return status;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function IncidentsPanel() {
  const [incidents, setIncidents] = useState<AdminIncident[] | null>(null);
  const [patterns, setPatterns] = useState<IncidentPatternSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("open");
  const [filterProcess, setFilterProcess] = useState<string>("");

  function reload() {
    setError(null);
    Promise.all([
      siteApi.listAdminIncidents({ status: filterStatus || undefined, process: filterProcess || undefined, limit: 100 }),
      siteApi.getAdminIncidentPatterns(),
    ]).then(([inc, pat]) => {
      setIncidents(inc.incidents);
      setPatterns(pat);
    }).catch((err) => setError(err instanceof Error ? err.message : "Could not load error log."));
  }

  useEffect(() => { reload(); }, [filterStatus, filterProcess]);

  async function action(incidentId: string, fn: () => Promise<unknown>) {
    setBusy(incidentId);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function messageCommish(incident: AdminIncident) {
    if (!incident.league_id) { setError("This incident isn't tied to a league."); return; }
    setBusy(incident.id);
    try {
      const { conversationId } = await siteApi.openCommissioner(incident.league_id);
      const note = `Regarding error: "${incident.title}" (occurred ${relativeTime(incident.occurred_at)}${incident.occurrence_count > 1 ? `, seen ${incident.occurrence_count}×` : ""}). An admin is looking into this issue.`;
      await siteApi.startAdminIncidentWorkorder({ incidentId: incident.id, conversationId, note });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start workorder.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return (
    <div>
      <p className="site-auth-error">{error}</p>
      <button type="button" onClick={() => { setError(null); reload(); }} className="site-account-button">Retry</button>
    </div>
  );
  if (!incidents || !patterns) return <p className="site-muted">Loading error log…</p>;

  const maxDaily = Math.max(1, ...patterns.dailyVolume.map((d) => d.count));

  return (
    <div>
      {/* Volume summary */}
      <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 16 }}>
        <article><span>Open</span><strong style={{ color: "#dc2626" }}>{patterns.open}</strong></article>
        <article><span>Resolved</span><strong style={{ color: "#16a34a" }}>{patterns.resolved}</strong></article>
        <article><span>Ignored</span><strong>{patterns.ignored}</strong></article>
        <article><span>Last 24h</span><strong>{patterns.last24h}</strong></article>
        <article><span>Last 7d</span><strong>{patterns.last7d}</strong></article>
        <article><span>Total</span><strong>{patterns.total}</strong></article>
      </div>

      {/* Sparkline */}
      {patterns.dailyVolume.some((d) => d.count > 0) && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: "0.85rem", color: "var(--site-muted, #888)" }}>Error volume (last 14 days)</strong>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48, marginTop: 4 }}>
            {patterns.dailyVolume.map((d) => (
              <div key={d.date} title={`${d.date}: ${d.count}`} style={{
                flex: 1, height: `${(d.count / maxDaily) * 100}%`, minHeight: 2,
                background: d.count > 0 ? "#dc2626" : "#e5e7eb", borderRadius: 2,
                opacity: d.count > 0 ? 1 : 0.4,
              }} />
            ))}
          </div>
        </div>
      )}

      {/* Top patterns */}
      {patterns.topPatterns.length > 0 && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Top recurring patterns ({patterns.topPatterns.length})</summary>
          <ul className="site-account-notif-list" style={{ marginTop: 8 }}>
            {patterns.topPatterns.map((p) => (
              <li key={p.fingerprint}>
                <strong>{p.title}</strong>
                <span>{p.process} · {p.occurrenceCount}× since {relativeTime(p.firstSeenAt)} · {statusBadge(p.status)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Status:{" "}
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
            <option value="">All</option>
          </select>
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Process:{" "}
          <input type="text" placeholder="filter…" value={filterProcess} onChange={(e) => setFilterProcess(e.target.value)} style={{ width: 180 }} />
        </label>
      </div>

      {/* Incident list */}
      {incidents.length === 0 ? (
        <p className="site-muted">No incidents match this filter.</p>
      ) : incidents.map((incident) => (
        <article key={incident.id} className="site-card" style={{ marginBottom: 12, borderLeft: `4px solid ${severityColor(incident.severity)}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>[{incident.severity.toUpperCase()}] {incident.title}</strong>
              {incident.occurrence_count > 1 && (
                <span style={{ marginLeft: 8, padding: "2px 6px", background: "#fef3c7", borderRadius: 4, fontSize: "0.75rem", fontWeight: 600 }}>
                  {incident.occurrence_count}× repeats
                </span>
              )}
              <p className="site-muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                {incident.process} · {relativeTime(incident.last_seen_at)}
                {incident.occurrence_count > 1 && ` · first seen ${relativeTime(incident.first_seen_at)}`}
                {incident.league_id && ` · League `}
                {incident.league_id && <a href={`/league/${incident.league_id}`} style={{ color: "var(--site-link, #2563eb)" }}>{incident.league_id.slice(0, 8)}…</a>}
              </p>
              {incident.error_message && <p style={{ fontSize: "0.85rem", marginTop: 4 }}><strong>Cause:</strong> {incident.error_name ?? "Error"}: {incident.error_message}</p>}
              {incident.workorder_status === "contacted" && incident.workorder_started_at && (
                <p style={{ fontSize: "0.85rem", marginTop: 4, color: "#2563eb" }}>
                  📬 Workorder started {relativeTime(incident.workorder_started_at)}
                  {incident.workorder_note && ` — "${incident.workorder_note.slice(0, 100)}${incident.workorder_note.length > 100 ? "…" : ""}"`}
                </p>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
              {incident.status === "open" && (
                <>
                  {incident.league_id && incident.workorder_status === "none" && (
                    <button type="button" disabled={busy === incident.id} onClick={() => messageCommish(incident)}
                      className="site-account-button" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
                      {busy === incident.id ? "…" : "Message Commish"}
                    </button>
                  )}
                  <button type="button" disabled={busy === incident.id} onClick={() => action(incident.id, () => siteApi.resolveAdminIncident(incident.id))}
                    className="site-account-button" style={{ fontSize: "0.8rem", padding: "4px 10px", background: "#16a34a" }}>
                    {busy === incident.id ? "…" : "Resolve"}
                  </button>
                  <button type="button" disabled={busy === incident.id} onClick={() => action(incident.id, () => siteApi.ignoreAdminIncident(incident.id))}
                    className="site-account-button" style={{ fontSize: "0.8rem", padding: "4px 10px", background: "#6b7280" }}>
                    {busy === incident.id ? "…" : "Ignore"}
                  </button>
                </>
              )}
              {incident.workorder_status === "contacted" && (
                <button type="button" disabled={busy === incident.id} onClick={() => action(incident.id, () => siteApi.closeAdminIncidentWorkorder(incident.id))}
                  className="site-account-button" style={{ fontSize: "0.8rem", padding: "4px 10px", background: "#16a34a" }}>
                  {busy === incident.id ? "…" : "Close Workorder"}
                </button>
              )}
            </div>
          </div>
          {(incident.error_stack || incident.detail) && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Debug details</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.75rem", marginTop: 4, maxHeight: 200, overflow: "auto" }}>
                {incident.error_stack ?? incident.detail}
              </pre>
            </details>
          )}
        </article>
      ))}
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
      {tab === "promo-codes" ? <PromoCodesPanel /> : null}
      {tab === "economy" ? <EconomyValuesPanel /> : null}
      {tab === "discord" ? <DiscordConfigPanel /> : null}
      {tab === "errors" ? <IncidentsPanel /> : null}
    </div>
  );
}
