import { useState } from "react";
import type { HubMatchupGame, MatchupPreview } from "../../types/api.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { MatchupCard } from "./MatchupCard.js";
import { HeroMatchupBreakdown } from "../hub/HeroMatchupBreakdown.js";

/** MatchupCard, collapsed by default -- tapping the card expands the same stat-comparison
 * breakdown the Discord game-channel render shows, fetched lazily on first expand (never
 * upfront for every card in a week's list, which would mean N preview fetches on page load). */
export function ExpandableMatchupCard({ game, featured = false }: { game: HubMatchupGame; featured?: boolean }) {
  const { guildId } = useReadyAuth();
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<MatchupPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setExpanded((current) => !current);
    if (!preview && !loading) {
      setLoading(true);
      setError(null);
      recApi.getMatchupPreview({ guildId, gameId: game.gameId })
        .then(setPreview)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load matchup breakdown."))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div className="hub-expandable-matchup">
      {/* Not `passive` -- that would stop the click at the card's own root before it ever
       * reaches this wrapper's handler. Reaction buttons inside the card already call their
       * own stopPropagation, so they keep working independently of this tap-to-expand. */}
      <div
        className="hub-expandable-matchup-trigger"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}
      >
        <MatchupCard game={game} featured={featured} />
      </div>
      {expanded && (
        <div className="hub-expandable-matchup-drawer">
          {loading && !preview ? <p className="hub-empty">Loading matchup breakdown…</p>
            : error ? <p className="hub-empty">{error}</p>
            : preview ? <HeroMatchupBreakdown preview={preview} />
            : null}
        </div>
      )}
    </div>
  );
}
