import { useState } from "react";
import { CFB_POSITIONS } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

// "Edit Roster" My Team quick action — for a user who doesn't track recruits but still needs
// to get a signed/acquired player onto their roster. Commissioners get an immediate add;
// everyone else's submission queues for commissioner review (see roster-add-requests.service.ts).
export function EditRosterRequestModal({ guildId, onClose, onDone }: { guildId: string; onClose: () => void; onDone: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [overallRating, setOverallRating] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() || !lastName.trim() || !position) {
      setError("First name, last name, and position are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.submitRosterAddRequest({
        guildId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        position,
        heightInches: heightInches.trim() ? Number(heightInches) : null,
        weightLbs: weightLbs.trim() ? Number(weightLbs) : null,
        overallRating: overallRating.trim() ? Number(overallRating) : null,
      });
      if (result.status === "approved") {
        setNotice(`${firstName} ${lastName} was added to your roster.`);
      } else {
        setNotice(`Request submitted — a commissioner will review adding ${firstName} ${lastName} to your roster.`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit roster addition.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Roster" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {notice ? (
        <>
          <p className="form-hint">{notice}</p>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      ) : (
        <>
          <p className="form-hint">
            Add a player who signed or joined your roster without going through the Recruiting Board.
          </p>
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
            <select className="form-input" value={position} onChange={(event) => setPosition(event.target.value)}>
              <option value="">Select position</option>
              {CFB_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Current OVR (optional)</span>
            <input className="form-input" type="number" min={0} max={99} value={overallRating} onChange={(event) => setOverallRating(event.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">Height, inches (optional)</span>
            <input className="form-input" type="number" min={60} max={84} value={heightInches} onChange={(event) => setHeightInches(event.target.value)} placeholder="e.g. 74" />
          </label>
          <label className="form-field">
            <span className="form-label">Weight, lbs (optional)</span>
            <input className="form-input" type="number" min={100} max={450} value={weightLbs} onChange={(event) => setWeightLbs(event.target.value)} />
          </label>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Submitting…" : "Submit"}
          </Button>
        </>
      )}
    </Modal>
  );
}
