/** Runs `fn` over `items` with at most `limit` calls in flight at once, preserving each
 * result's position in the returned array. Useful for batching independent I/O (Discord REST
 * calls, per-row upserts on separate pool connections) without either running fully serial
 * (slow) or fully parallel (risks overwhelming a rate-limited API or the connection pool). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
