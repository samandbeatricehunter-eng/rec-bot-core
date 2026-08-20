import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { HubMatchupSchedule } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";

export function ManageGameWagersModal({ guildId, onClose, onDone }: { guildId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [schedule, setSchedule] = useState<HubMatchupSchedule | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [gameId, setGameId] = useState("");
  const [closeWagering, setCloseWagering] = useState(true);
  const [refundOpen, setRefundOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getHubMatchupSchedule({ guildId, weekNumber: week }).then((result) => {
      if (cancelled) return;
      setSchedule(result);
      setWeek(result.selectedWeek);
      const first = result.games.find((game) => game.matchupType === "h2h" && !game.isFinal);
      setGameId((current) => result.games.some((game) => game.gameId === current) ? current : first?.gameId ?? "");
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load games."); });
    return () => { cancelled = true; };
  }, [guildId, week]);

  const games = useMemo(() => (schedule?.games ?? []).filter((game) => game.matchupType === "h2h" && !game.isFinal), [schedule]);

  async function submit() {
    if (!gameId || (!closeWagering && !refundOpen)) return;
    setBusy(true);
    setError(null);
    try {
      const notes: string[] = [];
      if (closeWagering) {
        const result = await recApi.closeGameWagering({ guildId, gameId });
        notes.push(`Wagering closed${result.refundedCount ? `; ${result.refundedCount} open offer(s) refunded` : ""}`);
      }
      if (refundOpen) {
        const result = await recApi.cancelGameWagering({ guildId, gameId });
        notes.push(`${result.refundedCount} open wager(s) canceled and refunded`);
      }
      onDone(`${notes.join(". ")}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update wagering.");
      setBusy(false);
    }
  }

  return <Modal title="Close or Refund Game Wagers" onClose={onClose}>
    <div className="hub-hero-action-modal">
      <p>Select one game, then choose whether to close new wagering, refund open wagers, or do both.</p>
      {schedule?.weekNumbers.length ? <label className="form-field"><span className="form-label">Week</span><select className="form-input" value={week ?? ""} disabled={busy} onChange={(event) => { setSchedule(null); setGameId(""); setWeek(Number(event.target.value)); }}>{schedule.weekNumbers.map((number) => <option key={number} value={number}>Week {number}</option>)}</select></label> : null}
      <label className="form-field"><span className="form-label">Game</span><select className="form-input" value={gameId} disabled={busy || !games.length} onChange={(event) => setGameId(event.target.value)}><option value="">{schedule ? "Select a game" : "Loading games…"}</option>{games.map((game) => <option key={game.gameId} value={game.gameId}>{game.awayTeamName} at {game.homeTeamName} · {game.wageringOpen ? "open" : "closed"}</option>)}</select></label>
      <label className="hub-troubleshoot-check"><input type="checkbox" checked={closeWagering} onChange={(event) => setCloseWagering(event.target.checked)} /><span><strong>Close wagering</strong><small>Prevent new bets and offers on this game.</small></span></label>
      <label className="hub-troubleshoot-check"><input type="checkbox" checked={refundOpen} onChange={(event) => setRefundOpen(event.target.checked)} /><span><strong>Cancel and refund open wagers</strong><small>Return funds held by wagers that have not been resolved.</small></span></label>
      {error && <p className="hub-transfer-status">{error}</p>}
      <Button variant="danger" disabled={busy || !gameId || (!closeWagering && !refundOpen)} onClick={() => void submit()}>{busy ? "Updating…" : "Apply Wager Actions"}</Button>
    </div>
  </Modal>;
}
