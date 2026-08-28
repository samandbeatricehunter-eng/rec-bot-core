import { FORMULA_VERSIONS } from "./types.js";

export type CareerScoreParts = {
  production: number;
  peakDominance: number;
  awards: number;
  winning: number;
  recordsLegacy: number;
};

export type CareerScoreResult = CareerScoreParts & {
  careerScore: number;
  immortalityScore: number;
  formulaVersion: typeof FORMULA_VERSIONS.careerScore;
};

export const CAREER_SCORE_WEIGHTS = {
  production: 0.3,
  peakDominance: 0.2,
  awards: 0.2,
  winning: 0.2,
  recordsLegacy: 0.1,
} as const;

export const IMMORTALITY_CAREER_WEIGHT = 0.7;
export const IMMORTALITY_VOTE_WEIGHT = 0.3;

export function careerScore(parts: CareerScoreParts): number {
  return (
    parts.production * CAREER_SCORE_WEIGHTS.production
    + parts.peakDominance * CAREER_SCORE_WEIGHTS.peakDominance
    + parts.awards * CAREER_SCORE_WEIGHTS.awards
    + parts.winning * CAREER_SCORE_WEIGHTS.winning
    + parts.recordsLegacy * CAREER_SCORE_WEIGHTS.recordsLegacy
  );
}

export function normalizeVotes(counts: Record<string, number>): Record<string, number> {
  const values = Object.values(counts);
  const max = Math.max(0, ...values);
  if (max <= 0) {
    return Object.fromEntries(Object.keys(counts).map((key) => [key, 0]));
  }
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, (value / max) * 100]));
}

export function immortalityScore(career: number, normalizedVote: number): number {
  return career * IMMORTALITY_CAREER_WEIGHT + normalizedVote * IMMORTALITY_VOTE_WEIGHT;
}

export function finalizeCareerScore(input: CareerScoreParts & { normalizedVote: number }): CareerScoreResult {
  const score = careerScore(input);
  return {
    ...input,
    careerScore: score,
    immortalityScore: immortalityScore(score, input.normalizedVote),
    formulaVersion: FORMULA_VERSIONS.careerScore,
  };
}

export function rejectSelfVote(voterUserId: string, nomineeUserId: string): boolean {
  return voterUserId === nomineeUserId;
}
