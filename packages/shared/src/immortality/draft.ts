export type DraftProspectInput = {
  userId: string;
  prospectId: string;
  side: "offense" | "defense";
  draftValue: number;
  projectedRound: number;
};

export type DraftFranchise = {
  teamId: string;
  pickOrder: number;
};

export type AssignedPick = {
  prospectId: string;
  userId: string;
  teamId: string;
  round: number;
  overallPick: number;
  revealOwnership: boolean;
};

export type PairAssignment = {
  userId: string;
  teamId: string;
  picks: AssignedPick[];
  score: number;
};

const ROUNDS = 7;

function preferredRound(projected: number): { min: number; max: number } {
  return { min: Math.max(1, projected - 1), max: Math.min(7, projected + 1) };
}

function acceptableRound(projected: number): { min: number; max: number } {
  return { min: Math.max(1, projected - 2), max: Math.min(7, projected + 2) };
}

function roundScore(projected: number, assigned: number, isLowerValueFall: boolean): number {
  const preferred = preferredRound(projected);
  if (assigned >= preferred.min && assigned <= preferred.max) return 100 - Math.abs(assigned - projected) * 8;
  const acceptable = acceptableRound(projected);
  if (assigned >= acceptable.min && assigned <= acceptable.max) {
    return 55 - Math.abs(assigned - projected) * 6 - (isLowerValueFall ? 0 : 10);
  }
  return 15 - Math.abs(assigned - projected) * 4 - (isLowerValueFall ? 5 : 20);
}

function pairCompatibility(offense: DraftProspectInput, defense: DraftProspectInput, pickOrder: number): { score: number; offenseRound: number; defenseRound: number } {
  const lowerIsOffense = offense.draftValue <= defense.draftValue;
  let best = { score: Number.NEGATIVE_INFINITY, offenseRound: 4, defenseRound: 5 };
  for (let offenseRound = 1; offenseRound <= ROUNDS; offenseRound += 1) {
    for (let defenseRound = 1; defenseRound <= ROUNDS; defenseRound += 1) {
      if (offenseRound === defenseRound) continue;
      const offenseScore = roundScore(offense.projectedRound, offenseRound, lowerIsOffense);
      const defenseScore = roundScore(defense.projectedRound, defenseRound, !lowerIsOffense);
      const earlyValue = (8 - Math.min(offenseRound, defenseRound)) * (Math.max(offense.draftValue, defense.draftValue) / 50);
      const score = offenseScore + defenseScore + earlyValue - Math.abs(pickOrder) * 0.01;
      if (score > best.score) best = { score, offenseRound, defenseRound };
    }
  }
  return best;
}

function hungarianMax(weights: number[][]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = (weights[i0 - 1]?.[j - 1] ?? 0) * -1 - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= n; j += 1) {
    if (p[j]) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

export function projectedRoundFromRank(rank: number, classSize: number): number {
  if (classSize <= 0) return 4;
  const percentile = rank / classSize;
  if (percentile <= 0.08) return 1;
  if (percentile <= 0.2) return 2;
  if (percentile <= 0.35) return 3;
  if (percentile <= 0.5) return 4;
  if (percentile <= 0.68) return 5;
  if (percentile <= 0.85) return 6;
  return 7;
}

export function draftValueFromProfile(input: { ovr: number; iq: number; classRank: number }): number {
  return Math.round(input.ovr * 12 + (input.iq - 80) * 0.6 - input.classRank * 0.4);
}

export function assignProspectPairs(input: {
  prospects: DraftProspectInput[];
  franchises: DraftFranchise[];
}): PairAssignment[] {
  const byUser = new Map<string, DraftProspectInput[]>();
  for (const prospect of input.prospects) {
    const list = byUser.get(prospect.userId) ?? [];
    list.push(prospect);
    byUser.set(prospect.userId, list);
  }
  const users = [...byUser.entries()]
    .map(([userId, pair]) => {
      const offense = pair.find((item) => item.side === "offense");
      const defense = pair.find((item) => item.side === "defense");
      return offense && defense ? { userId, offense, defense } : null;
    })
    .filter((row): row is { userId: string; offense: DraftProspectInput; defense: DraftProspectInput } => Boolean(row));

  const franchises = [...input.franchises].sort((a, b) => a.pickOrder - b.pickOrder).slice(0, users.length);
  const n = users.length;
  if (n === 0) return [];
  const weights = users.map((user) => franchises.map((franchise) => pairCompatibility(user.offense, user.defense, franchise.pickOrder).score));
  const assignment = hungarianMax(weights);
  const results: PairAssignment[] = [];
  for (let i = 0; i < n; i += 1) {
    const franchiseIndex = assignment[i] ?? i;
    const franchise = franchises[franchiseIndex];
    const user = users[i];
    if (!franchise || !user) continue;
    const fit = pairCompatibility(user.offense, user.defense, franchise.pickOrder);
    const offenseOverall = (fit.offenseRound - 1) * n + franchise.pickOrder;
    const defenseOverall = (fit.defenseRound - 1) * n + franchise.pickOrder;
    const firstReveal = fit.offenseRound > fit.defenseRound ? "defense" : "offense";
    results.push({
      userId: user.userId,
      teamId: franchise.teamId,
      score: fit.score,
      picks: [
        {
          prospectId: user.offense.prospectId,
          userId: user.userId,
          teamId: franchise.teamId,
          round: fit.offenseRound,
          overallPick: offenseOverall,
          revealOwnership: firstReveal === "offense" ? false : true,
        },
        {
          prospectId: user.defense.prospectId,
          userId: user.userId,
          teamId: franchise.teamId,
          round: fit.defenseRound,
          overallPick: defenseOverall,
          revealOwnership: firstReveal === "defense" ? false : true,
        },
      ],
    });
  }
  return results;
}

export function chronologicalPicks(assignments: PairAssignment[]): AssignedPick[] {
  return assignments.flatMap((row) => row.picks).sort((a, b) => a.overallPick - b.overallPick || a.round - b.round);
}
