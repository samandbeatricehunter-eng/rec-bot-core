import type { ReactNode } from "react";

export type BadgeStatus = "pending" | "approved" | "denied" | "locked" | "info";

export function Badge({ status, children }: { status: BadgeStatus; children: ReactNode }) {
  return <span className={`badge badge-${status}`}>{children}</span>;
}
