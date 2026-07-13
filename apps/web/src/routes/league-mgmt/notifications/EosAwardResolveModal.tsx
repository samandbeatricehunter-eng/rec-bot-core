import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { EosAwardPoll } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// Vote counts are entered manually per nominee (whatever the commissioner tallied from
// Discord reactions/polling) — settleEosAwardPoll takes raw numbers regardless of how they
// were collected, so there's no need to scrape Discord from here.
export function EosAwardResolveModal({
  pollId,
  onClose,
  onResolved,
}: {
  pollId: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { guildId } = useReadyAuth();
  const [poll, setPoll] = useState<EosAwardPoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    recApi
      .getEosAwardPoll({ guildId, pollId })
      .then((res) => setPoll(res.poll))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load award poll."));
  }, [guildId, pollId]);

  async function handleSettle() {
    if (!poll) return;
    setBusy(true);
    setError(null);
    const voteCounts: Record<string, number> = {};
    poll.nominee_payloads.forEach((_, index) => {
      voteCounts[String(index)] = Number(votes[index] ?? 0);
    });
    try {
      await recApi.settleEosAwardPoll({ guildId, pollId, voteCounts });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle this award poll.");
      setBusy(false);
    }
  }

  const totalVotes = Object.values(votes).reduce((sum, v) => sum + (Number(v) || 0), 0);

  return (
    <Modal title={poll ? poll.category_label : "EOS Award"} onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!poll && !error && <LoadingState />}
      {poll && (
        <div>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Enter each nominee's vote count from Discord, then settle — ties are broken automatically by net votes, then by the underlying stat.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            {poll.nominee_payloads.map((nominee, index) => (
              <div key={index} className="form-field" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor={`vote-${index}`}>
                  {nominee.teamName} {nominee.discordId ? `— <@${nominee.discordId}>` : ""} ({nominee.record}, {nominee.detail ?? `PD ${nominee.pointDifferential}`})
                </label>
                <input
                  id={`vote-${index}`}
                  className="form-input"
                  type="number"
                  min={0}
                  value={votes[index] ?? ""}
                  disabled={busy}
                  onChange={(e) => setVotes((prev) => ({ ...prev, [index]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <Button variant="primary" onClick={handleSettle} disabled={busy || totalVotes === 0}>
            {busy ? "Settling…" : "Settle Award"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
