import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCoins } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { EosLedger, PendingEosLedgers, RecPayoutTier } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { CoinAmount } from "../../../components/ui/CoinAmount.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// Embedded in Notifications as the "EOS Payout" tab — one collapsible receipt per linked
// user, collapsed by default. Expanding shows every stat line the user's team qualified
// for, the tier and coin amount for each, and lets the commissioner bump any single line
// to a different tier (or clear it) before approving the whole ledger. Approve issues the
// coins and DMs the user the ledger + who approved it; reject DMs them the reason.
export function EosPayoutLedgers({ onResolved }: { onResolved: (message: string) => void }) {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<PendingEosLedgers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function load() {
    recApi.listPendingEosLedgers(guildId).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending payouts."));
  }
  useEffect(load, [guildId]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function adjustTier(itemId: string, tier: RecPayoutTier | null) {
    setError(null);
    try {
      await recApi.adjustEosPayoutItem({ guildId, itemId, tier });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adjust that line item.");
    }
  }

  async function approve(ledger: EosLedger) {
    if (!data?.batch) return;
    setBusyUserId(ledger.userId);
    setError(null);
    try {
      await recApi.reviewEosLedger({ guildId, batchId: data.batch.id, userId: ledger.userId, action: "approve" });
      onResolved(`Approved ${ledger.displayName}'s ledger — ${formatCoins(ledger.total)} issued.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve this ledger.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function reject(ledger: EosLedger) {
    if (!data?.batch || !reason.trim()) return;
    setBusyUserId(ledger.userId);
    setError(null);
    try {
      await recApi.reviewEosLedger({ guildId, batchId: data.batch.id, userId: ledger.userId, action: "deny", deniedReason: reason.trim() });
      onResolved(`Rejected ${ledger.displayName}'s ledger.`);
      setRejecting(null);
      setReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject this ledger.");
    } finally {
      setBusyUserId(null);
    }
  }

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div>
      {error && <ErrorState message={error} />}

      {!data.batch && <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No EOS payout batch is open right now. Ledgers are prepared automatically once postseason play ends (or, for CFB, once the league advances past week 16).</p></Card>}

      {data.batch && data.ledgers.length === 0 && (
        <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>Nothing pending — every ledger in this batch has been reviewed.</p></Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {data.ledgers.map((ledger) => {
          const isOpen = expanded.has(ledger.userId);
          const busy = busyUserId === ledger.userId;
          return (
            <Card key={ledger.userId}>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                onClick={() => toggle(ledger.userId)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <div>
                    <strong>{ledger.displayName}</strong>
                    {ledger.teamName && <span style={{ color: "var(--text-secondary)", marginLeft: "var(--space-2)" }}>{ledger.teamName}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <Badge status="pending">{ledger.items.length} line{ledger.items.length === 1 ? "" : "s"}</Badge>
                  <strong style={{ fontSize: "var(--text-lg)" }}><CoinAmount amount={ledger.total} /></strong>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
                    {ledger.items.map((item) => (
                      <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                        <div>
                          <div>{item.payoutLabel}</div>
                          <small style={{ color: "var(--text-secondary)" }}>Value: {item.qualifiedValue}</small>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <select
                            className="form-select"
                            style={{ width: "auto" }}
                            value={item.qualifiedTier ?? ""}
                            onChange={(e) => adjustTier(item.id, (e.target.value || null) as RecPayoutTier | null)}
                          >
                            <option value="">None — {formatCoins(0)}</option>
                            {item.availableTiers.map((t) => <option key={t.tier} value={t.tier}>Tier {t.tier} — {formatCoins(t.amount)}</option>)}
                          </select>
                          <strong style={{ minWidth: 72, textAlign: "right" }}><CoinAmount amount={item.amount} /></strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                    <strong>Grand Total</strong>
                    <strong style={{ fontSize: "var(--text-lg)" }}><CoinAmount amount={ledger.total} /></strong>
                  </div>

                  {rejecting === ledger.userId ? (
                    <div className="form-field">
                      <label className="form-label" htmlFor={`reject-reason-${ledger.userId}`}>Reason for rejection</label>
                      <input id={`reject-reason-${ledger.userId}`} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this ledger being rejected?" />
                      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                        <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => reject(ledger)}>{busy ? "Rejecting…" : "Confirm Reject"}</Button>
                        <Button variant="ghost" onClick={() => { setRejecting(null); setReason(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <Button variant="primary" disabled={busy} onClick={() => approve(ledger)}>{busy ? "Working…" : "Approve & Issue"}</Button>
                      <Button variant="danger" disabled={busy} onClick={() => setRejecting(ledger.userId)}>Reject</Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
