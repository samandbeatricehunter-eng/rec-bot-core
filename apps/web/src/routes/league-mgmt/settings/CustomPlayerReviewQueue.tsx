import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { getRecAttributeDisplayName, getRecEditableAttributes, type RecGameFamily } from "@rec/shared";

function completeRatings(build: any) {
  const codes = getRecEditableAttributes(build.game_family as RecGameFamily, build.position, build.selected_archetype_key);
  return Object.fromEntries(codes.map((code) => [code, Number(build.attributes?.[code] ?? 0)]));
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
      const identity = build.identity ?? {};
      const edit = edits[build.id] ?? { identity, attributes: completeRatings(build) };
      const setEdit = (patch: Record<string, unknown>) => setEdits((current) => ({ ...current, [build.id]: { ...edit, ...patch } }));
      const setIdentity = (key: string, value: unknown) => setEdit({ identity: { ...edit.identity, [key]: value } });
      return <div key={build.id} className="settings-review-row">
        <div>
          <strong>{identity.firstName} {identity.lastName}</strong> · {build.position} · {build.estimated_ovr} OVR
          <p className="form-hint">{String(build.package_key).replaceAll("_", " ")} · {build.coin_price} coins · {build.creation_points_spent}/{build.creation_point_budget} CP · {build.unused_cp_refund_coins} coin refund</p>
          <p className="form-hint">Replacing: {build.replacement_player_snapshot?.full_name ?? "Unknown player"} · {build.replacement_player_snapshot?.position ?? "—"} · {build.replacement_player_snapshot?.overall_rating ?? "—"} OVR</p>
        </div>
        <p className="form-hint"><strong>88 OVR ceiling:</strong> if the created player exceeds 88 OVR, ratings must be reduced before approval. All commissioner edits are logged and sent to the purchaser.</p>
        <div className="custom-player-fields">
          <label>First name<input className="form-input" value={edit.identity.firstName ?? ""} onChange={(event) => setIdentity("firstName", event.target.value)} /></label>
          <label>Last name<input className="form-input" value={edit.identity.lastName ?? ""} onChange={(event) => setIdentity("lastName", event.target.value)} /></label>
          <label>Jersey #<input className="form-input" type="number" min={0} max={99} value={edit.identity.jerseyNumber ?? 0} onChange={(event) => setIdentity("jerseyNumber", Number(event.target.value))} /></label>
          <label>Hand<select className="form-select" value={edit.identity.handedness ?? "right"} onChange={(event) => setIdentity("handedness", event.target.value)}><option value="right">Right</option><option value="left">Left</option></select></label>
          <label>Height (in)<input className="form-input" type="number" min={60} max={84} value={edit.identity.heightInches ?? 72} onChange={(event) => setIdentity("heightInches", Number(event.target.value))} /></label>
          <label>Weight (lb)<input className="form-input" type="number" min={140} max={400} value={edit.identity.weightLbs ?? 200} onChange={(event) => setIdentity("weightLbs", Number(event.target.value))} /></label>
          {build.game_family !== "CFB" ? <><label>Hometown<input className="form-input" value={edit.identity.hometownCity ?? ""} onChange={(event) => setIdentity("hometownCity", event.target.value)} /></label><label>State<input className="form-input" value={edit.identity.hometownState ?? ""} onChange={(event) => setIdentity("hometownState", event.target.value)} /></label><label>College<input className="form-input" value={edit.identity.college ?? ""} onChange={(event) => setIdentity("college", event.target.value)} /></label></> : null}
        </div>
        <p className="form-hint"><strong>Locked purchase selections:</strong> {build.position} · {String(build.selected_archetype_key).replaceAll("_", " ")} · {build.development_trait}. Commissioners cannot change these during approval.</p>
        <h4>Submitted Ratings</h4>
        <div className="custom-player-fields">{Object.entries(edit.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([code, rating]) => <label key={code}>{getRecAttributeDisplayName(code)} ({code.toUpperCase()})<input className="form-input" type="number" min={0} max={99} value={Number(rating)} onChange={(event) => setEdit({ attributes: { ...edit.attributes, [code]: Math.max(0, Math.min(99, Number(event.target.value))) } })} /></label>)}</div>
        <textarea className="form-input" rows={2} placeholder="Commissioner note or required rejection reason" value={notes[build.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [build.id]: event.target.value }))} />
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Button variant="primary" disabled={busy === build.id} onClick={() => void review(build.id, "approve")}>Approve &amp; Apply</Button>
          <Button variant="danger" disabled={busy === build.id} onClick={() => void review(build.id, "reject")}>Reject &amp; Refund</Button>
        </div>
      </div>;
    })}
  </Card>;
}
