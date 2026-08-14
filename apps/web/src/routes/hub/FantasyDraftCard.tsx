import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  REC_CUSTOM_PLAYER_POSITIONS,
  REC_DEV_TRAITS,
  estimateRecPlayerOverall,
  getRecAttributeDisplayName,
  getRecEditableAttributes,
  listRecArchetypes,
  sortRecAttributeCodes,
  type RecOvrPosition,
} from "@rec/shared";
import { AlertTriangle, CheckCircle2, Clock, GripVertical, ListOrdered, Plus, Search, SkipForward, SlidersHorizontal, Trash2, Trophy, Undo2, X } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import { chatRealtimeClient } from "../../lib/chat-realtime-client.js";
import { ATTRIBUTE_ALL_KEYS, ATTRIBUTE_KEY_TO_CODE, attributeFullName, attributeLabel } from "../../lib/attribute-columns.js";
import type { FantasyDraftCheckin, FantasyDraftOrderMode, FantasyDraftPickRequest, FantasyDraftPoolPlayer, FantasyDraftState } from "../../types/api.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Modal } from "../../components/ui/Modal.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";

const POSITION_GROUP_ORDER = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "K", "P"];
const DRAFT_POSITIONS = [...REC_CUSTOM_PLAYER_POSITIONS, "K", "P"] as const;

function playerAge(birthYear: number | null): number | null {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear;
}
function formatHeight(inches: number | null): string {
  if (!inches) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
const NEXT_UP_COUNT = 5;

function formatScheduledAt(value: string | null): string {
  if (!value) return "not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "starting now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Ticking countdown to a scheduled draft start — mirrors the native `<t:UNIX:R>` timestamp
// the Discord side already gets for free, since a plain web push can't do the same trick.
function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = new Date(target).getTime() - now;
  return <span className="fantasy-draft-countdown">{formatCountdown(remaining)}</span>;
}

function sortByPosition(a: FantasyDraftPoolPlayer, b: FantasyDraftPoolPlayer): number {
  const ka = POSITION_GROUP_ORDER.indexOf(a.position);
  const kb = POSITION_GROUP_ORDER.indexOf(b.position);
  return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb);
}

function positionTabs(players: FantasyDraftPoolPlayer[]): string[] {
  // A handful of seeded players carry a blank position (data-quality gap upstream) — without
  // this filter that surfaces as a genuinely empty, unlabeled option in the dropdown.
  return [...new Set(players.map((p) => p.position).filter((position): position is string => Boolean(position?.trim())))].sort((a, b) => {
    const ka = POSITION_GROUP_ORDER.indexOf(a);
    const kb = POSITION_GROUP_ORDER.indexOf(b);
    return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb);
  });
}

function nextPicksUp(state: FantasyDraftState): Array<{ round: number; pickInRound: number; teamId: string; teamName: string }> {
  const { session, pickOrder, teams } = state;
  if (!session || pickOrder.length !== 32) return [];
  const result: Array<{ round: number; pickInRound: number; teamId: string; teamName: string }> = [];
  let round = session.currentRound;
  let pickInRound = session.currentPickInRound + 1;
  for (let i = 0; i < NEXT_UP_COUNT; i++) {
    if (pickInRound > 32) { pickInRound = 1; round += 1; }
    const index = pickInRound - 1;
    let teamId: string | undefined;
    if (session.orderMode === "snake" && round % 2 === 0) {
      teamId = pickOrder[pickOrder.length - 1 - index]?.teamId;
    } else {
      teamId = pickOrder[index]?.teamId;
    }
    if (!teamId) break;
    const team = teams.find((t) => t.id === teamId);
    result.push({ round, pickInRound, teamId, teamName: team?.displayName ?? "Unknown team" });
    pickInRound += 1;
  }
  return result;
}

export function FantasyDraftCard({ guildId, leagueId, compact = false }: { guildId: string; leagueId: string; compact?: boolean }) {
  const [state, setState] = useState<FantasyDraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pickOrderOpen, setPickOrderOpen] = useState(false);
  const [customPlayerOpen, setCustomPlayerOpen] = useState(false);
  const [wrapupTarget, setWrapupTarget] = useState<FantasyDraftPoolPlayer | null>(null);
  const [assignPoolOpen, setAssignPoolOpen] = useState(false);
  const [concludeResult, setConcludeResult] = useState<{ teamName: string; draftedCount: number }[] | null>(null);
  const [openPlayer, setOpenPlayer] = useState<FantasyDraftPoolPlayer | null>(null);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [pingModeOpen, setPingModeOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [cpuPingNotice, setCpuPingNotice] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipTargetPick, setSkipTargetPick] = useState(1);
  const [skippedPicks, setSkippedPicks] = useState<Array<{ id: string; teamId: string; teamName: string; round: number; pickInRound: number; overallPickNumber: number }>>([]);
  const [fillSkipTarget, setFillSkipTarget] = useState<{ id: string; teamName: string } | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const [wrapupBannerDismissed, setWrapupBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem(`rec-fantasy-draft-wrapup-${leagueId}`) === "1"; } catch { return false; }
  });

  const [boardOrder, setBoardOrder] = useState<string[]>([]);
  const boardSaveTimerRef = useRef<number | null>(null);
  const [saveBoardOpen, setSaveBoardOpen] = useState(false);
  const [loadBoardOpen, setLoadBoardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await recApi.getFantasyDraftState(guildId);
      setState(next);
      setError(null);
      if (next.session && ["live", "wrap_up"].includes(next.session.status)) {
        recApi.listSkippedFantasyDraftPicks(guildId).then((res) => setSkippedPicks(res.skipped)).catch(() => undefined);
      } else {
        setSkippedPicks([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  async function skipCurrentPick() {
    setSkipping(true);
    setError(null);
    try {
      await recApi.skipFantasyDraftPick(guildId);
      setNotice("Pick skipped — fill it in later from Missed Picks.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSkipping(false);
    }
  }

  useEffect(() => {
    let active = true;
    const unsubscribe = chatRealtimeClient.onChannelEvent(guildId, "fantasy_draft", leagueId, (event) => {
      if (event.kind === "refresh") void load();
    });
    void load();
    return () => { active = false; unsubscribe(); };
  }, [guildId, leagueId, load]);

  useEffect(() => {
    setBoardOrder(state?.myBoard ?? []);
  }, [state?.myBoard]);

  useEffect(() => {
    if (!state?.session) return;
    const status = state.session.status;
    if (status === "wrap_up" && prevStatusRef.current && prevStatusRef.current !== "wrap_up" && !wrapupBannerDismissed) {
      setNotice("The draft is complete — go review your in-game roster, then come back to finalize any undrafted players.");
    }
    prevStatusRef.current = status;
  }, [state, wrapupBannerDismissed]);

  useEffect(() => {
    return () => { if (boardSaveTimerRef.current) window.clearTimeout(boardSaveTimerRef.current); };
  }, []);

  async function runAction(action: () => Promise<unknown>, successMessage: string | null = null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleBoardReorder(next: FantasyDraftPoolPlayer[]) {
    const nextIds = next.map((p) => p.id);
    const subsetIds = new Set(nextIds);
    let cursor = 0;
    const merged = nextIds.length === boardOrder.length
      ? nextIds
      : boardOrder.map((id) => subsetIds.has(id) ? nextIds[cursor++]! : id);
    setBoardOrder(merged);
    if (boardSaveTimerRef.current) window.clearTimeout(boardSaveTimerRef.current);
    boardSaveTimerRef.current = window.setTimeout(() => {
      void runAction(() => recApi.saveFantasyDraftBoard({ guildId, playerIds: merged }));
    }, 600);
  }

  function toggleBoardMembership(playerId: string) {
    const next = boardOrder.includes(playerId) ? boardOrder.filter((id) => id !== playerId) : [...boardOrder, playerId];
    setBoardOrder(next);
    if (boardSaveTimerRef.current) window.clearTimeout(boardSaveTimerRef.current);
    boardSaveTimerRef.current = window.setTimeout(() => {
      void runAction(() => recApi.saveFantasyDraftBoard({ guildId, playerIds: next }));
    }, 600);
  }

  // Every draft submission — from the pool table's Draft button or the player card — gets a
  // native confirm before it goes out. Commissioners log immediately; everyone else submits a
  // request that only takes effect once the commissioner approves it.
  function handleDraftClick(player: FantasyDraftPoolPlayer, isCommissionerCaller: boolean) {
    if (!window.confirm(`Draft ${player.name}${isCommissionerCaller ? "" : " — sends a request to your commissioner"}?`)) return;
    void runAction(
      () => isCommissionerCaller
        ? recApi.logFantasyDraftPick({ guildId, playerId: player.id })
        : recApi.requestFantasyDraftPick({ guildId, playerId: player.id }),
      isCommissionerCaller ? `${player.name} drafted.` : `Pick request sent for ${player.name} — waiting on your commissioner.`,
    );
  }

  async function resolvePickRequest(requestId: string, action: "approve" | "deny") {
    setResolvingRequestId(requestId);
    setError(null);
    try {
      await recApi.resolveFantasyDraftPickRequest({ guildId, requestId, action });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingRequestId(null);
    }
  }

  if (loading && !state) return <SectionFrame eyebrow="Fantasy Draft" title="Draft Tracker"><LoadingState label="Loading the draft board…" /></SectionFrame>;
  if (error && !state) return <SectionFrame eyebrow="Fantasy Draft" title="Draft Tracker"><ErrorState message={error} /><div style={{ marginTop: "var(--space-3)" }}><Button variant="secondary" onClick={() => { setLoading(true); void load(); }}>Try again</Button></div></SectionFrame>;
  if (!state) return null;
  // After conclude, the hub no longer mounts this card — keep the full board route empty too
  // so deep links don't resurrect a finished draft room.
  if (state.session?.status === "concluded") return null;

  const { session, teams, pickOrder, pool, picks, pickRequests, caller } = state;
  const isCommissioner = caller.isCommissioner;
  const status = session?.status ?? "not_scheduled";
  const hasPickOrder = pickOrder.length === 32;
  const onTheClock = session && hasPickOrder ? teams.find((t) => t.id === state.onTheClockTeamId) ?? null : null;
  const draftedCount = picks.length;
  const playerNameById = new Map(pool.map((p) => [p.id, p.name]));

  const recentPicks = [...picks].sort((a, b) => b.overallPickNumber - a.overallPickNumber).slice(0, 8);

  const poolById = new Map(pool.map((p) => [p.id, p]));
  const boardPlayers = boardOrder.map((id) => poolById.get(id)).filter((p): p is FantasyDraftPoolPlayer => p != null && !p.isDrafted);
  const myRoster = caller.myTeamId ? pool.filter((p) => p.draftedByTeamId === caller.myTeamId && p.isDrafted) : [];
  const myPendingRequest = caller.myTeamId ? pickRequests.find((r) => r.teamId === caller.myTeamId) ?? null : null;

  function statusHeadline(): string {
    if (!session) return "No fantasy draft scheduled yet.";
    switch (session.status) {
      case "not_scheduled": return "No fantasy draft scheduled yet.";
      case "scheduled": return `Draft scheduled for ${formatScheduledAt(session.scheduledAt)}`;
      case "live": return hasPickOrder
        ? `Round ${session.currentRound} · Pick ${session.currentPickInRound} — ${onTheClock?.displayName ?? "unknown team"} on the clock`
        : "Draft is live — set the pick order to reveal the board";
      case "wrap_up": return "Draft complete — wrap-up phase";
      case "concluded": return "Fantasy draft complete";
    }
  }

  async function pingOnClock() {
    setPinging(true);
    setCpuPingNotice(null);
    setError(null);
    try {
      const result = await recApi.pingFantasyDraftOnClock(guildId);
      setNotice(`Pinged ${result.teamName ?? "the team on the clock"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("CPU_TEAM_ON_CLOCK")) setCpuPingNotice("Can't ping a CPU team — it's not linked to a coach.");
      else setError(message);
    } finally {
      setPinging(false);
    }
  }

  const commissionerActions: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }[] = [];
  commissionerActions.push({ label: "Draft Board", icon: <ListOrdered size={16} />, onClick: () => window.location.assign(`/l/${leagueId}/draft-board`) });
  if (isCommissioner) {
    if (status === "not_scheduled") commissionerActions.push({ label: "Schedule", icon: <Clock size={16} />, onClick: () => setScheduleOpen(true) });
    if (status === "scheduled") {
      commissionerActions.push({ label: "Reschedule Draft", icon: <Clock size={16} />, onClick: () => setScheduleOpen(true) });
      commissionerActions.push({ label: "Commence Draft", icon: <Trophy size={16} />, onClick: () => void runAction(() => recApi.commenceFantasyDraft(guildId), "Draft commenced.") });
    }
    if (["scheduled", "live"].includes(status)) commissionerActions.push({ label: hasPickOrder ? "Edit Pick Order" : "Set Pick Order", icon: <CheckCircle2 size={16} />, onClick: () => setPickOrderOpen(true) });
    if (["scheduled", "live", "wrap_up"].includes(status)) commissionerActions.push({ label: "Add Player", icon: <Plus size={16} />, onClick: () => setCustomPlayerOpen(true) });
    if (["scheduled", "live"].includes(status)) commissionerActions.push({ label: "Ping Users", icon: <AlertTriangle size={16} />, onClick: () => setPingModeOpen(true) });
    if (status === "live" && hasPickOrder) {
      commissionerActions.push({ label: "Ping On-The-Clock", icon: <AlertTriangle size={16} />, disabled: pinging, onClick: () => void pingOnClock() });
      commissionerActions.push({
        label: "SKIP", icon: <SkipForward size={16} />, disabled: skipping,
        onClick: () => { setSkipTargetPick(Math.min(32, session!.currentPickInRound + 1)); setSkipOpen(true); },
      });
      commissionerActions.push({ label: "Undo", icon: <Undo2 size={16} />, onClick: () => void runAction(() => recApi.undoFantasyDraftPick(guildId)) });
    }
    if (status === "wrap_up") commissionerActions.push({
      label: "Assign the Pool", icon: <CheckCircle2 size={16} />,
      onClick: () => setAssignPoolOpen(true),
    });
    if (status === "wrap_up") commissionerActions.push({
      label: "Conclude Draft", icon: <CheckCircle2 size={16} />, danger: true,
      onClick: () => void runAction(async () => {
        const result = await recApi.concludeFantasyDraft(guildId);
        setConcludeResult(result.underStrengthTeams);
      }, "Draft concluded."),
    });
  }

  const showUndraftedWarning = (status === "live" || status === "wrap_up") && hasPickOrder && pool.length > draftedCount;

  return (
    <SectionFrame className={compact ? "fantasy-draft-quick-actions" : undefined} eyebrow="Fantasy Draft" title={compact ? "Draft Management" : "Draft Board"} subtitle={statusHeadline()}>
      {notice && (
        <div className="fantasy-draft-notice">
          <p>{notice}</p>
          {status === "wrap_up" && !wrapupBannerDismissed && (
            <Button variant="ghost" size="compact" onClick={() => { setWrapupBannerDismissed(true); try { sessionStorage.setItem(`rec-fantasy-draft-wrapup-${leagueId}`, "1"); } catch { /* no-op */ } }}>Dismiss</Button>
          )}
        </div>
      )}
      {error && <p className="hub-error">{error}</p>}
      {skipOpen && session && (
        <Modal title="Skip draft picks" onClose={() => setSkipOpen(false)}>
          <p className="form-hint">Jump past Madden's fast CPU selections in one update. Bypassed slots remain available under Missed Picks.</p>
          <div className="fantasy-draft-actions">
            <Button variant="secondary" onClick={() => { setSkipOpen(false); void skipCurrentPick(); }}>Next pick</Button>
            <Button variant="secondary" onClick={() => void runAction(
              () => recApi.skipFantasyDraftToPick({ guildId, targetRound: session.currentRound + 1, targetPickInRound: 1 }),
              "Skipped to the end of the round.",
            ).then(() => setSkipOpen(false))}>End of round</Button>
            <Button variant="secondary" onClick={() => {
              if (!window.confirm("Auto-complete every remaining slot and move to wrap-up? This cannot be undone.")) return;
              void runAction(() => recApi.skipFantasyDraftToEnd(guildId), "Auto-completed the remaining picks.").then(() => setSkipOpen(false));
            }}>End of draft</Button>
          </div>
          <label className="form-field">
            <span className="form-label">Specific pick in Round {session.currentRound}</span>
            <select className="form-input" value={skipTargetPick} onChange={(event) => setSkipTargetPick(Number(event.target.value))}>
              {Array.from({ length: Math.max(0, 32 - session.currentPickInRound) }, (_, index) => session.currentPickInRound + index + 1).map((pick) => <option key={pick} value={pick}>Pick {pick}</option>)}
            </select>
          </label>
          <Button disabled={skipTargetPick <= session.currentPickInRound} onClick={() => void runAction(
            () => recApi.skipFantasyDraftToPick({ guildId, targetRound: session.currentRound, targetPickInRound: skipTargetPick }),
            `Skipped to Round ${session.currentRound}, Pick ${skipTargetPick}.`,
          ).then(() => setSkipOpen(false))}>Skip to pick</Button>
        </Modal>
      )}
      {cpuPingNotice && <p className="fantasy-draft-notice">{cpuPingNotice}</p>}

      {status === "scheduled" && session?.scheduledAt && (
        <p className="fantasy-draft-notice">Starts in <Countdown target={session.scheduledAt} /></p>
      )}

      {status !== "concluded" && (
        <>
          {status === "live" && onTheClock && !state.onTheClockCheckedIn && (
            <div className="fantasy-draft-checkin-warning">
              <AlertTriangle size={16} />
              <span><strong>{onTheClock.displayName}</strong> hasn't checked in for this draft — their pick will be skipped when it comes up.</span>
            </div>
          )}
          <CheckinBar state={state} guildId={guildId} busy={busy} onChanged={() => void load()} onError={setError} />
          <CommissionerCheckinPanel state={state} guildId={guildId} busy={busy} onChanged={() => void load()} onError={setError} />
        </>
      )}

      {status === "concluded" ? (
        <div className="fantasy-draft-concluded">
          <Trophy size={28} />
          <p><strong>{picks.length}</strong> total picks were logged for this draft.</p>
          {recentPicks.length > 0 && <PickHistory picks={recentPicks} playerNameById={playerNameById} />}
        </div>
      ) : (
        <>
          {showUndraftedWarning && (
            <p className="fantasy-draft-warning"><AlertTriangle size={16} /> {pool.length - draftedCount} player{pool.length - draftedCount === 1 ? "" : "s"} still undrafted — wrap-up picks can assign them after the main board closes.</p>
          )}

          {status === "live" && !hasPickOrder && (
            <div className="fantasy-draft-empty">
              <p>The draft is live. Set the pick order (1-32) so the board can open to the league.</p>
            </div>
          )}

          {isCommissioner && pickRequests.length > 0 && (
            <div className="fantasy-draft-pick-requests">
              <h4><AlertTriangle size={16} /> Pending pick request{pickRequests.length === 1 ? "" : "s"}</h4>
              {pickRequests.map((r) => (
                <div key={r.id} className="fantasy-draft-pick-request-row">
                  <span><strong>{r.teamName}</strong> wants to draft <em>{playerNameById.get(r.playerId) ?? "unknown player"}</em></span>
                  <div className="fantasy-draft-pick-request-actions">
                    <Button variant="primary" size="compact" disabled={resolvingRequestId === r.id} onClick={() => void resolvePickRequest(r.id, "approve")}>Confirm</Button>
                    <Button variant="secondary" size="compact" disabled={resolvingRequestId === r.id} onClick={() => void resolvePickRequest(r.id, "deny")}>Deny</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!isCommissioner && myPendingRequest && (
            <p className="fantasy-draft-notice"><Clock size={14} /> Your pick request for <strong>{playerNameById.get(myPendingRequest.playerId) ?? "this player"}</strong> is waiting on your commissioner.</p>
          )}

          {skippedPicks.length > 0 && (
            <div className="fantasy-draft-pick-requests">
              <h4><SkipForward size={16} /> Missed picks ({skippedPicks.length})</h4>
              {skippedPicks.map((slot) => (
                <div key={slot.id} className="fantasy-draft-pick-request-row">
                  <span>Round {slot.round}, Pick {slot.pickInRound} — <strong>{slot.teamName}</strong></span>
                  {isCommissioner && (
                    <div className="fantasy-draft-pick-request-actions">
                      <Button variant="primary" size="compact" onClick={() => setFillSkipTarget({ id: slot.id, teamName: slot.teamName })}>Fill In</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Browsing the pool (and building a personal draft board off it) doesn't need a
              pick order yet — the players are seeded at league setup, well before the draft
              is even scheduled. Only used to gate the whole table so nobody could look at
              or rank players until the commissioner set the order, right before/at draft
              time. Actual drafting stays impossible either way: the Draft/Assign row actions
              only render for status "live"/"wrap_up", and the backend independently rejects
              a pick against a session with no pick order. */}
          <DraftPoolTable
            guildId={guildId}
            pool={pool}
            busy={busy}
            isCommissioner={isCommissioner}
            status={status}
            onWrapupTarget={setWrapupTarget}
            onPoolAction={(action, successMessage) => void runAction(action, successMessage)}
            onOpenPlayer={setOpenPlayer}
            onDraftClick={(player) => handleDraftClick(player, isCommissioner)}
          />

          <div className="fantasy-draft-split">
            <div className="fantasy-draft-panel">
              <div className="fantasy-draft-board-actions">
                <Button variant="secondary" size="compact" disabled={busy || boardOrder.length === 0} onClick={() => setSaveBoardOpen(true)}>Save Draft Board</Button>
                <Button variant="secondary" size="compact" disabled={busy} onClick={() => setLoadBoardOpen(true)}>Load Draft Board</Button>
              </div>
              <BoardRosterSplit
                boardPlayers={boardPlayers}
                myRoster={myRoster}
                busy={busy}
                onReorder={handleBoardReorder}
              />
            </div>
            <div className="fantasy-draft-tracker">
              <TrackerPanel state={state} playerNameById={playerNameById} />
            </div>
          </div>

          {commissionerActions.length > 0 && (
            <div className="fantasy-draft-actionbar">
              {commissionerActions.map((a) => (
                <Button key={a.label} variant={a.danger ? "danger" : "secondary"} size="compact" disabled={busy || a.disabled} onClick={a.onClick}>{a.icon} {a.label}</Button>
              ))}
            </div>
          )}
        </>
      )}

      {pingModeOpen && (
        <Modal title="Ping Users" onClose={() => setPingModeOpen(false)}>
          <p className="form-hint">Quote the scheduled start time, or announce the draft is starting now?</p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              disabled={pinging || !session?.scheduledAt}
              onClick={() => void runAction(async () => { setPinging(true); try { await recApi.pingFantasyDraftUsers({ guildId, mode: "countdown" }); } finally { setPinging(false); } setPingModeOpen(false); }, "Users pinged with the countdown.")}
            >
              Quote Countdown
            </Button>
            <Button
              variant="tactical"
              disabled={pinging}
              onClick={() => void runAction(async () => { setPinging(true); try { await recApi.pingFantasyDraftUsers({ guildId, mode: "starting_now" }); } finally { setPinging(false); } setPingModeOpen(false); }, "Users pinged — starting now.")}
            >
              Starting Now
            </Button>
          </div>
        </Modal>
      )}
      {scheduleOpen && (
        <ScheduleModal
          guildId={guildId}
          initialValue={status === "scheduled" ? session?.scheduledAt ?? null : null}
          title={status === "scheduled" ? "Reschedule the Fantasy Draft" : "Schedule the Fantasy Draft"}
          onClose={() => setScheduleOpen(false)}
          onScheduled={() => void runAction(() => Promise.resolve(), status === "scheduled" ? "Draft rescheduled." : "Draft scheduled.")}
        />
      )}
      {pickOrderOpen && session && (
        <PickOrderModal
          teams={teams}
          initialMode={session.orderMode ?? "standard"}
          busy={busy}
          onClose={() => setPickOrderOpen(false)}
          onConfirm={(orderMode, teamSlots) => void runAction(async () => {
            await recApi.setFantasyDraftPickOrder({ guildId, orderMode, picks: teamSlots });
          }, `Pick order saved (${orderMode}).`)}
        />
      )}
      {customPlayerOpen && <AddCustomPlayerModal guildId={guildId} onClose={() => setCustomPlayerOpen(false)} onAdded={() => void load()} />}
      {saveBoardOpen && (
        <SaveDraftBoardModal
          guildId={guildId}
          playerIds={boardOrder}
          onClose={() => setSaveBoardOpen(false)}
          onSaved={(name) => { setSaveBoardOpen(false); setNotice(`Draft board "${name}" saved.`); }}
        />
      )}
      {loadBoardOpen && (
        <LoadDraftBoardModal
          guildId={guildId}
          onClose={() => setLoadBoardOpen(false)}
          onLoaded={(result) => {
            setLoadBoardOpen(false);
            void runAction(() => Promise.resolve(), result.resolvedCount != null && result.requestedCount != null
              ? `Board loaded — ${result.resolvedCount}/${result.requestedCount} players are available in this league.`
              : "Board loaded.");
          }}
        />
      )}
      {wrapupTarget && (
        <WrapupTeamModal
          player={wrapupTarget}
          teams={teams}
          myTeamId={caller.myTeamId}
          busy={busy}
          onClose={() => setWrapupTarget(null)}
          onConfirm={(teamId) => void runAction(async () => {
            await recApi.logFantasyDraftWrapupPick({ guildId, playerId: wrapupTarget.id, teamId });
          }, `${wrapupTarget.name} assigned.`)}
        />
      )}
      {assignPoolOpen && (
        <AssignThePoolModal
          guildId={guildId}
          teams={teams}
          pool={pool}
          onClose={() => setAssignPoolOpen(false)}
          onSaved={(count) => {
            setAssignPoolOpen(false);
            setNotice(`${count} player${count === 1 ? "" : "s"} assigned.`);
            void load();
          }}
        />
      )}
      {fillSkipTarget && (
        <FillSkippedPickModal
          teamName={fillSkipTarget.teamName}
          pool={pool}
          busy={busy}
          onClose={() => setFillSkipTarget(null)}
          onConfirm={(playerId) => void runAction(async () => {
            await recApi.fillSkippedFantasyDraftPick({ guildId, skippedSlotId: fillSkipTarget.id, playerId });
            setFillSkipTarget(null);
          }, "Missed pick filled in.")}
        />
      )}
      {concludeResult && (
        <Modal title="Draft Concluded" onClose={() => setConcludeResult(null)}>
          {concludeResult.length ? (
            <>
              <p>Some teams still have fewer than 22 players assigned. Draft the remaining players during wrap-up (or edit rosters in League Mgmt) before advancing:</p>
              <ul className="fantasy-draft-team-warning-list">
                {concludeResult.map((team) => <li key={team.teamName}><strong>{team.teamName}</strong> — {team.draftedCount}/22</li>)}
              </ul>
            </>
          ) : (
            <p>All teams met the minimum roster size. The draft is locked.</p>
          )}
          <Button variant="primary" onClick={() => setConcludeResult(null)}>Got it</Button>
        </Modal>
      )}
      {openPlayer && (
        <PlayerCardModal
          player={openPlayer}
          isOnBoard={boardOrder.includes(openPlayer.id)}
          canDraft={status === "live" && !openPlayer.isDrafted}
          draftLabel={isCommissioner ? "Draft Player" : "Request Pick"}
          busy={busy}
          onToggleBoard={() => toggleBoardMembership(openPlayer.id)}
          onDraft={() => { handleDraftClick(openPlayer, isCommissioner); setOpenPlayer(null); }}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </SectionFrame>
  );
}

/** Self-service check-in bar. Discord-linked members toggle their own team's presence;
 * mirrors the buttons on the live Discord embed. Shown pre-draft and through the live phase. */
function CheckinBar({ state, guildId, busy, onChanged, onError }: {
  state: FantasyDraftState;
  guildId: string;
  busy: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { caller, session, checkins } = state;
  const status = session?.status ?? "not_scheduled";
  const [saving, setSaving] = useState(false);
  const myTeamId = caller.myTeamId;
  if (!myTeamId) return null;
  if (status === "not_scheduled" || status === "scheduled" || status === "live") {
    const myCheckin = checkins.find((c) => c.teamId === myTeamId) ?? null;
    const checkedIn = myCheckin?.checkedIn ?? false;
    async function toggle() {
      setSaving(true);
      try {
        await recApi.setFantasyDraftSelfCheckin({ guildId, checkedIn: !checkedIn });
        onChanged();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    }
    return (
      <details className={`fantasy-draft-checkin${checkedIn ? " checked-in" : ""}`}>
        <summary className={checkedIn ? "" : "fantasy-draft-checkin-flash"}>
          {checkedIn ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <strong>{checkedIn ? "You're checked in" : "You haven't checked in yet — tap to check in"}</strong>
        </summary>
        <div className="fantasy-draft-checkin-status">
          <p>{checkedIn
            ? "You're all set for the draft — your pick won't be skipped."
            : "Check in before or during the draft, or your pick will be skipped when it comes up."}</p>
          <Button variant={checkedIn ? "secondary" : "primary"} size="compact" disabled={busy || saving} onClick={() => void toggle()}>
            {saving ? "Saving…" : checkedIn ? "Check Out" : "Check In"}
          </Button>
        </div>
      </details>
    );
  }
  return null;
}

/** Commissioner presence panel — every team by team name with its check-in status, the DC tag
 * next to each owner's Discord name, a running count of who's present, and override buttons. */
function CommissionerCheckinPanel({ state, guildId, busy, onChanged, onError }: {
  state: FantasyDraftState;
  guildId: string;
  busy: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { caller, session, checkins } = state;
  const [togglingTeamId, setTogglingTeamId] = useState<string | null>(null);
  if (!caller.isCommissioner || !session) return null;
  if (session.status === "concluded") return null;

  const linkedCheckins = checkins.filter((c) => !c.isCpu);
  const checkedCount = linkedCheckins.filter((c) => c.checkedIn).length;
  const myCheckin = caller.myTeamId ? checkins.find((c) => c.teamId === caller.myTeamId) : null;
  const iNeedToCheckIn = Boolean(myCheckin && !myCheckin.isCpu && !myCheckin.checkedIn);
  async function toggle(checkin: FantasyDraftCheckin) {
    setTogglingTeamId(checkin.teamId);
    try {
      await recApi.setFantasyDraftTeamCheckin({ guildId, teamId: checkin.teamId, checkedIn: !checkin.checkedIn });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingTeamId(null);
    }
  }

  return (
    <details className="fantasy-draft-checkin-panel">
      <summary className={`fantasy-draft-checkin-panel-head${iNeedToCheckIn ? " fantasy-draft-checkin-flash" : ""}`}>
        <h4>Check-Ins</h4>
        <span className="fantasy-draft-checkin-count">{checkedCount}/{linkedCheckins.length} linked teams checked in</span>
      </summary>
      <p className="fantasy-draft-checkin-panel-hint">Who's present for the draft. CPU teams are skipped automatically; linked teams not checked in get skipped when their pick comes up.</p>
      <ul className="fantasy-draft-checkin-list">
        {checkins.map((checkin) => {
          const discord = checkin.discordGlobalName ?? checkin.discordUsername;
          return (
            <li key={checkin.teamId} className={checkin.isCpu ? "is-cpu" : checkin.checkedIn ? "checked-in" : ""}>
              <span className="fantasy-draft-checkin-team">
                <strong>{checkin.teamName}</strong>
                <small>{checkin.isCpu ? "CPU-controlled" : discord ? `@${discord}` : "No Discord linked"}</small>
              </span>
              {checkin.isCpu ? (
                <span className="fantasy-draft-checkin-status-pill">CPU</span>
              ) : (
                <>
                  <span className="fantasy-draft-checkin-status-pill">{checkin.checkedIn ? "Checked In" : "NOT Checked In"}</span>
                  <Button variant={checkin.checkedIn ? "secondary" : "primary"} size="compact" disabled={busy || togglingTeamId === checkin.teamId} onClick={() => void toggle(checkin)}>
                    {togglingTeamId === checkin.teamId ? "Saving…" : checkin.checkedIn ? "Check Out" : "Check In"}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Tapping a player's name anywhere in the draft room opens this — photo/bio, a full
 * attributes tab, an abilities tab (placeholder when none is on file), and the action buttons:
 * Draft Player (if drafting is available to the viewer right now), Add/Remove from Board, Close. */
function PlayerCardModal({ player, isOnBoard, canDraft, draftLabel, busy, onToggleBoard, onDraft, onClose }: {
  player: FantasyDraftPoolPlayer;
  isOnBoard: boolean;
  canDraft: boolean;
  draftLabel: string;
  busy: boolean;
  onToggleBoard: () => void;
  onDraft: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"attributes" | "abilities">("attributes");
  const age = playerAge(player.birthYear);
  const attributeEntries = Object.entries(player.attributes)
    .filter(([, value]) => value != null)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  return (
    <Modal title={player.name} onClose={onClose} panelClassName="fantasy-draft-player-card">
      <div className="fantasy-draft-player-card-header">
        {player.photoUrl ? (
          <img className="fantasy-draft-player-card-photo" src={player.photoUrl} alt={player.name} />
        ) : (
          <div className="fantasy-draft-player-card-photo fantasy-draft-player-photo-empty">{player.position}</div>
        )}
        <div className="fantasy-draft-player-card-bio">
          <p className="fantasy-draft-player-card-position">{player.position} #{player.jerseyNumber ?? "—"} · {player.overallRating ?? "—"} OVR</p>
          {player.devTrait && <p className="fantasy-draft-player-card-devtrait">{player.devTrait.replaceAll("_", " ")}</p>}
          <dl className="fantasy-draft-player-card-facts">
            <div><dt>Height / Weight</dt><dd>{formatHeight(player.heightInches)}{player.weightLbs ? ` · ${player.weightLbs} lbs` : ""}</dd></div>
            <div><dt>Age</dt><dd>{age ?? "—"}</dd></div>
            <div><dt>College</dt><dd>{player.college ?? "—"}</dd></div>
            <div><dt>Experience</dt><dd>{player.yearsPro != null ? `${player.yearsPro} yr${player.yearsPro === 1 ? "" : "s"}` : "—"}</dd></div>
          </dl>
        </div>
      </div>

      <div className="fantasy-draft-tabs">
        <button type="button" className={tab === "attributes" ? "active" : ""} onClick={() => setTab("attributes")}>Attributes</button>
        <button type="button" className={tab === "abilities" ? "active" : ""} onClick={() => setTab("abilities")}>Abilities</button>
      </div>

      {tab === "attributes" ? (
        attributeEntries.length === 0 ? (
          <p className="hub-empty">No attribute data on file for this player.</p>
        ) : (
          <div className="fantasy-draft-player-card-attributes">
            {attributeEntries.map(([key, value]) => (
              <div key={key} className="fantasy-draft-player-card-attribute-row">
                <span className="fantasy-draft-player-card-attribute-name">{attributeFullName(key)}</span>
                <span className="fantasy-draft-player-card-attribute-value">{value}</span>
              </div>
            ))}
          </div>
        )
      ) : player.abilities && player.abilities.length > 0 ? (
        <div className="fantasy-draft-player-card-abilities">
          {player.abilities.map((ability, index) => (
            <div key={`${ability.name}-${index}`} className="fantasy-draft-player-card-ability">
              <strong className="fantasy-draft-player-card-ability-name">{ability.name}</strong>
              <p className="fantasy-draft-player-card-ability-description">{ability.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="hub-empty">No ability data is on file for this player.</p>
      )}

      <div className="fantasy-draft-form-actions">
        <Button variant={isOnBoard ? "secondary" : "primary"} disabled={busy} onClick={onToggleBoard}>
          {isOnBoard ? "Remove from Board" : "Add to Board"}
        </Button>
        {canDraft && (
          <Button variant="primary" disabled={busy} onClick={onDraft}>{draftLabel}</Button>
        )}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

type AttributeCondition = { id: string; key: string; min: number };

/** "QB with SPD>=90, THP>=90, SAC>=84" style filter builder — AND'd together with the position
 * filter and search box. Works against the full attribute set regardless of which columns the
 * position's default column set shows. */
function AttributeFilterBuilder({ conditions, onChange }: { conditions: AttributeCondition[]; onChange: (next: AttributeCondition[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(ATTRIBUTE_ALL_KEYS[0]!);
  const [draftMin, setDraftMin] = useState(80);

  function addCondition() {
    if (conditions.some((c) => c.key === draftKey)) return;
    onChange([...conditions, { id: crypto.randomUUID(), key: draftKey, min: draftMin }]);
  }

  return (
    <div className="fantasy-draft-attr-filter">
      <button type="button" className="fantasy-draft-attr-filter-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <SlidersHorizontal size={14} /> Attribute filters{conditions.length > 0 ? ` (${conditions.length})` : ""}
      </button>
      {conditions.length > 0 && (
        <div className="fantasy-draft-attr-filter-chips">
          {conditions.map((c) => (
            <span key={c.id} className="fantasy-draft-attr-filter-chip">
              {attributeLabel(c.key)} ≥ {c.min}
              <button type="button" aria-label={`Remove ${attributeLabel(c.key)} filter`} onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="fantasy-draft-attr-filter-panel">
          <select className="form-input" value={draftKey} onChange={(e) => setDraftKey(e.target.value)}>
            {ATTRIBUTE_ALL_KEYS.map((key) => <option key={key} value={key}>{attributeLabel(key)} — {attributeFullName(key)}</option>)}
          </select>
          <input className="form-input" type="number" min={0} max={99} value={draftMin} onChange={(e) => setDraftMin(Math.max(0, Math.min(99, Number(e.target.value) || 0)))} />
          <Button variant="secondary" size="compact" onClick={addCondition}>Add</Button>
        </div>
      )}
    </div>
  );
}

/** The big, main draft-room panel — every undrafted player, laid out like the in-game roster
 * viewer: position filter + search + attribute filters on top, a sticky sortable header row,
 * players scrolling vertically. Its own position filter (independent of Board/Roster's). */
function DraftPoolTable({ guildId, pool, busy, isCommissioner, status, onWrapupTarget, onPoolAction, onOpenPlayer, onDraftClick }: {
  guildId: string;
  pool: FantasyDraftPoolPlayer[];
  busy: boolean;
  isCommissioner: boolean;
  status: string;
  onWrapupTarget: (player: FantasyDraftPoolPlayer) => void;
  onPoolAction: (action: () => Promise<unknown>, successMessage?: string | null) => void;
  onOpenPlayer: (player: FantasyDraftPoolPlayer) => void;
  onDraftClick: (player: FantasyDraftPoolPlayer) => void;
}) {
  const [positionFilter, setPositionFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [conditions, setConditions] = useState<AttributeCondition[]>([]);
  const [sortKey, setSortKey] = useState("overallRating");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const available = useMemo(() => pool.filter((p) => !p.isDrafted), [pool]);
  const query = searchQuery.trim().toLowerCase();

  const columns = ATTRIBUTE_ALL_KEYS;

  const rows = available
    .filter((p) => positionFilter === "All" || p.position === positionFilter)
    .filter((p) => !query || p.name.toLowerCase().includes(query))
    .filter((p) => conditions.every((c) => (p.attributes[c.key] ?? -1) >= c.min))
    .sort((a, b) => {
      const av = sortKey === "overallRating" ? a.overallRating ?? -1 : a.attributes[sortKey] ?? -1;
      const bv = sortKey === "overallRating" ? b.overallRating ?? -1 : b.attributes[sortKey] ?? -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  function handleHeaderClick(key: string) {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortDir("asc"); return; }
    setSortKey("overallRating"); setSortDir("desc");
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return null;
    return sortDir === "desc" ? "▼" : "▲";
  }
  function ariaSort(key: string): "ascending" | "descending" | undefined {
    if (sortKey !== key) return undefined;
    return sortDir === "desc" ? "descending" : "ascending";
  }

  return (
    <div className="fantasy-draft-pool-panel">
      <div className="fantasy-draft-toolbar">
        <label className="form-field fantasy-draft-position-select">
          <span className="form-label">Position</span>
          <select className="form-input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
            <option value="All">All positions</option>
            {positionTabs(available).map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
        <label className="fantasy-draft-search">
          <Search size={14} />
          <input className="form-input" placeholder="Search players…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </label>
      </div>
      <AttributeFilterBuilder conditions={conditions} onChange={setConditions} />

      {rows.length === 0 ? (
        <p className="hub-empty">No undrafted players match this filter.</p>
      ) : (
        <div className="fantasy-draft-pool-table-scroll">
          <table className="fantasy-draft-pool-table">
            <thead>
              <tr>
                <th className="fantasy-draft-pool-table-name-col">Player</th>
                <th className="is-sortable" aria-sort={ariaSort("overallRating")} onClick={() => handleHeaderClick("overallRating")}>OVR {sortIndicator("overallRating")}</th>
                {columns.map((key) => (
                  <th key={key} className="is-sortable" title={attributeFullName(key)} aria-sort={ariaSort(key)} onClick={() => handleHeaderClick(key)}>
                    {attributeLabel(key)} {sortIndicator(key)}
                  </th>
                ))}
                <th className="fantasy-draft-pool-table-action-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((player) => (
                <tr key={player.id}>
                  <td className="fantasy-draft-pool-table-name-col">
                    <button type="button" className="fantasy-draft-player-name-btn" onClick={() => onOpenPlayer(player)}>
                      {player.photoUrl ? <img className="fantasy-draft-player-photo" src={player.photoUrl} alt="" loading="lazy" /> : <div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                      <span>
                        <strong>{player.name}</strong>
                        <small>{player.position}{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}{player.devTrait ? ` · ${player.devTrait.replaceAll("_", " ")}` : ""}</small>
                      </span>
                    </button>
                  </td>
                  <td>{player.overallRating ?? "—"}</td>
                  {columns.map((key) => <td key={key}>{player.attributes[key] ?? "—"}</td>)}
                  <td className="fantasy-draft-pool-table-action-col">
                    {status === "wrap_up" && !isCommissioner && (
                      <Button variant="primary" size="compact" disabled={busy} onClick={() => onPoolAction(() => recApi.logFantasyDraftWrapupPick({ guildId, playerId: player.id }), `${player.name} assigned to your team.`)}>Assign</Button>
                    )}
                    {status === "wrap_up" && isCommissioner && (
                      <Button variant="primary" size="compact" disabled={busy} onClick={() => onWrapupTarget(player)}>Assign</Button>
                    )}
                    {status === "live" && (
                      <Button variant="primary" size="compact" disabled={busy} onClick={() => onDraftClick(player)}>Draft</Button>
                    )}
                    {isCommissioner && (
                      <Button variant="ghost" size="compact" aria-label={`Remove ${player.name} from pool`} disabled={busy} onClick={() => {
                        if (!window.confirm(`Remove ${player.name} from the draft pool? This cannot be undone.`)) return;
                        onPoolAction(() => recApi.removeFantasyDraftPoolPlayer({ guildId, playerId: player.id }), `${player.name} removed from the pool.`);
                      }}><Trash2 size={15} /></Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const BOARD_ALL_SORT_OPTIONS = ["custom", "overallRating", ...ATTRIBUTE_ALL_KEYS];

/** My Board and My Roster, side by side, sharing one position filter. Board is per-position:
 * filtered to a single position it's a drag-to-reorder ranking of just that position; on "All"
 * it flattens to every position combined, sorted (desc) by whichever attribute the dropdown
 * picks instead of custom order — reordering is disabled in that view since there's no single
 * cross-position rank to drag. */
function BoardRosterSplit({ boardPlayers, myRoster, busy, onReorder }: {
  boardPlayers: FantasyDraftPoolPlayer[];
  myRoster: FantasyDraftPoolPlayer[];
  busy: boolean;
  onReorder: (next: FantasyDraftPoolPlayer[]) => void;
}) {
  const [positionFilter, setPositionFilter] = useState("All");
  const [allSortKey, setAllSortKey] = useState("custom");

  const tabs = positionTabs([...boardPlayers, ...myRoster]);

  const visibleBoard = positionFilter === "All"
    ? allSortKey === "custom"
      ? boardPlayers
      : [...boardPlayers].sort((a, b) => (allSortKey === "overallRating" ? b.overallRating ?? -1 : b.attributes[allSortKey] ?? -1) - (allSortKey === "overallRating" ? a.overallRating ?? -1 : a.attributes[allSortKey] ?? -1))
    : boardPlayers.filter((p) => p.position === positionFilter);

  const allSortLabel = allSortKey === "custom" ? "your custom rank" : allSortKey === "overallRating" ? "OVR (high to low)" : `${attributeLabel(allSortKey)} (high to low)`;

  const visibleRoster = myRoster
    .filter((p) => positionFilter === "All" || p.position === positionFilter)
    .sort(sortByPosition);

  return (
    <div className="fantasy-draft-board-roster-split">
      <div className="fantasy-draft-toolbar fantasy-draft-board-roster-toolbar">
        <label className="form-field fantasy-draft-position-select">
          <span className="form-label">Position</span>
          <select className="form-input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
            <option value="All">All positions</option>
            {tabs.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
        {positionFilter === "All" && (
          <label className="fantasy-draft-board-sort">
            Sort by
            <select className="form-input" value={allSortKey} onChange={(e) => setAllSortKey(e.target.value)}>
              {BOARD_ALL_SORT_OPTIONS.map((key) => <option key={key} value={key}>{key === "custom" ? "My custom rank" : key === "overallRating" ? "OVR" : attributeLabel(key)}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="fantasy-draft-board-roster-columns">
        <div className="fantasy-draft-panel-inner fantasy-draft-board-column">
          <h4 className="fantasy-draft-column-title">My Board</h4>
          <p className="fantasy-draft-panel-hint">
            {positionFilter === "All"
              ? `All positions, sorted by ${allSortLabel}. Drag to set your main ranking; moving players at the same position also updates that position's ranking.`
              : "Drag players to rank them (top = most wanted). Drafted players drop off automatically."}
          </p>
          {visibleBoard.length === 0 ? (
            <p className="hub-empty">{boardPlayers.length === 0 ? "Your board is empty — add players from the draft pool." : "No players in this position group yet."}</p>
          ) : (
            <SortableRankedList
              items={visibleBoard}
              onReorder={(next) => {
                if (positionFilter === "All") setAllSortKey("custom");
                onReorder(next);
              }}
              renderContent={(player) => (
                <div className="fantasy-draft-player-identity">
                  {player.photoUrl ? <img className="fantasy-draft-player-photo" src={player.photoUrl} alt={player.name} loading="lazy" /> : <div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                  <div>
                    <strong>{player.name}</strong>
                    <small>{player.position} · {player.overallRating ?? "—"} OVR{player.jerseyNumber != null ? ` · #${player.jerseyNumber}` : ""}</small>
                  </div>
                </div>
              )}
            />
          )}
        </div>

        <div className="fantasy-draft-panel-inner fantasy-draft-roster-column">
          <h4 className="fantasy-draft-column-title">My Roster</h4>
          {visibleRoster.length === 0 ? (
            <p className="hub-empty">No players drafted to your team yet.</p>
          ) : (
            <div className="fantasy-draft-roster">
              {visibleRoster.map((player) => (
                <div key={player.id} className="fantasy-draft-roster-row">
                  <div className="fantasy-draft-player-identity">
                    {player.photoUrl ? <img className="fantasy-draft-player-photo" src={player.photoUrl} alt={player.name} loading="lazy" /> : <div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                    <div>
                      <strong>{player.name}</strong>
                      <small>{player.position} · {player.overallRating ?? "—"} OVR{player.jerseyNumber != null ? ` · #${player.jerseyNumber}` : ""}</small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrackerPanel({ state, playerNameById }: { state: FantasyDraftState; playerNameById: Map<string, string> }) {
  const { session, teams, picks } = state;
  const onTheClock = session ? teams.find((t) => t.id === state.onTheClockTeamId) ?? null : null;
  const upcoming = nextPicksUp(state);

  const chronologicalPicks = [...picks].sort((a, b) => a.overallPickNumber - b.overallPickNumber);

  return (
    <div className="fantasy-draft-tracker-inner">
      {session && session.status === "live" && (
        <div className="fantasy-draft-clock">
          <p className="fantasy-draft-clock-label">On the clock</p>
          <p className="fantasy-draft-clock-team">{onTheClock?.displayName ?? "unknown team"}</p>
          <p className="fantasy-draft-clock-pick">Round {session.currentRound}, Pick {session.currentPickInRound}</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="fantasy-draft-nextup">
          <h4>Next up</h4>
          <ul>
            {upcoming.map((next) => (
              <li key={`${next.round}-${next.pickInRound}`}><span className="fantasy-draft-pick-round">R{next.round} P{next.pickInRound}</span><strong>{next.teamName}</strong></li>
            ))}
          </ul>
        </div>
      )}

      <div className="fantasy-draft-picks">
        <h4>Picks made</h4>
        {chronologicalPicks.length === 0 ? (
          <p className="hub-empty">No picks logged yet.</p>
        ) : (
          <ul>
            {chronologicalPicks.map((pick) => (
              <li key={pick.id}><span className="fantasy-draft-pick-round">R{pick.round} P{pick.pickInRound}</span><strong>{pick.teamName}</strong> — <em>{playerNameById.get(pick.playerId) ?? "unknown player"}</em>{pick.isWrapupPick ? " · wrap-up" : ""}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SortableRankedList<T extends { id: string }>({ items, onReorder, renderContent }: {
  items: T[];
  onReorder: (next: T[]) => void;
  renderContent: (item: T, index: number, isDragging: boolean) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startIndex: number; startY: number; armed: boolean; holdTimer: ReturnType<typeof setTimeout> | null } | null>(null);

  function cleanupDrag() {
    const dragState = dragStateRef.current;
    if (dragState?.holdTimer) clearTimeout(dragState.holdTimer);
    dragStateRef.current = null;
    setDraggingId(null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const isMouse = event.pointerType === "mouse";
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const dragState = { pointerId: event.pointerId, startIndex: index, startY: event.clientY, armed: !isMouse, holdTimer: null as ReturnType<typeof setTimeout> | null };
    dragStateRef.current = dragState;
    if (isMouse) {
      dragState.holdTimer = setTimeout(() => {
        if (dragStateRef.current === dragState) dragState.armed = true;
      }, 200);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>, index: number) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (!dragState.armed) {
      if (Math.abs(event.clientY - dragState.startY) > 10) {
        if (dragState.holdTimer) clearTimeout(dragState.holdTimer);
        dragStateRef.current = null;
      }
      return;
    }
    const currentIndex = dragState.startIndex;
    const draggingItem = items[currentIndex];
    if (!draggingItem) return;
    if (draggingId === null) {
      if (Math.abs(event.clientY - dragState.startY) < 6) return;
      setDraggingId(draggingItem.id);
    }
    const container = containerRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-sortable-row]"));
    if (!rows.length) return;
    let targetIndex = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i]!.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) { targetIndex = i; break; }
    }
    if (targetIndex === currentIndex) return;
    const next = [...items];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved!);
    dragStateRef.current = { ...dragState, startIndex: targetIndex };
    onReorder(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (dragState && event.pointerId === dragState.pointerId) cleanupDrag();
  }

  return (
    <div className="fantasy-draft-board-list" ref={containerRef}>
      {items.map((item, index) => (
        <div key={item.id} className={`fantasy-draft-board-row${draggingId === item.id ? " dragging" : ""}`} data-sortable-row>
          <span className="fantasy-draft-board-rank">{index + 1}</span>
          <span
            className={`fantasy-draft-board-handle${draggingId === item.id ? " dragging" : ""}`}
            role="button"
            aria-label={`Reorder ${"name" in item ? String((item as any).name) : item.id}`}
            title="Hold to drag"
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerMove={(e) => handlePointerMove(e, index)}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <GripVertical size={16} />
          </span>
          {renderContent(item, index, draggingId === item.id)}
        </div>
      ))}
    </div>
  );
}

function PickHistory({ picks, playerNameById }: { picks: FantasyDraftState["picks"]; playerNameById: Map<string, string> }) {
  if (!picks.length) return null;
  return (
    <div className="fantasy-draft-picks">
      <h4>Recent Picks</h4>
      <ul>
        {picks.map((pick) => (
          <li key={pick.id}><span className="fantasy-draft-pick-round">#{pick.overallPickNumber}</span><strong>{pick.teamName}</strong> took <em>{playerNameById.get(pick.playerId) ?? "unknown player"}</em>{pick.isWrapupPick ? " · wrap-up" : ""}</li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleModal({
  guildId,
  onClose,
  onScheduled,
  initialValue = null,
  title = "Schedule the Fantasy Draft",
}: {
  guildId: string;
  onClose: () => void;
  onScheduled: () => void;
  initialValue?: string | null;
  title?: string;
}) {
  const [value, setValue] = useState(() => {
    if (!initialValue) return "";
    const date = new Date(initialValue);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!value) { setError("Pick a date and time, or close to draft unscheduled."); return; }
    setBusy(true); setError(null);
    try {
      await recApi.scheduleFantasyDraft({ guildId, scheduledAt: new Date(value).toISOString() });
      onScheduled(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p className="form-hint">Pick a date/time for the league draft. The board stays closed until you commence it — scheduling is just for the calendar.</p>
      <label className="fantasy-draft-form-row">Draft time<input className="form-input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      {error && <p className="hub-error">{error}</p>}
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : initialValue ? "Reschedule" : "Schedule"}</Button>
      </div>
    </Modal>
  );
}

function PickOrderModal({ teams, initialMode, busy, onClose, onConfirm }: {
  teams: FantasyDraftState["teams"];
  initialMode: FantasyDraftOrderMode;
  busy: boolean;
  onClose: () => void;
  onConfirm: (orderMode: FantasyDraftOrderMode, picks: Array<{ pickInRound: number; teamId: string }>) => void;
}) {
  const [mode, setMode] = useState<FantasyDraftOrderMode>(initialMode);
  const [slots, setSlots] = useState<string[]>(() => Array.from({ length: 32 }, () => ""));
  const [error, setError] = useState<string | null>(null);
  const teamOptions = useMemo(() => [...teams].sort((a, b) => a.displayName.localeCompare(b.displayName)), [teams]);

  function setSlot(index: number, teamId: string) {
    setSlots((current) => {
      const next = current.map((existing) => (existing === teamId && teamId ? "" : existing));
      next[index] = teamId;
      return next;
    });
  }

  function confirm() {
    if (slots.some((slot) => !slot)) { setError("Assign a team to every slot (1-32) before saving."); return; }
    const unique = new Set(slots).size;
    if (unique !== 32) { setError("Each team can occupy only one pick slot."); return; }
    onConfirm(mode, slots.map((teamId, index) => ({ pickInRound: index + 1, teamId })));
    onClose();
  }

  return (
    <Modal title="Set Pick Order" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      <p className="form-hint">Assign a team to each pick slot. In <strong>snake</strong> order the round-1 order reverses every other round.</p>
      <div className="fantasy-draft-form-row">
        <label>Order mode<select className="form-input" value={mode} onChange={(e) => setMode(e.target.value as FantasyDraftOrderMode)}>
          <option value="standard">Standard</option><option value="snake">Snake</option>
        </select></label>
      </div>
      <div className="fantasy-draft-pickorder-grid">
        {slots.map((teamId, index) => {
          // No team picks twice in a fantasy draft — once a team is assigned to a slot, hide
          // it from every other slot's dropdown (but keep it in its own, so re-opening the
          // select still shows the current pick).
          const takenElsewhere = new Set(slots.filter((_, i) => i !== index && slots[i]));
          const availableOptions = teamOptions.filter((team) => team.id === teamId || !takenElsewhere.has(team.id));
          return (
            <label key={index} className="fantasy-draft-pickorder-slot">
              <span>{index + 1}</span>
              <select className="form-input" value={teamId} onChange={(e) => setSlot(index, e.target.value)}>
                <option value="">Select team</option>
                {availableOptions.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      {error && <p className="hub-error">{error}</p>}
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={confirm}>{busy ? "Saving…" : "Save Pick Order"}</Button>
      </div>
    </Modal>
  );
}

function WrapupTeamModal({ player, teams, myTeamId, busy, onClose, onConfirm }: {
  player: FantasyDraftPoolPlayer;
  teams: FantasyDraftState["teams"];
  myTeamId: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (teamId: string) => void;
}) {
  const [teamId, setTeamId] = useState(myTeamId ?? "");
  const sorted = useMemo(() => [...teams].sort((a, b) => a.displayName.localeCompare(b.displayName)), [teams]);
  return (
    <Modal title={`Assign ${player.name}`} onClose={onClose}>
      <p className="form-hint">Choose the team this player should join during wrap-up.</p>
      <div className="fantasy-draft-form-row">
        <label>Team<select className="form-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Select team</option>
          {sorted.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
        </select></label>
      </div>
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !teamId} onClick={() => onConfirm(teamId)}>{busy ? "Assigning…" : "Assign"}</Button>
      </div>
    </Modal>
  );
}

function FillSkippedPickModal({ teamName, pool, busy, onClose, onConfirm }: {
  teamName: string;
  pool: FantasyDraftPoolPlayer[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (playerId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const available = useMemo(() => pool.filter((p) => !p.isDrafted), [pool]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 50);
    return available.filter((p) => p.name.toLowerCase().includes(q) || p.position.toLowerCase().includes(q)).slice(0, 50);
  }, [available, query]);

  return (
    <Modal title={`Fill missed pick — ${teamName}`} onClose={onClose}>
      <p className="form-hint">Search for the player {teamName} actually took, then confirm.</p>
      <input className="form-input" placeholder="Search player or position…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="fantasy-draft-pick-requests" style={{ maxHeight: 320, overflowY: "auto" }}>
        {filtered.map((player) => (
          <div key={player.id} className="fantasy-draft-pick-request-row">
            <span>{player.name} — {player.position} · {player.overallRating} OVR</span>
            <div className="fantasy-draft-pick-request-actions">
              <Button variant="primary" size="compact" disabled={busy} onClick={() => onConfirm(player.id)}>Select</Button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="form-hint">No matching undrafted players.</p>}
      </div>
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

/** Wrap-up "Assign the Pool" — a focused commissioner view for walking every remaining
 * undrafted player onto a team (or leaving them as free agents) once the main board closes.
 * Differs from the inline wrap-up Assign button by giving a searchable, whole-pool list with
 * an explicit per-player team dropdown, mirroring the plan's post-draft assign-the-pool flow. */
function AssignThePoolModal({ guildId, teams, pool, onClose, onSaved }: {
  guildId: string;
  teams: FantasyDraftState["teams"];
  pool: FantasyDraftPoolPlayer[];
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = useMemo(() => pool.filter((p) => !p.isDrafted), [pool]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((p) => p.name.toLowerCase().includes(q) || p.position.toLowerCase().includes(q));
  }, [available, query]);
  const sorted = useMemo(() => [...teams].sort((a, b) => a.displayName.localeCompare(b.displayName)), [teams]);
  const queued = Object.entries(assignments).filter(([, teamId]) => teamId);

  async function saveAll() {
    if (queued.length === 0) { onClose(); return; }
    setSaving(true); setError(null);
    try {
      for (const [playerId, teamId] of queued) {
        await recApi.logFantasyDraftWrapupPick({ guildId, playerId, teamId });
      }
      onSaved(queued.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Assign the Pool" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      <p className="form-hint" style={{ marginTop: 0 }}>
        Pick a team for every remaining undrafted player you want to assign, then save once — anyone left as Free Agent stays in the pool.
      </p>
      <input className="form-input" placeholder="Search players…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="fantasy-draft-pick-requests" style={{ maxHeight: 420, overflowY: "auto", marginTop: "var(--space-3)" }}>
        {filtered.map((player) => (
          <div key={player.id} className="fantasy-draft-pick-request-row">
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {player.name} — {player.position} · {player.overallRating} OVR
            </span>
            <div className="fantasy-draft-pick-request-actions" style={{ minWidth: 260 }}>
              <select className="form-input" disabled={saving} value={assignments[player.id] ?? ""} onChange={(e) => setAssignments((current) => ({ ...current, [player.id]: e.target.value }))}>
                <option value="">Free Agent</option>
                {sorted.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
              </select>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="form-hint">No undrafted players match this search.</p>}
      </div>
      {error && <ErrorState message={error} />}
      <div className="fantasy-draft-form-actions">
        <span className="form-hint" style={{ margin: 0 }}>{queued.length} queued for assignment</span>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void saveAll()}>{saving ? "Saving…" : "Save Assignments"}</Button>
      </div>
    </Modal>
  );
}

function SaveDraftBoardModal({ guildId, playerIds, onClose, onSaved }: { guildId: string; playerIds: string[]; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give this board a name."); return; }
    setBusy(true); setError(null);
    try {
      await recApi.saveNamedFantasyDraftBoard({ guildId, name: trimmed, playerIds });
      onSaved(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Save Draft Board" onClose={onClose}>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Saves your current board ({playerIds.length} player{playerIds.length === 1 ? "" : "s"}) under a name you can
        reload for a future fantasy draft of this game. Saving under an existing name overwrites it.
      </p>
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">Board name</span>
        <input className="form-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Speed WRs" autoFocus />
      </label>
      <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
    </Modal>
  );
}

function LoadDraftBoardModal({ guildId, onClose, onLoaded }: { guildId: string; onClose: () => void; onLoaded: (result: { requestedCount?: number; resolvedCount?: number }) => void }) {
  const [boards, setBoards] = useState<Array<{ id: string; name: string; updatedAt: string; playerCount: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    recApi.listSavedFantasyDraftBoards(guildId).then((res) => setBoards(res.boards)).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }
  useEffect(load, [guildId]);

  async function loadBoard(boardId: string) {
    setBusyId(boardId); setError(null);
    try {
      const result = await recApi.loadNamedFantasyDraftBoard({ guildId, boardId });
      onLoaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusyId(null);
    }
  }

  async function removeBoard(boardId: string) {
    if (!window.confirm("Delete this saved draft board? This can't be undone.")) return;
    setBusyId(boardId); setError(null);
    try {
      await recApi.deleteSavedFantasyDraftBoard({ guildId, boardId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Load Draft Board" onClose={onClose}>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Loading a board replaces your current one. Any players not available in this league (already drafted, or not
        found) are dropped automatically and the rest re-rank to fill the gaps.
      </p>
      {error && <ErrorState message={error} />}
      {!boards && !error && <LoadingState />}
      {boards && boards.length === 0 && <p className="hub-empty">No saved draft boards yet for this game.</p>}
      {boards && boards.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {boards.map((board) => (
            <div key={board.id} className="fantasy-draft-saved-board-row">
              <span>
                <strong>{board.name}</strong>
                <small> · {board.playerCount} player{board.playerCount === 1 ? "" : "s"} · saved {new Date(board.updatedAt).toLocaleDateString()}</small>
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="primary" size="compact" disabled={busyId === board.id} onClick={() => void loadBoard(board.id)}>
                  {busyId === board.id ? "Loading…" : "Load"}
                </Button>
                <Button variant="ghost" size="compact" disabled={busyId === board.id} onClick={() => void removeBoard(board.id)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function AddCustomPlayerModal({ guildId, onClose, onAdded }: { guildId: string; onClose: () => void; onAdded: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState<RecOvrPosition>("QB");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [archetype, setArchetype] = useState("");
  const [devTrait, setDevTrait] = useState("normal");
  const [attributes, setAttributes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const archetypes = useMemo(() => { try { return listRecArchetypes("MADDEN", position); } catch { return []; } }, [position]);
  const editableCodes = useMemo(
    () => sortRecAttributeCodes(getRecEditableAttributes("MADDEN", position, archetype)),
    [position, archetype],
  );

  function changePosition(value: string) {
    setPosition(value as RecOvrPosition);
    setArchetype("");
    setAttributes({});
  }

  const overall = useMemo(() => {
    try { return estimateRecPlayerOverall(position, attributes).displayOverall; } catch { return 0; }
  }, [position, attributes]);

  useEffect(() => {
    if (!archetype && archetypes.length) setArchetype(archetypes[0]!.key);
  }, [archetype, archetypes]);

  function mutate(code: string, delta: number) {
    setAttributes((current) => ({ ...current, [code]: Math.max(0, Math.min(99, (current[code] ?? 0) + delta)) }));
  }

  function setAttribute(code: string, value: number) {
    setAttributes((current) => ({ ...current, [code]: Math.max(0, Math.min(99, Number.isFinite(value) ? Math.round(value) : 0)) }));
  }

  async function submit() {
    if (!firstName.trim() || !lastName.trim()) { setError("Enter a first and last name."); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await recApi.addFantasyDraftCustomPlayer({
        guildId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        position,
        jerseyNumber: jerseyNumber === "" ? null : Number(jerseyNumber),
        archetype: archetype || null,
        devTrait,
        overallRating: overall,
        attributes,
      });
      setNotice("Player added to the pool. Add another or close.");
      setFirstName(""); setLastName(""); setJerseyNumber(""); setAttributes({});
      onAdded();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <Modal title="Add Player" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      <div className="fantasy-draft-form-grid">
        <label>First name<input className="form-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label>Last name<input className="form-input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label>Position<select className="form-input" value={position} onChange={(e) => changePosition(e.target.value)}>
          {DRAFT_POSITIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Jersey #<input className="form-input" type="number" min="0" max="99" value={jerseyNumber} onChange={(e) => setJerseyNumber(e.target.value)} /></label>
        <label>Archetype<select className="form-input" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
          <option value="">None</option>
          {archetypes.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </select></label>
        <label>Development trait<select className="form-input" value={devTrait} onChange={(e) => setDevTrait(e.target.value)}>
          {REC_DEV_TRAITS.MADDEN.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </select></label>
      </div>
      <div className="fantasy-draft-attribute-list">
        {editableCodes.length ? editableCodes.map((code) => (
          <div key={code} className="fantasy-draft-attribute-row">
            <span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span>
            <button type="button" onClick={() => mutate(code, -1)}>−</button>
            <input className="custom-player-attribute-input" type="number" min={0} max={99}
              value={attributes[code] ?? 0}
              onChange={(e) => setAttribute(code, Number(e.target.value))} />
            <button type="button" onClick={() => mutate(code, 1)}>+</button>
          </div>
        )) : <p className="hub-empty">No attribute model for this position.</p>}
      </div>
      {error && <p className="hub-error">{error}</p>}
      {notice && <p className="hub-notice">{notice}</p>}
      <div className="fantasy-draft-form-actions">
        <span className="fantasy-draft-ovr">Estimated OVR: <b>{overall}</b></span>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Adding…" : "Add to Pool"}</Button>
      </div>
    </Modal>
  );
}
