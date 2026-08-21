import { useState } from "react";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubMatchupGame } from "../../types/api.js";

type HelpKind = "force_win" | "autopilot" | "matchup_issue";

const OPTIONS: Array<{ kind: HelpKind; label: string; description: string }> = [
  { kind: "force_win", label: "Request Force Win", description: "Ask a commissioner to rule this game in your favor." },
  { kind: "autopilot", label: "Request Opponent AutoPilot", description: "Ask a commissioner to have your opponent's team autopiloted." },
  { kind: "matchup_issue", label: "Report Matchup Issue", description: "Flag a problem with this matchup for a commissioner to look into." },
];

// Notification-only: submitting here creates a commissioner case and notifies commissioners —
// it does not itself decide the outcome or change any game state. A commissioner resolves it
// manually through existing tools.
export function RequestHelpSheet({
  matchup,
  guildId,
  onClose,
  onSubmitted,
}: {
  matchup: HubMatchupGame;
  guildId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [kind, setKind] = useState<HelpKind | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!kind || matchup.matchupType !== "h2h") return;
    const trimmed = message.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.submitMatchupHelpRequest({ guildId, gameId: matchup.gameId, kind, message: trimmed });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request.");
      setBusy(false);
    }
  }

  if (matchup.matchupType !== "h2h") {
    return (
      <Modal title="Request Help" onClose={onClose}>
        <p>Force Win and other help requests are only available for human vs human matchups.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Request Help" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        {OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={`btn ${kind === option.kind ? "btn-primary" : "btn-secondary"}`}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left", gap: 2, padding: "var(--space-2) var(--space-3)" }}
            onClick={() => setKind(option.kind)}
          >
            <strong>{option.label}</strong>
            <span style={{ fontWeight: 400, fontSize: "var(--text-sm)", opacity: 0.85 }}>{option.description}</span>
          </button>
        ))}
      </div>
      {kind && (
        <>
          <label className="form-field">
            <span className="form-label">Tell us what's going on</span>
            <textarea
              className="form-input"
              rows={4}
              maxLength={500}
              value={message}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="A description is required so a commissioner has context."
            />
          </label>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy || !message.trim()}>
            {busy ? "Submitting…" : "Submit Request"}
          </Button>
        </>
      )}
    </Modal>
  );
}
