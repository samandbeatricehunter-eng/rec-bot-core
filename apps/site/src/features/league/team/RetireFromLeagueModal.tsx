import { useState } from "react";
import { useHubChrome } from "@rec/hub-ui";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";

export function RetireFromLeagueModal({
  leagueName,
  teamNickname,
  onClose,
}: {
  leagueName: string;
  teamNickname: string;
  onClose: () => void;
}) {
  const hubChrome = useHubChrome();
  const [step, setStep] = useState<1 | 2>(1);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={step === 1 ? "Retire from League" : "Confirm retirement"} onClose={() => !busy && onClose()}>
      <div className="hub-retire-confirm">
        {step === 1 ? (
          <>
            <p>Type your team&apos;s currently displayed nickname exactly to continue. Your team will become open and you will lose access to this league.</p>
            <p className="hub-muted">Required nickname: <strong>{teamNickname}</strong></p>
            <label className="form-field">
              <span className="form-label">Team nickname</span>
              <input
                className="form-input"
                value={nickname}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
            {error ? <p className="hub-transfer-status">{error}</p> : null}
            <div className="advance-modal-actions">
              <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (nickname.trim() !== teamNickname.trim()) {
                    setError("Nickname must match exactly.");
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>This cannot be undone. Retire <strong>{teamNickname}</strong> from <strong>{leagueName}</strong>?</p>
            {error ? <p className="hub-transfer-status">{error}</p> : null}
            <div className="advance-modal-actions">
              <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>Back</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void hubChrome.retireFromCurrentLeague()
                    .then(() => onClose())
                    .catch((err) => {
                      setError(err instanceof Error ? err.message : "Failed to retire from this league.");
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? "Retiring…" : "Retire"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
