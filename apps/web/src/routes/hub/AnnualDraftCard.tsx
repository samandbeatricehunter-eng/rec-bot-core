import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, SkipForward, Trophy } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import { chatRealtimeClient } from "../../lib/chat-realtime-client.js";
import type { FantasyDraftState } from "../../types/api.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";

export function AnnualDraftCard({ guildId, leagueId, currentSeason }: { guildId: string; leagueId: string; currentSeason: number }) {
  const [state, setState] = useState<FantasyDraftState | null>(null);
  const [seasonNumber, setSeasonNumber] = useState(currentSeason + 1);
  const [timerMinutes, setTimerMinutes] = useState(2);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => recApi.getAnnualDraftState(guildId).then(setState).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load the annual draft.")), [guildId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => chatRealtimeClient.onChannelEvent(guildId, "fantasy_draft", leagueId, (event) => { if (event.kind === "refresh") void load(); }), [guildId, leagueId, load]);

  const onClock = useMemo(() => state?.teams.find((team) => team.id === state.onTheClockTeamId) ?? null, [state]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That draft action failed."); }
    finally { setBusy(false); }
  }

  if (!state && !error) return <LoadingState label="Loading annual draft…" />;
  if (!state) return <ErrorState message={error ?? "Failed to load the annual draft."} />;
  const session = state.session;
  const status = session?.status ?? "not_started";

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div><h3 style={{ margin: 0 }}>Annual Rookie Draft</h3><p className="form-hint" style={{ marginBottom: 0 }}>Seven-round pick clock using the live traded-pick ownership ledger.</p></div>
        {status === "live" && <div><strong>{onClock?.displayName ?? "Unknown team"}</strong><div className="form-hint">Round {session?.currentRound}, Pick {session?.currentPickInRound}</div></div>}
      </div>
      {error && <ErrorState message={error} />}
      {state.caller.isCommissioner && status !== "live" && (
        <div className="fantasy-draft-form-row" style={{ marginTop: "var(--space-3)" }}>
          <label>Draft season<input className="form-input" type="number" min={1} value={seasonNumber} onChange={(event) => setSeasonNumber(Number(event.target.value))} /></label>
          <label><input type="checkbox" checked={timerEnabled} onChange={(event) => setTimerEnabled(event.target.checked)} /> Use pick timer</label>
          {timerEnabled && <label>Minutes per pick<input className="form-input" type="number" min={1} max={30} value={timerMinutes} onChange={(event) => setTimerMinutes(Math.max(1, Number(event.target.value) || 1))} /></label>}
          <Button disabled={busy} onClick={() => void run(() => recApi.startAnnualDraft({ guildId, seasonNumber, pickTimerSeconds: timerEnabled ? timerMinutes * 60 : null }))}><Trophy size={16} /> Start Annual Draft</Button>
        </div>
      )}
      {state.caller.isCommissioner && status === "live" && (
        <div className="fantasy-draft-actions" style={{ marginTop: "var(--space-3)" }}>
          <Button disabled={busy} onClick={() => void run(() => recApi.advanceAnnualDraftPick(guildId))}>Confirm Pick & Advance</Button>
          <Button variant="secondary" disabled={busy || state.skipChoices.length < 2} onClick={() => { const next = state.skipChoices[1]; if (next) void run(() => recApi.skipAnnualDraftToSpecific({ guildId, round: next.round, pickInRound: next.pickInRound })); }}><SkipForward size={16} /> Skip Current Pick</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => recApi.setAnnualDraftTimer({ guildId, pickTimerSeconds: session?.pickTimerSeconds ? null : timerMinutes * 60 }))}><Clock size={16} /> {session?.pickTimerSeconds ? "Disable Timer" : "Enable Timer"}</Button>
          <Button variant="danger" disabled={busy} onClick={() => { if (window.confirm("End this annual draft?")) void run(() => recApi.endAnnualDraft(guildId)); }}>End Draft</Button>
        </div>
      )}
      {status === "concluded" && <p className="form-hint">Season {session?.seasonNumber} annual draft concluded. Start the next season when its seven-round pick ledger is ready.</p>}
    </Card>
  );
}
