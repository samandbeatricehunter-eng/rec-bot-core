export function ErrorState({ message }: { message: string }) {
  return <p style={{ color: "var(--error)" }}>{message}</p>;
}
