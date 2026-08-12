// recFetch now throws the API's own friendly .error string directly (or a generic
// fallback), so userFacingError just needs to pass it through. The old "REC API request
// failed: <status> {json}" wrapper is gone — this remains as a safety net in case any
// call site still receives a raw HTTP error from a different path.
export function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Legacy safety net: strip the old wrapper if it ever appears.
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
