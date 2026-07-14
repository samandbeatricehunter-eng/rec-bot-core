import { useEffect } from "react";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation.js";

type SwipeCardProps<T> = {
  items: T[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  /** Rendered as static edge affordances (e.g. desktop arrow buttons) alongside the swipeable area. */
  edgeControls?: React.ReactNode;
};

/** Generic swipeable single-item viewport. Shows one item at a time, tracks the finger/mouse
 * during a drag for visual feedback, and commits to the next/previous item on release —
 * arrow-button navigation (edgeControls) keeps working alongside it since they're not
 * mutually exclusive input methods. */
export function SwipeCard<T>({ items, activeIndex, onIndexChange, renderItem, className, edgeControls }: SwipeCardProps<T>) {
  const { handlers, dragOffsetPx, isDragging, reducedMotion, setCurrentIndex } = useSwipeNavigation({
    itemCount: items.length,
    onIndexChange,
  });

  useEffect(() => {
    setCurrentIndex(activeIndex);
  }, [activeIndex]);

  if (!items.length) return null;
  const item = items[activeIndex];

  return (
    <div className={["swipe-card-viewport", className].filter(Boolean).join(" ")}>
      <div
        className="swipe-card-surface"
        style={{
          transform: isDragging ? `translateX(${dragOffsetPx}px)` : undefined,
          transition: isDragging || reducedMotion ? "none" : "transform var(--duration-standard) var(--ease-standard)",
          touchAction: "pan-y",
        }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        {renderItem(item, activeIndex)}
      </div>
      {edgeControls}
    </div>
  );
}
