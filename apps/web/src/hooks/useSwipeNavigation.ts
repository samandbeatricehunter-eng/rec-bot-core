import { useMemo, useRef, useState } from "react";

type SwipeOptions = {
  itemCount: number;
  onIndexChange: (nextIndex: number) => void;
  /** Horizontal drag distance in px required to commit to the next/previous item. */
  threshold?: number;
  enabled?: boolean;
};

type SwipeHandlers = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
};

const FLING_VELOCITY_PX_PER_MS = 0.5;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Pointer-event based swipe navigation — works with touch and mouse-drag alike (so it's
 * exercisable via the preview tool, not just a real touchscreen). Ignores drags that are
 * more vertical than horizontal so it never fights page scroll. */
export function useSwipeNavigation({ itemCount, onIndexChange, threshold = 60, enabled = true }: SwipeOptions) {
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axisLocked = useRef<"horizontal" | "vertical" | null>(null);
  const reducedMotion = useMemo(prefersReducedMotion, []);

  function reset() {
    start.current = null;
    axisLocked.current = null;
    setIsDragging(false);
    setDragOffsetPx(0);
  }

  const handlers: SwipeHandlers = {
    onPointerDown(event) {
      if (!enabled || itemCount < 2) return;
      start.current = { x: event.clientX, y: event.clientY, t: performance.now() };
      axisLocked.current = null;
      setIsDragging(true);
    },
    onPointerMove(event) {
      if (!start.current) return;
      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      if (!axisLocked.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      if (axisLocked.current === "vertical") return;
      event.preventDefault();
      setDragOffsetPx(dx);
    },
    onPointerUp(event) {
      if (!start.current) { reset(); return; }
      const dx = event.clientX - start.current.x;
      const elapsed = Math.max(1, performance.now() - start.current.t);
      const velocity = Math.abs(dx) / elapsed;
      const committed = axisLocked.current === "horizontal" && (Math.abs(dx) > threshold || velocity > FLING_VELOCITY_PX_PER_MS);
      if (committed) {
        const direction = dx < 0 ? 1 : -1;
        const nextIndex = ((dx < 0 ? currentIndexRef.current + 1 : currentIndexRef.current - 1) + itemCount) % itemCount;
        void direction;
        onIndexChange(nextIndex);
      }
      reset();
    },
    onPointerCancel: reset,
  };

  // Tracks the "current" index externally so onPointerUp can compute next/prev without a
  // stale closure — callers pass the current index in via setCurrentIndex before drag starts.
  const currentIndexRef = useRef(0);
  function setCurrentIndex(index: number) {
    currentIndexRef.current = index;
  }

  return {
    handlers,
    dragOffsetPx,
    isDragging,
    reducedMotion,
    setCurrentIndex,
  };
}
