import { useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterDepartureStatus, RosterPlayer } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

const DEPARTURE_OPTIONS: Array<{ value: RosterDepartureStatus; label: string }> = [
  { value: "drafted", label: "Drafted (gone pro)" },
  { value: "transferred_out", label: "Transferred to another school" },
  { value: "retired", label: "Retired" },
  { value: "graduated", label: "Graduated" },
];

function DepartureModal({
  guildId,
  players,
  onClose,
  onDone,
}: {
  guildId: string;
  players: RosterPlayer[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [status, setStatus] = useState<RosterDepartureStatus>("drafted");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!playerId) {
      setError("Pick a player.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.setPlayerDeparture({ guildId, playerId, status, note: note.trim() || null });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log departure.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Log a departing player" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">Player</span>
        <select className="form-input" value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.fullName} · {player.position} · {player.overallRating ?? "—"} OVR
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Reason</span>
        <select className="form-input" value={status} onChange={(event) => setStatus(event.target.value as RosterDepartureStatus)}>
          {DEPARTURE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Note (optional)</span>
        <input className="form-input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} />
      </label>
      <Button variant="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Log departure"}
      </Button>
    </Modal>
  );
}

function TransferInModal({
  guildId,
  teamId,
  onClose,
  onDone,
}: {
  guildId: string;
  teamId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [classYear, setClassYear] = useState("");
  const [overallRating, setOverallRating] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() || !lastName.trim() || !position.trim()) {
      setError("First name, last name, and position are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.addTransferInPlayer({
        guildId,
        teamId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        position: position.trim(),
        classYear: classYear || null,
        overallRating: overallRating.trim() ? Number(overallRating) : null,
        note: note.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log incoming transfer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Log an incoming transfer" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">First name</span>
        <input className="form-input" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">Last name</span>
        <input className="form-input" value={lastName} onChange={(event) => setLastName(event.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">Position</span>
        <input className="form-input" value={position} onChange={(event) => setPosition(event.target.value.toUpperCase())} placeholder="e.g. WR" />
      </label>
      <label className="form-field">
        <span className="form-label">Class (optional)</span>
        <select className="form-input" value={classYear} onChange={(event) => setClassYear(event.target.value)}>
          <option value="">Unknown</option>
          <option value="FR">Freshman</option>
          <option value="SO">Sophomore</option>
          <option value="JR">Junior</option>
          <option value="SR">Senior</option>
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Overall (optional)</span>
        <input className="form-input" type="number" min={0} max={99} value={overallRating} onChange={(event) => setOverallRating(event.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">Note (optional)</span>
        <input className="form-input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} placeholder="e.g. transferred in from another program" />
      </label>
      <Button variant="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Add to roster"}
      </Button>
    </Modal>
  );
}

export function RosterMovesPanel({
  guildId,
  teamId,
  activePlayers,
  departedPlayers,
  onChanged,
}: {
  guildId: string;
  teamId: string;
  activePlayers: RosterPlayer[];
  departedPlayers: RosterPlayer[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [departureOpen, setDepartureOpen] = useState(false);
  const [transferInOpen, setTransferInOpen] = useState(false);
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);

  async function reinstate(playerId: string) {
    setBusyPlayerId(playerId);
    try {
      await recApi.reinstatePlayer({ guildId, playerId });
      onChanged();
    } finally {
      setBusyPlayerId(null);
    }
  }

  return (
    <div className="hub-roster-moves">
      <button type="button" className="hub-roster-moves-toggle" onClick={() => setOpen((value) => !value)}>
        Roster moves {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="hub-roster-moves-body">
          <div className="hub-roster-moves-actions">
            <Button variant="secondary" size="compact" disabled={!activePlayers.length} onClick={() => setDepartureOpen(true)}>
              Log departure
            </Button>
            <Button variant="secondary" size="compact" onClick={() => setTransferInOpen(true)}>
              Log incoming transfer
            </Button>
          </div>
          {departedPlayers.length > 0 && (
            <div className="hub-roster-departed-list">
              <p className="hub-eyebrow">Recently departed</p>
              {departedPlayers.map((player) => (
                <div key={player.id} className="hub-roster-departed-row">
                  <span>
                    <strong>{player.fullName}</strong> · {player.position} · {player.rosterStatus.replace("_", " ")}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={busyPlayerId === player.id}
                    onClick={() => void reinstate(player.id)}
                  >
                    {busyPlayerId === player.id ? "Reinstating…" : "Reinstate"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {departureOpen && (
        <DepartureModal
          guildId={guildId}
          players={activePlayers}
          onClose={() => setDepartureOpen(false)}
          onDone={() => {
            setDepartureOpen(false);
            onChanged();
          }}
        />
      )}
      {transferInOpen && (
        <TransferInModal
          guildId={guildId}
          teamId={teamId}
          onClose={() => setTransferInOpen(false)}
          onDone={() => {
            setTransferInOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
