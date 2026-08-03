import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CfbRosterSeedStatus } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";

// Backlog #41 — CFB roster-seed advisory + "roll every player forward one season". Shows a
// commissioner whether their CFB league was seeded from the approved baseline dataset, lets
// them apply it in one click (auto-selects the approved+active dataset), and runs the annual
// class-year roll-forward (FR→SO→JR→SR, seniors graduate). All no-ops outside CFB leagues.
export function CfbRosterMaintenance() {
  const { guildId } = useReadyAuth();
  const [status, setStatus] = useState<CfbRosterSeedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [confirmingRoll, setConfirmingRoll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    recApi
      .getCfbRosterSeedStatus(guildId)
      .then((res) => {
        if (!cancelled) setStatus(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load roster seed status.");
      });
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  async function applyBaseline() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await recApi.applyCfbBaseline(guildId);
      const { teamsUpdated, playersCreated } = res.result;
      setNotice(`Baseline roster applied — ${playersCreated} players created, ${teamsUpdated} teams stamped.`);
      setStatus(res.status);
      setConfirmingApply(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply baseline roster.");
    } finally {
      setBusy(false);
    }
  }

  async function rollForward() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await recApi.rollForwardCfbRoster(guildId);
      setNotice(`Rolled forward — ${res.result.advanced} players advanced a class year, ${res.result.graduated} seniors graduated, ${res.result.skipped} skipped (no class year).`);
      setStatus(res.status);
      setConfirmingRoll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to roll roster forward.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <Card><ErrorState message={error} /></Card> : <Card><LoadingState /></Card>;
  if (!status.isCfb) return null;

  const canApply = !status.seeded && Boolean(status.dataset);
  const canRoll = status.players.active > 0;

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>CFB Roster Seed</h2>
      <p className="form-hint">
        {status.seeded
          ? `This league is seeded from the approved CFB baseline roster (${status.teams.stamped}/${status.teams.total} teams stamped, ${status.players.total} players).`
          : "This league has not been seeded with a CFB baseline roster. Applying it stamps each team with its source-team id and imports the full player set (rostered, protected default players)."}
      </p>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", margin: "var(--space-3) 0" }}>
        <Stat label="Teams stamped" value={`${status.teams.stamped}/${status.teams.total}`} />
        <Stat label="Players" value={String(status.players.total)} />
        <Stat label="Active" value={String(status.players.active)} />
        <Stat label="Default (baseline)" value={String(status.players.defaultPlayers)} />
        <Stat label="With class year" value={String(status.players.withClassYear)} />
      </div>

      {status.dataset ? (
        <p className="form-hint">
          Baseline dataset: <strong>{status.dataset.game_title}</strong> ({status.dataset.published_date})
        </p>
      ) : (
        <p className="form-hint">No approved + active CFB baseline dataset is registered — apply seeding is unavailable until one exists.</p>
      )}

      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-3)" }}>
        {!confirmingApply ? (
          <Button variant="secondary" disabled={busy || !canApply} onClick={() => setConfirmingApply(true)}>
            {status.seeded ? "Baseline Applied" : "Apply Baseline Roster"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={applyBaseline}>{busy ? "Applying…" : "Confirm — import the full baseline roster"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmingApply(false)}>Cancel</Button>
          </>
        )}

        {!confirmingRoll ? (
          <Button variant="secondary" disabled={busy || !canRoll} onClick={() => setConfirmingRoll(true)}>
            Roll Roster Forward One Season
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={rollForward}>{busy ? "Rolling…" : "Confirm — FR→SO→JR→SR, seniors graduate"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmingRoll(false)}>Cancel</Button>
          </>
        )}
      </div>

      <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
        Roll-forward is mechanical: it advances every rostered player one class year and graduates seniors. It never introduces new
        freshmen (re-seed or recruit for intake) and never clears a graduated player's team link.
      </p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{value}</div>
      <div className="form-hint" style={{ margin: 0 }}>{label}</div>
    </div>
  );
}
