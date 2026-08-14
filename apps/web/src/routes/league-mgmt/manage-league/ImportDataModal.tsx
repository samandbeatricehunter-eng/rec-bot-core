import { useEffect, useState } from "react";
import { recApi, type EaConnection, type EaDataset, type EaFranchise, type EaImportResult } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const EA_DATASET_LABELS: Record<EaDataset, string> = {
  teams: "Teams",
  standings: "Standings",
  schedule: "Schedule & scores",
  rosters: "Team rosters",
  free_agents: "Free agents",
  passing: "Passing stats",
  rushing: "Rushing stats",
  receiving: "Receiving stats",
  defense: "Defensive stats",
  kicking: "Kicking stats",
  punting: "Punting stats",
  team_stats: "Team stats",
};

// Two-phase EA link: the commissioner opens EA's login page, pastes the redirect URL back,
// picks the gamertag (persona) that owns the franchise, and finally selects which of their
// franchises maps to this REC league. After that the connection is live and they can pull
// datasets on demand. Modeled on the existing companion-URL flow, but fully browser-driven.
export function ImportDataModal({
  guildId,
  leagueId,
  onClose,
}: {
  guildId: string;
  leagueId: string;
  onClose: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<EaConnection | null>(null);
  const [datasets, setDatasets] = useState<EaDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [personas, setPersonas] = useState<Array<{ personaId: number; displayName: string; name: string; namespaceName: string; console: string }> | null>(null);
  const [pendingAuthId, setPendingAuthId] = useState<string | null>(null);
  const [franchises, setFranchises] = useState<EaFranchise[] | null>(null);
  const [importResults, setImportResults] = useState<EaImportResult[] | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; task_key: string; status: string; completed_at: string | null; record_count: number; rolled_back_at: string | null; duplicate_of_job_id: string | null }> | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const [health, status] = await Promise.all([
        recApi.getMaddenEaHealth(),
        recApi.getMaddenEaStatus({ guildId, leagueId }),
      ]);
      setConfigured(health.configured);
      setDatasets(health.datasets);
      setConnection(status.connection);
      if (status.connection) {
        const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId }).catch(() => ({ jobs: [] }));
        setJobs(jobsResult.jobs);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to check EA import status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, [guildId, leagueId]);

  const [selectedDatasets, setSelectedDatasets] = useState<EaDataset[]>([]);
  const [autoImport, setAutoImport] = useState(false);
  useEffect(() => {
    if (connection) {
      setSelectedDatasets(connection.enabledDatasets);
      setAutoImport(connection.autoImport);
    }
  }, [connection]);

  function toggleDataset(dataset: EaDataset) {
    setSelectedDatasets((current) => current.includes(dataset) ? current.filter((d) => d !== dataset) : [...current, dataset]);
  }

  async function connect() {
    setBusy(true); setBusyLabel("Opening EA login…"); setError(null);
    try {
      const result = await recApi.beginMaddenEaLogin({ guildId, leagueId });
      setLoginUrl(result.loginUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to start EA login."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function submitCode() {
    if (!pasted.trim()) { setError("Paste the full URL from your browser's address bar after logging in."); return; }
    setBusy(true); setBusyLabel("Verifying EA login…"); setError(null);
    try {
      const result = await recApi.submitMaddenEaCode({ guildId, leagueId, pasted });
      setPendingAuthId(result.pendingAuthId);
      setPersonas(result.personas);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to verify the EA login."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function pickPersona(personaId: number) {
    if (!pendingAuthId) return;
    setBusy(true); setBusyLabel("Linking gamertag…"); setError(null);
    try {
      const result = await recApi.selectMaddenEaPersona({ guildId, leagueId, pendingAuthId, personaId });
      setConnection(result.connection);
      setPersonas(null);
      setPendingAuthId(null);
      setLoginUrl(null);
      if (result.connection.eaLeagueId) {
        setNotice("EA account linked. You can now import data for this league.");
        const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId }).catch(() => ({ jobs: [] }));
        setJobs(jobsResult.jobs);
      } else {
        const leagues = await recApi.listMaddenEaLeagues({ guildId, leagueId, connectionId: result.connection.id });
        setFranchises(leagues.leagues);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to link your gamertag."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function bindFranchise(eaLeagueId: number) {
    if (!connection) return;
    setBusy(true); setBusyLabel("Binding franchise…"); setError(null);
    try {
      const result = await recApi.bindMaddenEaLeague({ guildId, leagueId, connectionId: connection.id, eaLeagueId });
      setConnection(result.connection);
      setFranchises(null);
      setNotice(`Bound to ${result.connection.eaLeagueName ?? "your franchise"}. Ready to import.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to bind the franchise."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function saveSettings() {
    if (!connection || !selectedDatasets.length) return;
    setBusy(true); setBusyLabel("Saving settings…"); setError(null);
    try {
      const result = await recApi.updateMaddenEaSettings({ guildId, leagueId, connectionId: connection.id, datasets: selectedDatasets, autoImport });
      setConnection(result.connection);
      setNotice("Import settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to save settings."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function runImport() {
    if (!connection) return;
    setBusy(true); setBusyLabel("Pulling data from EA…"); setError(null); setImportResults(null);
    try {
      const result = await recApi.importMaddenEaDatasets({ guildId, leagueId, connectionId: connection.id, datasets: selectedDatasets });
      setImportResults(result.imports);
      setNotice(result.imports.length ? "Import finished." : "Nothing to import with the selected datasets.");
      const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId }).catch(() => ({ jobs: [] }));
      setJobs(jobsResult.jobs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to import data from EA."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  async function disconnect() {
    if (!connection) return;
    if (!window.confirm("Disconnect this league from EA? Saved connections are removed and you'll need to re-link to import again.")) return;
    setBusy(true); setBusyLabel("Disconnecting…"); setError(null);
    try {
      await recApi.disconnectMaddenEaConnection({ guildId, leagueId, connectionId: connection.id });
      setConnection(null); setJobs(null); setImportResults(null);
      setNotice("Disconnected from EA.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to disconnect."); }
    finally { setBusy(false); setBusyLabel(null); }
  }

  return (
    <Modal title="Import Data" onClose={onClose}>
      {loading && <LoadingState label="Checking EA connection…" />}
      {!loading && configured === false && (
        <>
          <p className="form-hint">Direct EA import isn't configured on this server. Use the Madden Companion import URL (Settings → Integrations) instead.</p>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      )}
      {!loading && configured && error && <ErrorState message={error} />}
      {!loading && configured && !error && (
        <>
          {notice && <p className="form-hint" style={{ color: "var(--gold)" }}>{notice}</p>}

          {connection ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <Card>
                <h3 style={{ marginTop: 0 }}>EA connection</h3>
                <p style={{ margin: 0 }}>
                  <strong>{connection.personaDisplayName ?? "Linked gamertag"}</strong> ({connection.console || "console"})
                  {connection.eaLeagueName ? <> · <strong>{connection.eaLeagueName}</strong>{connection.eaSeasonYear ? ` (${connection.eaSeasonYear})` : ""}</> : " · no franchise bound yet"}
                </p>
                <p className="form-hint">
                  Status: {connection.status}{connection.lastImportAt ? ` · Last import ${new Date(connection.lastImportAt).toLocaleString()}` : " · No import yet"}.
                  {connection.lastError ? ` Last error: ${connection.lastError}.` : ""} EA connections expire after about ten days of inactivity; re-link when imports start failing.
                </p>
              </Card>

              {!connection.eaLeagueId && (
                <Card>
                  <h3 style={{ marginTop: 0 }}>Which EA franchise is this league?</h3>
                  {!franchises && <p className="form-hint">Loading your franchises…</p>}
                  {franchises?.length === 0 && <p className="form-hint">No Madden franchise found for this gamertag. Open one in Madden and try again.</p>}
                  {franchises && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      {franchises.map((franchise) => (
                        <Button key={franchise.leagueId} variant="secondary" disabled={busy} onClick={() => void bindFranchise(franchise.leagueId)}>
                          {franchise.leagueName} ({franchise.seasonText}, {franchise.calendarYear}) — {franchise.numMembers} members · your team: {franchise.userTeamName}
                        </Button>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {connection.eaLeagueId && (
                <>
                  <Card>
                    <h3 style={{ marginTop: 0 }}>Datasets</h3>
                    <p className="form-hint">Choose what to pull. Per-week stats (schedule, passing, rushing, receiving, defense, kicking, punting, team stats) sync to the current week; rosters, free agents, teams, and standings are league-wide snapshots.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-2)" }}>
                      {datasets.map((dataset) => (
                        <label key={dataset} className="manual-checkbox" style={{ marginTop: 0 }}>
                          <input type="checkbox" checked={selectedDatasets.includes(dataset)} onChange={() => toggleDataset(dataset)} />
                          <span>{EA_DATASET_LABELS[dataset]}</span>
                        </label>
                      ))}
                    </div>
                    <div className="form-field" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
                      <label className="manual-checkbox" style={{ marginTop: 0 }}>
                        <input type="checkbox" checked={autoImport} onChange={(e) => setAutoImport(e.target.checked)} />
                        <span>Auto-import enabled datasets whenever new data is available</span>
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                      <Button variant="secondary" disabled={busy || !selectedDatasets.length} onClick={() => void saveSettings()}>
                        {busy && busyLabel === "Saving settings…" ? "Saving…" : "Save Settings"}
                      </Button>
                      <Button disabled={busy || !selectedDatasets.length} onClick={() => void runImport()}>
                        {busy && busyLabel === "Pulling data from EA…" ? "Importing…" : "Import Now"}
                      </Button>
                    </div>
                  </Card>

                  {importResults && (
                    <Card>
                      <h3 style={{ marginTop: 0 }}>Last import</h3>
                      {importResults.map((result) => (
                        <p key={result.dataset} style={{ margin: "var(--space-1) 0" }}>
                          {result.label}: {result.recordsStored} record{result.recordsStored === 1 ? "" : "s"}{result.duplicate ? " (duplicate — no changes)" : ""}
                        </p>
                      ))}
                    </Card>
                  )}

                  {jobs && jobs.some((job) => !job.rolled_back_at && !job.duplicate_of_job_id) && (
                    <Card>
                      <h3 style={{ marginTop: 0 }}>Recent imports</h3>
                      {jobs.filter((job) => !job.rolled_back_at && !job.duplicate_of_job_id).slice(0, 10).map((job) => (
                        <p key={job.id} className="form-hint" style={{ margin: "var(--space-1) 0" }}>
                          {job.task_key} — {job.completed_at ? new Date(job.completed_at).toLocaleString() : job.status} ({job.record_count} record{job.record_count === 1 ? "" : "s"})
                        </p>
                      ))}
                    </Card>
                  )}

                  <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
                    {busy && busyLabel === "Disconnecting…" ? "Disconnecting…" : "Disconnect from EA"}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <p className="form-hint">
                Link this league to an EA account to pull rosters, scores, and stats straight from the game. You'll sign in with EA in a new tab, paste the redirect URL back here, pick your gamertag, and choose the franchise.
              </p>
              {!loginUrl && (
                <div><Button disabled={busy} onClick={() => void connect()}>{busy ? "Opening…" : "Connect EA Account"}</Button></div>
              )}
              {loginUrl && (
                <>
                  <div className="form-field">
                    <label className="form-label" htmlFor="ea-login-url">1. Open this EA login link</label>
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <input id="ea-login-url" className="form-input" readOnly value={loginUrl} />
                      <Button variant="secondary" size="compact" onClick={() => void navigator.clipboard.writeText(loginUrl)}>Copy</Button>
                    </div>
                    <p className="form-hint">Sign in and allow access. The link expires shortly.</p>
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="ea-pasted-url">2. Paste the full URL you land on after signing in</label>
                    <textarea id="ea-pasted-url" className="form-input" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://signin.ea.com/…" />
                  </div>
                  <div><Button disabled={busy || !pasted.trim()} onClick={() => void submitCode()}>{busy ? "Verifying…" : "Verify & Continue"}</Button></div>
                </>
              )}
              {personas && (
                <>
                  <h3 style={{ margin: 0 }}>Pick your gamertag</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {personas.map((persona) => (
                      <Button key={persona.personaId} variant="secondary" disabled={busy} onClick={() => void pickPersona(persona.personaId)}>
                        {persona.displayName || persona.name} ({persona.console})
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
