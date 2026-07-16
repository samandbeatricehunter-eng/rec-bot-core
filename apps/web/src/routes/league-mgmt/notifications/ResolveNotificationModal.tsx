import { useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// One shared resolve panel for the notification types that don't get their own dedicated
// modal. Box Scores reuse ReviewBoxScoreModal, Active Checks reuse ActiveCheckReviewModal,
// and EOS Awards reuse EosAwardResolveModal (all opened directly from NotificationsHome
// instead of through here). Every type this modal actually handles reduces to one of three
// shapes: approve/deny (with or without a reason field, depending on whether the underlying
// table has one to store it in), or a single one-click resolve action. The active_check/
// eos_award cases below are only a defensive fallback for the rare case a notification of
// that type is missing its sourceId.
type ResolveMode =
  | { kind: "approve_deny"; reasonField: boolean; approveLabel: string; denyLabel: string }
  | { kind: "single"; actionLabel: string }
  | { kind: "info"; message: string };

function resolveModeFor(type: string): ResolveMode {
  switch (type) {
    case "purchase":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "highlight":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "game_of_the_year":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Crown Winner", denyLabel: "Deny" };
    case "stream":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "media":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve & Publish", denyLabel: "Deny" };
    case "team_request":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Approve", denyLabel: "Reject" };
    case "weekly_score_review":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Log Scores", denyLabel: "Cancel" };
    case "wager":
      return { kind: "single", actionLabel: "Settle Wager" };
    case "active_check":
      return { kind: "info", message: "This active check is missing its event reference — resolve it from Discord instead." };
    case "eos_award":
      return { kind: "info", message: "This award poll is missing its poll reference — resolve it from Discord instead." };
    default:
      return { kind: "info", message: "This notification type doesn't have a web resolve action yet." };
  }
}

async function resolveAction(guildId: string, notification: CommissionerNotification, action: "approve" | "deny", reason: string) {
  const sourceId = notification.sourceId ?? "";
  switch (notification.type) {
    case "purchase":
      return recApi.reviewPurchase({ guildId, purchaseId: sourceId, action, deniedReason: reason || undefined });
    case "highlight":
      return recApi.reviewHighlight({ guildId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "game_of_the_year":
      return recApi.reviewGameOfYear({ guildId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "stream":
      return recApi.reviewStream({ guildId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "media":
      return recApi.reviewMedia({ guildId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "team_request":
      return action === "approve"
        ? recApi.approveTeamRequest({ guildId, requestId: sourceId })
        : recApi.rejectTeamRequest({ guildId, requestId: sourceId });
    case "weekly_score_review":
      return action === "approve"
        ? recApi.approveWeeklyScoreReview({ guildId, reviewId: sourceId })
        : recApi.cancelWeeklyScoreReview({ guildId, reviewId: sourceId });
    case "wager":
      return recApi.settleWager({ guildId, wagerId: sourceId });
    default:
      throw new Error("No resolve action for this notification type.");
  }
}

export function ResolveNotificationModal({
  notification,
  onClose,
  onResolved,
}: {
  notification: CommissionerNotification;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { guildId } = useReadyAuth();
  const mode = resolveModeFor(notification.type);
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      await resolveAction(guildId, notification, action, reason);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve this notification.");
      setBusy(false);
    }
  }

  return (
    <Modal title={notification.title} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>{notification.subtitle}</p>
      {notification.type === "media" && notification.payload && (
        <div className="media-review-preview">
          <h3>{String(notification.payload.title ?? notification.title)}</h3>
          {typeof notification.payload.imageUrl === "string" && notification.payload.imageUrl && <img src={notification.payload.imageUrl} alt="" />}
          {Array.isArray(notification.payload.answers) ? (
            <div>{(notification.payload.answers as any[]).map((answer, index) => <article key={index}><strong>{answer.question}</strong><p>{answer.answer}</p></article>)}</div>
          ) : (
            <p>{String(notification.payload.body ?? "")}</p>
          )}
        </div>
      )}
      {notification.amount != null && (
        <p style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>${notification.amount}</p>
      )}

      {mode.kind === "info" && <p className="form-hint">{mode.message}</p>}

      {mode.kind === "single" && (
        <Button variant="primary" onClick={() => handle("approve")} disabled={busy}>
          {busy ? "Working…" : mode.actionLabel}
        </Button>
      )}

      {mode.kind === "approve_deny" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Button variant="primary" onClick={() => handle("approve")} disabled={busy}>
              {mode.approveLabel}
            </Button>
            <Button variant="danger" onClick={() => (mode.reasonField ? setShowDenyInput(true) : handle("deny"))} disabled={busy}>
              {mode.denyLabel}
            </Button>
          </div>
          {mode.reasonField && showDenyInput && (
            <div className="form-field">
              <label className="form-label" htmlFor="resolve-reason">Reason</label>
              <input
                id="resolve-reason"
                className="form-input"
                placeholder={`Reason for ${mode.denyLabel.toLowerCase()}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div style={{ marginTop: "var(--space-3)" }}>
                <Button variant="danger" onClick={() => handle("deny")} disabled={busy || !reason.trim()}>
                  Confirm {mode.denyLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
