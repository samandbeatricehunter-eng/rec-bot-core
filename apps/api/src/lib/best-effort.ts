/**
 * Best-effort side effects: may fail without failing the primary request, but must never be silent.
 * Use for Discord mirrors, notifications, optional cleanup, non-critical audit writes, etc.
 * Do NOT use for money mutations, permission changes, roster deletion, or other must-succeed paths.
 */

export type BestEffortContext = {
  leagueId?: string | null;
  userId?: string | null;
  guildId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  [key: string]: unknown;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function bestEffort<T>(
  operation: string,
  fn: () => Promise<T>,
  context: BestEffortContext = {},
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[bestEffort:${operation}]`, {
      ...context,
      error: formatError(error),
    });
    return undefined;
  }
}

/** Fire-and-forget wrapper that logs failures instead of swallowing them. */
export function bestEffortVoid(
  operation: string,
  promise: Promise<unknown>,
  context: BestEffortContext = {},
): void {
  void promise.catch((error) => {
    console.error(`[bestEffort:${operation}]`, {
      ...context,
      error: formatError(error),
    });
  });
}