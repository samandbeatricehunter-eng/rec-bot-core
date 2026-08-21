import test from "node:test";
import assert from "node:assert/strict";
import { invalidateComputeCache, withComputeCache } from "./compute-cache.js";

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
