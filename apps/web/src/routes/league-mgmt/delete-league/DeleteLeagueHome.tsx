import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueWeekView } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// Mirrors the Discord flow's three safety checkpoints (apps/bot/src/index-timeout.ts's
// handleLeagueMgmtDeleteLeague / deleteLeagueConfirm / handleDeleteLeagueModal), collapsed
// onto one page instead of a button → warning → modal sequence: the warning is always
// visible, and the Delete button stays disabled until the typed text exactly matches the
// league name (case-insensitive), same check the API enforces server-side.
export function DeleteLeagueHome() {
  const { guildId } = useReadyAuth();
  const [view, setView] = useState<LeagueWeekView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ leagueName: string; rowsDeleted: number } | null>(null);

  useEffect(() => {
    recApi
      .viewLeagueWeek(guildId)
      .then(setView)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league info."));
  }, [guildId]);

  const leagueName = view?.league?.name ?? "";
  const matches = confirmText.trim().length > 0 && confirmText.trim().toLowerCase() === leagueName.trim().toLowerCase();

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await recApi.deleteLeagueData({ guildId, confirmationText: confirmText });
      setResult({ leagueName: res.leagueName, rowsDeleted: Number(res.result?.rows_deleted ?? 0) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete league data.");
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Delete League" subtitle="Permanently erase this server's league data." />
      {error && <ErrorState message={error} />}
      {!view && !error && <LoadingState />}

      {view && !view.league && (
        <Card>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>No league is set up for this server, so there's nothing to delete.</p>
        </Card>
      )}

      {view?.league && !result && (
        <Card style={{ borderColor: "var(--error)" }}>
          <h2 style={{ marginTop: 0, color: "var(--error)" }}>WARNING: Delete League Data — Permanent</h2>
          <p>This deletes every league-scoped record for <strong>{leagueName}</strong>: teams, rosters, standings, game history, wallet ledger and purchases, badges/awards, active checks, streams, and all league settings.</p>
          <p>Kept: every member's Discord account, global career record, and wallet balance — and this Discord server itself, so you can re-run First-Time Setup afterward.</p>
          <p style={{ fontWeight: 700 }}>This cannot be undone.</p>

          <div className="form-field">
            <label className="form-label" htmlFor="confirm-league-name">Type the league name to confirm: {leagueName}</label>
            <input
              id="confirm-league-name"
              className="form-input"
              value={confirmText}
              disabled={busy}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={leagueName}
            />
          </div>
          <Button variant="danger" onClick={handleDelete} disabled={!matches || busy}>
            {busy ? "Deleting…" : "Delete League Data"}
          </Button>
        </Card>
      )}

      {result && (
        <Card>
          <h2 style={{ marginTop: 0, color: "var(--success)" }}>League Data Deleted</h2>
          <p>{result.leagueName} — {result.rowsDeleted} row(s) removed across league tables.</p>
          <p className="form-hint">Run First-Time Setup from Discord (/menu → League Mgmt → First-Time Setup) to set up a new league for this server.</p>
        </Card>
      )}
    </div>
  );
}
