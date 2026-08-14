import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { FantasyDraftCard } from "./FantasyDraftCard.js";

export function FantasyDraftBoardPage() {
  const { guildId } = useReadyAuth();
  const hub = useHubChrome();
  const navigate = useNavigate();
  const leagueId = hub.currentLeague?.id ?? "";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!guildId || !leagueId) return;
    // Confirm session status before mounting — concluded drafts redirect to the league hub.
    recApi.getFantasyDraftState(guildId).then((state) => {
      if (cancelled) return;
      if (state.session?.status === "concluded") {
        navigate(`/l/${leagueId}`, { replace: true });
        return;
      }
      setReady(true);
    }).catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [guildId, leagueId, navigate]);

  if (!ready) return <div className="hub-section"><LoadingState label="Loading…" /></div>;

  return (
    <div className="hub-section">
      <Button variant="ghost" onClick={() => navigate(-1)}>Back to league</Button>
      <FantasyDraftCard guildId={guildId} leagueId={leagueId} />
    </div>
  );
}
