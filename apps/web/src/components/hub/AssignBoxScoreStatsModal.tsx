import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { AssignableBoxScoreStats, RosterPlayer } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const CATEGORY_LABEL: Record<"passing" | "rushing", string> = { passing: "Passing", rushing: "Rushing" };

// After a box score upload, offer to attribute the applicable per-player stats (passing,
// rushing — never team-aggregate fields like time of possession) to a real roster player.
// Fully skippable — nothing here is required to finish the box score submission itself.
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
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});

  useEffect(() => {
    recApi.getAssignableBoxScoreStats({ guildId, submissionId }).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats to assign."));
    recApi.getTeamRoster({ guildId }).then((res) => setPlayers(res.players.filter((p) => p.rosterStatus === "active" || p.rosterStatus === "transferred_in"))).catch(() => setPlayers([]));
  }, [guildId, submissionId]);

  async function assign(category: "passing" | "rushing") {
    const rosterPlayerId = selected[category];
    if (!rosterPlayerId) return;
    setBusyCategory(category);
    setError(null);
    try {
      await recApi.assignBoxScoreStatsToPlayer({ guildId, submissionId, category, rosterPlayerId });
      setAssigned((current) => ({ ...current, [category]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign stats.");
    } finally {
      setBusyCategory(null);
    }
  }

  const categories = data ? (Object.keys(data.categories) as Array<"passing" | "rushing">) : [];

  return (
    <Modal title="Assign Stats to a Player?" onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Optional — attribute this game's stats to a player on your roster to track their
        performance. Skip any category, or close this to skip entirely.
      </p>
      {error && <ErrorState message={error} />}
      {!data || !players ? (
        <p className="hub-empty">Loading…</p>
      ) : categories.length === 0 ? (
        <p className="hub-empty">No passing or rushing stats were captured on this box score.</p>
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
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <select
                      className="form-select"
                      value={selected[category] ?? ""}
                      onChange={(e) => setSelected((current) => ({ ...current, [category]: e.target.value }))}
                    >
                      <option value="">Select a player…</option>
                      {players.map((player) => (
                        <option key={player.id} value={player.id}>{player.fullName} · {player.position}</option>
                      ))}
                    </select>
                    <Button
                      variant="primary"
                      size="compact"
                      disabled={!selected[category] || busyCategory === category}
                      onClick={() => void assign(category)}
                    >
                      {busyCategory === category ? "Assigning…" : "Assign"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Button variant="ghost" style={{ marginTop: "var(--space-3)" }} onClick={onClose}>Done</Button>
    </Modal>
  );
}
