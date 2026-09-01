import { FORMULA_VERSIONS } from "./types.js";

export type PersonaDnaTrait = {
  key: string;
  name: string;
  definition: string;
};

export type MindsetFocusOption = {
  key: string;
  name: string;
  definition: string;
};

export type PersonaDnaQuestionOption = {
  text: string;
  traitKey: string;
};

export type PersonaDnaQuestion = {
  number: number;
  question: string;
  options: PersonaDnaQuestionOption[];
};

export type PersonaDnaResult = {
  equippedTraitKeys: string[];
  formulaVersion: typeof FORMULA_VERSIONS.personaDna;
};

export function personaDnaKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function scorePersonaDnaInterview(input: {
  questions: PersonaDnaQuestion[];
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}): PersonaDnaResult {
  const equipped = new Set<string>();
  for (const answer of input.answers) {
    const question = input.questions.find((item) => item.number === answer.questionNumber);
    const option = question?.options[answer.optionIndex];
    if (!option) continue;
    equipped.add(option.traitKey);
  }
  return {
    equippedTraitKeys: [...equipped],
    formulaVersion: FORMULA_VERSIONS.personaDna,
  };
}
