import { apiBaseUrl } from "../../lib/rec-api-client.js";
import type { HubMatchupGame } from "../../types/api.js";

/** Streams / watch links for a single game — shared by My Matchup and GOTW. */
export function MatchupGameMedia({ game }: { game: HubMatchupGame }) {
  if (!game.streams.length) {
    return (
      <section className="hub-matchup-media" aria-label="Game media">
        <header>
          <span>Game media</span>
          <small>Streams &amp; watch links</small>
        </header>
        <p className="hub-matchup-media-empty">No live streams posted for this matchup yet.</p>
      </section>
    );
  }

  return (
    <section className="hub-matchup-media" aria-label="Game media">
      <header>
        <span>Game media</span>
        <small>{game.streams.length} stream{game.streams.length === 1 ? "" : "s"}</small>
      </header>
      <div className="hub-matchup-media-list">
        {game.streams.map((stream) => (
          <a
            key={stream.streamLogId}
            className="hub-matchup-media-item"
            href={`${apiBaseUrl()}${stream.watchPath}`}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{stream.teamName}</strong>
            <span>{stream.side === "away" ? "Away" : "Home"} · live</span>
            <small>{stream.viewCount} viewer{stream.viewCount === 1 ? "" : "s"}</small>
          </a>
        ))}
      </div>
    </section>
  );
}
