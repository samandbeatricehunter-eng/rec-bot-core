import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type ProspectReviewPayload = {
  prospectId: string;
  side: "offense" | "defense";
  position: string;
  name: string;
  firstName: string;
  lastName: string;
  age: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  bodyType: string | null;
  hometown: string | null;
  hometownState: string | null;
  college: string | null;
  jerseyNumber: number | null;
  startingDev: string;
  throwingMotionKey: string | null;
  personaLabel: string | null;
  playstyleArchetype: string | null;
  playstyleSecondary: string | null;
  personaDnaTraits: string[];
  playerTraits: string[];
  characteristics: string[];
  // Already in MADDEN_ATTRIBUTE_DEFINITIONS (in-game) order -- see submitProspectForReview.
  attributes: Array<{ code: string; name: string; value: number }>;
};

function formatHeight(inches: number | null): string {
  if (!inches) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

// Opened from a Notifications pending item (type "immortality_prospect") -- the full build
// snapshot already lives in the notification's own payload (captured at Creation Points
// submission time), so this needs no extra fetch, unlike custom-player review.
export function ImmortalityProspectReviewModal({
  guildId, notification, onClose, onResolved,
}: {
  guildId: string;
  notification: CommissionerNotification;
  onClose: () => void;
  onResolved: () => void;
}) {
  const data = notification.payload as unknown as ProspectReviewPayload;
  const [note, setNote] = useState("");
  const [firstName, setFirstName] = useState(data.firstName ?? "");
  const [lastName, setLastName] = useState(data.lastName ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nameChanged = firstName.trim() !== (data.firstName ?? "") || lastName.trim() !== (data.lastName ?? "");

  async function review(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) { setMessage("A rejection reason is required."); return; }
    if (!firstName.trim() || !lastName.trim()) { setMessage("First and last name can't be blank."); return; }
    setBusy(true); setMessage(null);
    try {
      await recApi.reviewImmortalityProspect({
        guildId, prospectId: data.prospectId, action, note: note.trim() || undefined,
        firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined,
      });
      onResolved();
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }

  return (
    <Modal title={`${data.side === "offense" ? "Offensive" : "Defensive"} Prospect Review`} onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      {message && <ErrorState message={message} />}
      <div className="settings-review-row">
        <h3 style={{ margin: 0 }}>{data.name} — {data.position}</h3>
        <p className="form-hint" style={{ margin: "4px 0 8px" }}>
          This player is already live and eligible for team selection — this is just your build sheet to recreate them in-game. Fix the name here first if Madden's filter would block it as vulgar; it updates everywhere, including an already-posted player card.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <label className="form-field" style={{ flex: 1 }}>
            <span className="form-label">First name</span>
            <input className="form-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            <span className="form-label">Last name</span>
            <input className="form-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        {nameChanged && <p className="form-hint" style={{ margin: "0 0 12px", color: "var(--warning, #b8860b)" }}>Renaming to "{firstName.trim()} {lastName.trim()}" — applied when you Approve or Reject.</p>}
        <p className="form-hint" style={{ margin: "4px 0 12px" }}>
          Age {data.age ?? "?"} · {formatHeight(data.heightInches)} · {data.weightLbs ?? "?"} lbs · {data.bodyType ?? "—"} · Jersey #{data.jerseyNumber ?? "?"}
          <br />
          {data.hometown ?? "—"}{data.hometownState ? `, ${data.hometownState}` : ""}{data.college ? ` · ${data.college}` : ""}
          <br />
          Starting Dev Trait: <strong>{data.startingDev}</strong>
          {data.throwingMotionKey ? <> · Throwing Motion: <strong>{data.throwingMotionKey}</strong></> : null}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
          {data.attributes.map((attr) => (
            <div key={attr.code} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span className="form-hint">{attr.code} {attr.name}</span>
              <strong>{attr.value}</strong>
            </div>
          ))}
        </div>

        <p style={{ margin: "0 0 4px" }}><strong>Persona:</strong> {data.personaLabel ?? "—"}</p>
        <p style={{ margin: "0 0 4px" }}><strong>Playstyle:</strong> {data.playstyleArchetype ?? "—"}{data.playstyleSecondary ? ` / ${data.playstyleSecondary}` : ""}</p>
        <p style={{ margin: "0 0 4px" }}><strong>Persona DNA:</strong> {data.personaDnaTraits.join(", ") || "—"}</p>
        {data.playerTraits.length > 0 && <p style={{ margin: "0 0 4px" }}><strong>Player Traits:</strong> {data.playerTraits.join(", ")}</p>}
        <p style={{ margin: "0 0 12px" }}><strong>Natural Characteristics:</strong> {data.characteristics.join(", ") || "—"}</p>

        <label className="form-label" htmlFor="prospect-review-note">Note (required to reject)</label>
        <textarea id="prospect-review-note" className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason this build is unacceptable" />
        <p className="form-hint" style={{ margin: "4px 0 0" }}>
          Rejecting removes this player's owner from the league entirely — use it only when the submission itself is the problem.
        </p>

        <div className="fantasy-draft-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <Button variant="danger" disabled={busy} onClick={() => void review("reject")}>Reject &amp; Remove From League</Button>
          <Button variant="primary" disabled={busy} onClick={() => void review("approve")}>Applied In Game</Button>
        </div>
      </div>
    </Modal>
  );
}
