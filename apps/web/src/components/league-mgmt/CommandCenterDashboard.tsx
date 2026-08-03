import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Newspaper } from "lucide-react";
import { stageLabel } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { AdvanceWeekGames, CompletedCommissionerTransaction } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import { LoadingState } from "../ui/LoadingState.js";
import { PendingItemsPanel } from "../../routes/league-mgmt/notifications/PendingItemsPanel.js";

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`section-heading ${className}`} style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-lg)" }}>{children}</h2>;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon,
}: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        className={`collapsible-header ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {icon && <span style={{ color: "var(--text-secondary)" }}>{icon}</span>}
          {title}
        </span>
        <span
          style={{
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          ▼
        </span>
      </button>
      <div
        className="collapsible-content"
        style={{
          overflow: "hidden",
          maxHeight: open ? "none" : "0",
          opacity: open ? 1 : 0,
          transition: "max-height 0.25s ease, opacity 0.2s ease",
          marginTop: open ? "var(--space-3)" : 0,
        }}
      >
        {open && children}
      </div>
    </Card>
  );
}

function AdvanceReadinessSection() {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<AdvanceWeekGames | null>(null);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    recApi.getAdvanceWeekGames(guildId).then(setData).catch(() => setData(null));
  }

  useEffect(load, [guildId]);

  async function notify(gameId: string, target: "home" | "away" | "both") {
    setBusyGameId(gameId);
    setNotice(null);
    try {
      await recApi.notifyMissingBoxScore({ guildId, gameId, target });
      setNotice("Notified.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to notify.");
    } finally {
      setBusyGameId(null);
    }
  }

  const missing = data?.gamesNeedingInput.filter((g) => g.isH2h) ?? [];

  return (
    <Card>
      <SectionHeading>Advance Readiness</SectionHeading>
      {!data ? (
        <LoadingState label="Loading…" />
      ) : missing.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>Every human matchup this week has a result. Ready to advance.</p>
      ) : (
        <div className="advance-readiness-list">
          {notice && <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{notice}</p>}
          {missing.map((game) => (
            <div key={game.gameId} className="advance-readiness-row">
              <div className="advance-readiness-row__info">
                <Link to={`/matchups/${game.gameId}`} className="advance-readiness-row__matchup">
                  {game.awayTeamName} @ {game.homeTeamName}
                </Link>
                <div className="advance-readiness-row__status">
                  {game.hasBoxScore ? "Box score submitted, awaiting review" : "No result submitted yet"}
                </div>
              </div>
              <div className="advance-readiness-row__actions">
                <Button variant="secondary" size="compact" disabled={busyGameId === game.gameId} onClick={() => void notify(game.gameId, "home")}>Notify Home</Button>
                <Button variant="secondary" size="compact" disabled={busyGameId === game.gameId} onClick={() => void notify(game.gameId, "away")}>Notify Away</Button>
                <Button variant="secondary" size="compact" disabled={busyGameId === game.gameId} onClick={() => void notify(game.gameId, "both")}>Notify Both</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LeagueActionsSection({ onOpenCommissionerChat }: { onOpenCommissionerChat: () => void }) {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const [currentStageLabel, setCurrentStageLabel] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getAdvanceWeekGames(guildId)
      .then((data) => setCurrentStageLabel(stageLabel(data.currentStage, data.currentWeek, game)))
      .catch(() => setCurrentStageLabel(null));
  }, [guildId, game]);

  return (
    <Card>
      <SectionHeading>League Actions{currentStageLabel ? ` — ${currentStageLabel}` : ""}</SectionHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Link to="/league-mgmt/manage-league" style={{ textDecoration: "none", color: "inherit" }}>
          <Button variant="secondary" style={{ justifyContent: "flex-start", width: "100%" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Manage League
            </span>
          </Button>
        </Link>
        <Link to="/league-mgmt/advance" style={{ textDecoration: "none", color: "inherit" }}>
          <Button variant="secondary" style={{ justifyContent: "flex-start", width: "100%" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
              Advance
            </span>
          </Button>
        </Link>
        <Link to="/league-mgmt/settings" style={{ textDecoration: "none", color: "inherit" }}>
          <Button variant="secondary" style={{ justifyContent: "flex-start", width: "100%" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </span>
          </Button>
        </Link>
        <Link to="/league-mgmt/publishing" style={{ textDecoration: "none", color: "inherit" }}>
          <Button variant="secondary" style={{ justifyContent: "flex-start", width: "100%" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Newspaper size={16} style={{ flexShrink: 0 }} />
              Media
            </span>
          </Button>
        </Link>
        <Button variant="secondary" onClick={onOpenCommissionerChat} style={{ justifyContent: "flex-start", width: "100%" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Open Commissioner Chat
          </span>
        </Button>
      </div>
    </Card>
  );
}

function RecentActivitySection() {
  const { guildId } = useReadyAuth();
  const [items, setItems] = useState<CompletedCommissionerTransaction[] | null>(null);

  useEffect(() => {
    recApi.listCompletedCommissionerTransactions(guildId).then((res) => setItems(res.transactions)).catch(() => setItems([]));
  }, [guildId]);

  return (
    <CollapsibleSection title="Recent Activity" defaultOpen={false} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>}>
      {!items ? (
        <LoadingState label="Loading…" />
      ) : items.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>Nothing resolved yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {items.slice(0, 10).map((item) => (
            <div key={item.id} style={{ fontSize: "var(--text-sm)" }}>
              <strong>{item.title}</strong> — {item.statusLabel}
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {item.reviewedByName ? `By ${item.reviewedByName} — ` : ""}
                {new Date(item.completedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function LinkedCoachesSection() {
  const { guildId } = useReadyAuth();
  const [entries, setEntries] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getLinkedRoster(guildId)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster."));
  }, [guildId]);

  return (
    <CollapsibleSection title="Linked Coaches" defaultOpen={false} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>}>
      {error && <div style={{ color: "var(--error)", fontSize: "var(--text-sm)", marginBottom: "var(--space-2)" }}>{error}</div>}
      {!entries && !error && <LoadingState />}
      {entries && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 520, overflowY: "auto", paddingRight: "var(--space-2)" }}>
          {entries.map((e) => (
            <div
              key={e.teamId}
              style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-1)", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ flexShrink: 0, minWidth: 60, textAlign: "right" }}>
                <span style={{ fontWeight: 700, color: "var(--gold)" }}>{e.powerRank != null ? `#${e.powerRank}` : "—"}</span>
                {e.rankChange != null && e.rankChange !== 0 && (
                  <div style={{ fontSize: "var(--text-xs)", color: e.rankChange > 0 ? "var(--success)" : "var(--error)" }}>
                    ({e.rankChange > 0 ? "+" : ""}{e.rankChange})
                  </div>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.userDisplayName}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.teamName}</div>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", flexShrink: 0, whiteSpace: "nowrap" }}>
                {e.record.wins}-{e.record.losses}{e.record.ties > 0 ? `-${e.record.ties}` : ""}
              </div>
            </div>
          ))}
          {entries.length === 0 && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No teams are linked to a user yet.</p>}
        </div>
      )}
    </CollapsibleSection>
  );
}

function DecisionsAndPollsSection({ guildId }: { guildId: string }) {
  // This will be the embedded CommissionerChatHome (polls only)
  // Import dynamically to avoid circular deps
  const [CommissionerChatHome, setCommissionerChatHome] = useState<any>(null);

  useEffect(() => {
    import("../../routes/league-mgmt/commissioner-chat/CommissionerChatHome.js").then((m) =>
      setCommissionerChatHome(() => m.CommissionerChatHome)
    );
  }, [guildId]);

  if (!CommissionerChatHome) return <LoadingState label="Loading…" />;

  return <CommissionerChatHome guildId={guildId} embedded />;
}

// Urgency-ordered Commissioner Command Center dashboard:
// Advance Readiness → League Actions → Awaiting Review → Recent Activity → Decisions & Polls
export function CommandCenterDashboard() {
  const { guildId } = useReadyAuth();
  const [commissionerChatOpen, setCommissionerChatOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <AdvanceReadinessSection />
      <LeagueActionsSection onOpenCommissionerChat={() => setCommissionerChatOpen(true)} />
      <Card>
        <SectionHeading>Awaiting Review</SectionHeading>
        <PendingItemsPanel />
      </Card>
      <RecentActivitySection />
      {commissionerChatOpen && (
        <div className="commissioner-chat-drawer-overlay" onClick={() => setCommissionerChatOpen(false)}>
          <div className="commissioner-chat-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="commissioner-chat-drawer-header">
              <h3 style={{ margin: 0 }}>Decisions & Polls</h3>
              <Button variant="ghost" size="compact" onClick={() => setCommissionerChatOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </Button>
            </div>
            <DecisionsAndPollsSection guildId={guildId} />
          </div>
        </div>
      )}
    </div>
  );
}