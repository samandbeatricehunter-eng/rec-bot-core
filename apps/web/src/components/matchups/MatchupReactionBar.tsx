import { useState } from "react";
import { Award, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import type { HubMatchupGame } from "../../types/api.js";

type Props = {
  game: HubMatchupGame;
  busy?: boolean;
  onLike: () => void;
  onDislike: () => void;
  onSubmitGoty: (comment: string) => Promise<void> | void;
  onClearGoty: () => Promise<void> | void;
};

export function MatchupReactionBar({
  game,
  busy = false,
  onLike,
  onDislike,
  onSubmitGoty,
  onClearGoty,
}: Props) {
  const [gotyOpen, setGotyOpen] = useState(false);
  const [comment, setComment] = useState(game.myGotyComment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liked = game.myReactions?.includes("like") ?? false;
  const disliked = game.myReactions?.includes("dislike") ?? false;
  const nominated = game.myReactions?.includes("goty") ?? false;

  function openGoty() {
    setComment(game.myGotyComment ?? "");
    setError(null);
    setGotyOpen(true);
  }

  async function submitGoty() {
    setSaving(true);
    setError(null);
    try {
      await onSubmitGoty(comment.trim());
      setGotyOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save GOTY nomination.");
    } finally {
      setSaving(false);
    }
  }

  async function clearGoty() {
    setSaving(true);
    setError(null);
    try {
      await onClearGoty();
      setGotyOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove GOTY nomination.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="matchup-reaction-bar" role="group" aria-label="Matchup reactions">
        <button
          type="button"
          className={`matchup-reaction${liked ? " is-active" : ""}`}
          disabled={busy || saving}
          onClick={onLike}
          title="Like this matchup"
        >
          <ThumbsUp size={16} />
          <span>Like</span>
          {game.reactionCounts?.like > 0 ? <b>{game.reactionCounts.like}</b> : null}
        </button>
        <button
          type="button"
          className={`matchup-reaction${disliked ? " is-active" : ""}`}
          disabled={busy || saving}
          onClick={onDislike}
          title="Dislike this matchup"
        >
          <ThumbsDown size={16} />
          <span>Dislike</span>
          {game.reactionCounts?.dislike > 0 ? <b>{game.reactionCounts.dislike}</b> : null}
        </button>
        <button
          type="button"
          className={`matchup-reaction matchup-reaction--goty${nominated ? " is-active" : ""}`}
          disabled={busy || saving}
          onClick={openGoty}
          title="Nominate for Game of the Year"
        >
          <Award size={16} />
          <span>GOTY</span>
          {game.reactionCounts?.goty > 0 ? <b>{game.reactionCounts.goty}</b> : null}
        </button>
      </div>

      {gotyOpen ? (
        <Modal title="Game of the Year" onClose={() => (!saving ? setGotyOpen(false) : undefined)}>
          <p className="matchup-goty-modal__lead">
            Nominate <strong>{game.awayTeamName}</strong> @ <strong>{game.homeTeamName}</strong> for
            Game of the Year. Add an optional short note.
          </p>
          <label className="matchup-goty-modal__label" htmlFor={`goty-comment-${game.gameId}`}>
            Brief comment
          </label>
          <textarea
            id={`goty-comment-${game.gameId}`}
            className="matchup-goty-modal__input"
            maxLength={280}
            rows={3}
            value={comment}
            disabled={saving}
            placeholder="What made this game special?"
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="matchup-goty-modal__count">{comment.length}/280</div>
          {error ? <p className="matchup-goty-modal__error">{error}</p> : null}
          <div className="matchup-goty-modal__actions">
            {nominated ? (
              <Button variant="ghost" disabled={saving} onClick={() => void clearGoty()}>
                Remove nomination
              </Button>
            ) : (
              <Button variant="ghost" disabled={saving} onClick={() => setGotyOpen(false)}>
                Cancel
              </Button>
            )}
            <Button variant="primary" disabled={saving} onClick={() => void submitGoty()}>
              {nominated ? "Update nomination" : "Nominate for GOTY"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
