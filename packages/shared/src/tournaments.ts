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

export const TOURNAMENT_PLAYSTYLES = [
  { key: "simulation", label: "Simulation" },
  { key: "competitive", label: "Competitive" },
  { key: "arcade", label: "Arcade" },
] as const;

export const TOURNAMENT_INJURY_OPTIONS = [
  { key: "on_standard", label: "On (standard)" },
  { key: "on_reduced", label: "On (reduced)" },
  { key: "off", label: "Off" },
] as const;

export type TournamentPlaystyle = (typeof TOURNAMENT_PLAYSTYLES)[number]["key"];
export type TournamentInjuryPolicy = (typeof TOURNAMENT_INJURY_OPTIONS)[number]["key"];

export type TournamentRules = {
  quarterLengthMinutes: number;
  difficulty: string;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number;
  injuries: TournamentInjuryPolicy;
  fatigueEnabled: boolean;
  playstyle: TournamentPlaystyle;
  wearAndTearEnabled: boolean;
};

export const TOURNAMENT_REQUIRED_RULES = [
  "The home player must stream the game live.",
  "A screenshot of the final score — or of a concession — must be taken and submitted with the result.",
  "Saving the stream (VOD) is strongly recommended so any dispute can be reviewed.",
] as const;

export function tournamentDifficultyOptions(game: string): Array<{ key: string; label: string }> {
  if (game === "cfb_27") {
    return [
      { key: "freshman", label: "Freshman" },
      { key: "varsity", label: "Varsity" },
      { key: "all_american", label: "All-American" },
      { key: "heisman", label: "Heisman" },
    ];
  }
  return [
    { key: "rookie", label: "Rookie" },
    { key: "pro", label: "Pro" },
    { key: "all_pro", label: "All-Pro" },
    { key: "all_madden", label: "All-Madden" },
  ];
}

export function defaultTournamentRules(game: string): TournamentRules {
  const cfb = game === "cfb_27";
  return {
    quarterLengthMinutes: 6,
    difficulty: cfb ? "heisman" : "all_madden",
    acceleratedClockEnabled: true,
    acceleratedClockMinimumSeconds: 15,
    injuries: "off",
    fatigueEnabled: false,
    playstyle: "competitive",
    wearAndTearEnabled: false,
  };
}

export function parseTournamentRules(value: unknown, game: string): TournamentRules {
  const fallback = defaultTournamentRules(game);
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  const difficulties = new Set(tournamentDifficultyOptions(game).map((item) => item.key));
  const playstyle = TOURNAMENT_PLAYSTYLES.some((item) => item.key === row.playstyle)
    ? (row.playstyle as TournamentPlaystyle)
    : fallback.playstyle;
  const injuries = TOURNAMENT_INJURY_OPTIONS.some((item) => item.key === row.injuries)
    ? (row.injuries as TournamentInjuryPolicy)
    : fallback.injuries;
  const quarter = Number(row.quarterLengthMinutes);
  const clockMin = Number(row.acceleratedClockMinimumSeconds);
  return {
    quarterLengthMinutes: Number.isFinite(quarter) ? Math.min(15, Math.max(4, Math.trunc(quarter))) : fallback.quarterLengthMinutes,
    difficulty: difficulties.has(String(row.difficulty ?? "")) ? String(row.difficulty) : fallback.difficulty,
    acceleratedClockEnabled: Boolean(row.acceleratedClockEnabled),
    acceleratedClockMinimumSeconds: Number.isFinite(clockMin) ? Math.min(25, Math.max(10, Math.trunc(clockMin))) : fallback.acceleratedClockMinimumSeconds,
    injuries,
    fatigueEnabled: Boolean(row.fatigueEnabled),
    playstyle,
    wearAndTearEnabled: Boolean(row.wearAndTearEnabled),
  };
}

export function tournamentRulesSummary(rules: TournamentRules, game: string): string {
  const difficulty = tournamentDifficultyOptions(game).find((item) => item.key === rules.difficulty)?.label ?? rules.difficulty;
  const playstyle = TOURNAMENT_PLAYSTYLES.find((item) => item.key === rules.playstyle)?.label ?? rules.playstyle;
  const injuries = TOURNAMENT_INJURY_OPTIONS.find((item) => item.key === rules.injuries)?.label ?? rules.injuries;
  const clock = rules.acceleratedClockEnabled
    ? `Accel clock on (${rules.acceleratedClockMinimumSeconds}s)`
    : "Accel clock off";
  const bits = [
    `${rules.quarterLengthMinutes}-min quarters`,
    difficulty,
    playstyle,
    clock,
    `Injuries ${injuries.toLowerCase()}`,
    rules.fatigueEnabled ? "Fatigue on" : "Fatigue off",
  ];
  if (game === "cfb_27") bits.push(rules.wearAndTearEnabled ? "Wear & tear on" : "Wear & tear off");
  return bits.join(" · ");
}

export function formatTournamentPlayerName(
  username: string | null | undefined,
  displayName: string | null | undefined,
  gamerTag: string | null | undefined,
): string {
  const site = username ? `@${username}` : displayName?.trim() || "REC Member";
  const tag = gamerTag?.trim();
  return tag ? `${site} (${tag})` : site;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export type TournamentCountdownPhase = "opens" | "registration" | "kickoff" | "live" | "complete";

export function tournamentCountdown(input: {
  status: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  kickoffAt: string | null;
  entrantCount: number;
  bracketSize: number | null;
  registrationPaused?: boolean;
  eventPaused?: boolean;
  now?: Date;
}): { phase: TournamentCountdownPhase; label: string; targetAt: string | null } {
  const now = input.now ?? new Date();
  if (input.status === "complete" || input.status === "cancelled") {
    return { phase: "complete", label: input.status === "cancelled" ? "Cancelled" : "Complete", targetAt: null };
  }
  if (input.eventPaused) {
    return { phase: "live", label: "Paused", targetAt: null };
  }
  if (input.status === "locked") {
    if (input.kickoffAt && new Date(input.kickoffAt).getTime() > now.getTime()) {
      return {
        phase: "kickoff",
        label: `Kickoff in ${formatCountdown(new Date(input.kickoffAt).getTime() - now.getTime())}`,
        targetAt: input.kickoffAt,
      };
    }
    return { phase: "live", label: "Live", targetAt: null };
  }
  const full = Boolean(input.bracketSize && input.entrantCount >= input.bracketSize);
  if (input.registrationOpensAt && new Date(input.registrationOpensAt).getTime() > now.getTime()) {
    return {
      phase: "opens",
      label: `Registration opens in ${formatCountdown(new Date(input.registrationOpensAt).getTime() - now.getTime())}`,
      targetAt: input.registrationOpensAt,
    };
  }
  const closesAt = input.registrationClosesAt ? new Date(input.registrationClosesAt) : null;
  const stillRegistering = !input.registrationPaused && !full && (!closesAt || closesAt.getTime() > now.getTime());
  if (stillRegistering && (closesAt || !input.registrationPaused)) {
    if (closesAt && closesAt.getTime() > now.getTime()) {
      return {
        phase: "registration",
        label: `Registration closes in ${formatCountdown(closesAt.getTime() - now.getTime())}`,
        targetAt: input.registrationClosesAt,
      };
    }
    if (!closesAt) {
      return { phase: "registration", label: "Registration open", targetAt: null };
    }
  }
  if (input.kickoffAt) {
    const kickoff = new Date(input.kickoffAt).getTime();
    if (kickoff > now.getTime()) {
      return {
        phase: "kickoff",
        label: `${full ? "Bracket full · " : "Registration closed · "}kickoff in ${formatCountdown(kickoff - now.getTime())}`,
        targetAt: input.kickoffAt,
      };
    }
  }
  return { phase: "kickoff", label: full ? "Bracket full · ready to lock" : "Registration closed · ready to lock", targetAt: input.kickoffAt };
}

export const TOURNAMENT_HIGHLIGHT_COINS = 250;
export const TOURNAMENT_HOUSE_ODDS = 1.91;
export const TOURNAMENT_WAGER_CAPS = { house: 1000, peer: 5000, h2h: 5000 } as const;

export const TOURNAMENT_TIMEZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "UTC", label: "UTC" },
] as const;
