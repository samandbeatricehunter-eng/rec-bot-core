// Short-TTL in-memory memoization for expensive per-league read-time computations (power
// rankings, strength of schedule, coach/user ratings) that were previously recomputed from
// scratch on every hub load, wager-option view, and game-channel render. These aren't
// financial calculations — a few seconds of staleness is invisible to users — so a small
// TTL cache removes the vast majority of redundant rec_game_results/rec_team_game_stats
// re-reads without needing a persisted snapshot table or hunting down every mutation path
// that would need to invalidate one. Single Node process, so a plain Map is sufficient.
type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 500;
let cacheEpoch = 0;

function sweepCache(now = Date.now()): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_CACHE_ENTRIES) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

/** Returns the cached value for `key` if still fresh, otherwise computes, stores, and returns it. */
export async function withComputeCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const startedAtEpoch = cacheEpoch;
  const work = compute()
    .then((value) => {
      if (startedAtEpoch === cacheEpoch) {
        store.delete(key);
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        sweepCache();
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, work);
  return work;
}

/** Drops every cached entry whose key starts with `prefix` — call after a mutation that should invalidate it immediately (e.g. an advance) rather than waiting out the TTL. */
export function invalidateComputeCache(prefix: string): void {
  cacheEpoch += 1;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

// Power rankings, SOS, and coach/user ratings are all keyed by guildId (see power-rankings
// .service.ts, sos.service.ts, ratings.service.ts) — call this after anything that changes a
// league's game results or roster (advance, box score approve/replace, manual result entry,
// team assignment change) so the next read reflects it immediately instead of within the TTL.
export function invalidateLeagueComputeCaches(guildId: string): void {
  for (const prefix of ["power-rankings:", "sos:", "coach-ratings:", "user-ratings:"]) {
    invalidateComputeCache(`${prefix}${guildId}`);
  }
}
