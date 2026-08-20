import type { HubMatchupDetail } from "../../types/api.js";

// spec §6.2.B: one high-priority contextual prompt, not a stack of banners — cast GOTW pick,
// watch live, box score awaiting review, box score rejected, or missing required submission.
// Priority order below matches the spec's own ordering. Reuses the matchup detail data already
// loads; no new backend calls.
export function ActiveGamePrompt({
  detail,
  canUploadBoxScore,
  onOpenBoxScore,
  onVoteGotw,
  onWatchLive,
}: {
  detail: HubMatchupDetail;
  canUploadBoxScore: boolean;
  onOpenBoxScore: () => void;
  onVoteGotw: () => void;
  onWatchLive: () => void;
}) {
  const matchup = detail.matchup;
  const gotw = detail.gotw;

  let prompt: { kind: string; message: string; actionLabel: string; onAction: () => void } | null = null;

  if (matchup.boxScoreStatus === "denied") {
    prompt = {
      kind: "denied",
      message: matchup.boxScoreDeniedReason ? `Box score rejected: ${matchup.boxScoreDeniedReason}` : "Box score rejected — resubmission required.",
      actionLabel: "Resubmit",
      onAction: onOpenBoxScore,
    };
  } else if (canUploadBoxScore) {
    prompt = { kind: "missing", message: "This game needs a box score submitted.", actionLabel: "Upload Box Score", onAction: onOpenBoxScore };
  } else if (matchup.boxScoreStatus === "pending") {
    prompt = { kind: "pending", message: "Box score submitted — awaiting commissioner review.", actionLabel: "", onAction: () => undefined };
  } else if (gotw && gotw.status === "open" && gotw.canVote) {
    prompt = { kind: "gotw", message: "Game of the Week is open — cast your pick.", actionLabel: "Vote", onAction: onVoteGotw };
  } else if (!matchup.isFinal && matchup.streams.length > 0) {
    prompt = { kind: "live", message: "This game is live now.", actionLabel: "Watch", onAction: onWatchLive };
  }

  if (!prompt) return null;

  return (
    <div className={`matchup-active-prompt matchup-active-prompt--${prompt.kind}`}>
      <span>{prompt.message}</span>
      {prompt.actionLabel && (
        <button type="button" className="btn btn-primary" onClick={prompt.onAction}>
          {prompt.actionLabel}
        </button>
      )}
    </div>
  );
}
