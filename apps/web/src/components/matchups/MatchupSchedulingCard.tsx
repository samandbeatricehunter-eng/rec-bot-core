import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { AvailabilityModal } from "../hub/AvailabilityModal.js";
import { StatusChip } from "../design-system/StatusChip.js";

type Snapshot = { status: string; scheduledFor: string | null; fwFlagged: boolean; pendingProposal: { id: string; proposedByUserId: string; proposedFor: string; proposedByMe: boolean } | null };
type Suggestions = {
  deadlineUtc: string; sharedWindows: Array<{ startUtc: string; endUtc: string }>;
  bestWindow: { kickoffUtc: string; windowEndUtc: string; score: number } | null; bestKickoffOptions: string[];
};

const STATUS_LABELS: Record<string, string> = {
  not_scheduled: "Not Scheduled", waiting_on_opponent: "Waiting on Opponent", time_proposed: "Time Proposed",
  confirmed: "Confirmed", reschedule_requested: "Reschedule Requested", no_shared_availability: "No Shared Availability",
  needs_commissioner_help: "Needs Commissioner Help", completed: "Completed",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MatchupSchedulingCard({ guildId, gameId, isCommissioner }: { guildId: string; gameId: string; isCommissioner: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);

  function load() {
    recApi.getSchedulingMatchupStatus({ guildId, gameId }).then(setSnapshot).catch((err) => setError(err instanceof Error ? err.message : "Failed to load scheduling status."));
    recApi.getSchedulingSuggestions({ guildId, gameId }).then(setSuggestions).catch(() => setSuggestions(null));
  }
  useEffect(load, [guildId, gameId]);

  async function run<T>(action: () => Promise<T>, successMessage?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) return null;
  const statusLabel = STATUS_LABELS[snapshot.status] ?? snapshot.status;

  return (
    <section className="matchup-scheduling-card">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Scheduling</h3>
        <StatusChip status={snapshot.status === "confirmed" ? "approved" : snapshot.status === "not_scheduled" ? "pending" : "info"} label={statusLabel} />
      </header>
      {error && <ErrorState message={error} />}
      {notice && <p className="site-auth-success">{notice}</p>}
      {snapshot.fwFlagged && <p className="form-hint" style={{ color: "var(--warning, #d9a521)" }}>A Force Win was requested for this game — a commissioner has been notified.</p>}

      {snapshot.status === "confirmed" && snapshot.scheduledFor && (
        <>
          <p>Kickoff: <strong>{fmt(snapshot.scheduledFor)}</strong></p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => void run(() => recApi.checkInScheduling({ guildId, gameId }), "You're checked in.")}>I'm Ready</Button>
            <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.requestSchedulingReschedule({ guildId, gameId }), "Reschedule requested.")}>Reschedule</Button>
          </div>
        </>
      )}

      {snapshot.pendingProposal && snapshot.status !== "confirmed" && (
        <>
          <p>Proposed: <strong>{fmt(snapshot.pendingProposal.proposedFor)}</strong></p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {snapshot.pendingProposal.proposedByMe ? (
              <>
                <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "withdraw" }), "Proposal withdrawn — propose a new time below.")}>Edit</Button>
                <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "withdraw" }), "Proposal deleted.")}>Delete</Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "accept" }), "Confirmed.")}>Accept</Button>
                {suggestions?.bestWindow && (
                  <Button variant="secondary" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "counter", counterForUtc: suggestions.bestWindow!.kickoffUtc }), "Countered.")}>Counter with best overlap</Button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!snapshot.pendingProposal && snapshot.status !== "confirmed" && (
        <>
          {suggestions?.bestWindow ? (
            <p>Best shared window: <strong>{fmt(suggestions.bestWindow.kickoffUtc)}</strong> – {fmt(suggestions.bestWindow.windowEndUtc)}</p>
          ) : (
            <p className="hub-empty">No shared availability found yet before the deadline.</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {suggestions?.bestWindow && (
              <Button variant="primary" size="compact" disabled={busy} onClick={() => void run(() => recApi.proposeSchedulingTime({ guildId, gameId, proposedForUtc: suggestions.bestWindow!.kickoffUtc }), "Time proposed.")}>Propose This Time</Button>
            )}
            <Button variant="ghost" size="compact" onClick={() => setAvailabilityOpen(true)}>Adjust Availability</Button>
            <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.markSchedulingCantMakeGame({ guildId, gameId }), "Opponent notified.")}>Can't Make Game</Button>
          </div>
        </>
      )}

      {isCommissioner && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.resetScheduling({ guildId, gameId }), "Scheduling reset.")}>Reset Scheduling (Commissioner)</Button>
        </div>
      )}

      {availabilityOpen && <AvailabilityModal guildId={guildId} onClose={() => { setAvailabilityOpen(false); load(); }} />}
    </section>
  );
}
