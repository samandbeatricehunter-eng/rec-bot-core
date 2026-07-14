import type { ReactNode } from "react";

export function StatPlate({ label, value, emphasis, className }: { label: string; value: ReactNode; emphasis?: boolean; className?: string }) {
  return (
    <div className={["stat-plate", emphasis && "stat-plate--emphasis", className].filter(Boolean).join(" ")}>
      <span className="stat-plate-label">{label}</span>
      <strong className="stat-plate-value tabular-nums">{value}</strong>
    </div>
  );
}
