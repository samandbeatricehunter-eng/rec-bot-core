import type { ReactNode } from "react";

type FootballPanelProps = {
  variant?: "default" | "featured" | "recessed";
  accent?: boolean;
  className?: string;
  children: ReactNode;
};

/** The layered premium-panel primitive: outer shadow, metal/illuminated top edge, dark
 * surface, subtle texture, and an optional gold accent edge for featured/selected content.
 * Replaces raw .hub-section / .card divs across the app. */
export function FootballPanel({ variant = "default", accent, className, children }: FootballPanelProps) {
  return (
    <div className={["fp-panel", `fp-panel--${variant}`, accent && "fp-panel--accent", className].filter(Boolean).join(" ")}>
      <div className="fp-panel-inner">{children}</div>
    </div>
  );
}
