export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <p style={{ color: "var(--text-secondary)" }}>{label}</p>;
}
