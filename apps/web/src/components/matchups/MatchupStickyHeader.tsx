import { Link } from "react-router-dom";
import { MessageCircle, MoreHorizontal } from "lucide-react";
import type { HubMatchupGame } from "../../types/api.js";

// spec §6.2.A: a compact header that stays reachable while scrolling a long Gameday Center
// page — team identity, live/final status, and quick jumps to chat and the action toolbar.
export function MatchupStickyHeader({
  matchup,
  gameChatLink,
  onOpenActions,
}: {
  matchup: HubMatchupGame;
  gameChatLink: string | null;
  onOpenActions: () => void;
}) {
  const isLive = !matchup.isFinal && matchup.streams.length > 0;
  return (
    <div className="matchup-sticky-header">
      <span className="matchup-sticky-header__teams">
        {matchup.awayTeamName} <span className="matchup-sticky-header__at">@</span> {matchup.homeTeamName}
      </span>
      {matchup.isFinal && matchup.homeScore != null && matchup.awayScore != null && (
        <span className="matchup-sticky-header__score">
          {matchup.awayScore}–{matchup.homeScore}
        </span>
      )}
      <span className={`matchup-sticky-header__status${isLive ? " is-live" : ""}`}>
        {matchup.isFinal ? "Final" : isLive ? "Live" : "Scheduled"}
      </span>
      <div className="matchup-sticky-header__actions">
        {gameChatLink && (
          <Link to={gameChatLink} className="matchup-sticky-header__icon-btn" aria-label="Open game chat">
            <MessageCircle size={16} />
          </Link>
        )}
        <button type="button" className="matchup-sticky-header__icon-btn" onClick={onOpenActions} aria-label="Jump to actions">
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
