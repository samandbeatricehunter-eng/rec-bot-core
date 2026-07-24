import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { PLAYER_STAT_CATEGORY_OPTIONS, PLAYER_STAT_FIELDS } from "../../lib/player-stat-fields.js";
import type { WatchedPlayer } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

function displayLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// A pending or approved box score for the game must already exist — the server enforces this
// (submitPlayerStatLine -> getBoxScoreUploadEligibility), and the caller is expected to only
// open this modal once matchup.boxScoreSubmissionId is set (same gating MatchupActions uses).
export function PlayerStatsModal({ guildId, onClose, onSubmitted }: { guildId: string; onClose: () => void; onSubmitted: () => void }) {
  const [watchedPlayers, setWatchedPlayers] = useState<WatchedPlayer[] | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [watchedPlayerId, setWatchedPlayerId] = useState("");
  const [category, setCategory] = useState("passing");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi.listMyWatchedPlayers({ guildId }).then((res) => setWatchedPlayers(res.players)).catch(() => setWatchedPlayers([]));
  }, [guildId]);

  async function handleSubmit() {
    const selected = watchedPlayers?.find((player) => player.id === watchedPlayerId);
    const name = selected?.playerName ?? playerName.trim();
    const statLines = (PLAYER_STAT_FIELDS[category] ?? []).flatMap(([statKey, label]) => {
      const raw = values[statKey]?.trim();
      if (!raw) return [];
      const value = Number(raw);
      return Number.isFinite(value) ? [{ statKey, label, value }] : [];
    });
    if (!name || !statLines.length) {
      setError("Pick or enter a player and add at least one stat.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.submitPlayerStatLine({ guildId, playerName: name, category, statLines });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Player stats submission failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Player Stats" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">Player</span>
        <select className="form-input" value={watchedPlayerId} onChange={(event) => setWatchedPlayerId(event.target.value)}>
          <option value="">Enter a new player</option>
          {(watchedPlayers ?? []).map((player) => (
            <option key={player.id} value={player.id}>{player.playerName} - {player.position}</option>
          ))}
        </select>
      </label>
      {!watchedPlayerId && (
        <label className="form-field">
          <span className="form-label">Player name</span>
          <input className="form-input" value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
        </label>
      )}
      <label className="form-field">
        <span className="form-label">Category</span>
        <select
          className="form-input"
          value={category}
          onChange={(event) => { setCategory(event.target.value); setValues({}); }}
        >
          {PLAYER_STAT_CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>{displayLabel(option)}</option>
          ))}
        </select>
      </label>
      <div className="hub-submission-grid">
        {(PLAYER_STAT_FIELDS[category] ?? []).map(([key, label]) => (
          <label className="form-field" key={key}>
            <span className="form-label">{label}</span>
            <input
              className="form-input"
              type="number"
              min="0"
              value={values[key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy}>
        {busy ? "Submitting…" : "Submit"}
      </Button>
    </Modal>
  );
}
