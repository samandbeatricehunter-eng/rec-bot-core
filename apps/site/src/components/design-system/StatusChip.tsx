type StatusChipProps = {
  status: "pending" | "approved" | "denied" | "info" | "locked";
  label: string;
  className?: string;
};

/** Pill status indicator — supersedes .badge-*. */
export function StatusChip({ status, label, className }: StatusChipProps) {
  return <span className={["status-chip", `status-chip--${status}`, className].filter(Boolean).join(" ")}>{label}</span>;
}
