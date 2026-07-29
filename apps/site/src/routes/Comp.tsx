import { useEffect, useState } from "react";
import { badgeAsset, badgeTooltip } from "../lib/badge-display.js";
import {
  siteApi,
  type CompUserDetail,
  type CompUserSummary,
  type PowerRankingRow,
} from "../lib/site-api.js";

type CompTab = "rankings" | "queue" | "tournaments" | "live" | "users";

const TABS: Array<{ id: CompTab; label: string }> = [
  { id: "rankings", label: "Rankings" },
  { id: "queue", label: "Matchup Queue" },
  { id: "tournaments", label: "Tournaments" },
  { id: "live", label: "Live Games" },
  { id: "users", label: "Users" },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="site-page-card">
      <h2>{title}</h2>
      <p className="site-muted">Coming soon — this ships with the H2H Comp matchmaking queue.</p>
    </div>
  );
}

function movementLabel(row: PowerRankingRow): string {
  if (row.previousRank == null) return "NEW";
  const delta = row.previousRank - row.rank;
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${Math.abs(delta)}`;
  return "—";
}

function RankingsTab() {
  const [games, setGames] = useState<Array<{ game: string; label: string; dynastyLabel: string }>>([]);
  const [game, setGame] = useState("");
  const [scope, setScope] = useState<"dynasty" | "comp">("dynasty");
  const [rankings, setRankings] = useState<PowerRankingRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    siteApi
      .listRankedGames()
      .then((res) => setGames(res.games))
      .catch(() => setGames([]));
  }, []);

  useEffect(() => {
    if (!game) {
      setRankings([]);
      setAsOf(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    siteApi
      .listPowerRankings({ game, scope })
      .then((res) => {
        if (!active) return;
        setRankings(res.rankings);
        setAsOf(res.asOf);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load rankings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [game, scope]);

  const selectedGame = games.find((g) => g.game === game);

  return (
    <div className="site-page-card">
      <div className="site-comp-game-picker">
        <select
          className="site-select"
          value={game}
          onChange={(e) => setGame(e.target.value)}
        >
          <option value="">Select a game…</option>
          {games.map((g) => (
            <option key={g.game} value={g.game}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {game ? (
        <div className="site-billing-panel">
          <div className="site-hero-switcher" role="tablist" aria-label="Ranking scope" style={{ margin: "0 auto var(--space-4)" }}>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "dynasty"}
              className={scope === "dynasty" ? "is-active" : ""}
              onClick={() => setScope("dynasty")}
            >
              {selectedGame?.dynastyLabel ?? "Dynasty"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "comp"}
              className={scope === "comp" ? "is-active" : ""}
              onClick={() => setScope("comp")}
            >
              H2H Comp
            </button>
          </div>

          {error && <p className="site-auth-error">{error}</p>}
          {loading ? (
            <p className="site-muted">Loading rankings…</p>
          ) : rankings.length === 0 ? (
            <p className="site-muted">
              {scope === "comp"
                ? "No H2H Comp games have been logged yet — rankings appear once the matchmaking queue is live."
                : "No rankings computed yet."}
            </p>
          ) : (
            <>
              {asOf ? <p className="site-muted">As of {new Date(asOf).toLocaleDateString()}</p> : null}
              <ol className="site-account-notif-list" style={{ listStyle: "none", paddingLeft: 0 }}>
                {rankings.map((row) => (
                  <li key={row.userId}>
                    <strong>
                      #{row.rank} @{row.username ?? row.displayName}
                    </strong>
                    <span>
                      Score {row.score.toFixed(1)} · {movementLabel(row)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : (
        <p className="site-muted" style={{ textAlign: "center" }}>
          Pick a game above to view its global rankings.
        </p>
      )}
    </div>
  );
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CompUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    siteApi
      .getCompUserDetail(userId)
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load user.");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <div className="site-modal" role="dialog" aria-modal="true">
      <button type="button" className="site-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="site-modal-panel site-comp-user-modal">
        <div className="site-modal-actions" style={{ justifyContent: "flex-end", marginTop: 0 }}>
          <button type="button" className="site-btn site-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <p className="site-auth-error">{error}</p>
        ) : !detail ? (
          <p className="site-muted">Loading…</p>
        ) : (
          <>
            <h2>@{detail.username ?? detail.displayName}</h2>
            <p className="site-muted">
              Member since{" "}
              {detail.memberSince ? new Date(detail.memberSince).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "—"}
            </p>
            <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <article>
                <span>All-time record</span>
                <strong>{detail.globalRecord.wins}-{detail.globalRecord.losses}</strong>
              </article>
              <article>
                <span>Playoff record</span>
                <strong>{detail.globalRecord.playoffWins}-{detail.globalRecord.playoffLosses}</strong>
              </article>
              <article>
                <span>Championship record</span>
                <strong>{detail.globalRecord.superbowlWins}-{detail.globalRecord.superbowlLosses}</strong>
              </article>
              <article>
                <span>Games played</span>
                <strong>{detail.globalRecord.gamesPlayed}</strong>
              </article>
            </div>

            <h3>Stats by game</h3>
            {detail.careerStats.length ? (
              <div className="site-account-game-stats">
                {detail.careerStats.map((game) => (
                  <details key={game.game} className="site-account-game-block">
                    <summary>{game.gameLabel}</summary>
                    <div className="site-account-stat-grid">
                      <article><span>Games logged</span><strong>{game.gamesLogged}</strong></article>
                      <article><span>Passing yards</span><strong>{game.passingYards.toLocaleString()}</strong></article>
                      <article><span>Rushing yards</span><strong>{game.rushingYards.toLocaleString()}</strong></article>
                      <article><span>Total yards</span><strong>{game.totalYards.toLocaleString()}</strong></article>
                      <article><span>First downs</span><strong>{game.firstDowns.toLocaleString()}</strong></article>
                      <article><span>TO differential</span><strong>{game.turnoverDifferential}</strong></article>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="site-muted">No box-score stats logged yet.</p>
            )}

            <h3>Badges ({detail.badges.length})</h3>
            {detail.badges.length ? (
              <ul className="site-account-badge-list">
                {detail.badges.map((badge) => {
                  const label = badge.badge_label ?? badge.badge_key.replaceAll("_", " ");
                  return (
                    <li
                      key={badge.badge_key + "-" + badge.badge_scope}
                      title={badgeTooltip(badge)}
                      className="site-account-badge-render"
                      style={{ backgroundImage: `url("${badgeAsset(badge.badge_key, label, badge.tier)}")` }}
                    >
                      <span className="sr-only">{label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="site-muted">No badges yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<CompUserSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    siteApi
      .listCompUsers({ page })
      .then((res) => {
        if (!active) return;
        setUsers(res.users);
        setTotal(res.total);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="site-page-card">
      {loading ? (
        <p className="site-muted">Loading users…</p>
      ) : (
        <>
          <ul className="site-account-notif-list">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="site-text-link"
                  onClick={() => setSelectedUserId(user.id)}
                  style={{ fontSize: 16, fontWeight: 700 }}
                >
                  @{user.username ?? user.displayName}
                </button>
                <span>{user.subscriptionTier}</span>
              </li>
            ))}
          </ul>
          <div className="site-profile-actions">
            <button className="site-btn site-btn-ghost" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="site-muted">
              Page {page} of {totalPages}
            </span>
            <button className="site-btn site-btn-ghost" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
      {selectedUserId ? <UserDetailModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} /> : null}
    </div>
  );
}

export function CompPage() {
  const [tab, setTab] = useState<CompTab>("rankings");

  return (
    <div className="site-page">
      <div className="site-hero-switcher" role="tablist" aria-label="Comp sections" style={{ margin: "0 auto var(--space-4)" }}>
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

      {tab === "rankings" ? <RankingsTab /> : null}
      {tab === "queue" ? <ComingSoon title="Matchup Queue" /> : null}
      {tab === "tournaments" ? <ComingSoon title="Tournaments" /> : null}
      {tab === "live" ? <ComingSoon title="Live Games" /> : null}
      {tab === "users" ? <UsersTab /> : null}
    </div>
  );
}
