import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { resolveTeamAppearance } from "../../../components/team/index.js";

type Panel = "menu" | "activity" | "transactions" | "suspend";

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ManageUserActionsModal({
  guildId,
  team,
  onClose,
  onUnlinked,
}: {
  guildId: string;
  team: TeamManagementSummaryRow;
  onClose: () => void;
  onUnlinked: (teamId: string) => void;
}) {
  const linked = team.linkedUser;
  const appearance = resolveTeamAppearance({
    abbreviation: team.abbreviation,
    displayAbbr: team.displayAbbr,
    originalAbbreviation: team.originalAbbreviation,
    primaryColor: team.primaryColor,
    logoUrl: team.logoUrl,
    displayCity: team.displayCity,
    displayNick: team.displayNick,
    name: team.name,
  });

  const [panel, setPanel] = useState<Panel>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof recApi.getManageUserActivity>>["events"] | null>(null);
  const [transactions, setTransactions] = useState<Awaited<ReturnType<typeof recApi.getManageUserTransactions>> | null>(null);
  const [advances, setAdvances] = useState("1");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setPanel("menu");
    setError(null);
    setActivity(null);
    setTransactions(null);
    setAdvances("1");
    setReason("");
  }, [team.id]);

  if (!linked) {
    return (
      <Modal title={appearance.nick || team.name} onClose={onClose} size="md">
        <p className="form-hint">This team has no linked user.</p>
        <div className="modal-panel-footer" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </Modal>
    );
  }

  const title = panel === "menu"
    ? (linked.displayName || linked.discordUsername || appearance.nick || "User")
    : panel === "activity"
      ? "Activity Log"
      : panel === "transactions"
        ? "Transactions"
        : "Suspend User";

  async function loadActivity() {
    setBusy(true);
    setError(null);
    try {
      const res = await recApi.getManageUserActivity({ guildId, teamId: team.id, userId: linked!.userId });
      setActivity(res.events);
      setPanel("activity");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load activity.");
    } finally {
      setBusy(false);
    }
  }

  async function loadTransactions() {
    setBusy(true);
    setError(null);
    try {
      const res = await recApi.getManageUserTransactions({ guildId, teamId: team.id, userId: linked!.userId });
      setTransactions(res);
      setPanel("transactions");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load transactions.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSuspend() {
    const n = Number.parseInt(advances, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter how many advances the suspension should last.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Enter a short reason for the suspension.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.suspendManageUser({
        guildId,
        teamId: team.id,
        userId: linked!.userId,
        advances: n,
        reason: reason.trim(),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to suspend user.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink() {
    if (!window.confirm(`Unlink ${linked!.displayName || "this user"} from ${team.name}? Discord roles for this link will be removed.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.unlinkTeam({ guildId, teamId: team.id });
      onUnlinked(team.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to unlink user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      size={panel === "menu" ? "md" : "lg"}
      showClose={panel === "menu"}
      footer={panel === "menu" ? undefined : (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => { setPanel("menu"); setError(null); }}>
            Back
          </Button>
          {panel === "suspend" ? (
            <Button variant="danger" disabled={busy} onClick={() => void submitSuspend()}>
              {busy ? "Suspending…" : "Apply Discord SUSPENDED Role"}
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
          )}
        </>
      )}
    >
      {panel === "menu" ? (
        <>
          <p className="form-hint" style={{ margin: 0 }}>
            {appearance.city} {appearance.nick}
            {linked.discordUsername ? ` · @${linked.discordUsername}` : ""}
          </p>
          <div className="modal-action-list">
            <Button variant="secondary" disabled={busy} onClick={() => void loadActivity()}>View Activity Log</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void loadTransactions()}>View Transactions</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setPanel("suspend"); setError(null); }}>Suspend User</Button>
            <Button variant="secondary" disabled title="Coming soon">Boot &amp; Ban User</Button>
            <Button variant="danger" disabled={busy} onClick={() => void removeLink()}>Remove User Link</Button>
          </div>
        </>
      ) : null}

      {panel === "activity" ? (
        busy && !activity ? <LoadingState label="Loading activity…" /> : (
          <ul className="modal-list">
            {(activity ?? []).length ? (activity ?? []).map((event) => (
              <li key={event.id} className="modal-list-item">
                <strong>{event.summary}</strong>
                <small>{formatWhen(event.createdAt)} · {event.actionKey}</small>
              </li>
            )) : (
              <li className="modal-list-item">
                <strong>No activity recorded yet</strong>
                <span>New confirmed actions will appear here going forward (last 25).</span>
              </li>
            )}
          </ul>
        )
      ) : null}

      {panel === "transactions" ? (
        busy && !transactions ? <LoadingState label="Loading transactions…" /> : transactions ? (
          <>
            <div className="modal-stat-row">
              <div className="modal-stat"><span>Wallet</span><strong>{transactions.wallet.walletBalance.toLocaleString()}</strong></div>
              <div className="modal-stat"><span>Savings</span><strong>{transactions.wallet.savingsBalance.toLocaleString()}</strong></div>
            </div>
            {(transactions.pending.purchases.length || transactions.pending.inbox.length) ? (
              <>
                <h3 className="modal-panel-title" style={{ fontSize: "var(--text-sm)" }}>Pending</h3>
                <ul className="modal-list">
                  {transactions.pending.purchases.map((row) => (
                    <li key={row.id} className="modal-list-item">
                      <strong>Purchase · {row.purchaseType ?? "unknown"}</strong>
                      <small>{formatWhen(row.createdAt)}{row.amount != null ? ` · ${row.amount}` : ""}</small>
                    </li>
                  ))}
                  {transactions.pending.inbox.map((row) => (
                    <li key={row.id} className="modal-list-item">
                      <strong>{row.header || row.queueType}</strong>
                      <small>{formatWhen(row.createdAt)} · {row.queueType}</small>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3 className="modal-panel-title" style={{ fontSize: "var(--text-sm)" }}>Last 25 transactions</h3>
            <ul className="modal-list">
              {transactions.transactions.length ? transactions.transactions.map((row) => (
                <li key={row.id} className="modal-list-item">
                  <strong>{row.description || row.transactionType || "Transaction"} · {row.amount >= 0 ? "+" : ""}{row.amount.toLocaleString()}</strong>
                  <small>{formatWhen(row.createdAt)}</small>
                </li>
              )) : (
                <li className="modal-list-item"><strong>No ledger rows yet</strong></li>
              )}
            </ul>
          </>
        ) : null
      ) : null}

      {panel === "suspend" ? (
        <>
          <p className="form-hint" style={{ margin: 0 }}>
            Applies the Discord guild role <strong>SUSPENDED</strong> and blocks speaking in game channels
            until the chosen number of league advances complete.
          </p>
          <label className="form-field">
            <span className="form-label">Advances remaining</span>
            <input className="form-input" type="number" min={1} max={52} value={advances} onChange={(e) => setAdvances(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">Reason</span>
            <textarea className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this user suspended?" />
          </label>
        </>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
    </Modal>
  );
}
