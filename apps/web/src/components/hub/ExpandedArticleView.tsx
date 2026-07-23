import { MessageCircle, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation.js";
import { MobileActionBar } from "../design-system/MobileActionBar.js";
import { Button } from "../ui/Button.js";
import type { HubResponse, StoryComment } from "../../types/api.js";
import { InterviewBody } from "./InterviewBody.js";

type Story = HubResponse["headlines"][number];

type ExpandedArticleViewProps = {
  stories: Story[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  comments: StoryComment[] | null;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  onSubmitComment: () => void;
  onReact: (storyId: string, reactionKey: "like" | "dislike") => void;
  onImageClick: (src: string) => void;
};

/** Full-screen mobile reading view for a headline/article — swiping left/right moves to
 * the adjacent story without closing the view (a dedicated component rather than an
 * extension of the generic Modal, which is used elsewhere for unrelated flows like Open
 * Teams that shouldn't gain swipe semantics by accident). */
export function ExpandedArticleView({ stories, activeIndex, onIndexChange, onClose, comments, commentBody, onCommentBodyChange, onSubmitComment, onReact, onImageClick }: ExpandedArticleViewProps) {
  const story = stories[activeIndex];
  const { handlers, dragOffsetPx, isDragging, reducedMotion } = useSwipeNavigation({
    itemCount: stories.length,
    onIndexChange,
  });
  if (!story) return null;

  return (
    <div className="expanded-article-overlay">
      <div
        className="expanded-article-surface"
        style={{
          transform: isDragging ? `translateX(${dragOffsetPx}px)` : undefined,
          transition: isDragging || reducedMotion ? "none" : "transform var(--duration-standard) var(--ease-standard)",
        }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <header className="expanded-article-header">
          <span className="expanded-article-index">{activeIndex + 1} / {stories.length}</span>
          <button type="button" className="expanded-article-close" onClick={onClose} aria-label="Close article">
            <X size={20} />
          </button>
        </header>
        <div className="expanded-article-body">
          <time>Week {story.week}</time>
          <h2>{story.headline ?? "League Story"}</h2>
          {story.image_url && <img className="expanded-article-image" src={story.image_url} alt="" onClick={() => onImageClick(story.image_url!)} />}
          <InterviewBody body={story.body} />
          {story.roundtable?.length ? (
            <div className="roundtable-panel">
              <div className="roundtable-banner">REC NETWORK · LEAGUE ROUNDTABLE</div>
              {story.roundtable.map((panelist) => (
                <article key={`${panelist.speaker}-${panelist.role}`}>
                  <div className="roundtable-avatar">{panelist.speaker.split(" ").map((part) => part[0]).join("")}</div>
                  <div>
                    <strong>{panelist.speaker}</strong>
                    <span>{panelist.role}</span>
                    <p>{panelist.take}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          <div className="story-comments">
            <h3><MessageCircle size={18} /> Comments</h3>
            {comments === null ? <p>Loading comments…</p> : comments.length ? comments.map((comment) => (
              <article key={comment.id}>
                <strong>{comment.authorName}</strong>
                <time>{new Date(comment.created_at).toLocaleString()}</time>
                <p>{comment.body}</p>
              </article>
            )) : <p className="hub-empty">No comments yet.</p>}
          </div>
        </div>
        <MobileActionBar>
          <button type="button" className={story.myReaction === "like" ? "active" : ""} onClick={() => onReact(story.id, "like")}>
            <ThumbsUp size={16} /> {story.reactionCounts.like}
          </button>
          <button type="button" className={story.myReaction === "dislike" ? "active" : ""} onClick={() => onReact(story.id, "dislike")}>
            <ThumbsDown size={16} /> {story.reactionCounts.dislike}
          </button>
          <input
            className="form-input"
            value={commentBody}
            onChange={(event) => onCommentBodyChange(event.target.value)}
            placeholder="Add to the discussion…"
          />
          <Button variant="primary" size="compact" disabled={!commentBody.trim()} onClick={onSubmitComment}>Post</Button>
        </MobileActionBar>
      </div>
    </div>
  );
}
