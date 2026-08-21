// In-memory TTL cache with in-flight coalescing. Used for idempotent site reads so
// chrome + page (profile, leagues, hub open) don't each pay a full round trip.
type CacheEntry = { value: unknown; freshUntil: number };

export function createReadCache(maxEntries = 200) {
  const store = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.freshUntil > now) return Promise.resolve(hit.value as T);

    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const work = compute()
      .then((value) => {
        if (ttlMs > 0) {
          store.delete(key);
          store.set(key, { value, freshUntil: Date.now() + ttlMs });
          while (store.size > maxEntries) {
            const oldest = store.keys().next().value;
            if (!oldest) break;
            store.delete(oldest);
          }
        }
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, work);
    return work;
  }

  function invalidate(prefix?: string) {
    if (!prefix) {
      store.clear();
      inflight.clear();
      return;
    }
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    for (const key of [...inflight.keys()]) {
      if (key.startsWith(prefix)) inflight.delete(key);
    }
  }

  return { get, invalidate };
}
