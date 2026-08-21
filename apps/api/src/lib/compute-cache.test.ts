import test from "node:test";
import assert from "node:assert/strict";
import { invalidateComputeCache, invalidateLeagueComputeCaches, withComputeCache } from "./compute-cache.js";

test("withComputeCache returns the stored value within the TTL and coalesces in-flight work", async () => {
  let calls = 0;
  const compute = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { n: calls };
  };

  const [a, b] = await Promise.all([
    withComputeCache("unit-test:coalesce", 5_000, compute),
    withComputeCache("unit-test:coalesce", 5_000, compute),
  ]);
  const c = await withComputeCache("unit-test:coalesce", 5_000, compute);

  assert.equal(calls, 1);
  assert.equal(a.n, 1);
  assert.equal(b.n, 1);
  assert.equal(c.n, 1);

  invalidateComputeCache("unit-test:");
  const d = await withComputeCache("unit-test:coalesce", 5_000, compute);
  assert.equal(calls, 2);
  assert.equal(d.n, 2);
  invalidateComputeCache("unit-test:");
});

test("invalidateLeagueComputeCaches drops power-ranking and user-rating keys for that guild", async () => {
  let rankingCalls = 0;
  let ratingCalls = 0;
  await withComputeCache("power-rankings:guild-a:current", 5_000, async () => {
    rankingCalls += 1;
    return { n: rankingCalls };
  });
  await withComputeCache("user-ratings:guild-a", 5_000, async () => {
    ratingCalls += 1;
    return { n: ratingCalls };
  });
  await withComputeCache("power-rankings:guild-b:current", 5_000, async () => ({ keep: true }));

  invalidateLeagueComputeCaches("guild-a");

  const ranking = await withComputeCache("power-rankings:guild-a:current", 5_000, async () => {
    rankingCalls += 1;
    return { n: rankingCalls };
  });
  const rating = await withComputeCache("user-ratings:guild-a", 5_000, async () => {
    ratingCalls += 1;
    return { n: ratingCalls };
  });
  const other = await withComputeCache("power-rankings:guild-b:current", 5_000, async () => ({ keep: false }));

  assert.equal(ranking.n, 2);
  assert.equal(rating.n, 2);
  assert.equal(other.keep, true);
  invalidateComputeCache("power-rankings:");
  invalidateComputeCache("user-ratings:");
});
