// REC-native Madden trade value model. No public trade calculator (madden-school.com and
// every other one surveyed) discloses its formula — they're all closed/manual — so this is an
// original model built from roster data actually available in REC: OVR, position, dev trait,
// contract (years left / cap hit), draft-pick round+slot, and team positional need. There is no
// tracked player age in this schema, so years_pro stands in for the age curve (rookie-to-prime
// build-up, decline in the back half of a career) — a reasonable proxy since it moves with the
// same career arc age would.
export const REC_TRADE_VALUE_MODEL_VERSION = "rec-trade-value-v1.0.0";

// Rough consensus from public trade-value writeups (impact positions carry more surplus value
// than a straight OVR comparison suggests) — QB highest, core skill/impact positions next,
// depth/replaceable positions lowest. Applies to Madden position codes only (this calculator is
// Madden-only per scope).
export const REC_TRADE_POSITION_MULTIPLIERS: Record<string, number> = {
  QB: 2.5,
  LE: 2.0, RE: 2.0,
  LOLB: 1.9, ROLB: 1.9,
  CB: 1.9,
  WR: 1.8,
  DT: 1.7,
  LT: 1.6, RT: 1.6,
  FS: 1.5, SS: 1.5,
  MLB: 1.4,
  HB: 1.3, TE: 1.3,
  LG: 1.1, RG: 1.1, C: 1.1,
  FB: 0.7,
  K: 0.5, P: 0.5,
};
const DEFAULT_POSITION_MULTIPLIER = 1.2;

export const REC_TRADE_DEV_TRAIT_MULTIPLIERS: Record<string, number> = {
  normal: 1.0,
  star: 1.15,
  superstar: 1.35,
  xfactor: 1.65,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Rookie-to-prime build-up (0 years pro = unproven, so a modest discount despite upside),
// prime years 2-7, gradual decline after — mirrors the real "peaks 24-26, fades after 30" curve
// one career-year at a time since we don't have actual age.
function experienceFactor(yearsPro: number | null | undefined): number {
  const years = yearsPro ?? 3;
  if (years <= 0) return 0.9;
  if (years <= 1) return 0.97;
  if (years <= 7) return 1.0;
  if (years <= 9) return 0.85;
  if (years <= 11) return 0.7;
  return 0.55;
}

// A player on a below-market deal (cap hit lower than their OVR would predict) is a more
// valuable trade asset than one on a bloated deal — rough linear expectation of cap hit vs
// OVR, then compare actual against it. No cap data at all (free agents / no-cap leagues)
// leaves this neutral.
function contractFactor(overallRating: number, capHit: number | null | undefined, contractYearsLeft: number | null | undefined): number {
  let factor = 1.0;
  if (typeof capHit === "number" && capHit > 0) {
    const expectedCapHit = Math.max(500_000, (overallRating - 60) * 250_000);
    const ratio = (expectedCapHit - capHit) / expectedCapHit;
    factor *= clamp(1 + ratio * 0.3, 0.75, 1.25);
  }
  // An expiring deal (0-1 years left) is a flight risk for the acquiring team.
  if (typeof contractYearsLeft === "number" && contractYearsLeft <= 1) factor *= 0.9;
  return clamp(factor, 0.6, 1.3);
}

// Elite players are worth disproportionately more than mediocre ones, and replacement-level
// (~60 OVR) players are worth close to nothing on the trade market — an exponential curve off a
// replacement-level floor captures that better than a straight linear OVR scale.
function baseValueFromOverall(overallRating: number): number {
  const aboveReplacement = Math.max(0, overallRating - 58);
  return Math.pow(aboveReplacement, 1.8) * 0.11;
}

export type RecTradePlayerInput = {
  id: string;
  position: string;
  overallRating: number;
  devTrait?: string | null;
  yearsPro?: number | null;
  contractYearsLeft?: number | null;
  capHit?: number | null;
};

export type RecTradePlayerValue = {
  id: string;
  rawValue: number;
  needAdjustedValue: number;
  /** 21 + years_pro — no real age is tracked in this schema, so this is a display estimate,
   * not an input the model treats as authoritative. */
  estimatedAge: number;
  breakdown: {
    base: number;
    positionMultiplier: number;
    devTraitMultiplier: number;
    experienceFactor: number;
    contractFactor: number;
    needMultiplier: number;
  };
};

/** 0 (no need) .. 1 (desperate need) per position, typically from computeRecTeamPositionNeeds. */
export type RecTeamPositionNeeds = Record<string, number>;

export function estimateRecPlayerTradeValue(player: RecTradePlayerInput, receivingTeamNeeds?: RecTeamPositionNeeds): RecTradePlayerValue {
  const base = baseValueFromOverall(player.overallRating);
  const positionMultiplier = REC_TRADE_POSITION_MULTIPLIERS[player.position?.toUpperCase() ?? ""] ?? DEFAULT_POSITION_MULTIPLIER;
  const devTraitMultiplier = REC_TRADE_DEV_TRAIT_MULTIPLIERS[player.devTrait ?? "normal"] ?? 1.0;
  const experience = experienceFactor(player.yearsPro);
  const contract = contractFactor(player.overallRating, player.capHit, player.contractYearsLeft);
  const rawValue = base * positionMultiplier * devTraitMultiplier * experience * contract;
  // A team with a genuine hole at this position values the same player higher than a team
  // that's already deep there — 0.85x (already stacked) to 1.25x (desperate need).
  const needScore = receivingTeamNeeds?.[player.position?.toUpperCase() ?? ""] ?? 0.5;
  const needMultiplier = 0.85 + needScore * 0.4;
  return {
    id: player.id,
    rawValue: Math.round(rawValue * 100) / 100,
    needAdjustedValue: Math.round(rawValue * needMultiplier * 100) / 100,
    estimatedAge: 21 + Math.max(0, player.yearsPro ?? 3),
    breakdown: { base, positionMultiplier, devTraitMultiplier, experienceFactor: experience, contractFactor: contract, needMultiplier },
  };
}

export type RecTradePickInput = {
  id: string;
  round: number;
  /** Overall slot within the whole draft (1-indexed) if known; null for an unresolved future pick. */
  pickNumber?: number | null;
  teamsInLeague: number;
};

/** Exponential decay approximating the shape of the classic Jimmy Johnson draft chart (3000 at
 * pick 1 down to single digits by the late rounds), rescaled onto the same rough 0-150 range
 * player values land in so the two compose meaningfully in a trade total. An unresolved future
 * pick (no exact slot yet) values off the middle of its round. */
export function estimateRecPickTradeValue(pick: RecTradePickInput): number {
  const teams = Math.max(pick.teamsInLeague, 1);
  const overallPick = pick.pickNumber ?? (pick.round - 1) * teams + Math.ceil(teams / 2);
  const value = 150 * Math.exp(-0.025 * Math.max(0, overallPick - 1));
  return Math.round(Math.max(value, 3) * 100) / 100;
}

export type RecTradeLegValue =
  | ({ type: "player" } & RecTradePlayerValue)
  | { type: "pick"; id: string; rawValue: number; needAdjustedValue: number };

export function estimateRecTradeSideValue(
  players: RecTradePlayerInput[],
  picks: RecTradePickInput[],
  coins: number,
  receivingTeamNeeds?: RecTeamPositionNeeds,
): { rawTotal: number; needAdjustedTotal: number; legs: RecTradeLegValue[] } {
  const legs: RecTradeLegValue[] = [
    ...players.map((player) => ({ type: "player" as const, ...estimateRecPlayerTradeValue(player, receivingTeamNeeds) })),
    ...picks.map((pick) => {
      const value = estimateRecPickTradeValue(pick);
      return { type: "pick" as const, id: pick.id, rawValue: value, needAdjustedValue: value };
    }),
  ];
  // Coins are a pure cash-equivalent asset with no need adjustment — 1000 coins ≈ 1 trade-value
  // point, an arbitrary but stable peg (coin economies vary a lot league to league; this just
  // needs to be small enough that coin sweeteners rarely swing a trade's verdict on their own).
  const coinValue = coins / 1000;
  const rawTotal = legs.reduce((sum, leg) => sum + leg.rawValue, 0) + coinValue;
  const needAdjustedTotal = legs.reduce((sum, leg) => sum + leg.needAdjustedValue, 0) + coinValue;
  return { rawTotal: Math.round(rawTotal * 100) / 100, needAdjustedTotal: Math.round(needAdjustedTotal * 100) / 100, legs };
}

// A team's average positional roster strength defines "need" relative to the rest of its own
// roster — light-count or low-OVR positions read as high need, deep/strong ones read as low
// need, all self-relative so it works the same whether a league runs 90 OVR average or 70.
export function computeRecTeamPositionNeeds(roster: Array<{ position: string; overallRating: number }>): RecTeamPositionNeeds {
  const byPosition = new Map<string, number[]>();
  for (const player of roster) {
    const position = player.position?.toUpperCase();
    if (!position) continue;
    const list = byPosition.get(position) ?? [];
    list.push(player.overallRating);
    byPosition.set(position, list);
  }
  const positions = Object.keys(REC_TRADE_POSITION_MULTIPLIERS);
  const avgOverall = roster.length ? roster.reduce((sum, p) => sum + p.overallRating, 0) / roster.length : 70;
  const needs: RecTeamPositionNeeds = {};
  for (const position of positions) {
    const ratings = byPosition.get(position) ?? [];
    if (!ratings.length) { needs[position] = 1; continue; } // no rostered players at this position at all — max need
    const best = Math.max(...ratings);
    const depthPenalty = ratings.length === 1 ? 0.15 : 0;
    const strengthGap = clamp((avgOverall - best) / 25, -0.5, 0.5); // best player here weaker than team average -> need
    needs[position] = clamp(0.5 + strengthGap + depthPenalty, 0, 1);
  }
  return needs;
}

export type RecTradeFairnessVerdict = "balanced" | "favors_proposing" | "favors_receiving";

export type RecTradeFairnessReport = {
  version: string;
  proposing: { rawTotal: number; needAdjustedTotal: number; legs: RecTradeLegValue[] };
  receiving: { rawTotal: number; needAdjustedTotal: number; legs: RecTradeLegValue[] };
  verdict: RecTradeFairnessVerdict;
  deltaPct: number;
};

/** The single entry point Trade Center (and the commissioner review flow) calls: give both
 * sides' rosters/needs and legs, get back a verdict. needAdjustedTotal is what decides the
 * verdict (raw totals are shown too, for transparency, but a trade that fills a real hole is
 * legitimately worth more to the team that's short there). */
export function evaluateRecTradeFairness(input: {
  proposingPlayers: RecTradePlayerInput[]; proposingPicks: RecTradePickInput[]; proposingCoins: number;
  receivingPlayers: RecTradePlayerInput[]; receivingPicks: RecTradePickInput[]; receivingCoins: number;
  proposingTeamNeeds: RecTeamPositionNeeds; receivingTeamNeeds: RecTeamPositionNeeds;
}): RecTradeFairnessReport {
  // NOTE the naming is "which side sends this", not "which side gets this": `proposing` is the
  // value of what the proposing team SENDS (evaluated against the receiving team's needs, since
  // they're the one gaining it), and `receiving` is the value of what the receiving team SENDS
  // (evaluated against the proposing team's needs). So the proposing team's own *gain* is
  // `receiving.needAdjustedTotal`, and its *cost* is `proposing.needAdjustedTotal`.
  const proposing = estimateRecTradeSideValue(input.proposingPlayers, input.proposingPicks, input.proposingCoins, input.receivingTeamNeeds);
  const receiving = estimateRecTradeSideValue(input.receivingPlayers, input.receivingPicks, input.receivingCoins, input.proposingTeamNeeds);
  const larger = Math.max(proposing.needAdjustedTotal, receiving.needAdjustedTotal, 0.01);
  // Positive => the proposing team gains more than it gives up (trade favors proposing).
  const deltaPct = Math.round(((receiving.needAdjustedTotal - proposing.needAdjustedTotal) / larger) * 1000) / 10;
  let verdict: RecTradeFairnessVerdict = "balanced";
  if (Math.abs(deltaPct) > 15) verdict = deltaPct > 0 ? "favors_proposing" : "favors_receiving";
  return { version: REC_TRADE_VALUE_MODEL_VERSION, proposing, receiving, verdict, deltaPct };
}
