import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { recApi } from "../../../lib/rec-api-client.js";
import type { BoxScoreSubmissionDetail } from "../../../types/api.js";

export function BoxScoreDetail() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const [submission, setSubmission] = useState<BoxScoreSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!submissionId) return;
    recApi
      .getBoxScoreSubmission(submissionId)
      .then(setSubmission)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load submission."));
  }, [submissionId]);

  async function handleReview(action: "approve" | "deny") {
    if (!submissionId) return;
    setBusy(true);
    try {
      await recApi.reviewBoxScore({ submissionId, action, deniedReason: action === "deny" ? denyReason : undefined });
      navigate("/league-mgmt/box-scores");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review submission.");
      setBusy(false);
    }
  }

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!submission) return <p>Loading…</p>;

  return (
    <div>
      <h2>
        Week {submission.week_number ?? "?"}: {submission.team1_abbr ?? "?"} {submission.away_score ?? "-"} @ {submission.team2_abbr ?? "?"} {submission.home_score ?? "-"}
      </h2>
      {submission.image_storage_url && (
        <img src={submission.image_storage_url} alt="Box score screenshot" style={{ maxWidth: "100%", marginBottom: 16 }} />
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => handleReview("approve")} disabled={busy} style={{ padding: "8px 16px" }}>
          Approve
        </button>
        <button onClick={() => setShowDenyInput(true)} disabled={busy} style={{ padding: "8px 16px" }}>
          Deny
        </button>
      </div>
      {showDenyInput && (
        <div>
          <input
            placeholder="Reason for denial"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <button onClick={() => handleReview("deny")} disabled={busy || !denyReason.trim()}>
            Confirm Deny
          </button>
        </div>
      )}
    </div>
  );
}
