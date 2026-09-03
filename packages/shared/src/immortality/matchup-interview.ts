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
  /** Whether this prospect's team has a completed game on record this season at all -- a brand
   * new signee with zero games played is a "debut" week, and any question implying a game
   * history (a past result, a prior head-to-head) has to be hard-excluded, not just down-weighted,
   * or it reads as nonsensical for that player. */
  hasPlayedThisSeason?: boolean;
  /** Result/margin of the most recent PRIOR meeting between these two specific teams this season
   * (not just "the last game," which could've been against anyone) -- only ever set when that
   * meeting actually happened. */
  priorMeetingResult?: "win" | "loss" | "tie" | null;
  priorMeetingMargin?: "blowout" | "close" | null;
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
  if (context.hasPlayedThisSeason === false) tags.push("debut");
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

  // post_win/post_loss/prior-meeting/debut-only tags are hard requirements, not just a weighting
  // bias -- a question that presupposes a specific fact (a past result, a prior head-to-head
  // meeting, a rookie's very first week on the roster) makes no sense to ask when that fact isn't
  // actually true, no matter how the random weighting falls, since down-weighting still leaves it
  // eligible to be picked. Exclude anything tagged for a fact that hasn't actually happened.
  const eligiblePool = pool.filter((question) => {
    if (question.tags.includes("post_win") && context.lastResult !== "win") return false;
    if (question.tags.includes("post_loss") && context.lastResult !== "loss") return false;
    if (question.tags.includes("requires_prior_meeting_loss") && context.priorMeetingResult !== "loss") return false;
    if (question.tags.includes("requires_prior_meeting_blowout_win")
      && !(context.priorMeetingResult === "win" && context.priorMeetingMargin === "blowout")) return false;
    if (question.tags.includes("requires_prior_meeting_close") && context.priorMeetingMargin !== "close") return false;
    if (question.tags.includes("debut_only") && context.hasPlayedThisSeason !== false) return false;
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

/**
 * Same weighting as selectMatchupInterviewQuestion, called repeatedly to fill a week's slate --
 * prefers a category not already used this week for variety, falling back to the full remaining
 * pool once every still-available category has already been picked. Each slot gets its own seed
 * suffix so the 3 picks are independent, not the same weighted draw repeated.
 */
export function selectMatchupInterviewQuestions(input: {
  pool: MatchupInterviewQuestion[];
  context: MatchupInterviewContext;
  seed: string;
  count?: number;
}): MatchupInterviewQuestion[] {
  const count = input.count ?? 3;
  const picked: MatchupInterviewQuestion[] = [];
  const usedIds = new Set<number>();
  const usedCategories = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const remaining = input.pool.filter((question) => !usedIds.has(question.id));
    if (!remaining.length) break;
    const freshCategory = remaining.filter((question) => !usedCategories.has(question.category));
    const candidatePool = freshCategory.length ? freshCategory : remaining;
    const next = selectMatchupInterviewQuestion({ pool: candidatePool, context: input.context, seed: `${input.seed}:${i}` });
    picked.push(next);
    usedIds.add(next.id);
    usedCategories.add(next.category);
  }
  return picked;
}

export type ReactiveOpponentContext = {
  opponentName: string;
  opponentTeamName: string;
  opponentAnswerText: string;
};

// Reactive questions respond to a real opponent answer with a fill-in template rather than a
// live-generated one -- deterministic, free, and matches the rest of the pool's static-question
// pattern instead of adding a new (and slower, costlier) generation path. Question ids for these
// live at 900000+ (template index), well clear of the static pool's 1-999 range, so a stored
// answer's question_id never collides with a real pool entry.
const REACTIVE_MATCHUP_TEMPLATES: Array<{ question: (ctx: ReactiveOpponentContext) => string; options: MatchupInterviewOption[] }> = [
  {
    question: (ctx) => `${ctx.opponentName} of the ${ctx.opponentTeamName} already said: "${ctx.opponentAnswerText}" What's your response?`,
    options: [
      { text: "They're entitled to be confident. Doesn't change anything for me.", dnaPoints: { Composure: 2 } },
      { text: "Noted. I'll let the tape speak for itself.", dnaPoints: { "Competitive Fire": 2 } },
      { text: "Respect the confidence — hope they can back it up.", dnaPoints: { "Team First": 1, Leadership: 1 } },
      { text: "That's a bold thing to put on record. We'll see.", dnaPoints: { Showmanship: 2 } },
    ],
  },
  {
    question: (ctx) => `${ctx.opponentName} told us their side of it ahead of this one. Anything you want on the record before kickoff?`,
    options: [
      { text: "Just that talk is cheap. Watch Sunday.", dnaPoints: { "Competitive Fire": 2 } },
      { text: "Nothing personal — may the better team win.", dnaPoints: { Composure: 2 } },
      { text: "I let my play do the talking, always have.", dnaPoints: { Leadership: 2 } },
      { text: "I've got plenty to say, and I'm not holding back.", dnaPoints: { Showmanship: 2 } },
    ],
  },
  {
    question: () => "Your opponent this week already went on record. Does what they said change your prep at all?",
    options: [
      { text: "Not even a little. Same plan either way.", dnaPoints: { Composure: 2 } },
      { text: "It tells me exactly what mindset we're playing against.", dnaPoints: { Leadership: 2 } },
      { text: "It's extra motivation for the whole locker room.", dnaPoints: { "Team First": 2 } },
      { text: "I love when the other side gives me something to prove wrong.", dnaPoints: { "Competitive Fire": 2 } },
    ],
  },
  {
    question: (ctx) => `${ctx.opponentName} framed this matchup a certain way already. How do you want it remembered instead?`,
    options: [
      { text: "As the week we proved exactly who's better.", dnaPoints: { "Competitive Fire": 2 } },
      { text: "As one more week this team handled business, together.", dnaPoints: { "Team First": 2 } },
      { text: "However it plays out — I don't script the story.", dnaPoints: { Composure: 2 } },
      { text: "As the game people bring up for years.", dnaPoints: { "Legacy Drive": 2 } },
    ],
  },
  {
    question: (ctx) => `Word is ${ctx.opponentName} isn't worried about this one. Fair?`,
    options: [
      { text: "They should be. We'll show them why.", dnaPoints: { "Competitive Fire": 2 } },
      { text: "Confidence is fine. Results are what count.", dnaPoints: { Composure: 2 } },
      { text: "Let them feel however they want going in.", dnaPoints: { Leadership: 2 } },
      { text: "That's the kind of quote that gets replayed after we win.", dnaPoints: { Showmanship: 2 } },
    ],
  },
  {
    question: (ctx) => `Given what ${ctx.opponentName} said, does this game mean a little more now?`,
    options: [
      { text: "Every game means the same to me — everything.", dnaPoints: { "Competitive Fire": 2 } },
      { text: "It means more to this whole locker room now.", dnaPoints: { "Team First": 2 } },
      { text: "I don't need extra motivation to play my best.", dnaPoints: { Composure: 2 } },
      { text: "It's a chapter I'll enjoy writing the ending to.", dnaPoints: { "Legacy Drive": 2 } },
    ],
  },
];

export const REACTIVE_MATCHUP_QUESTION_ID_BASE = 900000;

export function buildReactiveMatchupInterviewQuestion(input: {
  seed: string;
  opponent: ReactiveOpponentContext;
}): MatchupInterviewQuestion {
  const rng = seededRandom(input.seed);
  const templateIndex = Math.floor(rng() * REACTIVE_MATCHUP_TEMPLATES.length);
  const template = REACTIVE_MATCHUP_TEMPLATES[templateIndex];
  return {
    id: REACTIVE_MATCHUP_QUESTION_ID_BASE + templateIndex,
    category: "reactive_to_opponent",
    tags: ["reactive_to_opponent"],
    question: template.question(input.opponent),
    options: template.options,
  };
}

export type MatchupInterviewClaimOutcome = "met" | "missed";

/**
 * Auto-resolves a flagged bonusOpportunity once the game it was about has a real result --
 * Madden leagues only ever have EA-imported per-player stats, not OCR'd box scores, so this
 * checks the same aggregate stat fields the weekly-challenge/Player-of-the-Week systems already
 * read (rec_player_weekly_stats). Most hints reduce to "did the team win this specific game";
 * clutch-style hints also require a close final margin; anything else (mainly the exploit_*
 * hints, about beating a specific opponent weakness) additionally requires the player's own
 * stat line to have cleared their position's gold-tier weekly challenge that week -- reusing
 * that existing bar rather than inventing a new stat threshold.
 */
export function evaluateMatchupInterviewClaim(input: {
  hint: string;
  won: boolean;
  marginAbs: number;
  hadGoldWeek: boolean;
}): MatchupInterviewClaimOutcome {
  if (input.hint === "bounce_back_week") return input.won ? "met" : "missed";
  if (input.hint === "clutch_finish" || input.hint === "clutch_moment" || input.hint === "big_moment_response") {
    return input.won && input.marginAbs <= 8 ? "met" : "missed";
  }
  if (input.hint === "rivalry_statement_game" || input.hint === "weather_game") {
    return input.won ? "met" : "missed";
  }
  // Default -- covers the exploit_* hints and anything added to the pool later without a
  // dedicated rule: a claim about beating this specific opponent needs a win AND a real
  // standout performance to actually be true, not just a win by any margin.
  return input.won && input.hadGoldWeek ? "met" : "missed";
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
