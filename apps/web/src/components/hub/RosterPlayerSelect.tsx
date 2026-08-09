import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterPlayer } from "../../types/api.js";

const ROSTER_ACTIVE_STATUSES = new Set(["active", "transferred_in"]);

// Shared player-target picker for store purchases (attribute points, dev upgrades, age
// resets): a position-group toggle row above a dropdown scoped to that group, replacing
// free-text player-name entry so submissions always resolve to a real roster player.
export function RosterPlayerSelect({
  guildId,
  value,
  onChange,
}: {
  guildId: string;
  value: RosterPlayer | null;
  onChange: (player: RosterPlayer | null) => void;
}) {
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("ALL");

  useEffect(() => {
    let active = true;
    recApi.getTeamRoster({ guildId })
      .then((data) => { if (active) setPlayers((data.players ?? []).filter((p) => ROSTER_ACTIVE_STATUSES.has(p.rosterStatus))); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Failed to load your roster."); });
    return () => { active = false; };
  }, [guildId]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const player of players ?? []) if (player.positionGroup) set.add(player.positionGroup);
    return Array.from(set).sort();
  }, [players]);

  const visible = useMemo(() => {
    if (!players) return [];
    return group === "ALL" ? players : players.filter((p) => p.positionGroup === group);
  }, [players, group]);

  if (error) return <p className="form-hint">{error}</p>;
  if (!players) return <p className="hub-muted">Loading roster…</p>;

  return (
    <div className="roster-player-select">
      <div className="roster-player-select-groups">
        <button type="button" className={group === "ALL" ? "active" : ""} onClick={() => setGroup("ALL")}>ALL</button>
        {groups.map((g) => <button type="button" key={g} className={group === g ? "active" : ""} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      <select
        className="form-input"
        value={value?.id ?? ""}
        onChange={(event) => onChange(visible.find((p) => p.id === event.target.value) ?? null)}
      >
        <option value="">Select player</option>
        {visible.map((player) => (
          <option key={player.id} value={player.id}>
            {player.fullName} · {player.position} · {player.overallRating ?? "—"} OVR
          </option>
        ))}
      </select>
    </div>
  );
}
