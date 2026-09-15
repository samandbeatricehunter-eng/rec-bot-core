import type { ReactNode } from "react";

/** Sticky mobile action bar — e.g. comment/react controls pinned to the bottom of the
 * expanded article reading view. */
export function MobileActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["mobile-action-bar", className].filter(Boolean).join(" ")}>{children}</div>;
}
