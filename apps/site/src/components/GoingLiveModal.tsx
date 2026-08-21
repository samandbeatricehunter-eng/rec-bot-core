import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type StreamingMatchupOption } from "../lib/site-api.js";

const POLL_MS = 15_000;

export function GoingLiveModal() {
  const auth = useAuth();
  const [promptId, setPromptId] = useState<string | null>(null);
  const [matchups, setMatchups] = useState<StreamingMatchupOption[]>([]);
  const [platform, setPlatform] = useState<string | null>(null);
  const [gameId, setGameId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (auth.status !== "signed-in" || document.hidden) return;
    try {
      const next = await siteApi.getLiveStreamPrompt();
      if (next.prompt?.id && next.matchups.length) {
        setPromptId(next.prompt.id);
        setMatchups(next.matchups);
        setPlatform(next.session?.platform ?? null);
        setGameId((current) => current || next.prompt?.selected_game_id || next.matchups[0]?.gameId || "");
      } else {
        setPromptId(null);
        setMatchups([]);
      }
    } catch {
      /* keep the last prompt on a transient failure */
    }
  }

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setPromptId(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    function onVisible() {
      if (!document.hidden) void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [auth.status]);

  if (!promptId || !matchups.length) return null;

  async function confirm() {
    if (!promptId || !gameId) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.respondLiveStreamPrompt({ promptId, action: "confirm", gameId });
      setPromptId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm that matchup.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!promptId) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.respondLiveStreamPrompt({ promptId, action: "decline" });
      setPromptId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ignore this stream.");
    } finally {
      setBusy(false);
    }
  }

  const platformLabel = platform ? platform[0]!.toUpperCase() + platform.slice(1) : "your stream";

  return (
    <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="going-live-title">
      <div className="site-modal-panel">
        <h2 id="going-live-title">Going live for a league game?</h2>
        <p>
          {platformLabel} just went live. If this is for one of your REC matchups, pick it below
          and confirm. We&apos;ll post the stream about 3 minutes after you went live.
        </p>
        <label htmlFor="going-live-matchup">Matchup</label>
        <select
          id="going-live-matchup"
          value={gameId}
          disabled={busy}
          onChange={(event) => setGameId(event.target.value)}
        >
          {matchups.map((matchup) => (
            <option key={matchup.gameId} value={matchup.gameId}>
              {matchup.label}
            </option>
          ))}
        </select>
        {error ? <p className="site-auth-error">{error}</p> : null}
        <div className="site-modal-actions">
          <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => void decline()}>
            No
          </button>
          <button type="button" className="site-btn site-btn-primary" disabled={busy || !gameId} onClick={() => void confirm()}>
            {busy ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
