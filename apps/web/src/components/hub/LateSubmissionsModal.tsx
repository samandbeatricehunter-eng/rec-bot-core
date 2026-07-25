import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { TeamScheduleManualState, TeamScheduleManualWeek } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { UploadBoxScoreModal } from "../../routes/league-mgmt/manage-league/UploadBoxScoreModal.js";
import { HighlightUploadModal } from "./HighlightUploadModal.js";

function weekLabel(week: TeamScheduleManualWeek): string {
  const side = week.confirmedHomeAway === "home" ? "vs" : "at";
  return `Week ${week.weekNumber} ${side} ${week.confirmedOpponentName ?? "Opponent"}`;
}

// "Missed a box score or highlight for a past week" self-serve catch-up flow, reachable
// from My Team. Reuses UploadBoxScoreModal/HighlightUploadModal as-is (both already accept
// an explicit past week/gameId) — this just figures out which past weeks are still
// eligible and hands off to them.
export function LateSubmissionsModal({ guildId, currentWeek, onClose }: { guildId: string; currentWeek: number; onClose: () => void }) {
  const { discordId } = useReadyAuth();
  const [schedule, setSchedule] = useState<TeamScheduleManualState | null>(null);
  const [highlightCounts, setHighlightCounts] = useState<Record<number, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | "">("");
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
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
      if (!week.alreadyConfirmed || week.confirmedMatchupType !== "h2h" || week.isBye || !week.gameId) return false;
      if (week.weekNumber >= currentWeek) return false;
      const missingBoxScore = !week.boxScoreSubmissionId;
      const missingHighlight = (highlightCounts[week.weekNumber] ?? 0) < 2;
      return missingBoxScore || missingHighlight;
    });
  }, [schedule, highlightCounts, currentWeek]);

  useEffect(() => {
    if (selectedWeek !== "" && !eligibleWeeks.some((week) => week.weekNumber === selectedWeek)) {
      setSelectedWeek("");
    }
  }, [eligibleWeeks, selectedWeek]);

  const selected = eligibleWeeks.find((week) => week.weekNumber === selectedWeek) ?? null;
  const missingBoxScore = selected ? !selected.boxScoreSubmissionId : false;
  const missingHighlight = selected ? (highlightCounts?.[selected.weekNumber] ?? 0) < 2 : false;

  return (
    <Modal title="Late Submissions" onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Catch up on a past week you missed — pick a week below, then upload whichever of the box
        score or highlights you&apos;re still missing. Only weeks still missing at least one show up here.
      </p>
      {error && <ErrorState message={error} />}
      {!schedule || !highlightCounts ? (
        <p className="hub-empty">Loading…</p>
      ) : eligibleWeeks.length === 0 ? (
        <p className="hub-empty">No past weeks are missing a box score or highlight — you&apos;re all caught up.</p>
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
          onSubmitted={() => { setBoxScoreOpen(false); load(); }}
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
    </Modal>
  );
}
