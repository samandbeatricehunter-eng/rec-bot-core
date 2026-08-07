import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  REC_CUSTOM_PLAYER_POSITIONS,
  REC_DEV_TRAITS,
  REC_POSITION_OVR_MODELS,
  estimateRecPlayerOverall,
  getRecAttributeDisplayName,
  listRecArchetypes,
  type RecOvrPosition,
} from "@rec/shared";
import { AlertTriangle, CheckCircle2, Clock, Plus, Search, SkipForward, Trash2, Trophy, Undo2 } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import { chatRealtimeClient } from "../../lib/chat-realtime-client.js";
import type { FantasyDraftOrderMode, FantasyDraftPoolPlayer, FantasyDraftState } from "../../types/api.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Modal } from "../../components/ui/Modal.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";

const POSITION_GROUP_ORDER = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "K", "P"];
const DRAFT_POSITIONS = [...REC_CUSTOM_PLAYER_POSITIONS, "K", "P"] as const;

function formatScheduledAt(value: string | null): string {
  if (!value) return "not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function sortByPosition(a: FantasyDraftPoolPlayer, b: FantasyDraftPoolPlayer): number {
  const ka = POSITION_GROUP_ORDER.indexOf(a.position);
  const kb = POSITION_GROUP_ORDER.indexOf(b.position);
  return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb);
}

export function FantasyDraftCard({ guildId, leagueId }: { guildId: string; leagueId: string }) {
  const [state, setState] = useState<FantasyDraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [positionFilter, setPositionFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pickOrderOpen, setPickOrderOpen] = useState(false);
  const [customPlayerOpen, setCustomPlayerOpen] = useState(false);
  const [wrapupTarget, setWrapupTarget] = useState<FantasyDraftPoolPlayer | null>(null);
  const [concludeResult, setConcludeResult] = useState<{ teamName: string; draftedCount: number }[] | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const [wrapupBannerDismissed, setWrapupBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem(`rec-fantasy-draft-wrapup-${leagueId}`) === "1"; } catch { return false; }
  });

  const load = useCallback(async () => {
    try {
      const next = await recApi.getFantasyDraftState(guildId);
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    let active = true;
    const unsubscribe = chatRealtimeClient.onChannelEvent(guildId, "fantasy_draft", leagueId, (event) => {
      if (event.kind === "refresh") void load();
    });
    void load();
    return () => { active = false; unsubscribe(); };
  }, [guildId, leagueId, load]);

  useEffect(() => {
    if (!state?.session) return;
    const status = state.session.status;
    if (status === "wrap_up" && prevStatusRef.current && prevStatusRef.current !== "wrap_up" && !wrapupBannerDismissed) {
      setNotice("The draft is complete — go review your in-game roster, then come back to finalize any undrafted players.");
    }
    prevStatusRef.current = status;
  }, [state, wrapupBannerDismissed]);

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

  if (loading && !state) return <SectionFrame eyebrow="Fantasy Draft" title="Draft Tracker"><LoadingState label="Loading the draft board…" /></SectionFrame>;
  if (error && !state) return <SectionFrame eyebrow="Fantasy Draft" title="Draft Tracker"><ErrorState message={error} /><div style={{ marginTop: "var(--space-3)" }}><Button variant="secondary" onClick={() => { setLoading(true); void load(); }}>Try again</Button></div></SectionFrame>;
  if (!state) return null;

  const { session, teams, pickOrder, pool, picks, caller } = state;
  const isCommissioner = caller.isCommissioner;
  const status = session?.status ?? "not_scheduled";
  const hasPickOrder = pickOrder.length === 32;
  const onTheClock = session && hasPickOrder ? teams.find((t) => t.id === state.onTheClockTeamId) ?? null : null;
  const draftedCount = picks.length;
  const playerNameById = new Map(pool.map((p) => [p.id, p.name]));

  const positions = [...new Set(pool.filter((p) => !p.isDrafted).map((p) => p.position))].sort((a, b) => {
    const ka = POSITION_GROUP_ORDER.indexOf(a);
    const kb = POSITION_GROUP_ORDER.indexOf(b);
    return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb);
  });
  const query = searchQuery.trim().toLowerCase();
  const visibleRows = pool
    .filter((p) => !p.isDrafted)
    .filter((p) => positionFilter === "All" || p.position === positionFilter)
    .filter((p) => !query || p.name.toLowerCase().includes(query))
    .sort((a, b) => (b.overallRating ?? -1) - (a.overallRating ?? -1));

  const recentPicks = [...picks].sort((a, b) => b.overallPickNumber - a.overallPickNumber).slice(0, 8);

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

  const commissionerActions: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }[] = [];
  if (isCommissioner) {
    if (status === "not_scheduled") commissionerActions.push({ label: "Schedule", icon: <Clock size={16} />, onClick: () => setScheduleOpen(true) });
    if (status === "scheduled") commissionerActions.push({ label: "Commence Draft", icon: <Trophy size={16} />, onClick: () => void runAction(() => recApi.commenceFantasyDraft(guildId), "Draft commenced.") });
    if (["scheduled", "live"].includes(status)) commissionerActions.push({ label: hasPickOrder ? "Edit Pick Order" : "Set Pick Order", icon: <CheckCircle2 size={16} />, onClick: () => setPickOrderOpen(true) });
    if (["scheduled", "live", "wrap_up"].includes(status)) commissionerActions.push({ label: "Add Custom Player", icon: <Plus size={16} />, onClick: () => setCustomPlayerOpen(true) });
    if (status === "live" && hasPickOrder) {
      commissionerActions.push({ label: "Undo", icon: <Undo2 size={16} />, onClick: () => void runAction(() => recApi.undoFantasyDraftPick(guildId)) });
      commissionerActions.push({ label: "Skip to End", icon: <SkipForward size={16} />, onClick: () => void runAction(() => recApi.skipFantasyDraftToEnd(guildId), "Auto-completed the remaining picks.") });
    }
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
    <SectionFrame eyebrow="Fantasy Draft" title="Draft Tracker" subtitle={statusHeadline()} action={commissionerActions.length ? (
      <div className="fantasy-draft-actions">
        {commissionerActions.map((a) => (
          <Button key={a.label} variant={a.danger ? "danger" : "secondary"} size="compact" disabled={busy || a.disabled} onClick={a.onClick}>{a.icon} {a.label}</Button>
        ))}
      </div>
    ) : undefined}>
      {notice && (
        <div className="fantasy-draft-notice">
          <p>{notice}</p>
          {status === "wrap_up" && !wrapupBannerDismissed && (
            <Button variant="ghost" size="compact" onClick={() => { setWrapupBannerDismissed(true); try { sessionStorage.setItem(`rec-fantasy-draft-wrapup-${leagueId}`, "1"); } catch { /* no-op */ } }}>Dismiss</Button>
          )}
        </div>
      )}
      {error && <p className="hub-error">{error}</p>}

      {status === "concluded" ? (
        <div className="fantasy-draft-concluded">
          <Trophy size={28} />
          <p><strong>{picks.length}</strong> total picks were logged for this draft.</p>
          {recentPicks.length > 0 && <PickHistory picks={recentPicks} playerNameById={playerNameById} />}
        </div>
      ) : status === "not_scheduled" || status === "scheduled" ? (
        <div className="fantasy-draft-empty">
          <p>{status === "scheduled" ? "The draft is on the calendar — the board opens when the commissioner commences it." : "No fantasy draft scheduled yet."}</p>
        </div>
      ) : (
        <div className="fantasy-draft-body">
          {showUndraftedWarning && (
            <p className="fantasy-draft-warning"><AlertTriangle size={16} /> {pool.length - draftedCount} player{pool.length - draftedCount === 1 ? "" : "s"} still undrafted — wrap-up picks can assign them after the main board closes.</p>
          )}

          {status === "live" && !hasPickOrder && (
            <div className="fantasy-draft-empty">
              <p>The draft is live. Set the pick order (1-32) so the board can open to the league.</p>
            </div>
          )}

          {(status === "live" || status === "wrap_up") && hasPickOrder && (
            <div className="fantasy-draft-board">
              <div className="fantasy-draft-toolbar">
                <div className="fantasy-draft-filter-tabs">
                  {["All", ...positions].map((position) => (
                    <button key={position} type="button" className={positionFilter === position ? "active" : ""} onClick={() => setPositionFilter(position)}>{position}</button>
                  ))}
                </div>
                <label className="fantasy-draft-search">
                  <Search size={14} />
                  <input className="form-input" placeholder="Search players…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </label>
              </div>

              {visibleRows.length === 0 ? (
                <p className="hub-empty">No players in the pool for this filter.</p>
              ) : (
                <div className="fantasy-draft-pool">
                  {visibleRows.map((player) => {
                    const canDraft = status === "live" ? isCommissioner : true;
                    return (
                      <div key={player.id} className="fantasy-draft-player-row">
                        <div className="fantasy-draft-player-identity">
                          {player.photoUrl ? <img className="fantasy-draft-player-photo" src={player.photoUrl} alt={player.name} loading="lazy" /> : <div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                          <div>
                            <strong>{player.name}</strong>
                            <small>{player.position} · {player.overallRating ?? "—"} OVR{player.jerseyNumber != null ? ` · #${player.jerseyNumber}` : ""}{player.archetype ? ` · ${player.archetype.replaceAll("_", " ")}` : ""}</small>
                          </div>
                        </div>
                        <div className="fantasy-draft-player-actions">
                          {status === "wrap_up" && !isCommissioner && (
                            <Button variant="primary" size="compact" disabled={busy} onClick={() => void runAction(() => recApi.logFantasyDraftWrapupPick({ guildId, playerId: player.id }), `${player.name} assigned to your team.`)}>Assign to My Team</Button>
                          )}
                          {status === "wrap_up" && isCommissioner && (
                            <Button variant="primary" size="compact" disabled={busy} onClick={() => setWrapupTarget(player)}>Assign</Button>
                          )}
                          {status === "live" && isCommissioner && (
                            <Button variant="primary" size="compact" disabled={busy} onClick={() => void runAction(() => recApi.logFantasyDraftPick({ guildId, playerId: player.id }), `${player.name} drafted.`)}>Drafted</Button>
                          )}
                          {isCommissioner && (
                            <Button variant="ghost" size="compact" aria-label={`Remove ${player.name} from pool`} disabled={busy} onClick={() => void runAction(() => recApi.removeFantasyDraftPoolPlayer({ guildId, playerId: player.id }), `${player.name} removed from the pool.`)}><Trash2 size={15} /></Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(status === "live" || status === "wrap_up") && (
            <PickHistory picks={recentPicks} playerNameById={playerNameById} />
          )}
        </div>
      )}

      {scheduleOpen && <ScheduleModal guildId={guildId} onClose={() => setScheduleOpen(false)} onScheduled={() => void runAction(() => Promise.resolve(), "Draft scheduled.")} />}
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
    </SectionFrame>
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

function ScheduleModal({ guildId, onClose, onScheduled }: { guildId: string; onClose: () => void; onScheduled: () => void }) {
  const [value, setValue] = useState("");
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
    <Modal title="Schedule the Fantasy Draft" onClose={onClose}>
      <p className="form-hint">Pick a date/time for the league draft. The board stays closed until you commence it — scheduling is just for the calendar.</p>
      <label className="fantasy-draft-form-row">Draft time<input className="form-input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      {error && <p className="hub-error">{error}</p>}
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Schedule"}</Button>
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
        {slots.map((teamId, index) => (
          <label key={index} className="fantasy-draft-pickorder-slot">
            <span>{index + 1}</span>
            <select className="form-input" value={teamId} onChange={(e) => setSlot(index, e.target.value)}>
              <option value="">Select team</option>
              {teamOptions.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
            </select>
          </label>
        ))}
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
  const coefficientCodes = useMemo(() => Object.keys(REC_POSITION_OVR_MODELS[position]?.coefficients ?? {}), [position]);

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
    <Modal title="Add Custom Player" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
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
        {coefficientCodes.length ? coefficientCodes.map((code) => (
          <div key={code} className="fantasy-draft-attribute-row">
            <span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span>
            <button type="button" onClick={() => mutate(code, -1)}>−</button>
            <b>{attributes[code] ?? 0}</b>
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
