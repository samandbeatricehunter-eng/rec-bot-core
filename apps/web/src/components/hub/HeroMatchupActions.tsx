import { Film, LifeBuoy, Share2 } from "lucide-react";
import type { HubMatchupGame } from "../../types/api.js";

export function HeroMatchupActions({
  matchup,
  onOpenShareStream,
  onUploadHighlight,
  onOpenRequestHelp,
}: {
  guildId: string;
  matchup: HubMatchupGame;
  onChanged: () => void;
  onOpenShareStream?: () => void;
  onUploadHighlight?: () => void;
  onOpenRequestHelp?: () => void;
}) {
  const isH2h = matchup.matchupType === "h2h";
  const requestHelpInactiveReason = isH2h ? undefined : "Request Help isn't available for bye weeks, the offseason, or CPU matchups.";

  if (!matchup.involvesMe) return null;

  return (
    <div className="hub-hero-action-area">
      <div className="matchup-actions hub-hero-game-actions" role="group" aria-label="Game tools">
        <button type="button" className="matchup-action" disabled={!onOpenShareStream} onClick={onOpenShareStream}><Share2 size={16} /> Share Stream</button>
        <button type="button" className="matchup-action" disabled={!onUploadHighlight} onClick={onUploadHighlight}><Film size={16} /> Upload Highlight(s)</button>
        <button type="button" className="matchup-action" disabled={!isH2h || !onOpenRequestHelp} title={requestHelpInactiveReason} onClick={onOpenRequestHelp}><LifeBuoy size={16} /> Request Help</button>
      </div>
    </div>
  );
}
