import { FORMULA_VERSIONS } from "./types.js";

export type PlaystyleBlend = {
  primaryWeight: number;
  secondaryWeight: number;
  kind: "dominant" | "clear" | "near_tie";
};

export type PlaystyleOption = {
  text: string;
  primaryArchetype: string;
};

export type PlaystyleQuestion = {
  number: number;
  question: string;
  options: PlaystyleOption[];
};

export type PlaystyleResult = {
  scores: Record<string, number>;
  primaryArchetype: string;
  secondaryArchetype: string;
  blend: PlaystyleBlend;
  formulaVersion: typeof FORMULA_VERSIONS.playstyle;
};

const PRIMARY_POINTS = 2;
const RELATED_SECONDARY_POINTS = 1;

export function playstyleBlend(primaryScore: number, secondaryScore: number): PlaystyleBlend {
  const gap = primaryScore - secondaryScore;
  if (gap <= 2) return { primaryWeight: 0.65, secondaryWeight: 0.35, kind: "near_tie" };
  if (gap >= 6) return { primaryWeight: 0.8, secondaryWeight: 0.2, kind: "dominant" };
  return { primaryWeight: 0.75, secondaryWeight: 0.25, kind: "clear" };
}

export function scorePlaystyleInterview(input: {
  questions: PlaystyleQuestion[];
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}): PlaystyleResult {
  const scores: Record<string, number> = {};
  for (const answer of input.answers) {
    const question = input.questions.find((item) => item.number === answer.questionNumber);
    if (!question) continue;
    const chosen = question.options[answer.optionIndex];
    if (!chosen) continue;
    scores[chosen.primaryArchetype] = (scores[chosen.primaryArchetype] ?? 0) + PRIMARY_POINTS;
    for (const option of question.options) {
      if (option.primaryArchetype === chosen.primaryArchetype) continue;
      scores[option.primaryArchetype] = (scores[option.primaryArchetype] ?? 0) + 0;
    }
    void RELATED_SECONDARY_POINTS;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const primaryArchetype = ranked[0]?.[0] ?? "Field General";
  const secondaryArchetype = ranked[1]?.[0] ?? primaryArchetype;
  const blend = playstyleBlend(ranked[0]?.[1] ?? 0, ranked[1]?.[1] ?? 0);
  return {
    scores,
    primaryArchetype,
    secondaryArchetype,
    blend,
    formulaVersion: FORMULA_VERSIONS.playstyle,
  };
}

export type AttributeDelta = { code: string; floor: number; ceiling: number };

export type BranchingArchetypeOption = {
  text: string;
  archetype: string;
};

export type BranchingAnswerOption = {
  text: string;
  deltas: AttributeDelta[];
};

export type BranchingDrillQuestion = {
  question: string;
  options: BranchingAnswerOption[];
};

export type BranchingArchetypeBank = {
  q3: BranchingDrillQuestion;
  q4: BranchingDrillQuestion;
  q5: BranchingDrillQuestion;
};

export type BranchingPlaystyleGroup = {
  archetypes: string[];
  q1: { question: string; options: BranchingArchetypeOption[] };
  q2Question: string;
  banks: Record<string, BranchingArchetypeBank>;
};

export type BranchingPlaystyleAnswers = {
  q1ArchetypeIndex: number;
  q2ArchetypeIndex: number | null;
  q3OptionIndex: number;
  q4OptionIndex: number;
  q5OptionIndex: number;
};

export type BranchingPlaystyleResult = {
  primaryArchetype: string;
  secondaryArchetype: string | null;
  blend: PlaystyleBlend;
  attributeDeltas: Record<string, { floor: number; ceiling: number }>;
  formulaVersion: typeof FORMULA_VERSIONS.playstyleBranching;
};

export function pureBlend(): PlaystyleBlend {
  return { primaryWeight: 1, secondaryWeight: 0, kind: "dominant" };
}

export function hybridBlend(): PlaystyleBlend {
  return { primaryWeight: 0.7, secondaryWeight: 0.3, kind: "clear" };
}

export function scoreBranchingPlaystyleInterview(input: {
  group: BranchingPlaystyleGroup;
  answers: BranchingPlaystyleAnswers;
}): BranchingPlaystyleResult {
  const { group, answers } = input;
  const primaryArchetype = group.q1.options[answers.q1ArchetypeIndex]?.archetype ?? group.archetypes[0]!;
  const remaining = group.archetypes.filter((archetype) => archetype !== primaryArchetype);
  const secondaryArchetype = answers.q2ArchetypeIndex == null ? null : remaining[answers.q2ArchetypeIndex] ?? null;
  const blend = secondaryArchetype == null ? pureBlend() : hybridBlend();

  const bank = group.banks[primaryArchetype];
  const attributeDeltas: Record<string, { floor: number; ceiling: number }> = {};
  const drills: Array<[BranchingDrillQuestion | undefined, number]> = bank
    ? [[bank.q3, answers.q3OptionIndex], [bank.q4, answers.q4OptionIndex], [bank.q5, answers.q5OptionIndex]]
    : [];
  for (const [drill, optionIndex] of drills) {
    const option = drill?.options[optionIndex];
    if (!option) continue;
    for (const delta of option.deltas) {
      const existing = attributeDeltas[delta.code] ?? { floor: 0, ceiling: 0 };
      attributeDeltas[delta.code] = { floor: existing.floor + delta.floor, ceiling: existing.ceiling + delta.ceiling };
    }
  }

  return {
    primaryArchetype,
    secondaryArchetype,
    blend,
    attributeDeltas,
    formulaVersion: FORMULA_VERSIONS.playstyleBranching,
  };
}

export function blendAttributeTemplates(
  primary: Record<string, number>,
  secondary: Record<string, number>,
  blend: PlaystyleBlend,
): Record<string, number> {
  const keys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const a = primary[key] ?? secondary[key] ?? 0;
    const b = secondary[key] ?? primary[key] ?? 0;
    out[key] = Math.round(a * blend.primaryWeight + b * blend.secondaryWeight);
  }
  return out;
}
