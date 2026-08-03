import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { AssignableBoxScoreStats, RosterPlayer, TurnoverKind } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const CATEGORY_LABEL: Record<"passing" | "rushing", string> = { passing: "Passing", rushing: "Rushing" };
const TURNOVER_LABEL: Record<TurnoverKind, string> = {
  interceptions_thrown: "Interception Thrown",
  fumbles_lost: "Fumble Lost",
  interceptions_made: "Interception Made",
  forced_fumble: "Forced Fumble",
};
// Thrown/lost are the offense's own turnovers; made/forced are defensive credit (for a player
// on THIS team, earned against the opponent) — pulled from the opponent's committed numbers.
const TURNOVER_ORDER: TurnoverKind[] = ["interceptions_thrown", "fumbles_lost", "interceptions_made", "forced_fumble"];

type SlotKey = string; // `${category-or-kind}:${index}`

export function AssignBoxScoreStatsModal({
  guildId,
  submissionId,
  onClose,
}: {
  guildId: string;
  submissionId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AssignableBoxScoreStats | null>(null);
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<SlotKey, string>>({});
  const [busySlot, setBusySlot] = useState<SlotKey | null>(null);
  const [assigned, setAssigned] = useState<Record<SlotKey, boolean>>({});
  const [allocations, setAllocations] = useState<Record<string, Array<{ rosterPlayerId: string; stats: Record<string, number> }>>>({});

  useEffect(() => {
    recApi.getAssignableBoxScoreStats({ guildId, submissionId }).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats to assign."));
    recApi.getTeamRoster({ guildId }).then((res) => setPlayers(res.players.filter((p) => p.rosterStatus === "active" || p.rosterStatus === "transferred_in"))).catch(() => setPlayers([]));
  }, [guildId, submissionId]);

  async function assignCategory(category: "passing" | "rushing") {
    const rows = allocations[category] ?? [];
    if (!rows.length || rows.some((row) => !row.rosterPlayerId)) return;
    setBusySlot(category);
    setError(null);
    try {
      await recApi.assignBoxScoreStatAllocations({ guildId, submissionId, category, allocations: rows });
      setAssigned((current) => ({ ...current, [category]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign stats.");
    } finally {
      setBusySlot(null);
    }
  }

  async function assignTurnover(kind: TurnoverKind, index: number) {
    const slot = `${kind}:${index}`;
    const rosterPlayerId = selected[slot];
    if (!rosterPlayerId) return;
    setBusySlot(slot);
    setError(null);
    try {
      await recApi.assignTurnoverToPlayer({ guildId, submissionId, kind, rosterPlayerId });
      setAssigned((current) => ({ ...current, [slot]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign this turnover.");
    } finally {
      setBusySlot(null);
    }
  }

  const categories = data ? (Object.keys(data.categories) as Array<"passing" | "rushing">) : [];
  const turnoverKinds = useMemo(
    () => (data ? TURNOVER_ORDER.filter((kind) => (data.turnovers[kind] ?? 0) > 0) : []),
    [data],
  );
  const nothingToAssign = categories.length === 0 && turnoverKinds.length === 0;

  return (
    <Modal title="Assign Stats to a Player?" onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Optional — attribute this game's stats to players on your roster to track their
        performance. Skip anything, or close this to skip entirely.
      </p>
      {error && <ErrorState message={error} />}
      {!data || !players ? (
        <p className="hub-empty">Loading…</p>
      ) : nothingToAssign ? (
        <p className="hub-empty">No passing, rushing, or turnover stats were captured on this box score.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {categories.map((category) => {
            const lines = data.categories[category] ?? [];
            const done = assigned[category];
            return (
              <div key={category} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <strong>{CATEGORY_LABEL[category]}</strong>
                <p style={{ margin: "4px 0 var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  {lines.map((line) => `${line.label}: ${line.value}`).join(" · ")}
                </p>
                {done ? (
                  <p style={{ margin: 0, color: "var(--success)", fontSize: "var(--text-sm)" }}>Assigned.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {(allocations[category] ?? []).map((row, rowIndex) => (
                      <div key={rowIndex} style={{ display: "flex", gap: "var(--space-2)", alignItems: "end", flexWrap: "wrap" }}>
                        <select className="form-select" style={{ minWidth: 190 }} value={row.rosterPlayerId} onChange={(event) => setAllocations((current) => ({ ...current, [category]: (current[category] ?? []).map((item, index) => index === rowIndex ? { ...item, rosterPlayerId: event.target.value } : item) }))}>
                          <option value="">Select a player…</option>
                          {players.map((player) => <option key={player.id} value={player.id}>{player.fullName} · {player.position}</option>)}
                        </select>
                        {lines.map((line) => (
                          <label key={line.statKey} style={{ minWidth: 90 }}>
                            <span className="form-label">{line.label}</span>
                            <input className="form-input" type="number" min={0} value={row.stats[line.statKey] ?? 0} onChange={(event) => setAllocations((current) => ({ ...current, [category]: (current[category] ?? []).map((item, index) => index === rowIndex ? { ...item, stats: { ...item.stats, [line.statKey]: Math.max(0, Number(event.target.value)) } } : item) }))} />
                          </label>
                        ))}
                        <Button variant="ghost" size="compact" onClick={() => setAllocations((current) => ({ ...current, [category]: (current[category] ?? []).filter((_, index) => index !== rowIndex) }))}>Remove</Button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <Button variant="secondary" size="compact" onClick={() => setAllocations((current) => ({ ...current, [category]: [...(current[category] ?? []), { rosterPlayerId: "", stats: Object.fromEntries(lines.map((line) => [line.statKey, 0])) }] }))}>Add player</Button>
                    <Button
                      variant="primary"
                      size="compact"
                      disabled={!allocations[category]?.length || busySlot === category}
                      onClick={() => void assignCategory(category)}
                    >
                      {busySlot === category ? "Assigning…" : "Assign"}
                    </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {turnoverKinds.map((kind) => {
            const count = data.turnovers[kind] ?? 0;
            return (
              <div key={kind} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <strong>{TURNOVER_LABEL[kind]}{count > 1 ? ` (${count})` : ""}</strong>
                <p style={{ margin: "4px 0 var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Each one can go to a different player.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {Array.from({ length: count }).map((_, index) => {
                    const slot = `${kind}:${index}`;
                    const done = assigned[slot];
                    return (
                      <div key={slot} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", minWidth: 16 }}>#{index + 1}</span>
                        {done ? (
                          <span style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>Assigned.</span>
                        ) : (
                          <>
                            <select
                              className="form-select"
                              value={selected[slot] ?? ""}
                              onChange={(e) => setSelected((current) => ({ ...current, [slot]: e.target.value }))}
                            >
                              <option value="">Select a player…</option>
                              {players.map((player) => (
                                <option key={player.id} value={player.id}>{player.fullName} · {player.position}</option>
                              ))}
                            </select>
                            <Button
                              variant="primary"
                              size="compact"
                              disabled={!selected[slot] || busySlot === slot}
                              onClick={() => void assignTurnover(kind, index)}
                            >
                              {busySlot === slot ? "Assigning…" : "Assign"}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Button variant="ghost" style={{ marginTop: "var(--space-3)" }} onClick={onClose}>Done</Button>
    </Modal>
  );
}
