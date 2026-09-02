import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, ListOrdered, SkipForward, Trophy } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import { chatRealtimeClient } from "../../lib/chat-realtime-client.js";
import type { FantasyDraftOrderMode, FantasyDraftState, FantasyDraftType } from "../../types/api.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Modal } from "../../components/ui/Modal.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";

// REC no longer tracks which player each team drafts (see fantasy-draft.service.ts) -- this
// is purely a turn-order/pick-clock companion to the real in-Madden draft: whose turn it is,
// an optional per-pick timer, and five commissioner-only controls.

// <input type="datetime-local"> takes/returns a value with no timezone info, in local wall-clock
// time -- these two just cross that boundary against a real Date so the UI can round-trip an ISO
// timestamp without silently shifting it.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimeRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

// Ticking countdown against the pick's turnStartedAt + pickTimerSeconds deadline.
function PickTimer({ turnStartedAt, pickTimerSeconds }: { turnStartedAt: string; pickTimerSeconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedMs = now - new Date(turnStartedAt).getTime();
  const remainingSeconds = Math.max(0, pickTimerSeconds - Math.floor(elapsedMs / 1000));
  return <p className={`fantasy-draft-clock-timer${remainingSeconds <= 15 ? " is-urgent" : ""}`}>{formatTimeRemaining(remainingSeconds)}</p>;
}

export function FantasyDraftCard({ guildId, leagueId, compact = false }: { guildId: string; leagueId: string; compact?: boolean }) {
  const [state, setState] = useState<FantasyDraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [draftType, setDraftType] = useState<FantasyDraftType>("fantasy");
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(2);
  const [pickOrderOpen, setPickOrderOpen] = useState(false);
  const [skipToOpen, setSkipToOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const load = useCallback(() => {
    recApi.getFantasyDraftState(guildId)
      .then((next) => { setState(next); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the draft."));
  }, [guildId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!leagueId) return;
    return chatRealtimeClient.onChannelEvent(guildId, "fantasy_draft", leagueId, (event) => {
      if (event.kind === "refresh") load();
    });
  }, [guildId, leagueId, load]);

  useEffect(() => {
    setScheduleValue(state?.session?.scheduledAt ? toDatetimeLocalValue(state.session.scheduledAt) : "");
  }, [state?.session?.scheduledAt]);

  async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setActionError(null);
    try {
      const result = await action();
      load();
      return result;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action failed. Please try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const onTheClockTeam = useMemo(() => {
    if (!state?.onTheClockTeamId) return null;
    return state.teams.find((t) => t.id === state.onTheClockTeamId) ?? null;
  }, [state]);

  if (error) return <ErrorState message={error} />;
  if (!state) return <div className="hub-section"><LoadingState label="Loading draft…" /></div>;

  const { session, caller } = state;
  const status = session?.status ?? "not_started";

  if (status === "concluded") {
    return (
      <SectionFrame eyebrow="Draft" title="Draft Complete">
        <div className="fantasy-draft-concluded">
          <Trophy size={28} />
          <p>The draft has concluded.</p>
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame className={`fantasy-draft-card${compact ? " compact" : ""}`} eyebrow={session?.draftType === "offseason" ? "Offseason Draft" : session?.draftType === "rookie" ? "Rookie Draft" : "Fantasy Draft"} title={status === "live" ? "Draft In Progress" : "Draft Not Started"}>
      {actionError && <ErrorState message={actionError} />}

      {status === "live" && (
        onTheClockTeam ? (
          <div className="fantasy-draft-clock">
            <p className="fantasy-draft-clock-label">On The Clock</p>
            <p className="fantasy-draft-clock-team">{onTheClockTeam.displayName}</p>
            <p className="fantasy-draft-clock-pick">Round {session?.currentRound}, Pick {session?.currentPickInRound}</p>
            {session?.pickTimerSeconds && session.turnStartedAt ? (
              <PickTimer turnStartedAt={session.turnStartedAt} pickTimerSeconds={session.pickTimerSeconds} />
            ) : null}
          </div>
        ) : (
          <div className="fantasy-draft-empty">Set the pick order to begin the draft clock.</div>
        )
      )}

      {status === "not_started" && (
        <div className="fantasy-draft-empty">
          The draft hasn't started yet.
          {session?.scheduledAt && <> Scheduled for {new Date(session.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</>}
        </div>
      )}

      {caller.isCommissioner && (
        <div className="fantasy-draft-commissioner-panel">
          <h4>Commissioner Controls</h4>

          {status === "not_started" && (
            <>
              <div className="fantasy-draft-form-row">
                <label htmlFor="fantasy-draft-type">Draft type</label>
                <select id="fantasy-draft-type" className="form-input" value={draftType} onChange={(e) => setDraftType(e.target.value as FantasyDraftType)}>
                  <option value="fantasy">Fantasy Draft (standard or snake, unlimited rounds)</option>
                  <option value="offseason">Offseason Draft (standard order, 7 rounds)</option>
                  <option value="rookie">Rookie Draft (3 rounds, rest simulated)</option>
                </select>
              </div>
              <div className="fantasy-draft-form-row">
                <label>
                  <input type="checkbox" checked={timerEnabled} onChange={(e) => setTimerEnabled(e.target.checked)} /> Use a pick timer
                </label>
              </div>
              {timerEnabled && (
                <div className="fantasy-draft-form-row">
                  <label htmlFor="fantasy-draft-timer-minutes">Minutes per pick</label>
                  <input id="fantasy-draft-timer-minutes" className="form-input" type="number" min={1} max={30} value={timerMinutes} onChange={(e) => setTimerMinutes(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              )}
              <div className="fantasy-draft-actions">
                <Button variant="primary" size="compact" disabled={busy} onClick={() => runAction(() => recApi.startFantasyDraft({ guildId, draftType, pickTimerSeconds: timerEnabled ? timerMinutes * 60 : null }))}>
                  <Trophy size={16} /> Start Draft
                </Button>
              </div>

              <div className="fantasy-draft-form-row">
                <label htmlFor="fantasy-draft-schedule">Scheduled for</label>
                <input id="fantasy-draft-schedule" className="form-input" type="datetime-local" value={scheduleValue} onChange={(e) => setScheduleValue(e.target.value)} />
              </div>
              {scheduleError && <ErrorState message={scheduleError} />}
              <div className="fantasy-draft-actions">
                <Button variant="secondary" size="compact" disabled={scheduleBusy || !scheduleValue} onClick={async () => {
                  setScheduleBusy(true); setScheduleError(null);
                  try {
                    await recApi.scheduleFantasyDraft({ guildId, scheduledAt: new Date(scheduleValue).toISOString() });
                    load();
                  } catch (err) {
                    setScheduleError(err instanceof Error ? err.message : "We couldn't schedule the draft. Please try again.");
                  } finally { setScheduleBusy(false); }
                }}>
                  <Clock size={16} /> Announce Draft Date
                </Button>
                {state.session?.scheduledAt && (
                  <Button variant="ghost" size="compact" disabled={scheduleBusy} onClick={async () => {
                    setScheduleBusy(true); setScheduleError(null);
                    try {
                      await recApi.scheduleFantasyDraft({ guildId, scheduledAt: null });
                      setScheduleValue("");
                      load();
                    } catch (err) {
                      setScheduleError(err instanceof Error ? err.message : "We couldn't clear the schedule. Please try again.");
                    } finally { setScheduleBusy(false); }
                  }}>
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}

          {status === "live" && (
            <div className="fantasy-draft-actions">
              <Button variant="secondary" size="compact" disabled={busy} onClick={() => setPickOrderOpen(true)}>
                <CheckCircle2 size={16} /> Set Pick Order
              </Button>
              <Button variant="secondary" size="compact" disabled={busy || !state.onTheClockTeamId} onClick={() => runAction(() => recApi.skipFantasyDraftToNext(guildId))}>
                <SkipForward size={16} /> Skip to Next Pick
              </Button>
              <Button variant="secondary" size="compact" disabled={busy || !state.skipChoices.length} onClick={() => setSkipToOpen(true)}>
                <ListOrdered size={16} /> Skip to Specific Pick
              </Button>
              <Button variant="secondary" size="compact" disabled={busy} onClick={() => setPickOrderOpen(true)}>
                <Clock size={16} /> {session?.pickTimerSeconds ? "Change Timer" : "Set Timer"}
              </Button>
              <Button variant="danger" size="compact" disabled={busy} onClick={() => { if (confirm("End the draft? This can't be undone.")) void runAction(() => recApi.endFantasyDraft(guildId)); }}>
                End Draft
              </Button>
            </div>
          )}
        </div>
      )}

      {pickOrderOpen && state.session && (
        <PickOrderModal
          guildId={guildId}
          state={state}
          onClose={() => setPickOrderOpen(false)}
          onSaved={() => { setPickOrderOpen(false); load(); }}
        />
      )}

      {skipToOpen && (
        <SkipToModal
          guildId={guildId}
          skipChoices={state.skipChoices}
          onClose={() => setSkipToOpen(false)}
          onSkipped={() => { setSkipToOpen(false); load(); }}
        />
      )}
    </SectionFrame>
  );
}

function TimerField({ initialSeconds, value, onChange }: { initialSeconds: number | null; value: { enabled: boolean; minutes: number }; onChange: (next: { enabled: boolean; minutes: number }) => void }) {
  void initialSeconds;
  return (
    <>
      <div className="fantasy-draft-form-row">
        <label>
          <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} /> Use a pick timer
        </label>
      </div>
      {value.enabled && (
        <div className="fantasy-draft-form-row">
          <label htmlFor="fantasy-draft-modal-timer-minutes">Minutes per pick</label>
          <input id="fantasy-draft-modal-timer-minutes" className="form-input" type="number" min={1} max={30} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
      )}
    </>
  );
}

function PickOrderModal({ guildId, state, onClose, onSaved }: { guildId: string; state: FantasyDraftState; onClose: () => void; onSaved: () => void }) {
  const { session, teams, pickOrder } = state;
  const isOffseason = session?.draftType === "offseason";
  const [orderMode, setOrderMode] = useState<FantasyDraftOrderMode>(session?.orderMode ?? "standard");
  const [slots, setSlots] = useState<Array<{ pickInRound: number; teamId: string }>>(() => {
    if (pickOrder.length === teams.length) return [...pickOrder].sort((a, b) => a.pickInRound - b.pickInRound);
    return teams.map((t, i) => ({ pickInRound: i + 1, teamId: t.id }));
  });
  const [timer, setTimer] = useState({ enabled: Boolean(session?.pickTimerSeconds), minutes: session?.pickTimerSeconds ? Math.round(session.pickTimerSeconds / 60) : 2 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setTeamAt(pickInRound: number, teamId: string) {
    setSlots((current) => current.map((s) => (s.pickInRound === pickInRound ? { ...s, teamId } : s)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const usedTeamIds = new Set(slots.map((s) => s.teamId));
      if (usedTeamIds.size !== teams.length) throw new Error("Each team must occupy exactly one pick slot.");
      await recApi.setFantasyDraftPickOrder({ guildId, orderMode: isOffseason ? "standard" : orderMode, picks: slots });
      await recApi.setFantasyDraftTimer({ guildId, pickTimerSeconds: timer.enabled ? timer.minutes * 60 : null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save the pick order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Set Pick Order" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      {error && <ErrorState message={error} />}
      {!isOffseason && (
        <div className="fantasy-draft-form-row">
          <label htmlFor="fantasy-draft-order-mode">Order mode</label>
          <select id="fantasy-draft-order-mode" className="form-input" value={orderMode} onChange={(e) => setOrderMode(e.target.value as FantasyDraftOrderMode)}>
            <option value="standard">Standard (same order every round)</option>
            <option value="snake">Snake (order reverses each round)</option>
          </select>
        </div>
      )}
      <TimerField initialSeconds={session?.pickTimerSeconds ?? null} value={timer} onChange={setTimer} />
      <div className="fantasy-draft-pickorder-grid">
        {slots.map((slot) => (
          <div key={slot.pickInRound} className="fantasy-draft-pickorder-slot">
            <span>{slot.pickInRound}</span>
            <select className="form-input" value={slot.teamId} onChange={(e) => setTeamAt(slot.pickInRound, e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="fantasy-draft-actions" style={{ marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>Save</Button>
      </div>
    </Modal>
  );
}

function SkipToModal({ guildId, skipChoices, onClose, onSkipped }: { guildId: string; skipChoices: FantasyDraftState["skipChoices"]; onClose: () => void; onSkipped: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = skipChoices[selectedIndex];

  async function confirm() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.skipFantasyDraftToSpecific({ guildId, round: choice.round, pickInRound: choice.pickInRound });
      onSkipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't skip to that pick. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Skip to Specific Pick" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="fantasy-draft-form-row">
        <label htmlFor="fantasy-draft-skip-to">Pick</label>
        <select id="fantasy-draft-skip-to" className="form-input" value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))}>
          {skipChoices.map((c, i) => (
            <option key={`${c.round}-${c.pickInRound}`} value={i}>Round {c.round}, Pick {c.pickInRound} — {c.teamName}</option>
          ))}
        </select>
      </div>
      <div className="fantasy-draft-actions" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void confirm()} disabled={busy || !choice}>Skip to Pick</Button>
      </div>
    </Modal>
  );
}
