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
