import { useEffect, useState } from "react";
import { Coins, ClipboardList, RefreshCw } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { EosReadinessReport } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type SubView = "run" | "wipe" | "audit" | null;

// EOS payouts used to auto-fire when a league advanced out of the postseason -- that's now a
// manual commissioner action, so this is the single place all three EOS payout operations live:
// running the batch, the escape-hatch wipe-and-rerun (moved here from Settings > Maintenance),
// and a read-only readiness preview.
export function EosPayoutsToolsModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [view, setView] = useState<SubView>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (view === "run") return <RunEosPayoutsModal guildId={guildId} onClose={() => setView(null)} onDone={(message) => { setView(null); setNotice(message); }} />;
  if (view === "wipe") return <WipeAndRerunModal guildId={guildId} onClose={() => setView(null)} onDone={(message) => { setView(null); setNotice(message); }} />;
  if (view === "audit") return <EosAuditReviewModal guildId={guildId} onClose={() => setView(null)} />;

  return (
    <Modal title="EOS Payouts" onClose={onClose}>
      <div className="hub-hero-action-modal">
        {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
        <p className="form-hint" style={{ marginTop: 0 }}>
          End-of-season payouts no longer run automatically — trigger them here once the postseason is over.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={() => setView("run")}><Coins size={14} /> Run EOS Payouts</Button>
          <Button variant="secondary" onClick={() => setView("audit")}><ClipboardList size={14} /> EOS Audit/Review</Button>
          <Button variant="danger" onClick={() => setView("wipe")}><RefreshCw size={14} /> Wipe &amp; Rerun</Button>
        </div>
      </div>
    </Modal>
  );
}

function RunEosPayoutsModal({ guildId, onClose, onDone }: { guildId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.prepareEosPayouts({ guildId }) as { items?: unknown[]; totalAmount?: number };
      const itemCount = result.items?.length ?? 0;
      onDone(`EOS payout batch built: ${itemCount} item${itemCount === 1 ? "" : "s"}, ${result.totalAmount ?? 0} coins pending in the Pending Payouts inbox for review.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run EOS payouts.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Run EOS Payouts" onClose={onClose}>
      <div className="hub-hero-action-modal">
        <p>
          Builds (or refreshes) this season's end-of-season payout batch from current stats and standings, and
          drops it in the commissioner Pending Payouts inbox for review. Only available during the postseason
          (after the regular season ends, through the championship game). Safe to run more than once — it only
          replaces items still pending, never anything already approved or issued.
        </p>
        {error ? <ErrorState message={error} /> : null}
        <Button variant="primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Running…" : "Run EOS Payouts"}
        </Button>
      </div>
    </Modal>
  );
}

// Same escape-hatch this was before (relocated out of Settings > Maintenance): wipes every
// not-yet-approved item off the league's open EOS batch and recalculates a fresh one.
// Already-issued payouts (money already sent) are never touched.
function WipeAndRerunModal({ guildId, onClose, onDone }: { guildId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function wipeAndRerun() {
    setBusy(true);
    setError(null);
    try {
      await recApi.wipeAndRerunEosPayouts({ guildId, reason: reason.trim() });
      onDone("Pending EOS ledgers were wiped and recalculated from scratch.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to wipe and rerun EOS payouts.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Wipe & Rerun Open EOS Ledgers" onClose={onClose}>
      <div className="hub-hero-action-modal">
        <p className="form-hint" style={{ marginTop: 0 }}>
          For league-wide data issues only. This wipes every EOS payout ledger that hasn't been approved or
          rejected yet, clears the Pending Payouts inbox, and recalculates a fresh batch from current stats.
          Already-issued payouts are never touched.
        </p>
        {error ? <ErrorState message={error} /> : null}
        <label className="form-field">
          <span className="form-label">Reason (required)</span>
          <input
            className="form-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why does this batch need to be wiped and recalculated?"
            disabled={busy}
          />
        </label>
        <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void wipeAndRerun()}>
          {busy ? "Working…" : "Confirm Wipe & Rerun"}
        </Button>
      </div>
    </Modal>
  );
}

function EosAuditReviewModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [report, setReport] = useState<EosReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.auditEosPayoutReadiness({ guildId }).then((result) => {
      if (!cancelled) setReport(result);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the EOS readiness audit.");
    });
    return () => { cancelled = true; };
  }, [guildId]);

  return (
    <Modal title="EOS Audit/Review" onClose={onClose}>
      <div className="hub-hero-action-modal">
        <p className="form-hint" style={{ marginTop: 0 }}>
          A read-only preview of end-of-season payouts as of right now — safe to run any time, not just the
          postseason. Never creates or changes a payout batch.
        </p>
        {error ? <ErrorState message={error} /> : null}
        {!report && !error ? <LoadingState label="Auditing EOS payout readiness…" /> : null}
        {report ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <Card style={{ padding: "var(--space-3)" }}>
              <strong>{report.summary}</strong>
            </Card>

            <section>
              <h3 style={{ margin: "0 0 var(--space-2)" }}>Projected payouts ({report.projectedItems.length})</h3>
              {report.projectedItems.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "220px", overflowY: "auto" }}>
                  {report.projectedItems.map((item, index) => (
                    <div key={index} className="inline-admin-row">
                      <span>{item.payout_label}{item.qualified_tier ? ` (Tier ${item.qualified_tier})` : ""}</span>
                      <span>{item.amount} coins</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="form-hint">Nothing qualifies yet.</p>
              )}
            </section>

            <section>
              <h3 style={{ margin: "0 0 var(--space-2)" }}>Availability flags ({report.availabilityFlags.length})</h3>
              {report.availabilityFlags.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {report.availabilityFlags.map((flag) => (
                    <div key={flag.userId} className="inline-admin-row">
                      <span>{flag.displayName}{flag.teamName ? ` — ${flag.teamName}` : ""}</span>
                      <span className={`badge ${flag.payoutsHeld ? "badge-denied" : "badge-pending"}`}>
                        {flag.payoutsHeld ? "Payouts held" : "At risk"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="form-hint">Nobody flagged — availability looks set for every active member.</p>
              )}
            </section>

            <section>
              <h3 style={{ margin: "0 0 var(--space-2)" }}>Stat import</h3>
              {report.statsImport ? (
                <p className="form-hint" style={{ margin: 0 }}>
                  {report.statsImport.issueCount === 0
                    ? `No missing import data through week ${report.statsImport.currentWeek}.`
                    : `${report.statsImport.issueCount} gap${report.statsImport.issueCount === 1 ? "" : "s"} found through week ${report.statsImport.currentWeek}.`}
                </p>
              ) : (
                <p className="form-hint" style={{ margin: 0 }}>Not applicable — this check only applies to Madden leagues importing from EA.</p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
