import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { BoxScoreSubmissionDetail } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { LoadingState } from "../ui/LoadingState.js";

// The commissioner approve/deny panel — shared between the schedule builder (a pending
// submission for a specific week) and the notification center (deep-linking straight to
// the same submission from the feed). One review flow, two entry points.
export function ReviewBoxScoreModal({
  submissionId,
  onClose,
  onResolved,
}: {
  submissionId: string;
  onClose: () => void;
  onResolved: (action: "approve" | "deny") => void;
}) {
  const [submission, setSubmission] = useState<BoxScoreSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    recApi
      .getBoxScoreSubmission(submissionId)
      .then(setSubmission)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load submission."));
  }, [submissionId]);

  async function handleReview(action: "approve" | "deny") {
    setBusy(true);
    try {
      await recApi.reviewBoxScore({ submissionId, action, deniedReason: action === "deny" ? denyReason : undefined });
      onResolved(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review submission.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Review Box Score" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!submission && !error && <LoadingState />}
      {submission && (
        <div>
          <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-md)", fontWeight: 600 }}>
            Week {submission.week_number ?? "?"}: {submission.team1_abbr ?? "?"} {submission.away_score ?? "-"} @ {submission.team2_abbr ?? "?"} {submission.home_score ?? "-"}
          </p>
          {submission.image_storage_url && (
            <img
              src={submission.image_storage_url}
              alt="Box score screenshot"
              style={{ maxWidth: "100%", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)" }}
            />
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Button variant="primary" onClick={() => handleReview("approve")} disabled={busy}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => setShowDenyInput(true)} disabled={busy}>
              Deny
            </Button>
          </div>
          {showDenyInput && (
            <div className="form-field">
              <label className="form-label" htmlFor="deny-reason">Reason for denial</label>
              <input
                id="deny-reason"
                className="form-input"
                placeholder="Reason for denial"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
              />
              <div style={{ marginTop: "var(--space-3)" }}>
                <Button variant="danger" onClick={() => handleReview("deny")} disabled={busy || !denyReason.trim()}>
                  Confirm Deny
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
