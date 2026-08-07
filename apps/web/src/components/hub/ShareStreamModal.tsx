import { useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

export function ShareStreamModal({
  guildId,
  gameId,
  onClose,
  onSubmitted,
}: {
  guildId: string;
  gameId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const hub = useHubChrome();
  const buzzLabel = hub.currentLeague?.game?.startsWith("madden") ? "League News" : "Campus Buzz";
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.shareHubMatchupStream({ guildId, gameId, url: trimmed });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share stream.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Share Stream" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="form-field">
        <label className="form-label" htmlFor="share-stream-url">Stream URL</label>
        <input
          id="share-stream-url"
          className="form-input"
          type="url"
          placeholder="https://twitch.tv/yourchannel"
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
        />
        <p className="form-hint">
          Posts to this league's Discord streams channel (if linked), a {buzzLabel} Chat notice,
          and the Live Games board — plus a payout review if you're eligible this week.
        </p>
      </div>
      <Button variant="primary" onClick={() => void handleSubmit()} disabled={!url.trim() || busy}>
        {busy ? "Sharing…" : "Share Stream"}
      </Button>
    </Modal>
  );
}
