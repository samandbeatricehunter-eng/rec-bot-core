import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification, CommissionerNotificationType, CompletedCommissionerTransaction } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { ReviewBoxScoreModal } from "../../../components/box-score/ReviewBoxScoreModal.js";
import { ResolveNotificationModal } from "./ResolveNotificationModal.js";
import { ActiveCheckReviewModal } from "./ActiveCheckReviewModal.js";
import { EosAwardResolveModal } from "./EosAwardResolveModal.js";

const TYPE_LABELS: Record<CommissionerNotificationType, string> = {
  box_score: "Box Score", purchase: "Purchase", highlight: "Highlight", stream: "Stream",
  eos_payout: "EOS Payout", eos_award: "EOS Award", active_check: "Active Check",
  weekly_score_review: "Weekly Scores", wager: "Wager", team_request: "Team Request",
  media: "Media",
};
const ALL_TYPES = Object.keys(TYPE_LABELS) as CommissionerNotificationType[];

export function NotificationsHome() {
  const { guildId } = useReadyAuth();
  const [notifications, setNotifications] = useState<CommissionerNotification[] | null>(null);
  const [completed, setCompleted] = useState<CompletedCommissionerTransaction[] | null>(null);
  const [view, setView] = useState<"pending" | "completed">("pending");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommissionerNotificationType | "all">("all");
  const [activeBoxScoreId, setActiveBoxScoreId] = useState<string | null>(null);
  const [activeActiveCheckId, setActiveActiveCheckId] = useState<string | null>(null);
  const [activeEosAwardId, setActiveEosAwardId] = useState<string | null>(null);
  const [activeResolve, setActiveResolve] = useState<CommissionerNotification | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    Promise.all([recApi.listCommissionerNotifications(guildId), recApi.listCompletedCommissionerTransactions(guildId)])
      .then(([pendingResult, completedResult]) => {
        setNotifications(pendingResult.notifications);
        setCompleted(completedResult.transactions);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load notifications."));
  }

  useEffect(load, [guildId]);
  const visible = notifications?.filter((notification) => filter === "all" || notification.type === filter) ?? [];
  const typesPresent = new Set(notifications?.map((notification) => notification.type) ?? []);

  function openNotification(notification: CommissionerNotification) {
    if (!notification.sourceId) return setActiveResolve(notification);
    if (notification.type === "box_score") return setActiveBoxScoreId(notification.sourceId);
    if (notification.type === "active_check") return setActiveActiveCheckId(notification.sourceId);
    if (notification.type === "eos_award") return setActiveEosAwardId(notification.sourceId);
    setActiveResolve(notification);
  }

  function afterResolved(message: string) {
    setNotice(message);
    setActiveBoxScoreId(null);
    setActiveActiveCheckId(null);
    setActiveEosAwardId(null);
    setActiveResolve(null);
    load();
    window.dispatchEvent(new Event("rec:notifications-changed"));
  }

  return <div>
    <PageHeader title="Notifications" subtitle="Pending decisions and the league's latest approved or issued transactions." />
    {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
    {error && <ErrorState message={error} />}
    {(!notifications || !completed) && !error && <LoadingState />}

    {notifications && completed && <>
      <div className="notification-view-tabs">
        <Button variant={view === "pending" ? "primary" : "secondary"} onClick={() => setView("pending")}>Pending ({notifications.length})</Button>
        <Button variant={view === "completed" ? "primary" : "secondary"} onClick={() => setView("completed")}>Approved &amp; Issued ({completed.length})</Button>
      </div>

      {view === "pending" ? <>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <Button variant={filter === "all" ? "primary" : "secondary"} onClick={() => setFilter("all")}>All ({notifications.length})</Button>
          {ALL_TYPES.filter((type) => typesPresent.has(type)).map((type) => <Button key={type} variant={filter === type ? "primary" : "secondary"} onClick={() => setFilter(type)}>{TYPE_LABELS[type]}</Button>)}
        </div>
        {visible.length === 0 && <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>Nothing pending here.</p></Card>}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {visible.map((notification) => <Card key={notification.id} style={{ cursor: "pointer" }} onClick={() => openNotification(notification)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}><Badge status="info">{TYPE_LABELS[notification.type]}</Badge><span style={{ fontWeight: 700 }}>{notification.title}</span></div>
                <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{notification.subtitle}</p>
                <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{notification.submittedByName ? `From ${notification.submittedByName} — ` : ""}{new Date(notification.submittedAt).toLocaleString()}</p>
              </div>
              {notification.amount != null && <span style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>${notification.amount}</span>}
            </div>
          </Card>)}
        </div>
      </> : <CompletedTransactions transactions={completed} />}
    </>}

    {activeBoxScoreId && <ReviewBoxScoreModal submissionId={activeBoxScoreId} onClose={() => setActiveBoxScoreId(null)} onResolved={(action) => afterResolved(action === "approve" ? "Box score approved." : "Box score denied.")} />}
    {activeActiveCheckId && <ActiveCheckReviewModal eventId={activeActiveCheckId} onClose={() => setActiveActiveCheckId(null)} onResolved={() => afterResolved("Active check resolved.")} />}
    {activeEosAwardId && <EosAwardResolveModal pollId={activeEosAwardId} onClose={() => setActiveEosAwardId(null)} onResolved={() => afterResolved("Award settled.")} />}
    {activeResolve && <ResolveNotificationModal notification={activeResolve} onClose={() => setActiveResolve(null)} onResolved={() => afterResolved("Resolved.")} />}
  </div>;
}

function CompletedTransactions({ transactions }: { transactions: CompletedCommissionerTransaction[] }) {
  if (!transactions.length) return <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No approved or issued transactions yet.</p></Card>;
  return <div className="completed-transaction-list">{transactions.map((transaction) => <Card key={transaction.id}>
    <div className="completed-transaction-heading">
      <div><div className="completed-transaction-title"><Badge status="approved">{transaction.statusLabel}</Badge><strong>{transaction.title}</strong></div><p>{transaction.subtitle}</p></div>
      {transaction.amount != null && <strong className="completed-transaction-amount">${transaction.amount.toLocaleString()}</strong>}
    </div>
    {transaction.details.length > 0 && <dl className="completed-transaction-details">{transaction.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    <div className="completed-transaction-audit">
      <span>Member: <strong>{transaction.submittedByName ?? "REC Member"}</strong></span>
      <span>Approved/issued by: <strong>{transaction.reviewedByName ?? "REC Commissioner"}</strong></span>
      <time>{new Date(transaction.completedAt).toLocaleString()}</time>
    </div>
  </Card>)}</div>;
}
