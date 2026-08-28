import { FORMULA_VERSIONS } from "./types.js";

export const IQ_QUESTION_COUNT = 12;
export const IQ_START = 80;
export const IQ_MAX = 140;
export const IQ_POINTS_PER_CORRECT = 5;
export const IQ_SECONDS_PER_QUESTION = 25;
export const IQ_MAX_TEST_POINTS = IQ_QUESTION_COUNT * IQ_POINTS_PER_CORRECT;

export type IqPublicQuestion = {
  number: number;
  question: string;
  options: string[];
};

export type IqBankQuestion = IqPublicQuestion & {
  correctIndex: number;
};

export type IqAnswerRecord = {
  questionNumber: number;
  selectedOption: number | null;
  timedOut: boolean;
  submittedAt: string;
  responseMs: number | null;
  correct: boolean;
};

export type IqScoreResult = {
  correctCount: number;
  testPoints: number;
  iqScore: number;
  awareness: number;
  playRecognition: number;
  formulaVersion: typeof FORMULA_VERSIONS.iq;
};

export function toPublicIqQuestion(question: IqBankQuestion, optionOrder: number[]): IqPublicQuestion {
  return {
    number: question.number,
    question: question.question,
    options: optionOrder.map((index) => question.options[index] ?? ""),
  };
}

export function scoreIqAttempt(input: {
  answers: Array<{ questionNumber: number; correct: boolean }>;
}): IqScoreResult {
  const seen = new Set<number>();
  let correctCount = 0;
  for (const answer of input.answers) {
    if (answer.questionNumber < 1 || answer.questionNumber > IQ_QUESTION_COUNT) continue;
    if (seen.has(answer.questionNumber)) continue;
    seen.add(answer.questionNumber);
    if (answer.correct) correctCount += 1;
  }
  const testPoints = Math.min(IQ_MAX_TEST_POINTS, correctCount * IQ_POINTS_PER_CORRECT);
  const iqScore = Math.min(IQ_MAX, IQ_START + testPoints);
  const awareness = 40 + Math.round((59 * testPoints) / IQ_MAX_TEST_POINTS);
  const playRecognition = 40 + Math.round((45 * testPoints) / IQ_MAX_TEST_POINTS);
  return {
    correctCount,
    testPoints,
    iqScore,
    awareness,
    playRecognition,
    formulaVersion: FORMULA_VERSIONS.iq,
  };
}

export function isIqTimedOut(questionExpiresAt: string, nowIso: string): boolean {
  return Date.parse(nowIso) >= Date.parse(questionExpiresAt);
}

export function nextQuestionExpiresAt(startedAtIso: string, seconds = IQ_SECONDS_PER_QUESTION): string {
  return new Date(Date.parse(startedAtIso) + seconds * 1000).toISOString();
}

export function gradeIqSubmission(input: {
  question: IqBankQuestion;
  optionOrder: number[];
  selectedPresentedIndex: number | null;
  timedOut: boolean;
}): { selectedOption: number | null; correct: boolean; timedOut: boolean } {
  if (input.timedOut || input.selectedPresentedIndex == null) {
    return { selectedOption: null, correct: false, timedOut: true };
  }
  const originalIndex = input.optionOrder[input.selectedPresentedIndex];
  if (originalIndex == null) {
    return { selectedOption: null, correct: false, timedOut: false };
  }
  return {
    selectedOption: originalIndex,
    correct: originalIndex === input.question.correctIndex,
    timedOut: false,
  };
}

export function canAdvanceIqQuestion(currentQuestion: number, submittedQuestion: number): boolean {
  return submittedQuestion === currentQuestion && currentQuestion >= 1 && currentQuestion <= IQ_QUESTION_COUNT;
}
