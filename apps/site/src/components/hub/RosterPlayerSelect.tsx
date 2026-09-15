import { useEffect, useMemo, useState } from "react";
import { REC_ROSTER_POSITION_FILTERS, matchesRosterPositionFilter } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterPlayer } from "../../types/api.js";

const ROSTER_ACTIVE_STATUSES = new Set(["active", "transferred_in"]);

// Shared player-target picker for store purchases (attribute points, dev upgrades, age
// resets, contract adjustments): a horizontal position filter row above a dropdown scoped
// to that position, replacing free-text player-name entry so submissions always resolve to a
// real roster player. excludeDefault filters out baseline-seeded players (isDefaultPlayer)
// — used by CFB leagues where the store can't be spent on the default seeded roster.
export function RosterPlayerSelect({
  guildId,
  value,
  onChange,
  excludeDefault = false,
  showAge = false,
  excludePlayer,
  extraLabel,
}: {
  guildId: string;
  value: RosterPlayer | null;
  onChange: (player: RosterPlayer | null) => void;
  excludeDefault?: boolean;
  /** Include current age in option labels (age-reset flow). */
  showAge?: boolean;
  /** Drop players this purchase type has nothing left to offer (e.g. already top dev tier,
   *  already at/under the age-reset floor) out of the picker entirely. */
  excludePlayer?: (player: RosterPlayer) => boolean;
  /** Extra text appended to each option's label (e.g. current dev tier). */
  extraLabel?: (player: RosterPlayer) => string;
}) {
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<string>("ALL");

  useEffect(() => {
    let active = true;
    recApi.getTeamRoster({ guildId })
      .then((data) => { if (active) setPlayers((data.players ?? []).filter((p) => ROSTER_ACTIVE_STATUSES.has(p.rosterStatus) && (!excludeDefault || !p.isDefaultPlayer))); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Failed to load your roster."); });
    return () => { active = false; };
  }, [guildId, excludeDefault]);

  const visible = useMemo(() => {
    if (!players) return [];
    const filtered = (position === "ALL"
      ? players
      : players.filter((p) => matchesRosterPositionFilter(p.position, position))
    ).filter((p) => !excludePlayer?.(p));
    return [...filtered].sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0) || a.fullName.localeCompare(b.fullName));
  }, [players, position, excludePlayer]);

  useEffect(() => {
    if (value && position !== "ALL" && !matchesRosterPositionFilter(value.position, position)) {
      onChange(null);
    }
  }, [position, value, onChange]);

  if (error) return <p className="form-hint">{error}</p>;
  if (!players) return <p className="hub-muted">Loading roster…</p>;

  return (
    <div className="roster-player-select">
      <div className="roster-player-select-groups" role="tablist" aria-label="Filter by position">
        <button type="button" className={position === "ALL" ? "active" : ""} onClick={() => setPosition("ALL")}>ALL</button>
        {REC_ROSTER_POSITION_FILTERS.map((pos) => (
          <button type="button" key={pos} className={position === pos ? "active" : ""} onClick={() => setPosition(pos)}>{pos}</button>
        ))}
      </div>
      <select
        className="form-input"
        value={value?.id ?? ""}
        onChange={(event) => onChange(visible.find((p) => p.id === event.target.value) ?? null)}
      >
        <option value="">Select player</option>
        {visible.map((player) => {
          const agePart = showAge
            ? (player.age != null ? ` · Age ${player.age}` : " · Age —")
            : "";
          return (
            <option key={player.id} value={player.id}>
              {player.fullName} · {player.position}{agePart} · {player.overallRating ?? "—"} OVR{extraLabel?.(player) ?? ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}
