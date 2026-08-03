import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import type { OpenWagersForCommissionerResponse } from "../../../types/api.js";

// Commissioner escape hatch for select open wagers — both user-v-user (peer) and
// house — separate from the per-game bulk close/reopen/cancel controls, which act on
// every wager tied to one game rather than a single bet.
export function WagerMaintenance() {
  const { guildId } = useReadyAuth();
  const [wagers, setWagers] = useState<OpenWagersForCommissionerResponse["wagers"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await recApi.listOpenWagersForCommissioner(guildId);
      setWagers(res.wagers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load open wagers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function cancelWager(wagerId: string) {
    setBusyId(wagerId);
    setError(null);
    try {
      const res = await recApi.commissionerCancelWager({ guildId, wagerId });
      setNotice(`Wager cancelled and ${res.refunded.toLocaleString()} coins refunded.`);
      setConfirmId(null);
      setWagers((prev) => prev?.filter((w) => w.id !== wagerId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel wager.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Cancel &amp; Refund Open Wagers</h2>
      <p className="form-hint">
        Cancel any single open wager — peer (user vs. user) or house — and refund every stake involved. For voiding
        every wager on one game at once, use the Close/Reopen/Cancel Wagering controls on that game instead.
      </p>
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState />
      ) : !wagers || wagers.length === 0 ? (
        <p className="form-hint">No open wagers right now.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {wagers.map((wager) => (
            <div
              key={wager.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {wager.wagerKind === "house" ? "House" : "Peer"} · {wager.gameLabel} · S{wager.seasonNumber} W{wager.weekNumber}
                </div>
                <div className="form-hint" style={{ margin: 0 }}>
                  {wager.marketLabel}: {wager.pickLabel} — {wager.stake.toLocaleString()} coins staked ({wager.status})
                </div>
                <div className="form-hint" style={{ margin: 0 }}>
                  Placed by {wager.placedByName}
                  {wager.acceptedByName ? ` · Accepted by ${wager.acceptedByName}` : ""}
                </div>
              </div>
              {confirmId === wager.id ? (
                <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
                  <Button variant="danger" disabled={busyId === wager.id} onClick={() => void cancelWager(wager.id)}>
                    {busyId === wager.id ? "Cancelling…" : "Confirm Cancel"}
                  </Button>
                  <Button variant="ghost" disabled={busyId === wager.id} onClick={() => setConfirmId(null)}>
                    Back
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmId(wager.id)} style={{ flexShrink: 0 }}>
                  Cancel &amp; Refund
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
