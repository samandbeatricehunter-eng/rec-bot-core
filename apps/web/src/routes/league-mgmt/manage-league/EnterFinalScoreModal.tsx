import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ManualScoreRecordResult } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Outcome = "home" | "away" | "tie";
type Side = "home" | "away";
const STAT_FIELDS = [
  ["offPassYards", "Passing yards"], ["offRushYards", "Rushing yards"], ["offYardsGained", "Offensive yards"], ["totalYardsGained", "Total yards"],
  ["offFirstDown", "First downs"], ["thirdDownConversions", "3rd-down conversions"], ["fourthDownConversions", "4th-down conversions"], ["twoPointConversions", "2-point conversions"],
  ["turnoversCommitted", "Turnovers committed"], ["redZoneOffPercentage", "Red-zone offense %"], ["kickReturnYards", "Kick-return yards"], ["puntReturnYards", "Punt-return yards"],
  ["generatedTurnovers", "Takeaways generated"], ["yardsAllowed", "Yards allowed"], ["rushYardsAllowed", "Rush yards allowed"], ["passYardsAllowed", "Pass yards allowed"],
  ["firstDownsAllowed", "First downs allowed"], ["redZoneDefPercentage", "Red-zone defense %"], ["comebackDeficit", "Largest comeback deficit"], ["comebackDeficitQuarter", "Deficit quarter"], ["comebackRate", "Comeback rate"],
] as const;

export function EnterFinalScoreModal({ guildId, gameId, homeLabel, awayLabel, existing, onClose, onSaved }: {
  guildId: string; gameId: string; homeLabel: string; awayLabel: string;
  existing: { homeScore: number; awayScore: number; isTie: boolean } | null;
  onClose: () => void; onSaved: (result: ManualScoreRecordResult) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(existing ? (existing.isTie ? "tie" : existing.homeScore > existing.awayScore ? "home" : "away") : null);
  const [homeScore, setHomeScore] = useState(existing ? String(existing.homeScore) : "");
  const [awayScore, setAwayScore] = useState(existing ? String(existing.awayScore) : "");
  const [stats, setStats] = useState<Record<Side, Record<string, string | boolean>>>({ home: {}, away: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStat(side: Side, key: string, value: string | boolean) { setStats((current) => ({ ...current, [side]: { ...current[side], [key]: value } })); }
  function normalizeStats(side: Side) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stats[side])) {
      if (value === "" || value == null) continue;
      normalized[key] = key === "quarterScores"
        ? String(value).split(",").map((score) => Number(score.trim())).filter(Number.isFinite)
        : typeof value === "boolean" ? value : Number(value);
    }
    return normalized;
  }

  async function handleSave() {
    if (!outcome) return;
    setBusy(true); setError(null);
    try {
      const result = await recApi.recordManualScore({ guildId, gameId, outcome, homeScore: homeScore.trim() === "" ? null : Number(homeScore), awayScore: awayScore.trim() === "" ? null : Number(awayScore), manualStats: { home: normalizeStats("home"), away: normalizeStats("away") } });
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to save the final score."); setBusy(false); }
  }

  return <Modal title={existing ? "Correct Final Score" : "Enter Final Score"} onClose={onClose}>
    {error && <ErrorState message={error} />}
    <div className="form-field"><span className="form-label">Outcome</span><div className="segmented">
      <Button variant={outcome === "home" ? "primary" : "secondary"} onClick={() => setOutcome("home")} disabled={busy}>{homeLabel} Win</Button>
      <Button variant={outcome === "away" ? "primary" : "secondary"} onClick={() => setOutcome("away")} disabled={busy}>{awayLabel} Win</Button>
      <Button variant={outcome === "tie" ? "primary" : "secondary"} onClick={() => setOutcome("tie")} disabled={busy}>Tie</Button>
    </div></div>
    <div style={{ display: "flex", gap: "var(--space-3)" }}>
      {(["home", "away"] as Side[]).map((side) => <div className="form-field" style={{ flex: 1 }} key={side}><label className="form-label">{side === "home" ? homeLabel : awayLabel} Score</label><input className="form-input" type="number" min={0} max={200} value={side === "home" ? homeScore : awayScore} disabled={busy} onChange={(event) => side === "home" ? setHomeScore(event.target.value) : setAwayScore(event.target.value)} /></div>)}
    </div>
    <p className="form-hint">Scores are optional—leave blank to record a plain win/loss/tie.</p>
    <details className="manual-stat-entry"><summary>Optional team stats (same fields as a box score)</summary><p className="form-hint">Fill any fields you have. Blank fields remain unknown.</p>
      <div className="manual-stat-sides">{(["home", "away"] as Side[]).map((side) => <section key={side}><h3>{side === "home" ? homeLabel : awayLabel}</h3>
        <div className="manual-stat-grid">{STAT_FIELDS.map(([key, label]) => <label key={key}><span>{label}</span><input className="form-input" type="number" min={0} value={String(stats[side][key] ?? "")} onChange={(event) => updateStat(side, key, event.target.value)} /></label>)}</div>
        <label className="form-field"><span className="form-label">Quarter scores (comma-separated, including OT)</span><input className="form-input" placeholder="7, 3, 10, 7" value={String(stats[side].quarterScores ?? "")} onChange={(event) => updateStat(side, "quarterScores", event.target.value)} /></label>
        <label className="manual-checkbox"><input type="checkbox" checked={Boolean(stats[side].fourthQuarterComeback)} onChange={(event) => updateStat(side, "fourthQuarterComeback", event.target.checked)} /> Fourth-quarter comeback</label>
      </section>)}</div>
    </details>
    <Button variant="primary" onClick={handleSave} disabled={!outcome || busy}>{busy ? "Saving…" : "Save Result"}</Button>
  </Modal>;
}
