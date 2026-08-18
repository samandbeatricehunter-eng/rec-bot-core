import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { TeamScheduleManualState, TeamScheduleManualWeek } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { UploadBoxScoreModal } from "../../routes/league-mgmt/manage-league/UploadBoxScoreModal.js";
import { HighlightUploadModal } from "./HighlightUploadModal.js";
import { AssignBoxScoreStatsModal } from "./AssignBoxScoreStatsModal.js";

function weekLabel(week: TeamScheduleManualWeek): string {
  const side = week.confirmedHomeAway === "home" ? "vs" : "at";
  return `Week ${week.weekNumber} ${side} ${week.confirmedOpponentName ?? "Opponent"}`;
}

// "Missed a box score or highlight for this week or a past week" self-serve catch-up flow,
// reachable from My Team and the Buzz page's GameDay card. Reuses UploadBoxScoreModal/
// HighlightUploadModal as-is (both already accept an explicit week/gameId) — this just
// figures out which weeks (current or past — never future) are still eligible and hands
// off to them. An optional `focus` narrows the list to just one concern, for a GameDay
// button that means "I specifically want to submit a box score" (or highlights).
export function LateSubmissionsModal({
  guildId,
  currentWeek,
  focus,
  initialWeek,
  onClose,
}: {
  guildId: string;
  currentWeek: number;
  focus?: "boxScore" | "highlight";
  // Deep-linked open (e.g. from the /highlights Discord command) already knows which week —
  // pre-select it instead of making the user pick again, as long as it's still eligible.
  initialWeek?: number;
  onClose: () => void;
}) {
  const { discordId } = useReadyAuth();
  const [schedule, setSchedule] = useState<TeamScheduleManualState | null>(null);
  const [highlightCounts, setHighlightCounts] = useState<Record<number, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | "">("");
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [assignStatsSubmissionId, setAssignStatsSubmissionId] = useState<string | null>(null);

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
      const missingBoxScore = !week.boxScoreSubmissionId;
      const missingHighlight = (highlightCounts[week.weekNumber] ?? 0) < 2;
      if (focus === "boxScore") return missingBoxScore;
      if (focus === "highlight") return missingHighlight;
      return missingBoxScore || missingHighlight;
    });
  }, [schedule, highlightCounts, currentWeek, focus]);

  // A GameDay quick-action already knows what it wants — skip the "pick a week" step when
  // there's exactly one eligible week for that focused concern, or when the caller (a deep
  // link) already named a specific still-eligible week.
  useEffect(() => {
    if (selectedWeek !== "") return;
    if (initialWeek !== undefined && eligibleWeeks.some((week) => week.weekNumber === initialWeek)) {
      setSelectedWeek(initialWeek);
    } else if (focus && eligibleWeeks.length === 1) {
      setSelectedWeek(eligibleWeeks[0].weekNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, initialWeek, eligibleWeeks]);

  useEffect(() => {
    if (selectedWeek !== "" && !eligibleWeeks.some((week) => week.weekNumber === selectedWeek)) {
      setSelectedWeek("");
    }
  }, [eligibleWeeks, selectedWeek]);

  const selected = eligibleWeeks.find((week) => week.weekNumber === selectedWeek) ?? null;
  const missingBoxScore = selected ? !selected.boxScoreSubmissionId : false;
  const missingHighlight = selected ? (highlightCounts?.[selected.weekNumber] ?? 0) < 2 : false;

  const title = focus === "boxScore" ? "Submit Box Score" : focus === "highlight" ? "Submit Highlights" : "Late Submissions";
  const emptyText =
    focus === "boxScore"
      ? "No games — this week or past — are missing a box score."
      : focus === "highlight"
        ? "No weeks — this week or past — are missing a highlight."
        : "No weeks — this week or past — are missing a box score or highlight.";

  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Pick a week below, then upload whichever of the box score or highlights you&apos;re still
        missing — this covers this week's game too, not just past ones.
      </p>
      {error && <ErrorState message={error} />}
      {!schedule || !highlightCounts ? (
        <p className="hub-empty">Loading…</p>
      ) : eligibleWeeks.length === 0 ? (
        <p className="hub-empty">{emptyText}</p>
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
              {missingBoxScore && <Button variant="secondary" onClick={() => setBoxScoreOpen(true)}>Upload Box Score</Button>}
              {missingHighlight && <Button variant="secondary" onClick={() => setHighlightOpen(true)}>Upload Highlight(s)</Button>}
            </div>
          )}
        </>
      )}

      {boxScoreOpen && selected?.gameId && (
        <UploadBoxScoreModal
          guildId={guildId}
          discordId={discordId}
          weekNumber={selected.weekNumber}
          seasonNumber={schedule!.seasonNumber}
          gameId={selected.gameId}
          commissionerSubmission={false}
          requireSecondImage
          onClose={() => setBoxScoreOpen(false)}
          onSubmitted={(submissionId) => { setBoxScoreOpen(false); setAssignStatsSubmissionId(submissionId); load(); }}
        />
      )}
      {highlightOpen && selected?.gameId && (
        <HighlightUploadModal
          guildId={guildId}
          gameId={selected.gameId}
          onClose={() => setHighlightOpen(false)}
          onSubmitted={() => { setHighlightOpen(false); load(); }}
        />
      )}
      {assignStatsSubmissionId && (
        <AssignBoxScoreStatsModal guildId={guildId} submissionId={assignStatsSubmissionId} onClose={() => setAssignStatsSubmissionId(null)} />
      )}
    </Modal>
  );
}
