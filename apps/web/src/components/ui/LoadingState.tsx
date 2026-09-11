export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="hub-gameday-empty hub-gameday-empty--inline" role="status">
      <strong>{label}</strong>
    </p>
  );
}
