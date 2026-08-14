import { useState } from "react";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { recApi } from "../../../lib/rec-api-client.js";

export function ReportIssueModal({
  guildId,
  onClose,
}: {
  guildId: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.sendLeagueReport({ guildId, message: message.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Report an Issue" onClose={onClose}>
      {sent ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ color: "var(--gold)" }}>Your report has been sent to the admin team. They'll review it and follow up if needed.</p>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {error && <ErrorState message={error} />}
          <p className="form-hint" style={{ marginTop: 0 }}>
            Describe the issue you're experiencing. This will be sent to the site admin inbox for review.
          </p>
          <div className="form-field">
            <label className="form-label" htmlFor="report-message">What's wrong?</label>
            <textarea
              id="report-message"
              className="form-input"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue, what you were doing when it happened, and any error messages you saw…"
            />
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button disabled={busy || !message.trim()} onClick={() => void submit()}>
              {busy ? "Sending…" : "Send Report"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
