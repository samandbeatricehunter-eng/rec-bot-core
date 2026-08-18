import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { Modal } from "../../../components/ui/Modal.js";
import { REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, customPlayerRenderPublicUrl, getRecAttributeDisplayName, getRecEditableAttributes, sortRecAttributeCodes, type RecGameFamily } from "@rec/shared";

function completeRatings(build: any) {
  const codes = getRecEditableAttributes(build.game_family as RecGameFamily, build.position, build.selected_archetype_key);
  // Older valid builds stored only explicitly edited ratings. Missing values mean the
  // universal floor, not zero; sending zero during review makes authoritative validation
  // reject the approval before the apply transaction can run.
  return Object.fromEntries(codes.map((code) => [code, Number(build.attributes?.[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR)]));
}

function formatCandidate(player: {
  id: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  position: string;
  overall_rating: number | null;
}) {
  const name = player.full_name || `${player.first_name} ${player.last_name}`.trim();
  const ovr = player.overall_rating != null ? `${player.overall_rating} OVR` : "— OVR";
  return `${player.position} ${name} · ${ovr}`;
}

// Single-build review UI — approve/reject only, the submitted identity and ratings are
// applied as-is (commissioners cannot alter attribute values or details). Shared by the
// full Settings > Purchases queue (every pending build at once) and CustomPlayerReviewModal
// (one build, opened straight from a Pending Items notification).
function CustomPlayerBuildRow({
  guildId,
  build,
  note,
  busy,
  onNoteChange,
  onReview,
}: {
  guildId: string;
  build: any;
  note: string;
  busy: boolean;
  onNoteChange: (value: string) => void;
  onReview: (action: "approve" | "reject", replacementPlayerId?: string | null) => void;
}) {
  const identity = build.identity ?? {};
  const ratings = completeRatings(build);
  const buyerChose = Boolean(build.replacement_player_id);
  const isMadden = String(build.game_family) === "MADDEN";
  const [candidates, setCandidates] = useState<Array<{
    id: string;
    full_name: string | null;
    first_name: string;
    last_name: string;
    position: string;
    overall_rating: number | null;
  }> | null>(null);
  const [selectedReplacementId, setSelectedReplacementId] = useState(String(build.replacement_player_id ?? ""));
  const [candidateError, setCandidateError] = useState<string | null>(null);

  useEffect(() => {
    if (!isMadden || buyerChose) return;
    let cancelled = false;
    recApi.listCustomReplacementCandidates({ guildId, buildId: build.id })
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.replacementPlayers);
        if (!selectedReplacementId && result.replacementPlayers[0]) {
          setSelectedReplacementId(result.replacementPlayers[0].id);
        }
      })
      .catch((error) => {
        if (!cancelled) setCandidateError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [guildId, build.id, isMadden, buyerChose]);

  return <div className="settings-review-row">
    {identity.cardRenderId ? (
      <div className="custom-player-review-face">
        <img src={customPlayerRenderPublicUrl(identity.cardRenderId)} alt="Selected card headshot" />
        <span>Chosen headshot ({String(identity.bodyType ?? "").toLowerCase() || "standard"} build)</span>
      </div>
    ) : null}
    <div>
      <strong>{identity.firstName} {identity.lastName}</strong> · {build.position}
      <p className="form-hint">{String(build.package_key).replaceAll("_", " ")} · {build.coin_price} coins · {build.creation_points_spent}/{build.creation_point_budget} CP · {build.unused_cp_refund_coins > 0 ? "500-coin unspent CP reward" : "no unspent CP reward"}</p>
      {buyerChose ? (
        <p className="form-hint">
          Replacing: {build.replacement_player_snapshot?.full_name ?? "Unknown player"} · {build.replacement_player_snapshot?.position ?? "—"} · {build.replacement_player_snapshot?.overall_rating ?? "—"} OVR
          {" "}(permanently removed on approve &amp; apply)
        </p>
      ) : isMadden ? (
        <p className="form-hint">Buyer left the replaced player up to you — optionally choose one below (lowest OVR first). Recreate this player on any roster slot in Madden and the next import matches it by name regardless of what's picked here.</p>
      ) : (
        <p className="form-hint">No replacement player designated (new roster add).</p>
      )}
    </div>
    {isMadden && !buyerChose && (
      <label className="form-field">
        <span className="form-label">Replace roster player</span>
        <select
          className="form-select"
          value={selectedReplacementId}
          onChange={(event) => setSelectedReplacementId(event.target.value)}
          disabled={!candidates?.length}
        >
          <option value="">{candidates?.length ? "Select a player" : "Loading roster…"}</option>
          {(candidates ?? []).map((player) => (
            <option key={player.id} value={player.id}>{formatCandidate(player)}</option>
          ))}
        </select>
        {candidateError && <p className="form-hint">{candidateError}</p>}
      </label>
    )}
    <p className="form-hint">Review is approve/reject only — the submitted identity and ratings are applied exactly as the buyer built them.</p>
    <div className="custom-player-fields">
      <span className="form-label">First name: <strong>{identity.firstName ?? ""}</strong></span>
      <span className="form-label">Last name: <strong>{identity.lastName ?? ""}</strong></span>
      <span className="form-label">Jersey #: <strong>{identity.jerseyNumber ?? 0}</strong></span>
      <span className="form-label">Hand: <strong>{identity.handedness ?? "right"}</strong></span>
      <span className="form-label">Height: <strong>{identity.heightInches ? `${Math.floor(identity.heightInches / 12)}'${identity.heightInches % 12}"` : "—"}</strong></span>
      <span className="form-label">Weight: <strong>{identity.weightLbs ?? "—"} lb</strong></span>
      {build.game_family !== "CFB" ? <>
        <span className="form-label">Hometown: <strong>{identity.hometownCity || "—"}</strong></span>
        <span className="form-label">State: <strong>{identity.hometownState || "—"}</strong></span>
        <span className="form-label">College: <strong>{identity.college || "—"}</strong></span>
      </> : null}
    </div>
    <p className="form-hint"><strong>Locked purchase selections:</strong> {build.position}{build.game_family !== "CFB" ? ` · ${build.development_trait}` : ""}. Commissioners cannot change these during approval.</p>
    <h4>Submitted Ratings</h4>
    <div className="custom-player-fields">{sortRecAttributeCodes(Object.keys(ratings)).map((code) => <span key={code} className="form-label">{getRecAttributeDisplayName(code)} ({code.toUpperCase()}): <strong>{ratings[code]}</strong></span>)}</div>
    <textarea className="form-input" rows={2} placeholder="Commissioner note or required rejection reason" value={note} onChange={(event) => onNoteChange(event.target.value)} />
    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => onReview("approve", isMadden && !buyerChose ? selectedReplacementId || null : build.replacement_player_id ?? null)}
      >
        Approve &amp; Apply
      </Button>
      <Button variant="danger" disabled={busy} onClick={() => onReview("reject")}>Reject &amp; Refund</Button>
    </div>
  </div>;
}

export function CustomPlayerReviewQueue({ guildId }: { guildId: string }) {
  const [builds, setBuilds] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const result = await recApi.listCustomPlayerBuilds(guildId, true);
    const pending = (result.builds ?? []).filter((build: any) => build.status === "pending_review");
    setBuilds(pending);
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, [guildId]);

  async function review(buildId: string, action: "approve" | "reject", replacementPlayerId?: string | null) {
    if (action === "reject" && !notes[buildId]?.trim()) { setMessage("A rejection reason is required."); return; }
    setBusy(buildId); setMessage(null);
    try {
      const isMadden = String(builds.find((b: any) => b.id === buildId)?.game_family) === "MADDEN";
      await recApi.reviewCustomPlayer({
        guildId,
        buildId,
        action,
        note: notes[buildId]?.trim() || undefined,
        replacementPlayerId: action === "approve" ? replacementPlayerId : undefined,
      });
      setMessage(action === "approve"
        ? (isMadden
          ? "Custom player approved. It goes live once the buyer's commissioner recreates them in Madden and re-imports."
          : "Custom player approved and applied. Any earned unspent CP reward was credited.")
        : "Custom player rejected and the package price refunded.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }

  return <Card>
    <h3>Custom Player Review</h3>
    <p className="form-hint">CFB approval immediately replaces the selected roster player. Madden approval only locks in the designated replacement — the swap goes live once the commissioner recreates the player in-game and re-imports. Either way, the transaction rolls back completely if any roster, wallet, purchase, or audit update fails.</p>
    {message && <p>{message}</p>}
    {!builds.length ? <p className="form-hint">No custom-player builds are awaiting review.</p> : builds.map((build) => {
      return (
        <CustomPlayerBuildRow
          key={build.id}
          guildId={guildId}
          build={build}
          note={notes[build.id] ?? ""}
          busy={busy === build.id}
          onNoteChange={(value) => setNotes((current) => ({ ...current, [build.id]: value }))}
          onReview={(action, replacementPlayerId) => void review(build.id, action, replacementPlayerId)}
        />
      );
    })}
  </Card>;
}

// Opened straight from a Pending Items notification click (matching how Legend purchases
// already show their details inline) instead of navigating away to Settings > Purchases.
export function CustomPlayerReviewModal({ guildId, buildId, onClose, onResolved }: { guildId: string; buildId: string; onClose: () => void; onResolved: () => void }) {
  const [build, setBuild] = useState<any | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    recApi.listCustomPlayerBuilds(guildId, true)
      .then((result) => {
        const found = (result.builds ?? []).find((b: any) => b.id === buildId) ?? null;
        setBuild(found);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [guildId, buildId]);

  async function review(action: "approve" | "reject", replacementPlayerId?: string | null) {
    if (action === "reject" && !note.trim()) { setMessage("A rejection reason is required."); return; }
    setBusy(true); setMessage(null);
    try {
      await recApi.reviewCustomPlayer({
        guildId,
        buildId,
        action,
        note: note.trim() || undefined,
        replacementPlayerId: action === "approve" ? replacementPlayerId : undefined,
      });
      onResolved();
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }

  return (
    <Modal title="Custom Player Review" onClose={onClose}>
      {message && <p>{message}</p>}
      {build === undefined && <p className="form-hint">Loading…</p>}
      {build === null && <p className="form-hint">This build is no longer pending review (already approved, rejected, or withdrawn).</p>}
      {build && (
        <CustomPlayerBuildRow
          guildId={guildId}
          build={build}
          note={note}
          busy={busy}
          onNoteChange={setNote}
          onReview={(action, replacementPlayerId) => void review(action, replacementPlayerId)}
        />
      )}
    </Modal>
  );
}
