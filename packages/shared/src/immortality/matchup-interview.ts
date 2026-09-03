import { FORMULA_VERSIONS, type PersonaDimension } from "./types.js";

export type MatchupInterviewBonusOpportunity = {
  statCategoryHint: string;
  xpBonusPct: number;
};

export type MatchupInterviewOption = {
  text: string;
  dnaPoints: Partial<Record<PersonaDimension, number>>;
  bonusOpportunity?: MatchupInterviewBonusOpportunity;
};

export type MatchupInterviewQuestion = {
  id: number;
  category: string;
  tags: string[];
  question: string;
  options: MatchupInterviewOption[];
};

/** Context signals used to bias weekly interview question selection toward the current matchup. */
export type MatchupInterviewContext = {
  isRivalryGame?: boolean;
  isGameOfTheWeek?: boolean;
  opponentWeakSpots?: string[];
  lastResult?: "win" | "loss" | null;
  isElimination?: boolean;
  isSeasonFinale?: boolean;
  scoreMargin?: "blowout" | "close" | "comeback" | "overtime" | null;
};

/** Deterministic 32-bit hash -> [0,1) PRNG, so the same (league, prospect, week) always yields the same pick. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function contextTagsFor(context: MatchupInterviewContext): string[] {
  const tags: string[] = [];
  if (context.isRivalryGame) tags.push("rivalry");
  if (context.isGameOfTheWeek) tags.push("game_of_the_week");
  if (context.isElimination) tags.push("high_stakes");
  if (context.isSeasonFinale) tags.push("season_finale");
  if (context.lastResult === "win") tags.push("post_win");
  if (context.lastResult === "loss") tags.push("post_loss");
  if (context.scoreMargin) tags.push("score_margin");
  for (const spot of context.opponentWeakSpots ?? []) tags.push(spot);
  return tags;
}

/**
 * Picks one question for this week: contextual categories/tags get weighted priority
 * (a rivalry week is far more likely to draw a rivalry or weak-spot question), then a
 * seeded random pick breaks ties -- same (league, prospect, week) always resolves the
 * same way so re-loading the page doesn't reshuffle the question underneath the player.
 */
export function selectMatchupInterviewQuestion(input: {
  pool: MatchupInterviewQuestion[];
  context: MatchupInterviewContext;
  seed: string;
}): MatchupInterviewQuestion {
  const { pool, context, seed } = input;
  if (pool.length === 0) throw new Error("Matchup interview pool is empty.");
  const contextTags = new Set(contextTagsFor(context));

  // post_win/post_loss are hard requirements, not just a weighting bias -- a "post_win" question
  // asked in a week with no completed game yet (preseason, or simply hasn't played) makes no
  // sense no matter how the random weighting falls, since down-weighting still leaves it eligible
  // to be picked. Exclude anything tagged for a result that hasn't actually happened.
  const eligiblePool = pool.filter((question) => {
    if (question.tags.includes("post_win") && context.lastResult !== "win") return false;
    if (question.tags.includes("post_loss") && context.lastResult !== "loss") return false;
    return true;
  });
  const effectivePool = eligiblePool.length ? eligiblePool : pool;

  const weighted = effectivePool.map((question) => {
    const matches = question.tags.filter((tag) => contextTags.has(tag) || contextTags.has(question.category)).length;
    const categoryMatch = contextTags.has(question.category) ? 1 : 0;
    const weight = 1 + (matches + categoryMatch) * 4;
    return { question, weight };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const rng = seededRandom(seed);
  let roll = rng() * totalWeight;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.question;
  }
  return weighted[weighted.length - 1].question;
}

export type MatchupInterviewAnswerResult = {
  question: MatchupInterviewQuestion;
  option: MatchupInterviewOption;
  dnaPoints: Partial<Record<PersonaDimension, number>>;
  bonusOpportunity: MatchupInterviewBonusOpportunity | null;
  formulaVersion: typeof FORMULA_VERSIONS.matchupInterview;
};

export function scoreMatchupInterviewAnswer(input: {
  question: MatchupInterviewQuestion;
  optionIndex: number;
}): MatchupInterviewAnswerResult {
  const option = input.question.options[input.optionIndex];
  if (!option) throw new Error("Invalid matchup interview option index.");
  return {
    question: input.question,
    option,
    dnaPoints: option.dnaPoints,
    bonusOpportunity: option.bonusOpportunity ?? null,
    formulaVersion: FORMULA_VERSIONS.matchupInterview,
  };
}
