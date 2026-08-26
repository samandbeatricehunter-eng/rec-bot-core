import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { AvailabilityModal } from "../hub/AvailabilityModal.js";
import { StatusChip } from "../design-system/StatusChip.js";
import { ProposeTimeModal } from "./ProposeTimeModal.js";
import { ReviewOffersModal } from "./ReviewOffersModal.js";

type Snapshot = { status: string; scheduledFor: string | null; fwFlagged: boolean; pendingProposal: { id: string; proposedByUserId: string; proposedFor: string; proposedByMe: boolean } | null };
type Suggestions = {
  deadlineUtc: string; sharedWindows: Array<{ startUtc: string; endUtc: string }>;
  bestWindow: { kickoffUtc: string; windowEndUtc: string; score: number } | null; bestKickoffOptions: string[];
};

const STATUS_LABELS: Record<string, string> = {
  not_scheduled: "Not Scheduled", waiting_on_opponent: "Waiting on Opponent", time_proposed: "Time Proposed",
  confirmed: "Confirmed", reschedule_requested: "Reschedule Requested", no_shared_availability: "No Shared Availability",
  needs_commissioner_help: "Needs Commissioner Help", live: "Live", completed: "Completed",
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
  const [proposeOpen, setProposeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

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
  const awaitingMyResponse = Boolean(snapshot.pendingProposal && !snapshot.pendingProposal.proposedByMe);

  return (
    <section className={`matchup-scheduling-card${awaitingMyResponse ? " matchup-scheduling-card--attention" : ""}`}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Scheduling</h3>
        <StatusChip status={snapshot.status === "live" ? "info" : snapshot.status === "confirmed" ? "approved" : snapshot.status === "not_scheduled" ? "pending" : "info"} label={statusLabel} />
      </header>
      {error && <ErrorState message={error} />}
      {notice && <p className="site-auth-success">{notice}</p>}
      {snapshot.fwFlagged && <p className="form-hint" style={{ color: "var(--warning, #d9a521)" }}>A Force Win was requested for this game — a commissioner has been notified.</p>}

      {snapshot.status === "live" && (
        <>
          <p className="matchup-scheduling-attention">🔴 <strong>LIVE</strong></p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => void run(() => recApi.markGameOver({ guildId, gameId }), "Game marked over.")}>Game Over</Button>
          </div>
        </>
      )}

      {snapshot.status === "confirmed" && snapshot.scheduledFor && (
        <>
          <p>Kickoff: <strong>{fmt(snapshot.scheduledFor)}</strong></p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => void run(() => recApi.markGameStarted({ guildId, gameId }), "Game marked started.")}>Game Started</Button>
            <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.requestSchedulingReschedule({ guildId, gameId }), "Reschedule requested.")}>Reschedule</Button>
          </div>
        </>
      )}

      {snapshot.pendingProposal && snapshot.status !== "confirmed" && snapshot.status !== "live" && snapshot.status !== "completed" && (
        <>
          <p className={snapshot.pendingProposal.proposedByMe ? undefined : "matchup-scheduling-attention"}>
            {snapshot.pendingProposal.proposedByMe ? "Proposed: " : "🔔 Offer received — "}
            <strong>{fmt(snapshot.pendingProposal.proposedFor)}</strong>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {snapshot.pendingProposal.proposedByMe ? (
              <>
                <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "withdraw" })).then(() => setProposeOpen(true))}>Edit</Button>
                <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "withdraw" }), "Proposal deleted.")}>Delete</Button>
              </>
            ) : (
              <Button variant="primary" size="compact" disabled={busy} onClick={() => setReviewOpen(true)}>Review Offers</Button>
            )}
            <Button variant="ghost" size="compact" onClick={() => setAvailabilityOpen(true)}>Adjust Availability</Button>
          </div>
        </>
      )}

      {!snapshot.pendingProposal && snapshot.status !== "confirmed" && snapshot.status !== "live" && snapshot.status !== "completed" && (
        <>
          {suggestions?.bestWindow ? (
            <p>Best shared window: <strong>{fmt(suggestions.bestWindow.kickoffUtc)}</strong> – {fmt(suggestions.bestWindow.windowEndUtc)}</p>
          ) : (
            <p className="hub-empty">No shared availability found yet before the deadline.</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => setProposeOpen(true)}>Propose Time</Button>
            {suggestions?.bestWindow && (
              <Button variant="secondary" size="compact" disabled={busy} onClick={() => void run(() => recApi.proposeSchedulingTime({ guildId, gameId, proposedForUtc: suggestions.bestWindow!.kickoffUtc }), "Time proposed.")}>Propose Best Overlap</Button>
            )}
            <Button variant="ghost" size="compact" onClick={() => setAvailabilityOpen(true)}>Adjust Availability</Button>
            <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.markSchedulingCantMakeGame({ guildId, gameId, choice: "request_fs" }), "Opponent notified.")}>Can't Make Game</Button>
            <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.markGameStarted({ guildId, gameId }), "Game marked started.")}>Game Started</Button>
          </div>
        </>
      )}

      {isCommissioner && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <Button variant="ghost" size="compact" disabled={busy} onClick={() => void run(() => recApi.resetScheduling({ guildId, gameId }), "Scheduling reset.")}>Reset Scheduling (Commissioner)</Button>
        </div>
      )}

      {availabilityOpen && <AvailabilityModal guildId={guildId} onClose={() => { setAvailabilityOpen(false); load(); }} />}

      {proposeOpen && (
        <ProposeTimeModal
          guildId={guildId}
          gameId={gameId}
          title="Propose Time"
          onClose={() => setProposeOpen(false)}
          onDone={(message) => { setProposeOpen(false); setNotice(message); load(); }}
        />
      )}

      {reviewOpen && snapshot.pendingProposal && (
        <ReviewOffersModal
          proposedFor={snapshot.pendingProposal.proposedFor}
          busy={busy}
          error={error}
          onClose={() => setReviewOpen(false)}
          onAccept={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "accept" }), "Confirmed.").then(() => setReviewOpen(false))}
          onReject={() => void run(() => recApi.respondToSchedulingProposal({ guildId, gameId, proposalId: snapshot.pendingProposal!.id, action: "reject" }), "Offer rejected.").then(() => setReviewOpen(false))}
          onCounter={() => { setReviewOpen(false); setCounterOpen(true); }}
        />
      )}

      {counterOpen && snapshot.pendingProposal && (
        <ProposeTimeModal
          guildId={guildId}
          gameId={gameId}
          proposalId={snapshot.pendingProposal.id}
          title="Counter Offer"
          onClose={() => setCounterOpen(false)}
          onDone={(message) => { setCounterOpen(false); setNotice(message); load(); }}
        />
      )}
    </section>
  );
}
