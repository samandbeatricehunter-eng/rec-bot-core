import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play, RotateCcw, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { useAuth } from "../lib/auth-context.js";
import { HeroCard } from "../components/HeroCard.js";
import { useSwipeNavigation } from "../hooks/useSwipeNavigation.js";
import { useStreamPlayerControls } from "../hooks/useStreamPlayerControls.js";
import {
  siteApi,
  type LinkProfileResponse,
  type SiteAnnouncement,
  type SiteHomeCard,
  type SpotlightItem,
} from "../lib/site-api.js";

const ANNOUNCEMENT_MS = 8000;

function safeAnnouncementHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function HomePage() {
  const auth = useAuth();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);
  const [card, setCard] = useState<SiteHomeCard | null>(null);
  const [announcements, setAnnouncements] = useState<SiteAnnouncement[]>([]);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightItem[]>([]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let cancelled = false;
    Promise.all([
      siteApi.getLinkProfile().catch(() => null),
      siteApi.getHomeCard().catch(() => null),
      siteApi.listSiteAnnouncements().catch(() => ({ announcements: [] as SiteAnnouncement[] })),
      siteApi.getSpotlightReel().catch(() => ({ items: [] as SpotlightItem[], selectedAt: null })),
    ]).then(([me, homeCard, announcementPayload, spotlightPayload]) => {
      if (cancelled) return;
      setProfile(me);
      setCard(homeCard);
      setAnnouncements(announcementPayload.announcements ?? []);
      setSpotlight((spotlightPayload.items ?? []).filter((item) => Boolean(item.iframeUrl || item.videoUrl)));
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  useEffect(() => {
    if (announcements.length <= 1) return;
    const timer = window.setInterval(() => {
      setAnnouncementIndex((current) => (current + 1) % announcements.length);
    }, ANNOUNCEMENT_MS);
    return () => window.clearInterval(timer);
  }, [announcements.length]);

  useEffect(() => {
    setSpotlightIndex(0);
  }, [spotlight.length]);

  useEffect(() => {
    // Intentionally no wall-clock advance for Stream iframes — wait for ended postMessage / video onEnded.
  }, [spotlight, spotlightIndex]);

  useEffect(() => {
    if (spotlight.length <= 1) return;
    function onMessage(event: MessageEvent) {
      const origin = String(event.origin ?? "");
      if (
        !origin.includes("videodelivery.net") &&
        !origin.includes("cloudflarestream.com")
      ) {
        return;
      }
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          if (data === "ended") {
            setSpotlightIndex((current) => (current + 1) % spotlight.length);
          }
          return;
        }
      }
      const payload = data as {
        name?: string;
        eventName?: string;
        type?: string;
        event?: string;
      } | null;
      const name = payload?.name ?? payload?.eventName ?? payload?.type ?? payload?.event;
      if (name === "ended" || name === "complete") {
        setSpotlightIndex((current) => (current + 1) % spotlight.length);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [spotlight.length]);

  const displayName = card?.username || profile?.username || "Coach";
  const activeAnnouncement =
    announcements.length > 0
      ? announcements[announcementIndex % announcements.length]
      : null;
  const activeClip =
    spotlight.length > 0 ? spotlight[spotlightIndex % spotlight.length] : null;
  const activeSpotlightIndex = spotlight.length ? spotlightIndex % spotlight.length : 0;
  const spotlightSwipe = useSwipeNavigation({ itemCount: spotlight.length, onIndexChange: setSpotlightIndex });
  useEffect(() => { spotlightSwipe.setCurrentIndex(activeSpotlightIndex); }, [activeSpotlightIndex]);
  const spotlightPlayer = useStreamPlayerControls(activeSpotlightIndex);

  function advanceSpotlight() {
    if (spotlight.length <= 1) return;
    setSpotlightIndex((current) => (current + 1) % spotlight.length);
  }

  async function react(reactionKey: "like" | "dislike") {
    if (!activeClip || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await siteApi.reactSpotlight({
        highlightId: activeClip.id,
        reactionKey,
      });
      setSpotlight(next.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save reaction.");
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!activeClip || busy || !commentDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await siteApi.commentSpotlight({
        highlightId: activeClip.id,
        body: commentDraft.trim(),
      });
      setCommentDraft("");
      setSpotlight((current) =>
        current.map((item) =>
          item.id === activeClip.id
            ? { ...item, comments: [...item.comments, result.comment] }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-home">
      <HeroCard displayName={displayName} card={card} />

      <section className="site-home-panel site-home-spotlight">
        <header className="site-home-panel-head">
          <p>Global top clips</p>
          <h2>Spotlight Reel</h2>
        </header>
        {error ? <p className="site-auth-error">{error}</p> : null}
        {activeClip ? (
          <div className="site-spotlight-carousel">
            {spotlight.length > 1 ? (
              <button
                type="button"
                className="site-home-carousel-arrow"
                aria-label="Previous clip"
                onClick={() =>
                  setSpotlightIndex(
                    (current) => (current - 1 + spotlight.length) % spotlight.length,
                  )
                }
              >
                ‹
              </button>
            ) : null}
            <article
              className="site-spotlight-card"
              onPointerDown={spotlightSwipe.handlers.onPointerDown}
              onPointerMove={spotlightSwipe.handlers.onPointerMove}
              onPointerUp={spotlightSwipe.handlers.onPointerUp}
              onPointerCancel={spotlightSwipe.handlers.onPointerCancel}
            >
              <div className="site-spotlight-video">
                {activeClip.iframeUrl || activeClip.streamUid ? (
                  <>
                    <iframe
                      ref={spotlightPlayer.iframeRef}
                      key={activeClip.id}
                      src={`${
                        activeClip.iframeUrl ??
                        `https://iframe.videodelivery.net/${activeClip.streamUid}`
                      }?autoplay=true&muted=true`}
                      title="Spotlight clip"
                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      onLoad={() => spotlightPlayer.attach()}
                    />
                    {/* A cross-origin iframe swallows pointer gestures before they ever reach
                        the article's swipe handler above — this transparent catcher sits over
                        it purely so drags bubble up instead of vanishing into the iframe. That
                        also blocks the iframe's own native play/pause/mute controls from ever
                        being clicked again, so the button row below drives the embed directly
                        through the Stream Player SDK instead. */}
                    <div className="site-spotlight-video-swipe-catcher" />
                    <div className="site-spotlight-video-controls" onPointerDown={(event) => event.stopPropagation()}>
                      <button type="button" aria-label={spotlightPlayer.isPaused ? "Play" : "Pause"} onClick={spotlightPlayer.togglePlay}>
                        {spotlightPlayer.isPaused ? <Play size={16} /> : <Pause size={16} />}
                      </button>
                      <button type="button" aria-label="Rewind 10 seconds" onClick={() => spotlightPlayer.rewind(10)}>
                        <RotateCcw size={16} />
                      </button>
                      <button type="button" aria-label={spotlightPlayer.isMuted ? "Unmute" : "Mute"} onClick={spotlightPlayer.toggleMute}>
                        {spotlightPlayer.isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    </div>
                  </>
                ) : activeClip.videoUrl ? (
                  <video
                    key={activeClip.id}
                    src={activeClip.videoUrl}
                    controls
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    onEnded={advanceSpotlight} onError={() => {
                      setSpotlight((items) => {
                        const id = activeClip?.id;
                        if (!id) return items;
                        const next = items.filter((item) => item.id !== id);
                        if (next.length !== items.length) setSpotlightIndex(0);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <p className="site-muted">Clip unavailable.</p>
                )}
              </div>
              <div className="site-spotlight-meta">
                <strong>
                  {activeClip.matchupLabel ?? activeClip.team?.name ?? activeClip.author.displayName}
                </strong>
                <small className="site-spotlight-participants">
                  {activeClip.matchupParticipants
                    ? `H2H: @${activeClip.matchupParticipants.away} VS @${activeClip.matchupParticipants.home}`
                    : `CPU: @${activeClip.author.username ?? activeClip.author.displayName}`}
                </small>
                <span>
                  {activeClip.league.name}
                  {activeClip.weekNumber != null ? ` \u00B7 Week ${activeClip.weekNumber}` : ""}
                  {` \u00B7 ${spotlightIndex % spotlight.length + 1} of ${spotlight.length}`}
                </span>
              </div>
              <div className="site-spotlight-reactions">
                <button
                  type="button"
                  className={activeClip.myReaction === "like" ? "is-active" : ""}
                  disabled={busy}
                  onClick={() => void react("like")}
                >
                  <ThumbsUp size={18} aria-hidden="true" /> Like <small>{activeClip.reactionCounts.like ?? ""}</small>
                </button>
                <button
                  type="button"
                  className={activeClip.myReaction === "dislike" ? "is-active" : ""}
                  disabled={busy}
                  onClick={() => void react("dislike")}
                >
                  <ThumbsDown size={18} aria-hidden="true" /> Dislike <small>{activeClip.reactionCounts.dislike ?? ""}</small>
                </button>
              </div>
              <div className="site-spotlight-comments">
                <h4>Comments</h4>
                {activeClip.comments.length ? (
                  <ul>
                    {activeClip.comments.map((comment) => (
                      <li key={comment.id}>
                        <strong>{comment.author.displayName}</strong>
                        <span>{comment.body}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="site-muted">Be the first to comment.</p>
                )}
                <div className="site-spotlight-comment-form">
                  <input
                    type="text"
                    maxLength={1000}
                    placeholder="Leave a comment…"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitComment();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !commentDraft.trim()}
                    onClick={() => void submitComment()}
                  >
                    Post
                  </button>
                </div>
              </div>
            </article>
            {spotlight.length > 1 ? (
              <button
                type="button"
                className="site-home-carousel-arrow"
                aria-label="Next clip"
                onClick={() =>
                  setSpotlightIndex((current) => (current + 1) % spotlight.length)
                }
              >
                ›
              </button>
            ) : null}
          </div>
        ) : (
          <p className="site-muted">Spotlight clips refresh daily at 8 AM CT.</p>
        )}
      </section>

      <section className="site-home-panel site-home-announcements">
        <header className="site-home-panel-head">
          <p>Official board</p>
          <h2>Announcements</h2>
        </header>
        {activeAnnouncement ? (
          <div className="site-home-announce-carousel">
            {announcements.length > 1 ? (
              <button
                type="button"
                className="site-home-carousel-arrow"
                aria-label="Previous announcement"
                onClick={() =>
                  setAnnouncementIndex(
                    (current) =>
                      (current - 1 + announcements.length) % announcements.length,
                  )
                }
              >
                ‹
              </button>
            ) : null}
            <article className="site-home-announce-card">
              <h3>{activeAnnouncement.title}</h3>
              <p>{activeAnnouncement.body}</p>
              {safeAnnouncementHref(activeAnnouncement.href) ? (
                <a href={safeAnnouncementHref(activeAnnouncement.href)!} target="_blank" rel="noreferrer">
                  Read more
                </a>
              ) : null}
              {announcements.length > 1 ? (
                <span className="site-home-carousel-pos">
                  {announcementIndex % announcements.length + 1} / {announcements.length}
                </span>
              ) : null}
            </article>
            {announcements.length > 1 ? (
              <button
                type="button"
                className="site-home-carousel-arrow"
                aria-label="Next announcement"
                onClick={() =>
                  setAnnouncementIndex((current) => (current + 1) % announcements.length)
                }
              >
                ›
              </button>
            ) : null}
          </div>
        ) : (
          <p className="site-muted">No announcements right now.</p>
        )}
      </section>
    </div>
  );
}
