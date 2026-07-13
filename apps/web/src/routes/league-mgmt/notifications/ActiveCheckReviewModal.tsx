import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ActiveCheckCandidate, ActiveCheckReview } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// Mirrors the Discord flow's boot list exactly (apps/bot/src/flows/active-check.ts): every
// missed/kick-me candidate defaults to "boot" — unchecking a box "keeps" that person instead.
// Applying calls unlinkTeam (same as the Discord boot button does) + marks them booted; kept
// users get keepActiveCheckUsers. Finishing the review resolves the inbox notification.
export function ActiveCheckReviewModal({
  eventId,
  onClose,
  onResolved,
}: {
  eventId: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { guildId } = useReadyAuth();
  const [review, setReview] = useState<ActiveCheckReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  function load() {
    recApi
      .getActiveCheckReview({ guildId, eventId })
      .then(setReview)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load active check review."));
  }

  useEffect(load, [guildId, eventId]);

  function toggleKeep(discordId: string) {
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(discordId)) next.delete(discordId);
      else next.add(discordId);
      return next;
    });
  }

  async function handleApply() {
    if (!review) return;
    setBusy(true);
    setError(null);
    const candidates: ActiveCheckCandidate[] = [...review.inactive, ...review.kickMe];
    const keepIds = candidates.filter((c) => kept.has(c.discordId)).map((c) => c.discordId);
    const bootCandidates = candidates.filter((c) => !kept.has(c.discordId));
    try {
      if (keepIds.length) await recApi.keepActiveCheckUsers({ guildId, eventId, discordIds: keepIds });
      for (const candidate of bootCandidates) {
        await recApi.unlinkTeam({ guildId, teamId: candidate.teamId }).catch(() => undefined);
      }
      if (bootCandidates.length) {
        await recApi.markActiveCheckBooted({ guildId, eventId, discordIds: bootCandidates.map((c) => c.discordId) });
      }
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply active check decisions.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    setBusy(true);
    try {
      await recApi.finishActiveCheckReview({ guildId, eventId });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close out this active check.");
      setBusy(false);
    }
  }

  const candidates = review ? [...review.inactive, ...review.kickMe] : [];

  return (
    <Modal title="Active Check Review" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!review && !error && <LoadingState />}
      {review && (
        <div>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Everyone below missed the check or asked to leave. They're boot-listed by default — check a box to keep that coach instead.
          </p>
          {candidates.length === 0 && <p style={{ color: "var(--text-secondary)" }}>Nobody missed this check.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            {candidates.map((c) => (
              <label key={c.discordId} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input type="checkbox" checked={kept.has(c.discordId)} onChange={() => toggleKeep(c.discordId)} disabled={busy || applied} />
                <span>{c.teamName} — &lt;@{c.discordId}&gt;</span>
              </label>
            ))}
          </div>

          {!applied && candidates.length > 0 && (
            <Button variant="primary" onClick={handleApply} disabled={busy}>
              {busy ? "Applying…" : "Apply Decisions"}
            </Button>
          )}
          {(applied || candidates.length === 0) && (
            <div>
              {applied && <p style={{ color: "var(--success)" }}>Decisions applied.</p>}
              <Button variant="primary" onClick={handleFinish} disabled={busy}>
                {busy ? "Closing…" : "Finish Review"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
