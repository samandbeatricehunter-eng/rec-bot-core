import { useState } from "react";
import type { SiteTournamentDetail } from "../lib/site-api.js";

type Match = SiteTournamentDetail["matches"][number];

function TimeProposeForm({
  busy,
  label,
  onSubmit,
}: {
  busy: boolean;
  label: string;
  onSubmit: (proposedForUtc: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="site-tournament-scheduling-form">
      <input
        type="datetime-local"
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        className="site-btn site-btn-ghost"
        disabled={busy || !draft}
        onClick={() => onSubmit(new Date(draft).toISOString())}
      >
        {label}
      </button>
    </div>
  );
}

/** Propose/accept/counter panel for one tournament match — site-only, no Discord. Rendered only
 *  for the two players in a `ready` match that hasn't had a result reported yet. */
export function TournamentMatchScheduling({
  match,
  youId,
  busy,
  onPropose,
  onRespond,
  onRequestReschedule,
}: {
  match: Match;
  youId: string;
  busy: boolean;
  onPropose: (proposedForUtc: string) => void;
  onRespond: (proposalId: string, action: "accept" | "counter" | "withdraw" | "reject", counterForUtc?: string) => void;
  onRequestReschedule: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const scheduling = match.scheduling;
  const status = scheduling?.status ?? "not_scheduled";

  if (status === "confirmed") {
    return (
      <div className="site-tournament-scheduling">
        <p className="site-muted">
          Confirmed for {scheduling?.scheduledFor ? new Date(scheduling.scheduledFor).toLocaleString() : "—"}
        </p>
        <button className="site-btn site-btn-ghost" disabled={busy} onClick={onRequestReschedule}>
          Request a different time
        </button>
      </div>
    );
  }

  const pending = scheduling?.pendingProposal ?? null;
  if (status === "proposed" && pending) {
    if (pending.proposedByUserId === youId) {
      return (
        <div className="site-tournament-scheduling">
          <p className="site-muted">Waiting on your opponent — you proposed {new Date(pending.proposedFor).toLocaleString()}.</p>
        </div>
      );
    }
    return (
      <div className="site-tournament-scheduling">
        <p className="site-muted">Your opponent proposed {new Date(pending.proposedFor).toLocaleString()}.</p>
        {countering ? (
          <TimeProposeForm busy={busy} label="Send counter" onSubmit={(time) => { setCountering(false); onRespond(pending.id, "counter", time); }} />
        ) : (
          <div className="site-tournament-scheduling-actions">
            <button className="site-btn site-btn-primary" disabled={busy} onClick={() => onRespond(pending.id, "accept")}>Accept</button>
            <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => setCountering(true)}>Counter</button>
            <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => onRespond(pending.id, "reject")}>Reject</button>
          </div>
        )}
      </div>
    );
  }

  // not_scheduled or reschedule_requested — propose a fresh time.
  return (
    <div className="site-tournament-scheduling">
      <p className="site-muted">{status === "reschedule_requested" ? "A reschedule was requested — propose a new time." : "Propose a time to play."}</p>
      <TimeProposeForm busy={busy} label="Propose time" onSubmit={onPropose} />
    </div>
  );
}
