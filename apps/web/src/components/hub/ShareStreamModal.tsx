import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

type LinkedAccount = { platform: string; login: string; streamUrl: string };

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
  const [linked, setLinked] = useState<LinkedAccount[]>([]);
  const preferred = linked.find((row) => row.platform === "twitch") ?? linked[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    recApi.getHubStreamingAccounts({ guildId })
      .then((payload) => {
        if (!cancelled) setLinked(payload.accounts ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  async function handleSubmit(useLinked: boolean) {
    const trimmed = useLinked ? "" : url.trim();
    if (!useLinked && !trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.shareHubMatchupStream({ guildId, gameId, url: trimmed || undefined });
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
      {preferred ? (
        <div className="form-field">
          <p className="form-hint">
            Your {preferred.platform} account is linked ({preferred.login}). Posting will share{" "}
            {preferred.streamUrl} to this league&apos;s Discord streams channel, a {buzzLabel} Chat
            notice, and the Live Games board.
          </p>
          <Button variant="primary" onClick={() => void handleSubmit(true)} disabled={busy}>
            {busy ? "Sharing…" : `Post my ${preferred.platform} stream`}
          </Button>
        </div>
      ) : (
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
            Posts to this league&apos;s Discord streams channel (if linked), a {buzzLabel} Chat notice,
            and the Live Games board — plus a payout review if you&apos;re eligible this week.
            Link Twitch, YouTube, or TikTok under My Account → Linked accounts to skip pasting a URL.
          </p>
          <Button variant="primary" onClick={() => void handleSubmit(false)} disabled={!url.trim() || busy}>
            {busy ? "Sharing…" : "Share Stream"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
