import { useEffect, useState } from "react";
import { CASE_STATUS_BADGE } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification, CommissionerNotificationType, CompletedCommissionerTransaction } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { CoinAmount } from "../../../components/ui/CoinAmount.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { ReviewBoxScoreModal } from "../../../components/box-score/ReviewBoxScoreModal.js";
import { ResolveNotificationModal } from "./ResolveNotificationModal.js";
import { ActiveCheckReviewModal } from "./ActiveCheckReviewModal.js";
import { EosAwardResolveModal } from "./EosAwardResolveModal.js";
import { EosPayoutLedgers } from "./EosPayoutLedgers.js";
import { CustomPlayerReviewModal } from "../settings/CustomPlayerReviewQueue.js";
import { ImmortalityProspectReviewModal } from "./ImmortalityProspectReviewModal.js";

const TYPE_LABELS: Record<CommissionerNotificationType, string> = {
  box_score: "Box Score", purchase: "Purchase", highlight: "Highlight", stream: "Stream",
  eos_payout: "EOS Payout", eos_award: "EOS Award", active_check: "Active Check",
  weekly_score_review: "Weekly Scores", wager: "Wager", team_request: "Team Request",
  media: "Media", game_of_the_year: "Game of the Year", legend: "Legend",
  custom_player: "Custom Player",
  custom_team: "Custom Team",
  immortality_prospect: "Prospect Review",
  immortality_xp_spend: "Player XP Spend",
  immortality_xp_conversion: "Team XP Conversion",
  ea_auto_import: "EA Import",
  force_win_request: "Force Win Request", autopilot_request: "AutoPilot Request",
  matchup_issue_report: "Matchup Issue", trade: "Trade",
};
const ALL_TYPES = Object.keys(TYPE_LABELS) as CommissionerNotificationType[];
// EOS Payout and Stream get their own tab regardless of whether anything is pending right
// now, since they're recurring commissioner workflows worth always being able to find —
// unlike the other types, which only earn a pill when something's actually waiting.
const ALWAYS_VISIBLE_TYPES: CommissionerNotificationType[] = ["eos_payout", "stream"];

// Trade cards render a structured breakdown (teams, assets, evaluator verdict) from the
// inbox payload — the same value snapshot the trade was evaluated with. Works for rows
// written before the summary was enriched, since the payload always carried the snapshot.
type TradeAsset = { label: string };
type TradeValueSnapshot = {
  proposingAssets?: TradeAsset[];
  receivingAssets?: TradeAsset[];
  verdict?: "balanced" | "favors_proposing" | "favors_receiving";
  deltaPct?: number;
  proposing?: { needAdjustedTotal?: number };
  receiving?: { needAdjustedTotal?: number };
};

function TradeDetail({ payload, fallbackTeams }: { payload: CommissionerNotification["payload"]; fallbackTeams: { proposing?: unknown; receiving?: unknown } }) {
  const snapshot = (payload as { valueSnapshot?: TradeValueSnapshot } | null)?.valueSnapshot ?? null;
  const proposingTeam = typeof fallbackTeams.proposing === "string" ? fallbackTeams.proposing : null;
  const receivingTeam = typeof fallbackTeams.receiving === "string" ? fallbackTeams.receiving : null;
  if (!snapshot && !proposingTeam && !receivingTeam) return null;
  const assetLine = (assets?: TradeAsset[]) =>
    assets?.length ? assets.map((asset) => asset.label).join(", ") : "no players or picks";
  const verdict =
    snapshot?.verdict === "balanced"
      ? `Estimated fair value (within ${Math.abs(snapshot.deltaPct ?? 0)}%)`
      : snapshot?.verdict
        ? `Favors ${snapshot.verdict === "favors_proposing" ? proposingTeam ?? "the proposing team" : receivingTeam ?? "the receiving team"} by ~${Math.abs(snapshot.deltaPct ?? 0)}%`
        : null;
  return (
    <div style={{ marginTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--text-sm)" }}>
      {proposingTeam && receivingTeam && (
        <div><strong>{proposingTeam}</strong> ⇄ <strong>{receivingTeam}</strong></div>
      )}
      {snapshot && (
        <>
          <div>{proposingTeam ?? "Proposing team"} sends: {assetLine(snapshot.proposingAssets)}</div>
          <div>{receivingTeam ?? "Receiving team"} sends: {assetLine(snapshot.receivingAssets)}</div>
          {(verdict || snapshot.proposing?.needAdjustedTotal != null) && (
            <div style={{ color: "var(--text-secondary)" }}>
              Evaluator: {verdict}
              {snapshot.proposing?.needAdjustedTotal != null && snapshot.receiving?.needAdjustedTotal != null
                ? ` — ${snapshot.proposing.needAdjustedTotal} vs ${snapshot.receiving.needAdjustedTotal} need-adjusted value`
                : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The guts of the commissioner pending-items workflow (category filters, list, review
// modals) — used by NotificationsHome. Custom-player review opens CustomPlayerReviewModal
// here rather than sending commissioners to Settings.
export function PendingItemsPanel({ initialFilter = "all" }: { initialFilter?: CommissionerNotificationType | "all" }) {
  const { guildId } = useReadyAuth();
  const [notifications, setNotifications] = useState<CommissionerNotification[] | null>(null);
  const [completed, setCompleted] = useState<CompletedCommissionerTransaction[] | null>(null);
  const [view, setView] = useState<"pending" | "completed">("pending");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommissionerNotificationType | "all">(initialFilter);
  const [activeBoxScoreId, setActiveBoxScoreId] = useState<string | null>(null);
  const [activeActiveCheckId, setActiveActiveCheckId] = useState<string | null>(null);
  const [activeEosAwardId, setActiveEosAwardId] = useState<string | null>(null);
  const [activeResolve, setActiveResolve] = useState<CommissionerNotification | null>(null);
  const [activeCustomPlayerBuildId, setActiveCustomPlayerBuildId] = useState<string | null>(null);
  const [activeImmortalityProspect, setActiveImmortalityProspect] = useState<CommissionerNotification | null>(null);
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
  // EOS Payout notifications are handled entirely by the dedicated ledger tab below — a
  // flat card for one doesn't have a well-defined click action any more, so it's excluded
  // from every other view.
  const cardNotifications = notifications?.filter((notification) => notification.type !== "eos_payout") ?? [];
  const visible = cardNotifications.filter((notification) => filter === "all" || notification.type === filter);
  const typesPresent = new Set(cardNotifications.map((notification) => notification.type));

  function openNotification(notification: CommissionerNotification) {
    // Custom-player review needs the full identity/attribute-edit UI, not the generic
    // approve/deny modal — same idea as legend/box-score/active-check/eos-award below,
    // opened inline instead of navigating away to Settings.
    if (notification.type === "custom_player" && notification.sourceId) return setActiveCustomPlayerBuildId(notification.sourceId);
    if (notification.type === "immortality_prospect") return setActiveImmortalityProspect(notification);
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
    setActiveCustomPlayerBuildId(null);
    setActiveImmortalityProspect(null);
    load();
    window.dispatchEvent(new Event("rec:notifications-changed"));
  }

  return <>
    {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
    {error && <ErrorState message={error} />}
    {(!notifications || !completed) && !error && <LoadingState />}

    {notifications && completed && <>
      <div className="notification-view-tabs">
        <Button variant={view === "pending" ? "primary" : "secondary"} onClick={() => setView("pending")}>Pending ({notifications.length})</Button>
        <Button variant={view === "completed" ? "primary" : "secondary"} onClick={() => setView("completed")}>Approved &amp; Issued ({completed.length})</Button>
      </div>

      {view === "pending" ? <>
        <div className="pending-items-category-row" style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <button type="button" className={filter === "all" ? "pending-items-category is-active" : "pending-items-category"} onClick={() => setFilter("all")}>All ({cardNotifications.length})</button>
          {ALL_TYPES.filter((type) => typesPresent.has(type) || ALWAYS_VISIBLE_TYPES.includes(type)).map((type) => (
            <button key={type} type="button" className={filter === type ? "pending-items-category is-active" : "pending-items-category"} onClick={() => setFilter(type)}>{TYPE_LABELS[type]}</button>
          ))}
        </div>
        {filter === "eos_payout" ? (
          <EosPayoutLedgers onResolved={(message) => { setNotice(message); load(); window.dispatchEvent(new Event("rec:notifications-changed")); }} />
        ) : <>
          {visible.length === 0 && <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>Nothing pending here.</p></Card>}
          <div className="pending-items-scroll-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {visible.map((notification) => <Card key={notification.id} className="pending-item-card" onClick={() => openNotification(notification)}>
              <div className="pending-item-card-layout">
                <div className="pending-item-card-copy">
                  <div className="pending-item-card-heading"><Badge status="info">{TYPE_LABELS[notification.type]}</Badge><Badge status={CASE_STATUS_BADGE[notification.displayStatus]}>{notification.displayStatus}</Badge><span className="pending-item-card-title">{notification.title}</span></div>
                  {/* Legend and custom-player purchases carry a full detail dump (attributes,
                      replacement target, package) in their subtitle — that belongs only in the
                      dedicated review modal (LegendPurchaseDetail / CustomPlayerBuildRow) opened
                      on tap, not in this scannable list. Every other type's subtitle stays short
                      enough to keep here. */}
                  {notification.type !== "legend" && notification.type !== "custom_player" && (
                    <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{notification.subtitle}</p>
                  )}
                  {notification.type === "custom_team" && typeof (notification.payload as { logoUrl?: string } | null)?.logoUrl === "string" && (
                    <img
                      className="pending-item-logo-preview"
                      src={(notification.payload as { logoUrl: string }).logoUrl}
                      alt="Submitted custom team logo"
                    />
                  )}
                  <TradeDetail
                    payload={notification.payload}
                    fallbackTeams={{ proposing: (notification.payload as Record<string, unknown> | null)?.proposingTeam, receiving: (notification.payload as Record<string, unknown> | null)?.receivingTeam }}
                  />
                  <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{notification.submittedByName ? `From ${notification.submittedByName} — ` : ""}{new Date(notification.submittedAt).toLocaleString()}</p>
                </div>
                {notification.amount != null && <span className="pending-item-card-amount"><CoinAmount amount={notification.amount} /></span>}
              </div>
            </Card>)}
          </div>
        </>}
      </> : <CompletedTransactions transactions={completed} />}
    </>}

    {activeBoxScoreId && <ReviewBoxScoreModal submissionId={activeBoxScoreId} onClose={() => setActiveBoxScoreId(null)} onResolved={(action) => afterResolved(action === "approve" ? "Box score approved." : "Box score denied.")} />}
    {activeActiveCheckId && <ActiveCheckReviewModal eventId={activeActiveCheckId} onClose={() => setActiveActiveCheckId(null)} onResolved={() => afterResolved("Active check resolved.")} />}
    {activeEosAwardId && <EosAwardResolveModal pollId={activeEosAwardId} onClose={() => setActiveEosAwardId(null)} onResolved={() => afterResolved("Award settled.")} />}
    {activeResolve && <ResolveNotificationModal notification={activeResolve} onClose={() => setActiveResolve(null)} onResolved={() => afterResolved("Resolved.")} />}
    {activeCustomPlayerBuildId && <CustomPlayerReviewModal guildId={guildId} buildId={activeCustomPlayerBuildId} onClose={() => setActiveCustomPlayerBuildId(null)} onResolved={() => afterResolved("Custom player reviewed.")} />}
    {activeImmortalityProspect && <ImmortalityProspectReviewModal guildId={guildId} notification={activeImmortalityProspect} onClose={() => setActiveImmortalityProspect(null)} onResolved={() => afterResolved("Prospect reviewed.")} />}
  </>;
}

function CompletedTransactions({ transactions }: { transactions: CompletedCommissionerTransaction[] }) {
  if (!transactions.length) return <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No approved or issued transactions yet.</p></Card>;
  return <div className="completed-transaction-list">{transactions.map((transaction) => <Card key={transaction.id}>
    <div className="completed-transaction-heading">
      <div><div className="completed-transaction-title"><Badge status="approved">{transaction.statusLabel}</Badge><strong>{transaction.title}</strong></div><p style={{ whiteSpace: "pre-line" }}>{transaction.subtitle}</p></div>
      {transaction.amount != null && <strong className="completed-transaction-amount"><CoinAmount amount={transaction.amount} /></strong>}
    </div>
    {transaction.details.length > 0 && <dl className="completed-transaction-details">{transaction.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    <div className="completed-transaction-audit">
      <span>Member: <strong>{transaction.submittedByName ?? "REC Member"}</strong></span>
      <span>Approved/issued by: <strong>{transaction.reviewedByName ?? "REC Commissioner"}</strong></span>
      <time>{new Date(transaction.completedAt).toLocaleString()}</time>
    </div>
  </Card>)}</div>;
}
