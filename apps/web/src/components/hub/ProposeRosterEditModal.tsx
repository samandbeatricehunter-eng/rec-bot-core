import { useMemo, useState } from "react";
import { CFB_POSITIONS, REC_DEV_TRAITS, getRecAttributeDisplayName, getRecEditableAttributes, sortRecAttributeCodes } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterPlayer } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const MADDEN_EDIT_POSITIONS = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "K", "P", "LS"] as const;

// Manual Entry mode's self-service roster editing — propose a change to one of your own
// players (position, jersey #, dev trait/archetype, attributes). A commissioner reviews and
// approves or rejects it; nothing changes on the roster until then. Always submits the FULL
// current attribute set (not just what changed) since the backend applies attributes as a
// full replace, not a merge.
export function ProposeRosterEditModal({ guildId, player, isMadden, onClose, onSubmitted }: {
  guildId: string;
  player: RosterPlayer;
  isMadden: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [position, setPosition] = useState(player.position || "");
  const [jerseyNumber, setJerseyNumber] = useState(player.jerseyNumber != null ? String(player.jerseyNumber) : "");
  const [devTrait, setDevTrait] = useState(player.devTrait ?? "");
  const [archetype, setArchetype] = useState(player.archetype ?? "");
  const [attributes, setAttributes] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [code, value] of Object.entries(player.attributes)) if (typeof value === "number") out[code] = value;
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editableCodes = useMemo(
    () => sortRecAttributeCodes(getRecEditableAttributes(isMadden ? "MADDEN" : "CFB", position, archetype || undefined)),
    [isMadden, position, archetype],
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await recApi.submitRosterEditProposal({
        guildId,
        playerId: player.id,
        position: position || undefined,
        jerseyNumber: jerseyNumber === "" ? null : Number(jerseyNumber),
        devTrait: isMadden ? (devTrait || null) : undefined,
        archetype: archetype.trim() || null,
        attributes,
      });
      setNotice("Proposal submitted — your commissioner will review it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit that proposal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Propose Edit — ${player.fullName}`} onClose={onClose}>
      {error && <ErrorState message={error} />}
      {notice ? (
        <>
          <p className="form-hint">{notice}</p>
          <Button variant="primary" onClick={() => { onSubmitted(); onClose(); }}>Done</Button>
        </>
      ) : (
        <>
          <p className="form-hint">Changes take effect only after your commissioner approves this proposal.</p>
          <div className="fantasy-draft-form-grid">
            <label>Position<select className="form-input" value={position} onChange={(e) => setPosition(e.target.value)}>
              {(isMadden ? MADDEN_EDIT_POSITIONS : CFB_POSITIONS).map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select></label>
            <label>Jersey #<input className="form-input" type="number" min="0" max="99" value={jerseyNumber} onChange={(e) => setJerseyNumber(e.target.value)} /></label>
            <label>Archetype<input className="form-input" value={archetype} placeholder="e.g. Field General" onChange={(e) => setArchetype(e.target.value)} /></label>
            {isMadden && (
              <label>Development trait<select className="form-input" value={devTrait} onChange={(e) => setDevTrait(e.target.value)}>
                <option value="">—</option>
                {REC_DEV_TRAITS.MADDEN.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
              </select></label>
            )}
          </div>
          <div className="fantasy-draft-form-grid" style={{ marginTop: "var(--space-3)" }}>
            {editableCodes.map((code) => (
              <label key={code}>{getRecAttributeDisplayName(code)}
                <input className="form-input" type="number" min={0} max={99}
                  value={attributes[code] ?? 0}
                  onChange={(e) => setAttributes((current) => ({ ...current, [code]: Math.max(0, Math.min(99, Number(e.target.value) || 0)) }))}
                />
              </label>
            ))}
          </div>
          <div style={{ marginTop: "var(--space-3)" }}>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit Proposal"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
