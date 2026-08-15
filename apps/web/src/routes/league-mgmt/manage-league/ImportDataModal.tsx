import { useEffect, useState } from "react";
import { apiBaseUrl, recApi, type EaConnection, type EaDataset, type EaFranchise, type EaImportProgressEvent, type EaImportResult } from "../../../lib/rec-api-client.js";
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

// Mirrors the server's ea-weeks.ts so the picker offers exactly what the import route will
// accept: preseason weeks 1-4, season displays 1-23 with the Pro Bowl (display 21) skipped.
const PLAYOFF_LABELS: Record<number, string> = {
  19: "Wild Card Round",
  20: "Divisional Round",
  21: "Conference Championship",
  23: "Super Bowl",
};
function seasonWeekLabel(displayWeek: number): string {
  if (displayWeek >= 1 && displayWeek <= 18) return `Week ${displayWeek}`;
  return PLAYOFF_LABELS[displayWeek] ?? `Week ${displayWeek}`;
}
const PRESEASON_DISPLAY_WEEKS = [1, 2, 3, 4];
// Display 22 is the Pro Bowl — reserved by EA but never exportable, so it's not offered.
const SEASON_DISPLAY_WEEKS = Array.from({ length: 23 }, (_, i) => i + 1).filter((w) => w !== 22);
type WeekMode = "current" | "week" | "span";

// Two-phase EA link: the commissioner opens EA's login page, pastes the redirect URL back,
// picks the gamertag (persona) that owns the franchise, and finally selects which of their
// franchises maps to this REC league. After that the connection is live and they can pull
// datasets on demand. Modeled on the existing companion-URL flow, but fully browser-driven.
export function ImportDataModal({
  guildId,
  leagueId,
  onClose,
  onManualEntry,
}: {
  guildId: string;
  leagueId: string;
  onClose: () => void;
  onManualEntry: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "ea" | "companion">("choose");
  const [companion, setCompanion] = useState<{ url: string; connectionId: string } | null>(null);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<EaConnection | null>(null);
  const [datasets, setDatasets] = useState<EaDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [personas, setPersonas] = useState<Array<{ personaId: number; displayName: string; name: string; namespaceName: string; console: string }> | null>(null);
  const [pendingAuthId, setPendingAuthId] = useState<string | null>(null);
  const [franchises, setFranchises] = useState<EaFranchise[] | null>(null);
  const [importResults, setImportResults] = useState<EaImportResult[] | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; task_key: string; status: string; completed_at: string | null; record_count: number; rolled_back_at: string | null; duplicate_of_job_id: string | null }> | null>(null);
  const [importProgress, setImportProgress] = useState<EaImportProgressEvent[]>([]);
  const [leagueName, setLeagueName] = useState<string | null>(null);

  async function loadStatus() {
    if (!guildId || !leagueId) {
      setLoading(false);
      setLoadError("Missing league context — close this window and try again from Manage League.");
      setConfigured(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setError(null);
    try {
      // Load health and status independently so a single failing call can't blank the modal.
      const healthResult = await recApi.getMaddenEaHealth().catch((cause) => {
        throw new Error(cause instanceof Error ? cause.message : "Failed to reach the EA import health check.");
      });
      setConfigured(Boolean(healthResult.configured));
      setDatasets(Array.isArray(healthResult.datasets) ? healthResult.datasets : []);

      if (!healthResult.configured) {
        setConnection(null);
        return;
      }

      const statusResult = await recApi.getMaddenEaStatus({ guildId, leagueId });
      setConnection(statusResult.connection);
      if (statusResult.connection) {
        const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId }).catch(() => ({ jobs: [] as NonNullable<typeof jobs> }));
        setJobs(jobsResult.jobs);
      } else {
        setJobs(null);
      }
    } catch (cause) {
      setConfigured((prev) => prev ?? false);
      setLoadError(cause instanceof Error ? cause.message : "Failed to check EA import status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, [guildId, leagueId]);

  const [selectedDatasets, setSelectedDatasets] = useState<EaDataset[]>([]);
  const [autoImport, setAutoImport] = useState(false);
  const [weekMode, setWeekMode] = useState<WeekMode>("current");
  const [weekStage, setWeekStage] = useState<0 | 1>(1);
  const [singleWeek, setSingleWeek] = useState(1);
  const [spanFrom, setSpanFrom] = useState(1);
  const [spanTo, setSpanTo] = useState(18);
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
    if (!connection || busy) return; // Prevent duplicate submissions
    setBusy(true); setBusyLabel("Connecting to EA…"); setError(null); setImportResults(null); setImportProgress([]);
    try {
      const weekRefs =
        weekMode === "current" ? undefined
        : weekMode === "week"
          ? [{ stage: weekStage, weekIndex: singleWeek - 1 }]
          : weekStage === 1
            ? SEASON_DISPLAY_WEEKS.filter((w) => w >= Math.min(spanFrom, spanTo) && w <= Math.max(spanFrom, spanTo))
                .map((w) => ({ stage: weekStage as 0 | 1, weekIndex: w - 1 }))
            : PRESEASON_DISPLAY_WEEKS.filter((w) => w >= Math.min(spanFrom, spanTo) && w <= Math.max(spanFrom, spanTo))
                .map((w) => ({ stage: weekStage as 0 | 1, weekIndex: w - 1 }));
      const result = await recApi.importMaddenEaDatasetsStream(
        { guildId, leagueId, connectionId: connection.id, datasets: selectedDatasets, weekRefs },
        (event) => {
          setImportProgress((prev) => [...prev, event]);
          if (event.type === "dataset_start") setBusyLabel(`Importing ${event.label}…`);
          if (event.type === "reconciling") setBusyLabel(event.step);
        },
      );
      setImportResults(result);
      setNotice(result.length ? "Import finished." : "Nothing to import with the selected datasets.");
      const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId }).catch(() => ({ jobs: [] }));
      setJobs(jobsResult.jobs);
      showImportNotification(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to import data from EA.";
      const isNetworkError = cause instanceof TypeError && message.toLowerCase().includes("network");
      if (isNetworkError) {
        setBusyLabel("Import running in background — checking for results…");
        const completed = await pollForImportCompletion();
        if (completed) {
          setNotice("Import completed. The connection timed out but the data was imported successfully.");
        } else {
          setError("Import is still running in the background. Results will appear in Recent Imports below once complete. Do not start another import until this one finishes.");
        }
      } else {
        setError(message);
      }
    }
    finally { setBusy(false); setBusyLabel(null); }
  }

  function showImportNotification(results: EaImportResult[]) {
    const succeeded = results.filter((r) => r.recordsStored > 0);
    const leagueLabel = connection?.eaLeagueName ?? "your league";
    const summary = succeeded.map((r) => `${r.label}: ${r.recordsStored} records`).join("\n");
    const body = succeeded.length
      ? `EA import for ${leagueLabel} completed.\n${summary}`
      : `EA import for ${leagueLabel} completed with no new data.`;
    try {
      if (Notification.permission === "granted") {
        new Notification("EA Import Complete", { body: summary || "No new data.", tag: `ea-import-${leagueId}` });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") new Notification("EA Import Complete", { body: summary || "No new data.", tag: `ea-import-${leagueId}` });
        });
      }
    } catch { /* Notification API not available */ }
  }

  /** Poll the jobs list every 5 seconds for up to 3 minutes waiting for a new import job. */
  async function pollForImportCompletion(): Promise<boolean> {
    const startedAt = Date.now();
    const initialJobIds = new Set((jobs ?? []).map((j) => j.id));
    while (Date.now() - startedAt < 180_000) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      try {
        const jobsResult = await recApi.listMaddenEaImportJobs({ guildId, leagueId });
        setJobs(jobsResult.jobs);
        const newJobs = jobsResult.jobs.filter((j) => !initialJobIds.has(j.id) && j.status === "completed");
        if (newJobs.length > 0) {
          setImportResults(newJobs.map((j) => ({
            dataset: j.task_key as EaDataset,
            label: j.task_key,
            importJobId: j.id,
            duplicate: false,
            recordsStored: j.record_count,
          })));
          return true;
        }
      } catch { /* ignore poll errors */ }
    }
    return false;
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

  async function generateCompanionUrl() {
    setCompanionBusy(true);
    setCompanionError(null);
    try {
      const existing = await recApi.getMaddenCompanionConnections({ guildId, leagueId }).catch(() => ({ connections: [] as Array<{ id: string; status: string }> }));
      const active = existing.connections.find((c) => c.status === "active");
      const result = active
        ? await recApi.rotateMaddenCompanionConnection({ guildId, leagueId, connectionId: active.id })
        : await recApi.createMaddenCompanionConnection({ guildId, leagueId });
      setCompanion({ url: `${apiBaseUrl()}${result.import_path}`, connectionId: active?.id ?? "" });
    } catch (cause) {
      setCompanionError(cause instanceof Error ? cause.message : "Failed to generate the Companion URL.");
    } finally {
      setCompanionBusy(false);
    }
  }

  if (mode === "choose") {
    return (
      <Modal title="Import Data" onClose={onClose}>
        <p className="form-hint">Choose how to get this league's data into REC.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={() => setMode("ea")}>Import via EA OAuth</Button>
          <p className="form-hint" style={{ margin: "-6px 0 0" }}>Link your EA account and pull rosters, scores, and stats straight from the game.</p>
          <Button variant="secondary" onClick={() => { setMode("companion"); void generateCompanionUrl(); }}>Import via Companion App</Button>
          <p className="form-hint" style={{ margin: "-6px 0 0" }}>Generate this league's unique URL to enter in the Madden Companion App for exports.</p>
          <Button variant="secondary" onClick={onManualEntry}>Input Data Manually</Button>
          <p className="form-hint" style={{ margin: "-6px 0 0" }}>Type in box scores, results, and player stat lines yourself — opens the manual entry page.</p>
        </div>
      </Modal>
    );
  }

  if (mode === "companion") {
    return (
      <Modal title="Import via Companion App" onClose={onClose}>
        {companionError && <ErrorState message={companionError} />}
        {companionBusy && <LoadingState label="Generating league URL…" />}
        {companion && (
          <>
            <p><strong>Copy this now.</strong> The same URL accepts full exports or any supported subset. For security it's shown only after generation; rotating immediately disables the old URL.</p>
            <div className="form-field">
              <label className="form-label" htmlFor="companion-import-url-modal">League Companion import URL</label>
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <input id="companion-import-url-modal" className="form-input" readOnly value={companion.url} />
                <Button variant="secondary" size="compact" onClick={() => void navigator.clipboard.writeText(companion.url)}>Copy</Button>
              </div>
            </div>
            <p className="form-hint">Enter this URL in the Madden Companion App under League Settings → Export, then export from the app after each advance.</p>
          </>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={() => setMode("choose")}>Back</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import via EA OAuth" onClose={onClose}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <Button variant="ghost" size="compact" onClick={() => setMode("choose")}>← All import options</Button>
      </div>
      {loading && <LoadingState label="Checking EA connection…" />}
      {!loading && loadError && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <ErrorState message={loadError} />
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" onClick={() => void loadStatus()}>Retry</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
      {!loading && !loadError && configured === false && (
        <>
          <p className="form-hint">Direct EA import isn't configured on this server yet (missing EA_CLIENT_SECRET / EA_TOKEN_ENC_KEY). Use the Madden Companion import URL under Settings → Integrations instead.</p>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      )}
      {!loading && !loadError && configured && (
        <>
          {error && <ErrorState message={error} />}
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
                    <p className="form-hint">Choose what to pull. Per-week stats (schedule, passing, rushing, receiving, defense, kicking, punting, team stats) follow the week selection below; rosters, free agents, teams, and standings are league-wide snapshots.</p>
                    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
                      <div className="form-field" style={{ margin: 0, minWidth: 170 }}>
                        <label className="form-label" htmlFor="ea-week-mode">Import for</label>
                        <select id="ea-week-mode" className="form-select" value={weekMode} onChange={(e) => setWeekMode(e.target.value as WeekMode)}>
                          <option value="current">Current week</option>
                          <option value="week">A specific week</option>
                          <option value="span">A range of weeks</option>
                        </select>
                      </div>
                      {weekMode !== "current" && (
                        <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
                          <label className="form-label" htmlFor="ea-week-stage">Season part</label>
                          <select id="ea-week-stage" className="form-select" value={weekStage} onChange={(e) => { setWeekStage(Number(e.target.value) as 0 | 1); setSingleWeek(1); setSpanFrom(1); setSpanTo(Number(e.target.value) === 0 ? 4 : 18); }}>
                            <option value={1}>Regular season &amp; playoffs</option>
                            <option value={0}>Preseason</option>
                          </select>
                        </div>
                      )}
                      {weekMode === "week" && (
                        <div className="form-field" style={{ margin: 0, minWidth: 190 }}>
                          <label className="form-label" htmlFor="ea-week-single">Week</label>
                          <select id="ea-week-single" className="form-select" value={singleWeek} onChange={(e) => setSingleWeek(Number(e.target.value))}>
                            {(weekStage === 1 ? SEASON_DISPLAY_WEEKS : PRESEASON_DISPLAY_WEEKS).map((w) => (
                              <option key={w} value={w}>{weekStage === 1 ? seasonWeekLabel(w) : `Preseason Week ${w}`}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {weekMode === "span" && (
                        <>
                          <div className="form-field" style={{ margin: 0, minWidth: 190 }}>
                            <label className="form-label" htmlFor="ea-week-from">From</label>
                            <select id="ea-week-from" className="form-select" value={spanFrom} onChange={(e) => setSpanFrom(Number(e.target.value))}>
                              {(weekStage === 1 ? SEASON_DISPLAY_WEEKS : PRESEASON_DISPLAY_WEEKS).map((w) => (
                                <option key={w} value={w}>{weekStage === 1 ? seasonWeekLabel(w) : `Preseason Week ${w}`}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-field" style={{ margin: 0, minWidth: 190 }}>
                            <label className="form-label" htmlFor="ea-week-to">Through</label>
                            <select id="ea-week-to" className="form-select" value={spanTo} onChange={(e) => setSpanTo(Number(e.target.value))}>
                              {(weekStage === 1 ? SEASON_DISPLAY_WEEKS : PRESEASON_DISPLAY_WEEKS).map((w) => (
                                <option key={w} value={w}>{weekStage === 1 ? seasonWeekLabel(w) : `Preseason Week ${w}`}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>
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
                        {busy ? (busyLabel ?? "Import in progress…") : "Import Now"}
                      </Button>
                    </div>
                  </Card>

                  {importProgress.length > 0 && (
                    <Card style={{ padding: "var(--space-3)" }}>
                      <h4 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-sm)" }}>Import Progress</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {importProgress.map((event, i) => {
                          if (event.type === "starting") return <ProgressLine key={i} icon="⏳" text={`Starting import — ${event.datasets.join(", ")}`} />;
                          if (event.type === "dataset_start") return <ProgressLine key={i} icon="⏳" text={`${event.label} — fetching…`} />;
                          if (event.type === "dataset_done") return <ProgressLine key={i} icon="✅" text={`${event.label} — ${event.records} record${event.records === 1 ? "" : "s"}${event.duplicate ? " (no changes)" : ""}`} />;
                          if (event.type === "dataset_error") return <ProgressLine key={i} icon="❌" text={`${event.label} — ${event.error}`} isError />;
                          if (event.type === "reconciling") return <ProgressLine key={i} icon="⏳" text={event.step} />;
                          if (event.type === "done") return <ProgressLine key={i} icon="✅" text="Import complete!" />;
                          if (event.type === "error") return <ProgressLine key={i} icon="❌" text={event.error} isError />;
                          return null;
                        })}
                      </div>
                    </Card>
                  )}

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

                  <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
                    <Button variant="secondary" disabled={busy} onClick={() => {
                      if (!window.confirm("Reset roster? This removes all players without an EA ID so the next import repopulates from EA.")) return;
                      recApi.wipeBaselineRoster({ guildId, leagueId }).then((r) => setNotice(`Wiped ${r.wiped} players. Run an import now to repopulate from EA.`)).catch((e) => setError(e instanceof Error ? e.message : "Failed to wipe roster."));
                    }}>
                      Reset Roster from EA
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => {
                      setBusy(true); setBusyLabel("Backfilling scores…");
                      recApi.backfillEaScores({ guildId, leagueId }).then((r: any) => {
                        const g = r.games;
                        const res = r.results;
                        const sample = r.sampleGames ?? [];
                        if (g) {
                          const sampleInfo = sample.length
                            ? `\nLatest games: ${sample.map((s: any) => `${s.source}/${s.status} score=${s.home_score}-${s.away_score} teams=${s.home_team_id ?? 'null'}-${s.away_team_id ?? 'null'}`).join('; ')}`
                            : '\nNo games found in rec_games.';
                          setNotice(`Games: ${g.total_games} total, ${g.companion_games} EA, ${g.completed} completed, ${g.with_scores} w/scores, ${g.ready} ready. Results: ${res?.total ?? 0} total, ${res?.companion_import ?? 0} EA.${sampleInfo}`);
                        } else {
                          setNotice("Backfill complete.");
                        }
                      }).catch((e: any) => setError(e instanceof Error ? e.message : "Failed to backfill scores.")).finally(() => { setBusy(false); setBusyLabel(null); });
                    }}>
                      Backfill Scores
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
                      {busy && busyLabel === "Disconnecting…" ? "Disconnecting…" : "Disconnect from EA"}
                    </Button>
                  </div>
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

function ProgressLine({ icon, text, isError }: { icon: string; text: string; isError?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: isError ? "var(--error)" : "var(--text-secondary)" }}>
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{ wordBreak: "break-word" }}>{text}</span>
    </div>
  );
}
