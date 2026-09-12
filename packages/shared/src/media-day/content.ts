// Typed accessors over the Media Day content banks distilled from the uploaded package (see
// weekly-challenges/catalog.ts's header for the same pattern). weekly_challenge_media_questions.json
// is filtered to the 148 gradable challenge ids weekly-challenges/config/weekly_challenge_catalog.json
// already carries -- a question for a challenge that can never be issued would never be reachable.
// Special-teams challenges have no pre-game interview question in the uploaded package (only a
// postgame framing note, used later at Challenge Reveal) -- Media Day here only ever asks about
// the offense and defense challenges.
import weeklyChallengeQuestionsJson from "./config/weekly_challenge_media_questions.json" with { type: "json" };
import answerFamiliesJson from "./config/answer_families.json" with { type: "json" };
import toneFollowupsJson from "./config/tone_followups.json" with { type: "json" };
import type { WeeklyChallengeSide } from "../weekly-challenges/conditions.js";

export type MediaDayQuestionVariant = {
  challenge_id: string;
  challenge_name: string;
  side: "offense" | "defense";
  category: string;
  id: string;
  variant: number;
  question: string;
  answer_family: string;
};

export type MediaDayAnswerOption = { key: string; text: string; intent: Record<string, unknown>; clarifier?: string };

const QUESTIONS = (weeklyChallengeQuestionsJson as { primary_question_variants: MediaDayQuestionVariant[] }).primary_question_variants;
const ANSWER_FAMILIES = answerFamiliesJson as unknown as Record<string, MediaDayAnswerOption[]>;
const TONE_FOLLOWUPS = toneFollowupsJson as {
  non_rti_team: Record<string, string[]>;
  rti_subject: Record<string, string[]>;
};

function pickIndex(seed: string, length: number, salt: number): number {
  let hash = salt >>> 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

/** All question variants written for a given challenge, in its original variant order. */
export function mediaDayQuestionVariantsForChallenge(challengeId: string): MediaDayQuestionVariant[] {
  return QUESTIONS.filter((q) => q.challenge_id === challengeId);
}

/** Deterministic pick so the same (team, week, side) always sees the same question wording within
 * a given week -- same seeding technique as pickWeeklyChallenge. */
export function pickMediaDayQuestion(challengeId: string, seed: string): MediaDayQuestionVariant | undefined {
  const pool = mediaDayQuestionVariantsForChallenge(challengeId);
  if (!pool.length) return undefined;
  return pool[pickIndex(seed, pool.length, 7)];
}

export function mediaDayAnswerOptions(family: string): MediaDayAnswerOption[] {
  return ANSWER_FAMILIES[family] ?? [];
}

/** Fills {placeholder} tokens in a question/answer template. Unresolved placeholders are left
 * as-is rather than throwing -- callers that need strict resolution should check the result. */
export function renderMediaDayTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

export function mediaDayToneFollowUp(scope: "non_rti_team" | "rti_subject", dimension: string, seed: string): string | undefined {
  const pool = TONE_FOLLOWUPS[scope]?.[dimension];
  if (!pool?.length) return undefined;
  return pool[pickIndex(seed, pool.length, 11)];
}

export type { WeeklyChallengeSide };
