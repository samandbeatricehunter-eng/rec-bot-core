import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { apiBaseUrl, recApi } from "../../../lib/rec-api-client.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";

type Connection = {
  id: string;
  status: string;
  external_league_id: string | null;
  last_health_status: string | null;
  last_health_check_at: string | null;
  last_import_at: string | null;
  import_count: number;
};

type ImportJob = { id: string; task_key: string; status: string; completed_at: string | null; record_count: number; rolled_back_at: string | null; duplicate_of_job_id: string | null };

function formatJobLabel(job: ImportJob): string {
  const when = job.completed_at ? new Date(job.completed_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown time";
  return `${job.task_key} — ${when} (${job.record_count} record${job.record_count === 1 ? "" : "s"})`;
}

export function MaddenCompanionSettings({ leagueId, game }: { leagueId: string; game: string }) {
  const { guildId } = useReadyAuth();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [rollbackJobId, setRollbackJobId] = useState("");
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);

  async function load() {
    if (!leagueId || !game.startsWith("madden_")) return;
    try {
      const [result, jobsResult] = await Promise.all([
        recApi.getMaddenCompanionConnections({ guildId, leagueId }),
        recApi.listMaddenCompanionImportJobs({ guildId, leagueId }),
      ]);
      setConnections(result.connections);
      setJobs(jobsResult.jobs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load Companion connection.");
    }
  }

  async function rollback() {
    if (!rollbackJobId) return;
    if (!window.confirm("Roll back this import? Any scores/data it changed will revert to what they were before it ran. This cannot be undone.")) return;
    setRollbackBusy(true);
    setRollbackNotice(null);
    try {
      const result = await recApi.rollbackMaddenCompanionImportJob({ guildId, leagueId, jobId: rollbackJobId });
      setRollbackNotice(`Reverted ${result.reverted} record${result.reverted === 1 ? "" : "s"}, cleared ${result.cleared}.`);
      setRollbackJobId("");
      await load();
    } catch (cause) {
      setRollbackNotice(cause instanceof Error ? cause.message : "Failed to roll back this import.");
    } finally {
      setRollbackBusy(false);
    }
  }

  useEffect(() => { void load(); }, [guildId, leagueId, game]);

  if (!game.startsWith("madden_")) return <Card><p>Madden Companion imports are available only for Madden 26 and Madden 27 leagues.</p></Card>;
  if (!leagueId) return <ErrorState message="This league is missing its settings identity. Reload the page and try again." />;
  if (!connections) return error ? <ErrorState message={error} /> : <LoadingState />;
  const active = connections.find((connection) => connection.status === "active") ?? null;

  async function generate(rotate: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = rotate && active
        ? await recApi.rotateMaddenCompanionConnection({ guildId, leagueId, connectionId: active.id })
        : await recApi.createMaddenCompanionConnection({ guildId, leagueId });
      setImportPath(result.import_path);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to generate Companion URLs.");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <h2 style={{ marginTop: 0 }}>Madden Companion App</h2>
    <p className="form-hint">Each URL is unique to this REC league. The URL controls where data is stored; an ID inside an export cannot redirect data into another league. Exact retries are ignored, while changed records are versioned for audit.</p>
    {error && <ErrorState message={error} />}
    {active && <div style={{ marginBottom: "var(--space-4)" }}>
      <p><strong>Status:</strong> Active{active.external_league_id ? ` · EA franchise ${active.external_league_id}` : " · awaiting first export"}</p>
      <p className="form-hint">{active.import_count} completed import{active.import_count === 1 ? "" : "s"}. Last result: {active.last_health_status ?? "No data received yet"}.</p>
    </div>}
    {!importPath && <Button disabled={busy} onClick={() => void generate(Boolean(active))}>{busy ? "Generating…" : active ? "Rotate and show new URL" : "Generate league import URL"}</Button>}
    {importPath && <>
      <p><strong>Copy this now.</strong> The same URL accepts full exports or any supported subset. For security, it is shown only after generation or rotation; rotating immediately disables the old URL.</p>
      <div className="form-field">
        <label className="form-label" htmlFor="companion-import-url">League Companion import URL</label>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <input id="companion-import-url" className="form-input" readOnly value={`${apiBaseUrl()}${importPath}`} />
          <Button variant="secondary" size="compact" onClick={() => void navigator.clipboard.writeText(`${apiBaseUrl()}${importPath}`)}>Copy</Button>
        </div>
      </div>
    </>}
    {jobs && jobs.some((job) => !job.rolled_back_at && !job.duplicate_of_job_id) && (
      <div style={{ marginTop: "var(--space-5)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
        <h3 style={{ marginTop: 0 }}>Rollback</h3>
        <p className="form-hint">Undo a faulty import — reverts every record it changed back to what it was immediately before that import ran.</p>
        <div className="form-field">
          <label className="form-label" htmlFor="companion-rollback-job">Import to roll back</label>
          <select id="companion-rollback-job" className="form-input" value={rollbackJobId} onChange={(e) => setRollbackJobId(e.target.value)}>
            <option value="">Select an import…</option>
            {jobs.filter((job) => !job.rolled_back_at && !job.duplicate_of_job_id).map((job) => (
              <option key={job.id} value={job.id}>{formatJobLabel(job)}</option>
            ))}
          </select>
        </div>
        <Button variant="danger" disabled={!rollbackJobId || rollbackBusy} onClick={() => void rollback()}>
          {rollbackBusy ? "Rolling back…" : "Roll Back This Import"}
        </Button>
        {rollbackNotice && <p className="form-hint" style={{ marginTop: "var(--space-2)" }}>{rollbackNotice}</p>}
      </div>
    )}
  </Card>;
}
