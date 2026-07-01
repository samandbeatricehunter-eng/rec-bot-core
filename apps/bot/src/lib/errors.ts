// Strips the "REC API request failed: <status> {json}" wrapper recApi throws on a
// non-2xx response and surfaces the API's own friendly `.error` string instead, so
// raw HTTP/Postgres error text doesn't leak into a Discord embed shown to a user.
export function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const apiError = message.match(/^REC API request failed:\s*\d+\s+(\{.*\})$/s);
  if (apiError?.[1]) {
    try {
      const parsed = JSON.parse(apiError[1]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // Fall through to the original message if the API did not return JSON.
    }
  }
  return message;
}
