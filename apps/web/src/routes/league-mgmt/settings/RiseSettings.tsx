import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { FantasyDraftCard } from "../../hub/FantasyDraftCard.js";

// Reachable from League Mgmt regardless of chapter state -- unlike the normal hub route, which
// redirects an RTI member with no franchise yet straight to /rise, League Mgmt stays open the
// whole time. That's what lets the commissioner set the intro video and schedule/start the
// rookie draft before members have even finished Origins.
export function RiseSettings() {
  const { guildId } = useReadyAuth();
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      recApi.getLeagueHeaderSummary(guildId),
      recApi.getImmortalityIntroVideo(guildId).catch(() => null),
    ]).then(([header, hub]) => {
      setLeagueId(header.league.id);
      setUrl(hub?.introVideo?.url ?? "");
      setError(null);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load Rise to Immortality settings."))
      .finally(() => setLoading(false));
  }, [guildId]);

  async function saveIntroVideo() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await recApi.setImmortalityIntroVideo({ guildId, url: url.trim() || null });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save the intro video.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  return <>
    {error && <ErrorState message={error} />}
    <Card>
      <h3>Intro Video</h3>
      <p className="hub-muted">Members must watch this to the end before Origins unlocks. Leave blank to disable the gate.</p>
      <div className="form-row">
        <input className="form-input" value={url} onChange={(event) => { setUrl(event.target.value); setSaved(false); }} placeholder="https://…" />
        <Button variant="primary" disabled={busy} onClick={() => void saveIntroVideo()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {saved && <p style={{ color: "var(--success)" }}>Saved.</p>}
    </Card>
    {leagueId && <FantasyDraftCard guildId={guildId} leagueId={leagueId} />}
  </>;
}
