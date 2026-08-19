import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Opened from the "Review Offers" button once an opponent has proposed a kickoff time -- one
// place to Accept, Counter (hands off to ProposeTimeModal in counter mode), or Reject outright.
export function ReviewOffersModal({
  proposedFor, busy, error, onClose, onAccept, onReject, onCounter,
}: {
  proposedFor: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCounter: () => void;
}) {
  return (
    <Modal title="Review Offer" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <p>Your opponent proposed kickoff: <strong>{fmt(proposedFor)}</strong></p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Button variant="primary" size="compact" disabled={busy} onClick={onAccept}>Accept</Button>
        <Button variant="secondary" size="compact" disabled={busy} onClick={onCounter}>Counter</Button>
        <Button variant="ghost" size="compact" disabled={busy} onClick={onReject}>Reject</Button>
      </div>
    </Modal>
  );
}
