import { FORMULA_VERSIONS } from "./types.js";

export type PlayerTraitPositionGroup = "QB" | "MIKE";

export type PlayerTraitDefinition = {
  key: string;
  name: string;
  definition: string;
};

export type PlayerTraitQuestionOption = {
  text: string;
  traitKey: string;
};

export type PlayerTraitQuestion = {
  number: number;
  question: string;
  options: PlayerTraitQuestionOption[];
};

export type PlayerTraitResult = {
  equippedTraitKeys: string[];
  formulaVersion: typeof FORMULA_VERSIONS.playerTraits;
};

const RISK_AVERSE_QB_TRAIT_KEYS = ["anchored", "throw_away", "oblivious", "frozen_solid"];
const CONSERVATIVE_TRAIT_KEY = "conservative";
const RISK_AVERSE_THRESHOLD = 2;

export function playerTraitKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function scorePlayerTraitInterview(input: {
  positionGroup: PlayerTraitPositionGroup;
  questions: PlayerTraitQuestion[];
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}): PlayerTraitResult {
  const equipped = new Set<string>();
  for (const answer of input.answers) {
    const question = input.questions.find((item) => item.number === answer.questionNumber);
    const option = question?.options[answer.optionIndex];
    if (!option) continue;
    equipped.add(playerTraitKey(option.traitKey));
  }
  if (input.positionGroup === "QB") {
    const riskAverseCount = [...equipped].filter((key) => RISK_AVERSE_QB_TRAIT_KEYS.includes(key)).length;
    if (riskAverseCount >= RISK_AVERSE_THRESHOLD) equipped.add(CONSERVATIVE_TRAIT_KEY);
  }
  return {
    equippedTraitKeys: [...equipped],
    formulaVersion: FORMULA_VERSIONS.playerTraits,
  };
}
