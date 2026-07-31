import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { AdvanceWeekGames, CompletedCommissionerTransaction } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import { LoadingState } from "../ui/LoadingState.js";
import { PendingItemsPanel } from "../../routes/league-mgmt/notifications/PendingItemsPanel.js";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-lg)" }}>{children}</h2>;
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

function RecentActivitySection() {
  const { guildId } = useReadyAuth();
  const [items, setItems] = useState<CompletedCommissionerTransaction[] | null>(null);

  useEffect(() => {
    recApi.listCompletedCommissionerTransactions(guildId).then((res) => setItems(res.transactions)).catch(() => setItems([]));
  }, [guildId]);

  return (
    <Card>
      <SectionHeading>Recent Activity</SectionHeading>
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
    </Card>
  );
}

// Urgency-ordered Commissioner Command Center dashboard: Advance Readiness, then Awaiting
// Review (the existing generic PendingItemsPanel, unchanged), then Recent Activity. Decisions
// and Polls lives immediately below this (LeagueMgmtHome renders embedded CommissionerChatHome
// next), not duplicated here — a read-only topics list plus a link-out was redundant with that
// component's real vote/close controls once it moved to a dashboard-first layout.
export function CommandCenterDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <AdvanceReadinessSection />
      <Card>
        <SectionHeading>Awaiting Review</SectionHeading>
        <PendingItemsPanel />
      </Card>
      <RecentActivitySection />
    </div>
  );
}
