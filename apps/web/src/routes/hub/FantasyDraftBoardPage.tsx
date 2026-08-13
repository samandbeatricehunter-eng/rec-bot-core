import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { Button } from "../../components/ui/Button.js";
import { FantasyDraftCard } from "./FantasyDraftCard.js";

export function FantasyDraftBoardPage() {
  const { guildId } = useReadyAuth();
  const hub = useHubChrome();
  const navigate = useNavigate();
  return (
    <div className="hub-section">
      <Button variant="ghost" onClick={() => navigate(-1)}>Back to league</Button>
      <FantasyDraftCard guildId={guildId} leagueId={hub.currentLeague?.id ?? ""} />
    </div>
  );
}
