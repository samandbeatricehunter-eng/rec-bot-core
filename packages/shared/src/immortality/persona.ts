import { FORMULA_VERSIONS, PERSONA_DIMENSIONS, type PersonaDimension } from "./types.js";

export type PersonaScores = Record<PersonaDimension, number>;

export type PersonaOption = {
  text: string;
  dnaPoints: Partial<PersonaScores>;
};

export type PersonaQuestion = {
  number: number;
  question: string;
  options: PersonaOption[];
};

export type PersonaResult = {
  scores: PersonaScores;
  primary: PersonaDimension;
  secondary: PersonaDimension;
  label: string;
  formulaVersion: typeof FORMULA_VERSIONS.persona;
};

export const PERSONA_RESOLUTION: Record<string, string> = {
  "Leadership+Competitive Fire": "Field General",
  "Leadership+Team First": "Captain",
  "Leadership+Showmanship": "Vocal Leader",
  "Leadership+Composure": "Professional",
  "Leadership+Legacy Drive": "Standard Bearer",
  "Competitive Fire+Team First": "Warrior",
  "Competitive Fire+Showmanship": "Showstopper",
  "Competitive Fire+Composure": "Silent Assassin",
  "Competitive Fire+Legacy Drive": "Alpha",
  "Team First+Showmanship": "Sparkplug",
  "Team First+Composure": "Steady Hand",
  "Team First+Legacy Drive": "Dynasty Builder",
  "Showmanship+Composure": "Cool Operator",
  "Showmanship+Legacy Drive": "Icon",
  "Composure+Legacy Drive": "Perfectionist",
};

export function emptyPersonaScores(): PersonaScores {
  return {
    Leadership: 0,
    "Competitive Fire": 0,
    "Team First": 0,
    Showmanship: 0,
    Composure: 0,
    "Legacy Drive": 0,
  };
}

export function addPersonaPoints(scores: PersonaScores, points: Partial<PersonaScores>): PersonaScores {
  const next = { ...scores };
  for (const dimension of PERSONA_DIMENSIONS) {
    next[dimension] += points[dimension] ?? 0;
  }
  return next;
}

function pairKey(a: PersonaDimension, b: PersonaDimension): string {
  const [first, second] = [a, b].sort();
  return `${first}+${second}`;
}

export function resolvePersona(scores: PersonaScores): PersonaResult {
  const ranked = [...PERSONA_DIMENSIONS].sort((a, b) => {
    const diff = scores[b] - scores[a];
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
  const primary = ranked[0] ?? "Leadership";
  const secondary = ranked[1] ?? "Competitive Fire";
  const label = PERSONA_RESOLUTION[`${primary}+${secondary}`]
    ?? PERSONA_RESOLUTION[pairKey(primary, secondary)]
    ?? `${primary} / ${secondary}`;
  return {
    scores,
    primary,
    secondary,
    label,
    formulaVersion: FORMULA_VERSIONS.persona,
  };
}

export function scorePersonaInterview(input: {
  questions: PersonaQuestion[];
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}): PersonaResult {
  let scores = emptyPersonaScores();
  for (const answer of input.answers) {
    const question = input.questions.find((item) => item.number === answer.questionNumber);
    const option = question?.options[answer.optionIndex];
    if (!option) continue;
    scores = addPersonaPoints(scores, option.dnaPoints);
  }
  return resolvePersona(scores);
}
