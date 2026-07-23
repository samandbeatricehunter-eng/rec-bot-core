import { buildShortInterviewHeadline } from "./interview-title-bank.js";

export type InterviewAnswer = { questionId?: string; question: string; answer: string };

export function formatInterviewBody(answers: InterviewAnswer[]): string {
  return answers
    .map((row) => `Q: ${row.question.trim()}\nA: ${row.answer.trim()}`)
    .join("\n\n");
}

export function buildInterviewHeadline(input: {
  teamName?: string | null;
  mascotOrNick?: string | null;
  answers: InterviewAnswer[];
  weekNumber: number;
}): string {
  return buildShortInterviewHeadline(input);
}

export function interviewRoundtableLooksLikeQa(
  roundtable: Array<{ speaker?: string; role?: string; take?: string }> | null | undefined,
): boolean {
  if (!roundtable?.length) return false;
  const coachHeavy = roundtable.filter((p) => String(p.speaker ?? "").toLowerCase() === "coach").length;
  return coachHeavy >= Math.ceil(roundtable.length * 0.6);
}
