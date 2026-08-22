import { useState } from "react";
import { ChevronDown, ChevronRight, Coins, Database, Tag, Trophy, Users, Wrench } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { RepairGameChannelsModal } from "./RepairGameChannelsModal.js";
import { ManageGameWagersModal } from "./ManageGameWagersModal.js";
import { ManageGotwToolsModal } from "./ManageGotwToolsModal.js";

type AuditReport = Awaited<ReturnType<typeof recApi.auditMaddenEaImport>>;
type ResyncResult = Awaited<ReturnType<typeof recApi.resyncNicknames>>;
type ReconcileResult = Awaited<ReturnType<typeof recApi.reconcileRoles>>;

export function TroubleshootModal({
  guildId,
  leagueId,
  showImportAudit = false,
  onClose,
}: {
  guildId: string;
  leagueId?: string | null;
  showImportAudit?: boolean;
  onClose: () => void;
}) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [wagersOpen, setWagersOpen] = useState(false);
  const [gotwOpen, setGotwOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (repairOpen) {
    return (
      <RepairGameChannelsModal
        guildId={guildId}
        onClose={() => setRepairOpen(false)}
        onDone={(message) => {
          setRepairOpen(false);
          setNotice(message);
        }}
      />
    );
  }
  if (wagersOpen) return <ManageGameWagersModal guildId={guildId} onClose={() => setWagersOpen(false)} onDone={(message) => { setWagersOpen(false); setNotice(message); }} />;
  if (gotwOpen) {
    return (
      <ManageGotwToolsModal
        guildId={guildId}
        onClose={() => setGotwOpen(false)}
        onDone={(message) => {
          setGotwOpen(false);
          setNotice(message);
        }}
      />
    );
  }

  return (
    <Modal title="Tools" onClose={onClose}>
      {notice && (
        <p className="form-hint" style={{ color: "var(--gold)", marginBottom: "var(--space-3)" }}>
          {notice}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {showImportAudit && leagueId && (
          <CollapsibleSection title="Import Audit" defaultOpen>
            <ImportAuditPanel guildId={guildId} leagueId={leagueId} />
          </CollapsibleSection>
        )}
        <CollapsibleSection title="Discord Roles & Nicknames" defaultOpen>
          <DiscordRolesPanel guildId={guildId} />
        </CollapsibleSection>
        <CollapsibleSection title="Repair Game Channels">
          <p className="form-hint" style={{ marginTop: 0 }}>
            Wipe and recreate Discord game channels for the current week. Use this if channels
            are missing, misnamed, or out of sync with the schedule.
          </p>
          <Button variant="secondary" onClick={() => setRepairOpen(true)}>
            <Wrench size={14} /> Open Repair Tool
          </Button>
        </CollapsibleSection>
        <CollapsibleSection title="Game of the Week">
          <p className="form-hint" style={{ marginTop: 0 }}>
            Close voting when a GOTW started without a stream, or clear logged votes if a Force Win
            was settled as a real pick.
          </p>
          <Button variant="secondary" onClick={() => setGotwOpen(true)}>
            <Trophy size={14} /> Open GOTW Tools
          </Button>
        </CollapsibleSection>
        <CollapsibleSection title="Close or Refund Wagers">
          <p className="form-hint" style={{ marginTop: 0 }}>Select a game to close new wagering and/or cancel and refund its open wagers.</p>
          <Button variant="secondary" onClick={() => setWagersOpen(true)}><Coins size={14} /> Open Wager Tool</Button>
        </CollapsibleSection>
      </div>
    </Modal>
  );
}

function DiscordRolesPanel({ guildId }: { guildId: string }) {
  const [resyncBusy, setResyncBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resyncResult, setResyncResult] = useState<ResyncResult | null>(null);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);

  async function resyncNicknames() {
    setResyncBusy(true);
    setResyncResult(null);
    setError(null);
    try {
      setResyncResult(await recApi.resyncNicknames(guildId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to resync nicknames.");
    } finally {
      setResyncBusy(false);
    }
  }

  async function reconcileRoles() {
    setReconcileBusy(true);
    setReconcileResult(null);
    setError(null);
    try {
      setReconcileResult(await recApi.reconcileRoles(guildId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reconcile roles.");
    } finally {
      setReconcileBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>
        After a coach replaces Discord on My Account, or if nicknames/roles drifted, force-set every
        linked member&apos;s server nickname to their team and grant the Member / Co-Commish /
        Commissioner role that matches their current assignment.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <Button variant="secondary" disabled={resyncBusy} onClick={() => void resyncNicknames()}>
          <Tag size={14} /> {resyncBusy ? "Syncing…" : "Resync Nicknames"}
        </Button>
        <Button variant="secondary" disabled={reconcileBusy} onClick={() => void reconcileRoles()}>
          <Users size={14} /> {reconcileBusy ? "Reconciling…" : "Reconcile Roles"}
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      {resyncResult && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <p className="form-hint" style={{ margin: 0 }}>
            Nicknames: <strong>{resyncResult.synced.length}</strong> updated, <strong>{resyncResult.failed.length}</strong> failed, <strong>{resyncResult.skipped.length}</strong> skipped.
          </p>
          {resyncResult.failed.length > 0 && (
            <ul style={{ color: "var(--danger, #e05252)", margin: "8px 0 0" }}>
              {resyncResult.failed.map((row) => (
                <li key={row.discordId}>&lt;@{row.discordId}&gt; → &quot;{row.nickname}&quot;: {row.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {reconcileResult && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <p className="form-hint" style={{ margin: 0 }}>
            Roles: <strong>{reconcileResult.corrected.length}</strong> corrected, <strong>{reconcileResult.alreadyCorrect}</strong> already correct, <strong>{reconcileResult.failed.length}</strong> failed.
          </p>
          {reconcileResult.corrected.length > 0 && (
            <ul style={{ margin: "8px 0 0" }}>
              {reconcileResult.corrected.map((row) => (
                <li key={row.discordId}>&lt;@{row.discordId}&gt;: {row.from.length ? row.from.join(", ") : "none"} → {row.to ?? "none"}</li>
              ))}
            </ul>
          )}
          {reconcileResult.failed.length > 0 && (
            <ul style={{ color: "var(--danger, #e05252)", margin: "8px 0 0" }}>
              {reconcileResult.failed.map((row) => (
                <li key={row.discordId}>&lt;@{row.discordId}&gt;: {row.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ImportAuditPanel({ guildId, leagueId }: { guildId: string; leagueId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);

  async function runAudit() {
    setBusy(true);
    setError(null);
    try {
      setReport(await recApi.auditMaddenEaImport({ guildId, leagueId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import audit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Check every week through the current week for missing scores, official results, team stats, or player stats that may not have landed from EA. Madden regular-season weeks have at most 16 games (fewer when teams are on bye).
      </p>
      <Button variant="secondary" disabled={busy} onClick={() => void runAudit()}>
        <Database size={14} /> {busy ? "Auditing…" : "Run Import Audit"}
      </Button>
      {error && <ErrorState message={error} />}
      {busy && !report && <LoadingState label="Auditing imported weeks…" />}
      {report && (
        <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <p className="form-hint" style={{ margin: 0 }}>
            {report.issueCount === 0
              ? `No missing import data through ${report.weeks[report.weeks.length - 1]?.label ?? `week ${report.currentWeek}`}.`
              : `${report.issueCount} gap${report.issueCount === 1 ? "" : "s"} found through week ${report.currentWeek}.`}
          </p>
          {report.weeks.map((week) => (
            <article key={week.weekNumber} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)" }}>
              <strong>{week.label}</strong>
              <span className="form-hint" style={{ display: "block", margin: "2px 0 0" }}>
                {week.scheduledGames} scheduled · {week.completedGames} completed · {week.unplayedGames} unplayed
              </span>
              {week.issues.length === 0
                ? <p className="form-hint" style={{ margin: "6px 0 0" }}>{week.unplayedGames && week.weekNumber === report.currentWeek ? "Current week still in progress." : "All imported data present."}</p>
                : <ul style={{ margin: "6px 0 0", paddingLeft: "1.2rem" }}>{week.issues.map((issue, index) => <li key={`${issue.kind}-${issue.gameId ?? index}`}>{issue.label}</li>)}</ul>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card style={{ padding: 0 }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          padding: "var(--space-3) var(--space-4)",
          fontWeight: 600,
          textAlign: "left",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title}
      </button>
      {open && (
        <div style={{ padding: "0 var(--space-4) var(--space-4)" }}>
          {children}
        </div>
      )}
    </Card>
  );
}
