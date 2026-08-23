// Crypto-backed Fisher-Yates, not Math.random() -- fairness is auditable for things like a
// public lottery draw order. Uses the Web Crypto API (globalThis.crypto), not node:crypto, so
// this file stays safe to import from browser bundles as well as the API server.
function randomIndex(exclusiveMax: number): number {
  const range = exclusiveMax; // [0, exclusiveMax)
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % range);
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % range;
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
