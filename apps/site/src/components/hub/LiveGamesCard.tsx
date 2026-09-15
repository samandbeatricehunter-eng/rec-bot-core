import { apiBaseUrl } from "../../lib/rec-api-client.js";
import { SectionFrame } from "../design-system/SectionFrame.js";
import type { HubResponse } from "../../types/api.js";

// Every active stream league-wide, right now — a live filter (posted_at within 2h AND
// ended_at is null) computed server-side in hub.service.ts, not a separate query here.
// ended_at is set early either when the stream itself is closed or when a box score lands for
// that game (createBoxScoreSubmission), so a game leaves this list the moment either happens.
export function LiveGamesCard({ liveStreams }: { liveStreams: HubResponse["liveStreams"] }) {
  if (!liveStreams.length) return null;
  return (
    <SectionFrame eyebrow="Right now" title="Live Games">
      <div className="hub-live-games">
        {liveStreams.map((stream) => {
          const streamerName = stream.user?.username || stream.user?.display_name || "A coach";
          return (
            <a
              key={stream.id}
              className="hub-live-game-row"
              href={`${apiBaseUrl()}${stream.watchPath}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="hub-live-game-dot" />
              <span className="hub-live-game-matchup">
                {stream.matchupLabel && <strong>{stream.matchupLabel}</strong>} {stream.awayTeamName ?? "Away"} at {stream.homeTeamName ?? "Home"}
              </span>
              <span className="hub-live-game-streamer">{streamerName}</span>
              <span className="hub-live-game-viewers">{stream.viewCount} viewer{stream.viewCount === 1 ? "" : "s"}</span>
            </a>
          );
        })}
      </div>
    </SectionFrame>
  );
}
