/** Allow only same-origin relative paths for post-login redirects. */
export function safeInternalNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return null;
  return value;
}
