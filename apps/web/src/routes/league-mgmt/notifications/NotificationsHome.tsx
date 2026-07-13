import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification, CommissionerNotificationType } from "../../../types/api.js";
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
  box_score: "Box Score",
  purchase: "Purchase",
  highlight: "Highlight",
  stream: "Stream",
  eos_payout: "EOS Payout",
  eos_award: "EOS Award",
  active_check: "Active Check",
  weekly_score_review: "Weekly Scores",
  wager: "Wager",
  team_request: "Team Request",
};

const ALL_TYPES = Object.keys(TYPE_LABELS) as CommissionerNotificationType[];

export function NotificationsHome() {
  const { guildId } = useReadyAuth();
  const [notifications, setNotifications] = useState<CommissionerNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommissionerNotificationType | "all">("all");
  const [activeBoxScoreId, setActiveBoxScoreId] = useState<string | null>(null);
  const [activeActiveCheckId, setActiveActiveCheckId] = useState<string | null>(null);
  const [activeEosAwardId, setActiveEosAwardId] = useState<string | null>(null);
  const [activeResolve, setActiveResolve] = useState<CommissionerNotification | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    recApi
      .listCommissionerNotifications(guildId)
      .then((res) => setNotifications(res.notifications))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load notifications."));
  }

  useEffect(load, [guildId]);

  const visible = notifications?.filter((n) => filter === "all" || n.type === filter) ?? [];
  const typesPresent = new Set(notifications?.map((n) => n.type) ?? []);

  function openNotification(n: CommissionerNotification) {
    if (!n.sourceId) {
      setActiveResolve(n);
      return;
    }
    if (n.type === "box_score") return setActiveBoxScoreId(n.sourceId);
    if (n.type === "active_check") return setActiveActiveCheckId(n.sourceId);
    if (n.type === "eos_award") return setActiveEosAwardId(n.sourceId);
    setActiveResolve(n);
  }

  function afterResolved(message: string) {
    setNotice(message);
    setActiveBoxScoreId(null);
    setActiveActiveCheckId(null);
    setActiveEosAwardId(null);
    setActiveResolve(null);
    load();
  }

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Everything awaiting commissioner or co-commissioner action, in one feed." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      {!notifications && !error && <LoadingState />}

      {notifications && (
        <>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
            <Button variant={filter === "all" ? "primary" : "secondary"} onClick={() => setFilter("all")}>
              All ({notifications.length})
            </Button>
            {ALL_TYPES.filter((t) => typesPresent.has(t)).map((t) => (
              <Button key={t} variant={filter === t ? "primary" : "secondary"} onClick={() => setFilter(t)}>
                {TYPE_LABELS[t]}
              </Button>
            ))}
          </div>

          {visible.length === 0 && (
            <Card>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>Nothing pending here.</p>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {visible.map((n) => (
              <Card key={n.id} style={{ cursor: "pointer" }} onClick={() => openNotification(n)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
                      <Badge status="info">{TYPE_LABELS[n.type]}</Badge>
                      <span style={{ fontWeight: 700 }}>{n.title}</span>
                    </div>
                    <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{n.subtitle}</p>
                    <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                      {n.submittedBy ? `From <@${n.submittedBy}> — ` : ""}
                      {new Date(n.submittedAt).toLocaleString()}
                    </p>
                  </div>
                  {n.amount != null && <span style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>${n.amount}</span>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {activeBoxScoreId && (
        <ReviewBoxScoreModal
          submissionId={activeBoxScoreId}
          onClose={() => setActiveBoxScoreId(null)}
          onResolved={(action) => afterResolved(action === "approve" ? "Box score approved." : "Box score denied.")}
        />
      )}

      {activeActiveCheckId && (
        <ActiveCheckReviewModal
          eventId={activeActiveCheckId}
          onClose={() => setActiveActiveCheckId(null)}
          onResolved={() => afterResolved("Active check resolved.")}
        />
      )}

      {activeEosAwardId && (
        <EosAwardResolveModal
          pollId={activeEosAwardId}
          onClose={() => setActiveEosAwardId(null)}
          onResolved={() => afterResolved("Award settled.")}
        />
      )}

      {activeResolve && (
        <ResolveNotificationModal
          notification={activeResolve}
          onClose={() => setActiveResolve(null)}
          onResolved={() => afterResolved("Resolved.")}
        />
      )}
    </div>
  );
}
