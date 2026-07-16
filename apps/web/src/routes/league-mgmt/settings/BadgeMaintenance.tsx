import { useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

// Recomputes every active coach's game/season/career badges from the games already
// stored in rec_team_game_stats — safe to run any time, since badge progress is always
// re-derived from stored games rather than incremented. Normally this happens
// automatically on the next box score approval or league advance; this button exists
// for when a commissioner wants the trophy case to reflect this season's games right
// now instead of waiting for the next one.
export function BadgeMaintenance() {
  const { guildId } = useReadyAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recApi.refreshBadgeBaselines(guildId);
      setNotice(`Badges recomputed for ${result.usersUpdated} active coach${result.usersUpdated === 1 ? "" : "es"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh badge baselines.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Refresh Badge Baselines</h2>
      <p className="form-hint">
        Recomputes every active coach's badges from this season's stored games. Safe to run any time — badges are always
        re-derived from stored data, never incremented, so this can't double-count anything.
      </p>
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh Badges Now"}</Button>
    </Card>
  );
}
