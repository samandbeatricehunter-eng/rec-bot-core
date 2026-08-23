export type TournamentBracketStyle = "single_elim" | "double_elim";
export type TournamentPayoutScope = "winner" | "final_two" | "final_four";
export type TournamentBracketSide = "winners" | "losers" | "grand_final";
export type TournamentMatchFeedSlot = "a" | "b";

export type TournamentBracketType = {
  key: string;
  label: string;
  size: number;
  style: TournamentBracketStyle;
};

export const TOURNAMENT_BRACKET_TYPES: TournamentBracketType[] = [
  { key: "single_elim_4", label: "Single elimination — 4", size: 4, style: "single_elim" },
  { key: "single_elim_8", label: "Single elimination — 8", size: 8, style: "single_elim" },
  { key: "single_elim_16", label: "Single elimination — 16", size: 16, style: "single_elim" },
  { key: "single_elim_32", label: "Single elimination — 32", size: 32, style: "single_elim" },
  { key: "double_elim_4", label: "Double elimination — 4", size: 4, style: "double_elim" },
  { key: "double_elim_8", label: "Double elimination — 8", size: 8, style: "double_elim" },
  { key: "double_elim_16", label: "Double elimination — 16", size: 16, style: "double_elim" },
];

export const TOURNAMENT_PAYOUT_SCOPES: Array<{ key: TournamentPayoutScope; label: string; hint: string }> = [
  { key: "winner", label: "Winner only", hint: "Champion takes the full prize." },
  { key: "final_two", label: "Final two", hint: "Champion and runner-up both get paid." },
  { key: "final_four", label: "Final four", hint: "Champion, runner-up, and both semifinal losers get paid." },
];

export type BracketMatchSpec = {
  key: string;
  side: TournamentBracketSide;
  round: number;
  slot: number;
  playerA: string | null;
  playerB: string | null;
  winnerFeed?: { key: string; slot: TournamentMatchFeedSlot };
  loserFeed?: { key: string; slot: TournamentMatchFeedSlot };
};

export function tournamentBracketType(key: string): TournamentBracketType | undefined {
  return TOURNAMENT_BRACKET_TYPES.find((item) => item.key === key);
}

/** Standard 1-indexed seed order in bracket slots: 1 vs size, then folded. */
export function seededBracketOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error("Bracket size must be a power of two.");
  }
  let seeds = [1, 2];
  while (seeds.length < size) {
    const next: number[] = [];
    const mirror = seeds.length * 2 + 1;
    for (const seed of seeds) {
      next.push(seed, mirror - seed);
    }
    seeds = next;
  }
  return seeds;
}

function matchKey(side: TournamentBracketSide, round: number, slot: number): string {
  const prefix = side === "winners" ? "w" : side === "losers" ? "l" : "gf";
  return `${prefix}-${round}-${slot}`;
}

function padEntrants(entrants: Array<string | null>, size: number): Array<string | null> {
  const next = entrants.slice(0, size);
  while (next.length < size) next.push(null);
  return next;
}

function generateWinnersBracket(entrants: Array<string | null>, size: number): BracketMatchSpec[] {
  const seeds = seededBracketOrder(size);
  const slots = seeds.map((seed) => entrants[seed - 1] ?? null);
  const rounds = Math.log2(size);
  const matches: BracketMatchSpec[] = [];
  const roundSlots: Array<Array<string | null>> = [slots];

  for (let round = 1; round <= rounds; round += 1) {
    const players = roundSlots[round - 1];
    const next: Array<string | null> = [];
    const matchCount = players.length / 2;
    for (let slot = 0; slot < matchCount; slot += 1) {
      const key = matchKey("winners", round, slot);
      const spec: BracketMatchSpec = {
        key,
        side: "winners",
        round,
        slot,
        playerA: players[slot * 2] ?? null,
        playerB: players[slot * 2 + 1] ?? null,
      };
      if (round < rounds) {
        spec.winnerFeed = {
          key: matchKey("winners", round + 1, Math.floor(slot / 2)),
          slot: slot % 2 === 0 ? "a" : "b",
        };
      }
      matches.push(spec);
      next.push(null);
    }
    roundSlots.push(next);
  }
  return matches;
}

function wireLoser(match: BracketMatchSpec | undefined, feed: { key: string; slot: TournamentMatchFeedSlot }) {
  if (!match) return;
  match.loserFeed = feed;
}

function generateDoubleElim4(entrants: Array<string | null>): BracketMatchSpec[] {
  const wb = generateWinnersBracket(entrants, 4);
  const l1: BracketMatchSpec = {
    key: matchKey("losers", 1, 0),
    side: "losers",
    round: 1,
    slot: 0,
    playerA: null,
    playerB: null,
    winnerFeed: { key: matchKey("losers", 2, 0), slot: "a" },
  };
  const l2: BracketMatchSpec = {
    key: matchKey("losers", 2, 0),
    side: "losers",
    round: 2,
    slot: 0,
    playerA: null,
    playerB: null,
    winnerFeed: { key: matchKey("grand_final", 1, 0), slot: "b" },
  };
  const gf: BracketMatchSpec = {
    key: matchKey("grand_final", 1, 0),
    side: "grand_final",
    round: 1,
    slot: 0,
    playerA: null,
    playerB: null,
  };
  wireLoser(wb.find((m) => m.key === "w-1-0"), { key: l1.key, slot: "a" });
  wireLoser(wb.find((m) => m.key === "w-1-1"), { key: l1.key, slot: "b" });
  wireLoser(wb.find((m) => m.key === "w-2-0"), { key: l2.key, slot: "b" });
  const wbFinal = wb.find((m) => m.key === "w-2-0");
  if (wbFinal) wbFinal.winnerFeed = { key: gf.key, slot: "a" };
  return [...wb, l1, l2, gf];
}

function generateDoubleElim8(entrants: Array<string | null>): BracketMatchSpec[] {
  const wb = generateWinnersBracket(entrants, 8);
  const losers: BracketMatchSpec[] = [
    {
      key: matchKey("losers", 1, 0), side: "losers", round: 1, slot: 0, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 2, 0), slot: "a" },
    },
    {
      key: matchKey("losers", 1, 1), side: "losers", round: 1, slot: 1, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 2, 1), slot: "a" },
    },
    {
      key: matchKey("losers", 2, 0), side: "losers", round: 2, slot: 0, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 3, 0), slot: "a" },
    },
    {
      key: matchKey("losers", 2, 1), side: "losers", round: 2, slot: 1, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 3, 0), slot: "b" },
    },
    {
      key: matchKey("losers", 3, 0), side: "losers", round: 3, slot: 0, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 4, 0), slot: "a" },
    },
    {
      key: matchKey("losers", 4, 0), side: "losers", round: 4, slot: 0, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("grand_final", 1, 0), slot: "b" },
    },
  ];
  const gf: BracketMatchSpec = {
    key: matchKey("grand_final", 1, 0), side: "grand_final", round: 1, slot: 0, playerA: null, playerB: null,
  };
  wireLoser(wb.find((m) => m.key === "w-1-0"), { key: "l-1-0", slot: "a" });
  wireLoser(wb.find((m) => m.key === "w-1-1"), { key: "l-1-0", slot: "b" });
  wireLoser(wb.find((m) => m.key === "w-1-2"), { key: "l-1-1", slot: "a" });
  wireLoser(wb.find((m) => m.key === "w-1-3"), { key: "l-1-1", slot: "b" });
  wireLoser(wb.find((m) => m.key === "w-2-0"), { key: "l-2-0", slot: "b" });
  wireLoser(wb.find((m) => m.key === "w-2-1"), { key: "l-2-1", slot: "b" });
  wireLoser(wb.find((m) => m.key === "w-3-0"), { key: "l-4-0", slot: "b" });
  const wbFinal = wb.find((m) => m.key === "w-3-0");
  if (wbFinal) wbFinal.winnerFeed = { key: gf.key, slot: "a" };
  return [...wb, ...losers, gf];
}

function generateDoubleElim16(entrants: Array<string | null>): BracketMatchSpec[] {
  const wb = generateWinnersBracket(entrants, 16);
  const losers: BracketMatchSpec[] = [];
  for (let slot = 0; slot < 4; slot += 1) {
    losers.push({
      key: matchKey("losers", 1, slot), side: "losers", round: 1, slot, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 2, slot), slot: "a" },
    });
  }
  for (let slot = 0; slot < 4; slot += 1) {
    losers.push({
      key: matchKey("losers", 2, slot), side: "losers", round: 2, slot, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 3, Math.floor(slot / 2)), slot: slot % 2 === 0 ? "a" : "b" },
    });
  }
  for (let slot = 0; slot < 2; slot += 1) {
    losers.push({
      key: matchKey("losers", 3, slot), side: "losers", round: 3, slot, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 4, slot), slot: "a" },
    });
  }
  for (let slot = 0; slot < 2; slot += 1) {
    losers.push({
      key: matchKey("losers", 4, slot), side: "losers", round: 4, slot, playerA: null, playerB: null,
      winnerFeed: { key: matchKey("losers", 5, 0), slot: slot === 0 ? "a" : "b" },
    });
  }
  losers.push({
    key: matchKey("losers", 5, 0), side: "losers", round: 5, slot: 0, playerA: null, playerB: null,
    winnerFeed: { key: matchKey("losers", 6, 0), slot: "a" },
  });
  losers.push({
    key: matchKey("losers", 6, 0), side: "losers", round: 6, slot: 0, playerA: null, playerB: null,
    winnerFeed: { key: matchKey("grand_final", 1, 0), slot: "b" },
  });
  const gf: BracketMatchSpec = {
    key: matchKey("grand_final", 1, 0), side: "grand_final", round: 1, slot: 0, playerA: null, playerB: null,
  };
  for (let slot = 0; slot < 8; slot += 1) {
    wireLoser(wb.find((m) => m.key === `w-1-${slot}`), {
      key: matchKey("losers", 1, Math.floor(slot / 2)),
      slot: slot % 2 === 0 ? "a" : "b",
    });
  }
  for (let slot = 0; slot < 4; slot += 1) {
    wireLoser(wb.find((m) => m.key === `w-2-${slot}`), { key: matchKey("losers", 2, slot), slot: "b" });
  }
  for (let slot = 0; slot < 2; slot += 1) {
    wireLoser(wb.find((m) => m.key === `w-3-${slot}`), { key: matchKey("losers", 4, slot), slot: "b" });
  }
  wireLoser(wb.find((m) => m.key === "w-4-0"), { key: matchKey("losers", 6, 0), slot: "b" });
  const wbFinal = wb.find((m) => m.key === "w-4-0");
  if (wbFinal) wbFinal.winnerFeed = { key: gf.key, slot: "a" };
  return [...wb, ...losers, gf];
}

export function generateTournamentBracket(input: {
  bracketType: string;
  entrantIds: string[];
}): BracketMatchSpec[] {
  const meta = tournamentBracketType(input.bracketType);
  if (!meta) throw new Error("Unknown bracket type.");
  const padded = padEntrants(input.entrantIds, meta.size);
  if (meta.style === "single_elim") return generateWinnersBracket(padded, meta.size);
  if (meta.size === 4) return generateDoubleElim4(padded);
  if (meta.size === 8) return generateDoubleElim8(padded);
  return generateDoubleElim16(padded);
}

export function tournamentRoundLabel(side: TournamentBracketSide, round: number, roundsInSide: number): string {
  if (side === "grand_final") return "Grand Final";
  const remaining = roundsInSide - round + 1;
  const prefix = side === "losers" ? "LB " : "";
  if (remaining === 1) return `${prefix}Final`;
  if (remaining === 2) return `${prefix}Semifinals`;
  if (remaining === 3) return `${prefix}Quarterfinals`;
  return `${prefix}Round ${round}`;
}
