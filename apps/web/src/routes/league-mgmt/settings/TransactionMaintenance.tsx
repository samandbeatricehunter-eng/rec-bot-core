import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import type { LinkedTeamRow, ReversibleTransaction } from "../../../types/api.js";
import { formatCoins } from "@rec/shared";

// Site-only replacement for the Discord bot's old "Troubleshoot -> Reverse Transaction" flow —
// that Discord admin command has been removed; this is now the one place a commissioner can
// post a compensating wallet transaction for a data-entry mistake or a bug's aftermath.
export function TransactionMaintenance() {
  const { guildId } = useReadyAuth();
  const [coaches, setCoaches] = useState<LinkedTeamRow[] | null>(null);
  const [selectedDiscordId, setSelectedDiscordId] = useState("");
  const [transactions, setTransactions] = useState<ReversibleTransaction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    recApi.listLinkedUsersTeams(guildId).then((res) => setCoaches(res.linked.filter((row) => row.discordId))).catch(() => setCoaches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function loadTransactions(discordId: string) {
    setSelectedDiscordId(discordId);
    setTransactions(null);
    setError(null);
    setNotice(null);
    if (!discordId) return;
    setLoading(true);
    try {
      const res = await recApi.listReversibleTransactions({ guildId, discordId });
      setTransactions(res.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }

  async function reverse(ledgerId: string) {
    setBusyId(ledgerId);
    setError(null);
    try {
      const res = await recApi.reverseTransaction({ guildId, discordId: selectedDiscordId, ledgerId });
      setNotice(`Posted a compensating transaction of ${formatCoins(res.amount)}.`);
      setConfirmId(null);
      await loadTransactions(selectedDiscordId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reverse transaction.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Reverse a Wallet Transaction</h2>
      <p className="form-hint">
        Select a linked coach, then post a compensating transaction for one of their recent wallet entries — for
        correcting a mistaken payout or debit. This doesn't edit history; it adds an offsetting entry.
      </p>
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">Coach</span>
        <select className="form-input" value={selectedDiscordId} onChange={(event) => void loadTransactions(event.target.value)}>
          <option value="">{coaches === null ? "Loading coaches…" : "Select a coach"}</option>
          {(coaches ?? []).map((row) => (
            <option key={row.id} value={row.discordId ?? ""}>
              {row.team?.name ?? "Team"} · {row.user?.display_name ?? "Coach"}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <LoadingState />
      ) : !selectedDiscordId ? null : !transactions || transactions.length === 0 ? (
        <p className="form-hint">No recent transactions for this coach.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          {transactions.map((txn) => (
            <div
              key={txn.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                opacity: txn.reversible ? 1 : 0.55,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {formatCoins(txn.amount, { signed: true })} · {txn.transaction_type.replaceAll("_", " ")}
                </div>
                <div className="form-hint" style={{ margin: 0 }}>
                  {txn.description || txn.source} — {new Date(txn.created_at).toLocaleString()}
                </div>
              </div>
              {!txn.reversible ? (
                <span className="form-hint" style={{ flexShrink: 0 }}>Already reversed</span>
              ) : confirmId === txn.id ? (
                <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
                  <Button variant="danger" disabled={busyId === txn.id} onClick={() => void reverse(txn.id)}>
                    {busyId === txn.id ? "Reversing…" : "Confirm Reverse"}
                  </Button>
                  <Button variant="ghost" disabled={busyId === txn.id} onClick={() => setConfirmId(null)}>
                    Back
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmId(txn.id)} style={{ flexShrink: 0 }}>
                  Reverse
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
