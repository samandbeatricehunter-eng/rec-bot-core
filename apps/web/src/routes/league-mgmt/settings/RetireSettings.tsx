import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { useHubChrome } from "../../../lib/hub-chrome-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Candidate = { userId: string; displayName: string; teamName: string | null; role: string };

export function RetireSettings() {
  const { guildId } = useReadyAuth();
  const hubChrome = useHubChrome();
  const [isHeadCommissioner, setIsHeadCommissioner] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    recApi.getCommissionerRetireContext(guildId)
      .then((result) => {
        if (cancelled) return;
        setIsHeadCommissioner(result.isHeadCommissioner);
        setCandidates(result.candidates);
        setTransferToUserId((current) => current || result.candidates[0]?.userId || "");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load retire options.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]);

  const needsSuccessor = isHeadCommissioner;
  const canRetire = !needsSuccessor || Boolean(transferToUserId);

  async function confirmRetire() {
    setBusy(true);
    setError(null);
    try {
      await recApi.retireAsCommissioner({
        guildId,
        transferToUserId: needsSuccessor ? transferToUserId : null,
      });
      setConfirmOpen(false);
      hubChrome.exitToMain("/leagues");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to retire from this league.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <Card style={{ borderColor: "var(--error)" }}>
      <h2 style={{ marginTop: 0 }}>Retire from this league</h2>
      <p>Retiring removes you from the league on the site and unlinks you in the Discord server. Your team becomes open for a replacement coach.</p>
      {needsSuccessor && (
        <>
          <p>You're the head commissioner. Choose who receives that title before you leave — the league must keep an owner.</p>
          {candidates.length ? (
            <div className="form-field">
              <label className="form-label" htmlFor="retire-successor">New head commissioner</label>
              <select
                id="retire-successor"
                className="form-input"
                value={transferToUserId}
                onChange={(event) => setTransferToUserId(event.target.value)}
                disabled={busy}
              >
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.displayName}{candidate.teamName ? ` · ${candidate.teamName}` : ""}{candidate.role !== "member" ? ` (${candidate.role.replaceAll("_", " ")})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="form-hint">There is nobody else in this league to transfer the title to. Invite or promote another member first, or use Delete League if this league is shutting down.</p>
          )}
        </>
      )}
      {error && <ErrorState message={error} />}
      <Button
        variant="danger"
        disabled={busy || (needsSuccessor && (!transferToUserId || candidates.length === 0))}
        onClick={() => { setError(null); setConfirmOpen(true); }}
      >
        Retire from League
      </Button>

      {confirmOpen && (
        <Modal title="Retire from this league?" onClose={() => !busy && setConfirmOpen(false)}>
          <p>This is permanent for your membership in this league.</p>
          <ul>
            <li>You will be removed from the league on the site.</li>
            <li>You will be unlinked in the Discord server (managed roles and nickname cleared).</li>
            <li>Your team will become an open slot.</li>
            {needsSuccessor && transferToUserId ? (
              <li>
                Head commissioner will transfer to{" "}
                <strong>{candidates.find((candidate) => candidate.userId === transferToUserId)?.displayName ?? "the selected member"}</strong>.
              </li>
            ) : null}
          </ul>
          {error && <ErrorState message={error} />}
          <div className="advance-modal-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy || !canRetire} onClick={() => void confirmRetire()}>
              {busy ? "Retiring…" : "Confirm Retirement"}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
