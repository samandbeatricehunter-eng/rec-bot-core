import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { GotwPollStatus, HubMatchupSchedule } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";

export function ManageGotwToolsModal({
  guildId,
  onClose,
  onDone,
}: {
  guildId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [schedule, setSchedule] = useState<HubMatchupSchedule | null>(null);
  const [polls, setPolls] = useState<GotwPollStatus[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [pollId, setPollId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getHubMatchupSchedule({ guildId, weekNumber: week }).then((result) => {
      if (cancelled) return;
      setSchedule(result);
      setWeek(result.selectedWeek);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load weeks.");
    });
    return () => { cancelled = true; };
  }, [guildId, week]);

  useEffect(() => {
    if (week == null) return;
    let cancelled = false;
    recApi.listGotwPollsForWeek({ guildId, weekNumber: week }).then((result) => {
      if (cancelled) return;
      setPolls(result.polls);
      setPollId((current) => result.polls.some((poll) => poll.id === current) ? current : result.polls[0]?.id ?? "");
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load GOTW polls.");
    });
    return () => { cancelled = true; };
  }, [guildId, week]);

  const selected = useMemo(() => polls?.find((poll) => poll.id === pollId) ?? null, [polls, pollId]);
  const canClose = selected?.status === "open";
  const canClear = selected?.status === "settled";

  async function closeVoting() {
    if (!pollId || !canClose) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.closeGameOfWeekVoting({ guildId, pollId });
      onDone("GOTW voting closed. Picks are frozen and will not be logged until the game is settled as a played result.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not close GOTW voting.");
      setBusy(false);
    }
  }

  async function clearLoggedVotes() {
    if (!pollId || !canClear) return;
    if (!window.confirm("Clear logged GOTW votes for this poll? Guessing records and correct-pick payouts for this game will be reversed, and the poll will be voided.")) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.clearLoggedGotwVotes({ guildId, pollId });
      onDone(`Cleared ${result.recordsCleared} logged GOTW vote${result.recordsCleared === 1 ? "" : "s"}${result.payoutsReversed ? ` and reversed ${result.payoutsReversed} payout${result.payoutsReversed === 1 ? "" : "s"}` : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear logged GOTW votes.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Game of the Week Tools" onClose={onClose}>
      <div className="hub-hero-action-modal">
        <p>
          Close voting when a GOTW started without a stream (so it did not auto-close).
          Clear logged votes when a GOTW was settled as a Force Win and should not count toward records or payouts.
          Fair Sims still settle GOTW picks.
        </p>
        {schedule?.weekNumbers.length ? (
          <label className="form-field">
            <span className="form-label">Week</span>
            <select
              className="form-input"
              value={week ?? ""}
              disabled={busy}
              onChange={(event) => {
                setPolls(null);
                setPollId("");
                setWeek(Number(event.target.value));
              }}
            >
              {schedule.weekNumbers.map((number) => (
                <option key={number} value={number}>Week {number}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="form-field">
          <span className="form-label">GOTW poll</span>
          <select
            className="form-input"
            value={pollId}
            disabled={busy || !polls?.length}
            onChange={(event) => setPollId(event.target.value)}
          >
            <option value="">{polls ? "Select a GOTW poll" : "Loading polls…"}</option>
            {(polls ?? []).map((poll) => (
              <option key={poll.id} value={poll.id}>
                {poll.away_team_name} at {poll.home_team_name} · {poll.status}
              </option>
            ))}
          </select>
        </label>
        {polls && !polls.length ? <p className="form-hint">No GOTW poll for this week.</p> : null}
        {error ? <p className="hub-transfer-status">{error}</p> : null}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Button variant="secondary" disabled={busy || !canClose} onClick={() => void closeVoting()}>
            {busy && canClose ? "Closing…" : "Close Voting"}
          </Button>
          <Button variant="danger" disabled={busy || !canClear} onClick={() => void clearLoggedVotes()}>
            {busy && canClear ? "Clearing…" : "Clear Logged Votes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
