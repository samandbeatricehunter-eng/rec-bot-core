export type TeamOfferCandidate = { teamId: string; division: string };

function seededRandom(seed: string): () => number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return () => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return hash / 0xffffffff;
  };
}

/**
 * Post-Origins franchise offer: 4 random still-available teams, soft-weighted away from
 * divisions that already have more user-owned teams so a small (e.g. 10-user) league doesn't
 * cluster 3+ humans into one division -- but never blocks an offer just to enforce that, since
 * with few teams left late in registration a strict cap could leave someone with under 4 choices.
 */
export function pickTeamOffers(input: {
  candidates: TeamOfferCandidate[];
  claimedDivisionCounts: Record<string, number>;
  count: number;
  seed: string;
}): string[] {
  const rng = seededRandom(input.seed);
  const remaining = input.candidates.map((candidate) => ({
    teamId: candidate.teamId,
    weight: 1 / Math.pow(1 + (input.claimedDivisionCounts[candidate.division] ?? 0), 2),
  }));
  const picked: string[] = [];
  const take = Math.min(input.count, remaining.length);
  for (let i = 0; i < take; i += 1) {
    const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * totalWeight;
    let index = remaining.length - 1;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      roll -= remaining[cursor]!.weight;
      if (roll <= 0) { index = cursor; break; }
    }
    picked.push(remaining.splice(index, 1)[0]!.teamId);
  }
  return picked;
}
