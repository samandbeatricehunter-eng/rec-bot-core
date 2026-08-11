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

export function MaddenCompanionSettings({ leagueId, game }: { leagueId: string; game: string }) {
  const { guildId } = useReadyAuth();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!leagueId || !game.startsWith("madden_")) return;
    try {
      const result = await recApi.getMaddenCompanionConnections({ guildId, leagueId });
      setConnections(result.connections);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load Companion connection.");
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
  </Card>;
}
