import { useCallback, useEffect, useRef, useState } from "react";

// Minimal surface of the Cloudflare Stream Player SDK we actually use. See
// https://developers.cloudflare.com/stream/viewing-videos/using-the-player-api/
// Kept as a local copy of apps/web/src/hooks/useStreamPlayerControls.ts — apps/site can't
// import across the app boundary, and this is small enough not to be worth a shared package
// for. Keep the two in sync if either changes.
type StreamPlayer = {
  play: () => Promise<void> | void;
  pause: () => void;
  muted: boolean;
  currentTime: number;
  addEventListener: (type: string, listener: () => void) => void;
};

declare global {
  interface Window {
    Stream?: (el: HTMLIFrameElement) => StreamPlayer;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadStreamSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Stream) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve(); // fail open — control bar becomes inert, video still autoplays
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** Wraps a Cloudflare Stream `<iframe>` (rendered autoplay+muted) with a tiny custom control
 * bar. The iframe is cross-origin, so once a swipe-catcher overlay intercepts pointer events
 * for drag gestures, clicks can never reach the iframe's own native player controls again —
 * this hook talks to the player directly through the documented Stream Player SDK instead so
 * play/pause, mute/unmute, and rewind keep working. `resetKey` should change whenever the
 * embedded clip changes (the iframe remounts) so local play/mute state resets to match the
 * fresh autoplay-muted embed. */
export function useStreamPlayerControls(resetKey: string | number | undefined) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    playerRef.current = null;
    setIsPaused(false);
    setIsMuted(true);
  }, [resetKey]);

  const attach = useCallback(() => {
    void loadStreamSdk().then(() => {
      if (!iframeRef.current || !window.Stream) return;
      const player = window.Stream(iframeRef.current);
      playerRef.current = player;
      player.addEventListener("play", () => setIsPaused(false));
      player.addEventListener("pause", () => setIsPaused(true));
    });
  }, []);

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    if (isPaused) {
      void player.play();
      setIsPaused(false);
    } else {
      player.pause();
      setIsPaused(true);
    }
  }

  function toggleMute() {
    const player = playerRef.current;
    if (!player) return;
    const next = !isMuted;
    player.muted = next;
    setIsMuted(next);
  }

  function rewind(seconds = 10) {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = Math.max(0, (player.currentTime || 0) - seconds);
  }

  return { iframeRef, attach, isPaused, isMuted, togglePlay, toggleMute, rewind };
}
