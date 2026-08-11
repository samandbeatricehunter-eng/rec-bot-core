import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { Modal } from "../../../components/ui/Modal.js";
import { REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, getRecAttributeDisplayName, getRecEditableAttributes, sortRecAttributeCodes, type RecGameFamily } from "@rec/shared";

function completeRatings(build: any) {
  const codes = getRecEditableAttributes(build.game_family as RecGameFamily, build.position, build.selected_archetype_key);
  // Older valid builds stored only explicitly edited ratings. Missing values mean the
  // universal floor, not zero; sending zero during review makes authoritative validation
  // reject the approval before the apply transaction can run.
  return Object.fromEntries(codes.map((code) => [code, Number(build.attributes?.[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR)]));
}

function HeightFields({ heightInches, onChange }: { heightInches: number; onChange: (heightInches: number) => void }) {
  const safeHeight = Math.max(60, Math.min(84, Number(heightInches) || 72));
  const feet = Math.floor(safeHeight / 12);
  const inches = safeHeight % 12;
  const inchOptions = feet === 7 ? [0] : Array.from({ length: 12 }, (_, value) => value);
  return <>
    <label>Height (ft)<select className="form-select" value={feet} onChange={(event) => {
      const nextFeet = Number(event.target.value);
      onChange(nextFeet * 12 + (nextFeet === 7 ? 0 : inches));
    }}>
      <option value={5}>5 ft</option>
      <option value={6}>6 ft</option>
      <option value={7}>7 ft</option>
    </select></label>
    <label>Height (in)<select className="form-select" value={feet === 7 ? 0 : inches} onChange={(event) => onChange(feet * 12 + Number(event.target.value))}>
      {inchOptions.map((value) => <option key={value} value={value}>{value} in</option>)}
    </select></label>
  </>;
}

// Single-build review UI — the identity/attribute-edit form a generic approve/deny modal
// can't offer. Shared by the full Settings > Purchases queue (every pending build at once)
// and CustomPlayerReviewModal (one build, opened straight from a Pending Items notification).
function CustomPlayerBuildRow({ build, edit, note, busy, onEditChange, onNoteChange, onReview }: {
  build: any;
  edit: { identity: any; attributes: Record<string, number> };
  note: string;
  busy: boolean;
  onEditChange: (patch: Record<string, unknown>) => void;
  onNoteChange: (value: string) => void;
  onReview: (action: "approve" | "reject") => void;
}) {
  const identity = edit.identity;
  const setIdentity = (key: string, value: unknown) => onEditChange({ identity: { ...identity, [key]: value } });
  return <div className="settings-review-row">
    <div>
      <strong>{identity.firstName} {identity.lastName}</strong> · {build.position} · {build.estimated_ovr} OVR
      <p className="form-hint">{String(build.package_key).replaceAll("_", " ")} · {build.coin_price} coins · {build.creation_points_spent}/{build.creation_point_budget} CP · {build.unused_cp_refund_coins} coin refund</p>
      <p className="form-hint">Replacing: {build.replacement_player_snapshot?.full_name ?? "Unknown player"} · {build.replacement_player_snapshot?.position ?? "—"} · {build.replacement_player_snapshot?.overall_rating ?? "—"} OVR</p>
    </div>
    <p className="form-hint"><strong>88 OVR ceiling:</strong> if the created player exceeds 88 OVR, ratings must be reduced before approval. All commissioner edits are logged and sent to the purchaser.</p>
    <div className="custom-player-fields">
      <label>First name<input className="form-input" value={identity.firstName ?? ""} onChange={(event) => setIdentity("firstName", event.target.value)} /></label>
      <label>Last name<input className="form-input" value={identity.lastName ?? ""} onChange={(event) => setIdentity("lastName", event.target.value)} /></label>
      <label>Jersey #<input className="form-input" type="number" min={0} max={99} value={identity.jerseyNumber ?? 0} onChange={(event) => setIdentity("jerseyNumber", Number(event.target.value))} /></label>
      <label>Hand<select className="form-select" value={identity.handedness ?? "right"} onChange={(event) => setIdentity("handedness", event.target.value)}><option value="right">Right</option><option value="left">Left</option></select></label>
      <HeightFields heightInches={identity.heightInches ?? 72} onChange={(value) => setIdentity("heightInches", value)} />
      <label>Weight (lb)<input className="form-input" type="number" min={140} max={400} value={identity.weightLbs ?? 200} onChange={(event) => setIdentity("weightLbs", Number(event.target.value))} /></label>
      {build.game_family !== "CFB" ? <><label>Hometown<input className="form-input" value={identity.hometownCity ?? ""} onChange={(event) => setIdentity("hometownCity", event.target.value)} /></label><label>State<input className="form-input" value={identity.hometownState ?? ""} onChange={(event) => setIdentity("hometownState", event.target.value)} /></label><label>College<input className="form-input" value={identity.college ?? ""} onChange={(event) => setIdentity("college", event.target.value)} /></label></> : null}
    </div>
    <p className="form-hint"><strong>Locked purchase selections:</strong> {build.position}{build.game_family !== "CFB" ? ` · ${build.development_trait}` : ""}. Commissioners cannot change these during approval.</p>
    <h4>Submitted Ratings</h4>
    <div className="custom-player-fields">{sortRecAttributeCodes(Object.keys(edit.attributes ?? {})).map((code) => <label key={code}>{getRecAttributeDisplayName(code)} ({code.toUpperCase()})<input className="form-input" type="number" min={0} max={99} value={Number(edit.attributes[code])} onChange={(event) => onEditChange({ attributes: { ...edit.attributes, [code]: Math.max(0, Math.min(99, Number(event.target.value))) } })} /></label>)}</div>
    <textarea className="form-input" rows={2} placeholder="Commissioner note or required rejection reason" value={note} onChange={(event) => onNoteChange(event.target.value)} />
    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
      <Button variant="primary" disabled={busy} onClick={() => onReview("approve")}>Approve &amp; Apply</Button>
      <Button variant="danger" disabled={busy} onClick={() => onReview("reject")}>Reject &amp; Refund</Button>
    </div>
  </div>;
}

export function CustomPlayerReviewQueue({ guildId }: { guildId: string }) {
  const [builds, setBuilds] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const result = await recApi.listCustomPlayerBuilds(guildId, true);
    const pending = (result.builds ?? []).filter((build: any) => build.status === "pending_review");
    setBuilds(pending);
    setEdits((current) => Object.fromEntries(pending.map((build: any) => [build.id, current[build.id] ?? { identity: build.identity, attributes: completeRatings(build) }] )));
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, [guildId]);

  async function review(buildId: string, action: "approve" | "reject") {
    if (action === "reject" && !notes[buildId]?.trim()) { setMessage("A rejection reason is required."); return; }
    setBusy(buildId); setMessage(null);
    try {
      await recApi.reviewCustomPlayer({ guildId, buildId, action, note: notes[buildId]?.trim() || undefined, adjustments: action === "approve" ? edits[buildId] : undefined });
      setMessage(action === "approve" ? "Custom player approved, applied, and refunded for unused creation points." : "Custom player rejected and the package price refunded.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }

  return <Card>
    <h3>Custom Player Review</h3>
    <p className="form-hint">Approval immediately replaces the selected roster player. The transaction rolls back completely if any roster, wallet, purchase, or audit update fails.</p>
    {message && <p>{message}</p>}
    {!builds.length ? <p className="form-hint">No custom-player builds are awaiting review.</p> : builds.map((build) => {
      const edit = edits[build.id] ?? { identity: build.identity ?? {}, attributes: completeRatings(build) };
      return (
        <CustomPlayerBuildRow
          key={build.id}
          build={build}
          edit={edit}
          note={notes[build.id] ?? ""}
          busy={busy === build.id}
          onEditChange={(patch) => setEdits((current) => ({ ...current, [build.id]: { ...edit, ...patch } }))}
          onNoteChange={(value) => setNotes((current) => ({ ...current, [build.id]: value }))}
          onReview={(action) => void review(build.id, action)}
        />
      );
    })}
  </Card>;
}

// Opened straight from a Pending Items notification click (matching how Legend purchases
// already show their details inline) instead of navigating away to Settings > Purchases.
export function CustomPlayerReviewModal({ guildId, buildId, onClose, onResolved }: { guildId: string; buildId: string; onClose: () => void; onResolved: () => void }) {
  const [build, setBuild] = useState<any | null | undefined>(undefined);
  const [edit, setEdit] = useState<{ identity: any; attributes: Record<string, number> } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    recApi.listCustomPlayerBuilds(guildId, true)
      .then((result) => {
        const found = (result.builds ?? []).find((b: any) => b.id === buildId) ?? null;
        setBuild(found);
        if (found) setEdit({ identity: found.identity ?? {}, attributes: completeRatings(found) });
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [guildId, buildId]);

  async function review(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) { setMessage("A rejection reason is required."); return; }
    setBusy(true); setMessage(null);
    try {
      await recApi.reviewCustomPlayer({ guildId, buildId, action, note: note.trim() || undefined, adjustments: action === "approve" && edit ? { identity: edit.identity, attributes: edit.attributes } : undefined });
      onResolved();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }

  return (
    <Modal title="Custom Player Review" onClose={onClose}>
      {message && <p>{message}</p>}
      {build === undefined && <p className="form-hint">Loading…</p>}
      {build === null && <p className="form-hint">This build is no longer pending review (already approved, rejected, or withdrawn).</p>}
      {build && edit && (
        <CustomPlayerBuildRow
          build={build}
          edit={edit}
          note={note}
          busy={busy}
          onEditChange={(patch) => setEdit((current) => (current ? { ...current, ...patch } : current))}
          onNoteChange={setNote}
          onReview={(action) => void review(action)}
        />
      )}
    </Modal>
  );
}
