export type InterviewAnswer = { questionId?: string; question: string; answer: string };

const KEYWORD_TEMPLATES: Array<{ keys: string[]; templates: string[] }> = [
  {
    keys: ["dominat", "crush", "blowout", "run the table"],
    templates: [
      "{team} Coach Makes a Bold Claim: {quote}",
      "{team} Coach Is Not Holding Back: {quote}",
    ],
  },
  {
    keys: ["revenge", "payback", "owe", "last time"],
    templates: [
      "{team} Coach Wants Payback: {quote}",
      "{mascot} Coach Circles a Rematch: {quote}",
    ],
  },
  {
    keys: ["underdog", "doubt", "prove", "respect"],
    templates: [
      "{team} Coach Embraces the Doubt: {quote}",
      "{mascot} Coach Has a Chip: {quote}",
    ],
  },
  {
    keys: ["culture", "locker room", "identity", "standard"],
    templates: [
      "{team} Coach Draws a Line on Culture: {quote}",
      "{mascot} Coach Defines the Program: {quote}",
    ],
  },
  {
    keys: ["pressure", "heat", "spotlight", "expectation"],
    templates: [
      "{team} Coach on the Pressure: {quote}",
      "{mascot} Coach Faces the Noise: {quote}",
    ],
  },
  {
    keys: ["rival", "enemy", "hate", "border"],
    templates: [
      "{team} Coach Turns Up Rivalry Week: {quote}",
      "{mascot} Coach Sends a Rivalry Message: {quote}",
    ],
  },
  {
    keys: ["playoff", "championship", "title", "final"],
    templates: [
      "{team} Coach Eyes the Finish Line: {quote}",
      "{mascot} Coach Talks Title Path: {quote}",
    ],
  },
  {
    keys: ["defense", "stop", "shutdown"],
    templates: ["{team} Coach Trusts the Defense: {quote}"],
  },
  {
    keys: ["offense", "score", "attack", "scheme"],
    templates: ["{team} Coach Opens Up the Offense: {quote}"],
  },
  {
    keys: ["message", "warning", "notice", "call out", "shot"],
    templates: [
      "{team} Coach Delivers a Message: {quote}",
      "{mascot} Coach Fires a Shot: {quote}",
    ],
  },
];

const FALLBACKS = [
  "{team} Coach Breaks Silence Ahead of Week {week}",
  "{mascot} Coach Speaks Out: {quote}",
  "{team} Coach Sets the Tone: {quote}",
];

function snippet(answer: string, maxWords = 8): string {
  const words = answer.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, maxWords);
  if (!words.length) return "League Story";
  let text = words.join(" ");
  if (answer.trim().split(/\s+/).length > maxWords) text += "…";
  return text.replace(/[.?!,:;]+$/g, "");
}

function pickTemplate(corpus: string, team: string, mascot: string, quote: string, week: number): string {
  const lower = corpus.toLowerCase();
  for (const row of KEYWORD_TEMPLATES) {
    if (row.keys.some((k) => lower.includes(k))) {
      const t = row.templates[Math.floor(Math.random() * row.templates.length)]!;
      return t
        .replaceAll("{team}", team)
        .replaceAll("{mascot}", mascot)
        .replaceAll("{quote}", quote)
        .replaceAll("{week}", String(week));
    }
  }
  const t = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]!;
  return t
    .replaceAll("{team}", team)
    .replaceAll("{mascot}", mascot)
    .replaceAll("{quote}", quote)
    .replaceAll("{week}", String(week));
}

export function formatInterviewBody(answers: InterviewAnswer[]): string {
  return answers.map((row) => `Q: ${row.question.trim()}\nA: ${row.answer.trim()}`).join("\n\n");
}

export function buildInterviewHeadline(input: {
  teamName?: string | null;
  mascotOrNick?: string | null;
  answers: InterviewAnswer[];
  weekNumber: number;
}): string {
  const team = (input.teamName ?? "League").trim() || "League";
  const mascot = (input.mascotOrNick ?? team).trim() || team;
  const longest = [...input.answers].sort((a, b) => b.answer.trim().length - a.answer.trim().length)[0];
  const quote = snippet(longest?.answer ?? "Week ahead");
  const corpus = input.answers.map((a) => `${a.question} ${a.answer}`).join(" ");
  return pickTemplate(corpus, team, mascot, quote, input.weekNumber);
}

export function interviewRoundtableLooksLikeQa(
  roundtable: Array<{ speaker?: string; role?: string; take?: string }> | null | undefined,
): boolean {
  if (!roundtable?.length) return false;
  const coachHeavy = roundtable.filter((p) => String(p.speaker ?? "").toLowerCase() === "coach").length;
  return coachHeavy >= Math.ceil(roundtable.length * 0.6);
}
