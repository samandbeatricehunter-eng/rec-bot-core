import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { TeamScheduleManualState, TeamScheduleManualWeek } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { HighlightUploadModal } from "./HighlightUploadModal.js";

function weekLabel(week: TeamScheduleManualWeek): string {
  const side = week.confirmedHomeAway === "home" ? "vs" : "at";
  return `Week ${week.weekNumber} ${side} ${week.confirmedOpponentName ?? "Opponent"}`;
}

// "Missed a highlight for this week or a past week" self-serve catch-up flow, reachable from
// My Team and the Buzz page's GameDay card. Reuses HighlightUploadModal as-is (it already
// accepts an explicit week/gameId) — this just figures out which weeks (current or past —
// never future) are still eligible and hands off to it.
export function LateSubmissionsModal({
  guildId,
  currentWeek,
  initialWeek,
  onClose,
}: {
  guildId: string;
  currentWeek: number;
  // Deep-linked open (e.g. from the /highlights Discord command) already knows which week —
  // pre-select it instead of making the user pick again, as long as it's still eligible.
  initialWeek?: number;
  onClose: () => void;
}) {
  const [schedule, setSchedule] = useState<TeamScheduleManualState | null>(null);
  const [highlightCounts, setHighlightCounts] = useState<Record<number, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | "">("");
  const [highlightOpen, setHighlightOpen] = useState(false);

  function load() {
    setError(null);
    Promise.all([recApi.getMyTeamSchedule(guildId), recApi.getMyHighlightWeekCounts(guildId)])
      .then(([sched, counts]) => {
        setSchedule(sched);
        setHighlightCounts(counts.counts);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your schedule."));
  }
  useEffect(() => { load(); }, [guildId]);

  const eligibleWeeks = useMemo(() => {
    if (!schedule || !highlightCounts) return [];
    return schedule.weeks.filter((week) => {
      if (!week.alreadyConfirmed || !week.confirmedMatchupType || week.isBye || !week.gameId) return false;
      if (week.weekNumber > currentWeek) return false;
      return (highlightCounts[week.weekNumber] ?? 0) < 2;
    });
  }, [schedule, highlightCounts, currentWeek]);

  // A GameDay quick-action already knows what it wants — skip the "pick a week" step when
  // there's exactly one eligible week, or when the caller (a deep link) already named a
  // specific still-eligible week.
  useEffect(() => {
    if (selectedWeek !== "") return;
    if (initialWeek !== undefined && eligibleWeeks.some((week) => week.weekNumber === initialWeek)) {
      setSelectedWeek(initialWeek);
    } else if (eligibleWeeks.length === 1) {
      setSelectedWeek(eligibleWeeks[0].weekNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWeek, eligibleWeeks]);

  useEffect(() => {
    if (selectedWeek !== "" && !eligibleWeeks.some((week) => week.weekNumber === selectedWeek)) {
      setSelectedWeek("");
    }
  }, [eligibleWeeks, selectedWeek]);

  const selected = eligibleWeeks.find((week) => week.weekNumber === selectedWeek) ?? null;

  return (
    <Modal title="Submit Highlights" onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Pick a week below, then upload the highlights you&apos;re still missing — this covers this week's game too, not just past ones.
      </p>
      {error && <ErrorState message={error} />}
      {!schedule || !highlightCounts ? (
        <p className="hub-empty">Loading…</p>
      ) : eligibleWeeks.length === 0 ? (
        <p className="hub-empty">No weeks — this week or past — are missing a highlight.</p>
      ) : (
        <>
          <label className="form-field">
            <span className="form-label">Week</span>
            <select
              className="form-input"
              value={selectedWeek}
              onChange={(event) => setSelectedWeek(event.target.value ? Number(event.target.value) : "")}
            >
              <option value="">Select a week</option>
              {eligibleWeeks.map((week) => (
                <option key={week.weekNumber} value={week.weekNumber}>{weekLabel(week)}</option>
              ))}
            </select>
          </label>
          {selected && (
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={() => setHighlightOpen(true)}>Upload Highlight(s)</Button>
            </div>
          )}
        </>
      )}

      {highlightOpen && selected?.gameId && (
        <HighlightUploadModal
          guildId={guildId}
          gameId={selected.gameId}
          onClose={() => setHighlightOpen(false)}
          onSubmitted={() => { setHighlightOpen(false); load(); }}
        />
      )}
    </Modal>
  );
}
