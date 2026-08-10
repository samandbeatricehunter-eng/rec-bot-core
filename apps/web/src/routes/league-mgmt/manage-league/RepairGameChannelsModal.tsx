import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Candidate = { gameId: string; name: string; hasActiveChannel: boolean };

// Two ways to repair: wipe every current-week game channel and recreate the whole slate
// (createGameChannelsForCurrentWeek), or pick specific matchups via checkbox and only
// wipe+recreate those (recreateGameChannelsForGames) — everything else stays untouched.
export function RepairGameChannelsModal({
  guildId,
  onClose,
  onDone,
}: {
  guildId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"choose" | "wipe-all">("choose");

  useEffect(() => {
    recApi
      .listCurrentWeekGameChannelCandidates(guildId)
      .then((res) => {
        setCandidates(res.candidates);
        setSelected(new Set(res.candidates.map((c) => c.gameId)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's matchups."));
  }, [guildId]);

  function toggle(gameId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  async function wipeAll() {
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.createGameChannelsForCurrentWeek(guildId);
      onDone(`Wiped and recreated all game channels: ${result.created.length} created, ${result.deleted} old channel${result.deleted === 1 ? "" : "s"} removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to wipe and recreate game channels.");
    } finally {
      setBusy(false);
    }
  }

  async function recreateSelected() {
    const gameIds = [...selected];
    if (!gameIds.length) { setError("Select at least one matchup to recreate."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.recreateGameChannelsForGames({ guildId, gameIds });
      onDone(`Recreated ${result.created.length} game channel${result.created.length === 1 ? "" : "s"} (${result.deleted} old channel${result.deleted === 1 ? "" : "s"} removed).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recreate the selected game channels.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Repair Game Channels" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!candidates && !error && <LoadingState />}
      {candidates && (
        <div>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Wipe and recreate every current-week game channel, or pick specific matchups below to
            wipe and recreate just those — everything else is left alone either way.
          </p>

          <div className="site-profile-actions" style={{ marginBottom: "var(--space-4)" }}>
            <Button variant={mode === "wipe-all" ? "primary" : "secondary"} onClick={() => setMode("wipe-all")} disabled={busy}>
              Wipe all &amp; recreate
            </Button>
            <Button variant={mode === "choose" ? "primary" : "secondary"} onClick={() => setMode("choose")} disabled={busy}>
              Choose specific channels
            </Button>
          </div>

          {mode === "wipe-all" ? (
            <div>
              <p style={{ color: "var(--text-secondary)" }}>
                This deletes every tracked game channel for this week ({candidates.length} total) and
                creates a fresh one for each current-week matchup.
              </p>
              <Button variant="primary" onClick={() => void wipeAll()} disabled={busy}>
                {busy ? "Wiping & recreating…" : `Wipe all ${candidates.length} & recreate`}
              </Button>
            </div>
          ) : (
            <div>
              {candidates.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No current-week matchups found.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
                {candidates.map((c) => (
                  <label key={c.gameId} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input type="checkbox" checked={selected.has(c.gameId)} onChange={() => toggle(c.gameId)} disabled={busy} />
                    <span>{c.name}{c.hasActiveChannel ? "" : " (no channel yet)"}</span>
                  </label>
                ))}
              </div>
              {candidates.length > 0 && (
                <Button variant="primary" onClick={() => void recreateSelected()} disabled={busy || selected.size === 0}>
                  {busy ? "Recreating…" : `Recreate ${selected.size} selected`}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
