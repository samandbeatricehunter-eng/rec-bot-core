import type { ReactNode } from "react";

export function BroadcastLabel({ children, tone = "gold", className }: { children: ReactNode; tone?: "gold" | "neutral"; className?: string }) {
  return <span className={["broadcast-label", `broadcast-label--${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}
