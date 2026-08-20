import { useState } from "react";
import { coinsNumber } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { CoinAmount } from "../ui/CoinAmount.js";

type Transaction = { id: string; amount: number; transactionType: string | null; description: string | null; createdAt: string };

function formatTxLabel(type: string | null) {
  if (!type) return "Transaction";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Condensed wallet/savings block used on both Campus Buzz (hero card) and My Team (replacing
// the old three-column balances + big Funds & Savings details section) — one block, one
// balances row, one actions row (View Transactions / Transfer Coins), each opening its own modal.
export function WalletSavingsCard({
  guildId,
  wallet,
  savings,
  onTransferred,
}: {
  guildId: string;
  wallet: number;
  savings: number;
  onTransferred: () => void;
}) {
  const [txOpen, setTxOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [direction, setDirection] = useState<"to_savings" | "from_savings">("to_savings");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function openTransactions() {
    setTxOpen(true);
    setTxError(null);
    if (!transactions) {
      recApi.getMyRecentTransactions({ guildId, limit: 50 })
        .then((result) => setTransactions(result.transactions))
        .catch((err) => setTxError(err instanceof Error ? err.message : "Failed to load transactions."));
    }
  }

  function openTransfer() {
    setDirection("to_savings");
    setAmount("");
    setStatus(null);
    setTransferOpen(true);
  }

  async function submitTransfer() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setStatus("Enter a positive amount."); return; }
    setBusy(true);
    setStatus(null);
    try {
      const result = await recApi.transferMyFunds({ guildId, amount: value, direction });
      setStatus(`Transfer complete. Wallet ${coinsNumber(result.wallet_balance)} · Savings ${coinsNumber(result.savings_balance)}`);
      setAmount("");
      onTransferred();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="hub-wallet-card">
      <div className="hub-wallet-card-balances">
        <div><span>Wallet</span><strong><CoinAmount amount={wallet} /></strong></div>
        <div className="hub-wallet-card-divider" />
        <div><span>Savings</span><strong><CoinAmount amount={savings} /></strong></div>
      </div>
      <div className="hub-wallet-card-actions">
        <button type="button" className="btn btn-secondary" onClick={openTransactions}>View Transactions</button>
        <button type="button" className="btn btn-secondary" onClick={openTransfer}>Transfer Coins</button>
      </div>
    </div>

    {txOpen && (
      <Modal title="Recent Transactions" onClose={() => setTxOpen(false)}>
        {txError ? <p className="hub-empty">{txError}</p>
          : transactions === null ? <p className="hub-empty">Loading…</p>
          : transactions.length === 0 ? <p className="hub-empty">No transactions yet.</p>
          : <div className="hub-ledger-list">
              {transactions.map((tx) => (
                <div key={tx.id} className="hub-ledger-row">
                  <div>
                    <strong>{tx.description ?? formatTxLabel(tx.transactionType)}</strong>
                    <span className="hub-muted">{new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  <strong className={tx.amount >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}><CoinAmount amount={tx.amount} signed /></strong>
                </div>
              ))}
            </div>}
      </Modal>
    )}

    {transferOpen && (
      <Modal title="Transfer Coins" onClose={() => setTransferOpen(false)}>
        <div className="hub-poty-modal">
          <div className="hub-wallet-transfer-toggle">
            <button type="button" className={direction === "to_savings" ? "active" : ""} onClick={() => setDirection("to_savings")}>To Savings</button>
            <button type="button" className={direction === "from_savings" ? "active" : ""} onClick={() => setDirection("from_savings")}>From Savings</button>
          </div>
          <p className="hub-muted">Wallet: <CoinAmount amount={wallet} /> · Savings: <CoinAmount amount={savings} /></p>
          <label className="form-field">
            <span className="form-label">Amount</span>
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              max={direction === "to_savings" ? wallet : savings}
              placeholder="Amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {status && <p className="hub-transfer-status">{status}</p>}
          <Button variant="primary" disabled={busy || !amount} onClick={() => void submitTransfer()}>{busy ? "Transferring…" : "Transfer"}</Button>
        </div>
      </Modal>
    )}
  </>;
}

export function ManageFundsModal({
  guildId,
  wallet,
  savings,
  onTransferred,
  onClose,
}: {
  guildId: string;
  wallet: number;
  savings: number;
  onTransferred: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"transfer" | "transactions">("transfer");
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"to_savings" | "from_savings">("to_savings");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function selectTab(next: "transfer" | "transactions") {
    setTab(next);
    if (next === "transactions" && transactions === null && !txError) {
      recApi.getMyRecentTransactions({ guildId, limit: 50 })
        .then((result) => setTransactions(result.transactions))
        .catch((err) => setTxError(err instanceof Error ? err.message : "Failed to load transactions."));
    }
  }

  async function submitTransfer() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setStatus("Enter a positive amount.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await recApi.transferMyFunds({ guildId, amount: value, direction });
      setStatus(`Transfer complete. Wallet ${coinsNumber(result.wallet_balance)} · Savings ${coinsNumber(result.savings_balance)}`);
      setAmount("");
      setTransactions(null);
      onTransferred();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Manage Funds" onClose={onClose}>
    <div className="hub-funds-modal">
      <div className="hub-funds-switcher" role="tablist" aria-label="Manage funds view">
        <button type="button" role="tab" aria-selected={tab === "transfer"} className={tab === "transfer" ? "active" : ""} onClick={() => selectTab("transfer")}>Transfer Funds</button>
        <button type="button" role="tab" aria-selected={tab === "transactions"} className={tab === "transactions" ? "active" : ""} onClick={() => selectTab("transactions")}>Transactions</button>
      </div>

      {tab === "transfer" ? <>
        <div className="hub-funds-balances">
          <div><span>Wallet</span><strong><CoinAmount amount={wallet} /></strong></div>
          <div><span>Savings</span><strong><CoinAmount amount={savings} /></strong></div>
        </div>
        <div className="hub-wallet-transfer-toggle">
          <button type="button" className={direction === "to_savings" ? "active" : ""} onClick={() => setDirection("to_savings")}>To Savings</button>
          <button type="button" className={direction === "from_savings" ? "active" : ""} onClick={() => setDirection("from_savings")}>From Savings</button>
        </div>
        <label className="form-field">
          <span className="form-label">Amount</span>
          <input className="form-input" type="number" min="0.01" step="0.01" max={direction === "to_savings" ? wallet : savings} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" />
        </label>
        {status && <p className="hub-transfer-status">{status}</p>}
        <Button variant="primary" disabled={busy || !amount} onClick={() => void submitTransfer()}>{busy ? "Transferring…" : "Transfer"}</Button>
      </> : txError ? <p className="hub-empty">{txError}</p>
        : transactions === null ? <p className="hub-empty">Loading…</p>
        : transactions.length === 0 ? <p className="hub-empty">No transactions yet.</p>
        : <div className="hub-ledger-list">
          {transactions.map((tx) => <div key={tx.id} className="hub-ledger-row">
            <div><strong>{tx.description ?? formatTxLabel(tx.transactionType)}</strong><span className="hub-muted">{new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
            <strong className={tx.amount >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}><CoinAmount amount={tx.amount} signed /></strong>
          </div>)}
        </div>}
    </div>
  </Modal>;
}
