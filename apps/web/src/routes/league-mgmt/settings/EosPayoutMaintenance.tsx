import { useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// League-wide-issue escape hatch: wipes every not-yet-issued item off the league's open EOS
// batch, clears its Pending Payouts inbox entry, and immediately recalculates a fresh one.
// Already-issued payouts (money already sent) are never touched.
export function EosPayoutMaintenance() {
  const { guildId } = useReadyAuth();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function wipeAndRerun() {
    setBusy(true);
    setError(null);
    try {
      await recApi.wipeAndRerunEosPayouts({ guildId, reason: reason.trim() });
      setNotice("Pending EOS ledgers were wiped and recalculated from scratch.");
      setConfirming(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to wipe and rerun EOS payouts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Wipe &amp; Rerun Open EOS Ledgers</h2>
      <p className="form-hint">
        For league-wide data issues only. This wipes every EOS payout ledger that hasn't been approved or rejected yet, clears the
        Pending Payouts inbox, and recalculates a fresh batch from current stats. Already-issued payouts are never touched.
      </p>
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      {!confirming ? (
        <Button variant="danger" onClick={() => setConfirming(true)}>Wipe &amp; Rerun</Button>
      ) : (
        <div className="form-field">
          <label className="form-label" htmlFor="wipe-rerun-reason">Reason (required)</label>
          <input id="wipe-rerun-reason" className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this batch need to be wiped and recalculated?" />
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={wipeAndRerun}>{busy ? "Working…" : "Confirm Wipe & Rerun"}</Button>
            <Button variant="ghost" onClick={() => { setConfirming(false); setReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
