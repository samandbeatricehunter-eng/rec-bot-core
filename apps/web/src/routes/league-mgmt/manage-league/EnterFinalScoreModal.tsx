import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ManualScoreRecordResult, PerformanceTag, WatchedPlayer } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Outcome = "home" | "away" | "tie";
type Side = "home" | "away";
type Unit = "offense" | "defense" | "special_teams";
type PerformanceGrade = "standout" | "solid" | "neutral" | "poor";

const STAT_FIELDS = [
  ["offPassYards", "Passing yards"], ["offRushYards", "Rushing yards"], ["offYardsGained", "Offensive yards"], ["totalYardsGained", "Total yards"],
  ["offFirstDown", "First downs"], ["thirdDownConversions", "3rd-down conversions"], ["fourthDownConversions", "4th-down conversions"], ["twoPointConversions", "2-point conversions"],
  ["turnoversCommitted", "Turnovers committed"], ["redZoneOffPercentage", "Red-zone offense %"], ["kickReturnYards", "Kick-return yards"], ["puntReturnYards", "Punt-return yards"],
  ["generatedTurnovers", "Takeaways generated"], ["yardsAllowed", "Yards allowed"], ["rushYardsAllowed", "Rush yards allowed"], ["passYardsAllowed", "Pass yards allowed"],
  ["firstDownsAllowed", "First downs allowed"], ["redZoneDefPercentage", "Red-zone defense %"], ["comebackDeficit", "Largest comeback deficit"], ["comebackDeficitQuarter", "Deficit quarter"], ["comebackRate", "Comeback rate"],
] as const;

// Deliberately a shorter, player-specific vocabulary — most of the team-stat fields above
// (red-zone %, 2-point conversions, etc.) don't make sense attributed to one player.
const PLAYER_STAT_FIELDS = [
  ["passYards", "Passing yards"], ["rushYards", "Rushing yards"], ["receptions", "Receptions"], ["recYards", "Receiving yards"],
  ["tackles", "Tackles"], ["sacks", "Sacks"], ["interceptions", "Interceptions"], ["touchdowns", "Touchdowns"],
] as const;
const GRADE_OPTIONS: Array<{ value: PerformanceGrade; label: string }> = [
  { value: "standout", label: "Standout" }, { value: "solid", label: "Solid" }, { value: "neutral", label: "Neutral" }, { value: "poor", label: "Poor" },
];
const UNITS: Array<{ value: Unit; label: string }> = [
  { value: "offense", label: "Offense" }, { value: "defense", label: "Defense" }, { value: "special_teams", label: "Special Teams" },
];

type PlayerTagDraft = { watchedPlayerId: string; performanceGrade: PerformanceGrade; statLines: Array<{ statKey: string; value: string }> };

export function EnterFinalScoreModal({ guildId, gameId, homeLabel, awayLabel, homeTeamId, awayTeamId, existing, onClose, onSaved }: {
  guildId: string; gameId: string; homeLabel: string; awayLabel: string;
  homeTeamId?: string | null; awayTeamId?: string | null;
  existing: { homeScore: number; awayScore: number; isTie: boolean } | null;
  onClose: () => void; onSaved: (result: ManualScoreRecordResult) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(existing ? (existing.isTie ? "tie" : existing.homeScore > existing.awayScore ? "home" : "away") : null);
  const [homeScore, setHomeScore] = useState(existing ? String(existing.homeScore) : "");
  const [awayScore, setAwayScore] = useState(existing ? String(existing.awayScore) : "");
  const [stats, setStats] = useState<Record<Side, Record<string, string | boolean>>>({ home: {}, away: {} });
  const [watchedPlayers, setWatchedPlayers] = useState<Record<Side, WatchedPlayer[]>>({ home: [], away: [] });
  const [playerTags, setPlayerTags] = useState<Record<Side, PlayerTagDraft[]>>({ home: [], away: [] });
  const [unitTags, setUnitTags] = useState<Record<Side, Partial<Record<Unit, PerformanceGrade>>>>({ home: {}, away: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (homeTeamId) recApi.listWatchedPlayers(guildId, homeTeamId).then((res) => setWatchedPlayers((current) => ({ ...current, home: res.players }))).catch(() => {});
    if (awayTeamId) recApi.listWatchedPlayers(guildId, awayTeamId).then((res) => setWatchedPlayers((current) => ({ ...current, away: res.players }))).catch(() => {});
  }, [guildId, homeTeamId, awayTeamId]);

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

  function addPlayerTag(side: Side) {
    setPlayerTags((current) => ({ ...current, [side]: [...current[side], { watchedPlayerId: "", performanceGrade: "standout", statLines: [] }] }));
  }
  function removePlayerTag(side: Side, index: number) {
    setPlayerTags((current) => ({ ...current, [side]: current[side].filter((_, i) => i !== index) }));
  }
  function updatePlayerTag(side: Side, index: number, patch: Partial<PlayerTagDraft>) {
    setPlayerTags((current) => ({ ...current, [side]: current[side].map((tag, i) => i === index ? { ...tag, ...patch } : tag) }));
  }
  function addStatLine(side: Side, index: number) {
    updatePlayerTag(side, index, { statLines: [...playerTags[side][index].statLines, { statKey: "", value: "" }] });
  }
  function updateStatLine(side: Side, index: number, lineIndex: number, patch: Partial<{ statKey: string; value: string }>) {
    const lines = playerTags[side][index].statLines.map((line, i) => i === lineIndex ? { ...line, ...patch } : line);
    updatePlayerTag(side, index, { statLines: lines });
  }
  function removeStatLine(side: Side, index: number, lineIndex: number) {
    updatePlayerTag(side, index, { statLines: playerTags[side][index].statLines.filter((_, i) => i !== lineIndex) });
  }
  function setUnitGrade(side: Side, unit: Unit, grade: PerformanceGrade | "") {
    setUnitTags((current) => {
      const next = { ...current[side] };
      if (grade) next[unit] = grade; else delete next[unit];
      return { ...current, [side]: next };
    });
  }

  function buildPerformanceTags(side: Side): PerformanceTag[] {
    const tags: PerformanceTag[] = [];
    for (const draft of playerTags[side]) {
      if (!draft.watchedPlayerId) continue;
      const statLines = draft.statLines
        .filter((line) => line.statKey && line.value.trim() !== "")
        .map((line) => ({ statKey: line.statKey, label: PLAYER_STAT_FIELDS.find(([key]) => key === line.statKey)?.[1] ?? line.statKey, value: Number(line.value) }));
      tags.push({ subjectType: "player", watchedPlayerId: draft.watchedPlayerId, performanceGrade: draft.performanceGrade, statLines });
    }
    for (const [unit, grade] of Object.entries(unitTags[side]) as Array<[Unit, PerformanceGrade]>) {
      tags.push({ subjectType: "unit", unit, performanceGrade: grade });
    }
    return tags;
  }

  async function handleSave() {
    if (!outcome) return;
    setBusy(true); setError(null);
    try {
      const result = await recApi.recordManualScore({
        guildId, gameId, outcome,
        homeScore: homeScore.trim() === "" ? null : Number(homeScore),
        awayScore: awayScore.trim() === "" ? null : Number(awayScore),
        manualStats: { home: normalizeStats("home"), away: normalizeStats("away") },
        performanceTags: { home: buildPerformanceTags("home"), away: buildPerformanceTags("away") },
      });
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to save the results."); setBusy(false); }
  }

  return <Modal title={existing ? "Correct Results" : "Enter Results"} onClose={onClose}>
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
    <details className="manual-stat-entry"><summary>Players to Watch (optional)</summary>
      <p className="form-hint">Tag standout or struggling players and units — this feeds the headline generator with richer storylines. Manage each team's player list from its schedule page.</p>
      <div className="manual-stat-sides">{(["home", "away"] as Side[]).map((side) => <section key={side}>
        <h3>{side === "home" ? homeLabel : awayLabel}</h3>
        {watchedPlayers[side].length === 0 && <p className="form-hint">No players to watch added for this team yet.</p>}
        {playerTags[side].map((tag, index) => (
          <div key={index} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <select className="form-select" style={{ flex: 1 }} value={tag.watchedPlayerId} onChange={(event) => updatePlayerTag(side, index, { watchedPlayerId: event.target.value })}>
                <option value="">Select player…</option>
                {watchedPlayers[side].map((player) => <option key={player.id} value={player.id}>{player.playerName} · {player.position}{player.classYear ? ` · ${player.classYear}` : ""}</option>)}
              </select>
              <select className="form-select" value={tag.performanceGrade} onChange={(event) => updatePlayerTag(side, index, { performanceGrade: event.target.value as PerformanceGrade })}>
                {GRADE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <Button variant="ghost" size="compact" onClick={() => removePlayerTag(side, index)}><Trash2 size={14} /></Button>
            </div>
            {tag.statLines.map((line, lineIndex) => (
              <div key={lineIndex} style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                <select className="form-select" style={{ flex: 1 }} value={line.statKey} onChange={(event) => updateStatLine(side, index, lineIndex, { statKey: event.target.value })}>
                  <option value="">Select stat…</option>
                  {PLAYER_STAT_FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <input className="form-input" style={{ flex: 1 }} type="number" placeholder="Value" value={line.value} onChange={(event) => updateStatLine(side, index, lineIndex, { value: event.target.value })} />
                <Button variant="ghost" size="compact" onClick={() => removeStatLine(side, index, lineIndex)}><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button variant="secondary" size="compact" onClick={() => addStatLine(side, index)} style={{ marginTop: "var(--space-2)" }}><Plus size={14} /> Add Stat Line</Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => addPlayerTag(side)} disabled={watchedPlayers[side].length === 0}><Plus size={14} /> Tag a Player</Button>
        <div style={{ marginTop: "var(--space-3)" }}>
          <span className="form-label">Unit performance</span>
          {UNITS.map((unit) => (
            <div key={unit.value} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-1)" }}>
              <span>{unit.label}</span>
              <select className="form-select" style={{ width: 140 }} value={unitTags[side][unit.value] ?? ""} onChange={(event) => setUnitGrade(side, unit.value, event.target.value as PerformanceGrade | "")}>
                <option value="">No tag</option>
                {GRADE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>)}</div>
    </details>
    <Button variant="primary" onClick={handleSave} disabled={!outcome || busy}>{busy ? "Saving…" : "Save Results"}</Button>
  </Modal>;
}
