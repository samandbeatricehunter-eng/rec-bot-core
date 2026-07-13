import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ManualScoreRecordResult } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Outcome = "home" | "away" | "tie";

// Pre-filled with the existing result if one exists, so correcting a score doesn't mean
// starting from scratch. "home"/"away" here mean the scheduled game's home/away team, not
// this row's team — the outcome buttons are labeled with the actual team names to avoid
// that ambiguity (mirrors apps/bot/src/flows/manual-scores.ts's UX).
export function EnterFinalScoreModal({
  guildId,
  gameId,
  homeLabel,
  awayLabel,
  existing,
  onClose,
  onSaved,
}: {
  guildId: string;
  gameId: string;
  homeLabel: string;
  awayLabel: string;
  existing: { homeScore: number; awayScore: number; isTie: boolean } | null;
  onClose: () => void;
  onSaved: (result: ManualScoreRecordResult) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(
    existing ? (existing.isTie ? "tie" : existing.homeScore > existing.awayScore ? "home" : "away") : null,
  );
  const [homeScore, setHomeScore] = useState(existing ? String(existing.homeScore) : "");
  const [awayScore, setAwayScore] = useState(existing ? String(existing.awayScore) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.recordManualScore({
        guildId,
        gameId,
        outcome,
        homeScore: homeScore.trim() === "" ? null : Number(homeScore),
        awayScore: awayScore.trim() === "" ? null : Number(awayScore),
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the final score.");
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? "Correct Final Score" : "Enter Final Score"} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="form-field">
        <span className="form-label">Outcome</span>
        <div className="segmented">
          <Button variant={outcome === "home" ? "primary" : "secondary"} onClick={() => setOutcome("home")} disabled={busy}>
            {homeLabel} Win
          </Button>
          <Button variant={outcome === "away" ? "primary" : "secondary"} onClick={() => setOutcome("away")} disabled={busy}>
            {awayLabel} Win
          </Button>
          <Button variant={outcome === "tie" ? "primary" : "secondary"} onClick={() => setOutcome("tie")} disabled={busy}>
            Tie
          </Button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="home-score">{homeLabel} Score</label>
          <input
            id="home-score"
            className="form-input"
            type="number"
            min={0}
            max={200}
            value={homeScore}
            disabled={busy}
            onChange={(e) => setHomeScore(e.target.value)}
          />
        </div>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="away-score">{awayLabel} Score</label>
          <input
            id="away-score"
            className="form-input"
            type="number"
            min={0}
            max={200}
            value={awayScore}
            disabled={busy}
            onChange={(e) => setAwayScore(e.target.value)}
          />
        </div>
      </div>
      <p className="form-hint">Scores are optional — leave blank to record a plain win/loss/tie.</p>
      <Button variant="primary" onClick={handleSave} disabled={!outcome || busy}>
        {busy ? "Saving…" : "Save Result"}
      </Button>
    </Modal>
  );
}
