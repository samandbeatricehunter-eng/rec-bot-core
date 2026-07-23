import type { InterviewAnswer } from "./interview-headlines.js";

/**
 * Titles keyed to interview topics (from question ids like `transfer_portal:1`)
 * and to question-text keywords. Selection prefers the topics of the 3 chosen questions.
 */
export const TOPIC_TITLE_BANK: Record<string, string[]> = {
  pregame: [
    "{team} Sets the Pregame Tone",
    "{mascot} Locked In Before Kickoff",
    "{team} Coach Previews Week {week}",
    "{mascot} Draw the First-Quarter Line",
    "{team} Gameplan Check",
  ],
  postgame: [
    "{team} Breaks Down the Result",
    "{mascot} After the Final Whistle",
    "{team} Film-Room Focus",
    "{mascot} Owns the Outcome",
    "{team} Postgame Truth Session",
  ],
  rivalry_week: [
    "{team} Turns Up Rivalry Week",
    "{mascot} Draws Battle Lines",
    "{team} Rivalry Message",
    "{mascot} Stokes the Rivalry",
    "{team} Coach on the Rival",
  ],
  upset_watch: [
    "{team} Embraces the Upset Path",
    "{mascot} Playing With a Chip",
    "{team} Out to Prove It",
    "{mascot} Underdog Energy",
    "{team} Puncher's Chance",
  ],
  playoff_push: [
    "{team} Eyes the Finish Line",
    "{mascot} Playoff Push Mentality",
    "{team} Championship Path Talk",
    "{mascot} Contender Check",
    "{team} Stretch-Run Focus",
  ],
  rebuild: [
    "{team} Rebuild Mentality",
    "{mascot} Process Over Noise",
    "{team} Building the Standard",
    "{mascot} Next-Man Culture",
    "{team} Long-Game Identity",
  ],
  championship_standard: [
    "{team} Championship-or-Bust Standard",
    "{mascot} Title-Path Mentality",
    "{team} Held to the Highest Bar",
    "{mascot} Chasing Hardware",
    "{team} Contender Identity",
  ],
  recruiting_trail: [
    "{team} Closes the Class",
    "{mascot} Recruiting Pitch Check",
    "{team} Fresh Talent Mentality",
    "{mascot} Building Through Recruiting",
    "{team} Recruiting Trail Update",
  ],
  transfer_portal: [
    "{team} Works the Portal",
    "{mascot} Portal Strategy Session",
    "{team} Roster Continuity Talk",
    "{mascot} Addresses the Portal Cycle",
    "{team} New Pieces Mentality",
  ],
  coach_spotlight: [
    "{team} Coach Opens the Playbook",
    "{mascot} Philosophy Check",
    "{team} In Their Own Words",
    "{mascot} Behind the Headset",
    "{team} Coach Spotlight",
    "{team} Program Identity Talk",
  ],
};

/** Extra titles when specific question phrasing appears. */
export const QUESTION_PHRASE_TITLES: Array<{ match: RegExp; titles: string[] }> = [
  {
    match: /gameplay philosophy|gameplan philosophy|philosophy you lean/i,
    titles: [
      "{team} Coach on Gameplan Philosophy",
      "{mascot} Defines the Offensive Identity",
      "{team} Philosophy Under the Mic",
    ],
  },
  {
    match: /recruiting gameplan|closing out this class/i,
    titles: [
      "{team} Closing the Recruiting Class",
      "{mascot} Recruiting Endgame",
      "{team} Class-Finish Mentality",
    ],
  },
  {
    match: /transfer portal this cycle|working the transfer portal/i,
    titles: [
      "{team} Portal Plan This Cycle",
      "{mascot} How They'll Use the Portal",
      "{team} Portal Roster Strategy",
    ],
  },
  {
    match: /locker room culture|culture that lasts/i,
    titles: [
      "{team} Builds a Lasting Culture",
      "{mascot} Locker Room Standard",
      "{team} Culture Beyond One Season",
    ],
  },
  {
    match: /handle the pressure|pressure of the job/i,
    titles: [
      "{team} Coach on Handling Pressure",
      "{mascot} Week-to-Week Pressure",
      "{team} Steadies Under the Spotlight",
    ],
  },
  {
    match: /headline get wrong|headline writes itself/i,
    titles: [
      "{team} Rewrites the Headline",
      "{mascot} Sets the Record Straight",
      "{team} Beyond the Narrative",
    ],
  },
  {
    match: /toughest opposing coach|opponent that worries/i,
    titles: [
      "{team} Scouts the Opposition",
      "{mascot} Respects the Matchup",
      "{team} Opponent Watch",
    ],
  },
];

/** Legacy keyword bank (secondary scoring). */
export const INTERVIEW_TITLE_BANK: Array<{ keys: string[]; titles: string[] }> = [
  { keys: ["faith", "god", "lord", "yeshua", "prayer", "blessed"], titles: [
    "{team} Coach Keeps Faith First", "{mascot} Grateful and Locked In", "{team} Grounded Message",
  ]},
  { keys: ["work", "grind", "25/8", "hunger"], titles: [
    "{team} Coach on the Grind", "{mascot} Extra Work Mentality", "{team} Hunger Check",
  ]},
  { keys: ["dominat", "crush", "blowout"], titles: [
    "{team} Coach Talks Dominance", "{mascot} Feeling Unstoppable",
  ]},
  { keys: ["rival", "rivalry"], titles: [
    "{team} Turns Up Rivalry Week", "{mascot} Sends a Rivalry Message",
  ]},
];

export function allInterviewTitles(): string[] {
  const topicTitles = Object.values(TOPIC_TITLE_BANK).flat();
  const phraseTitles = QUESTION_PHRASE_TITLES.flatMap((row) => row.titles);
  const keywordTitles = INTERVIEW_TITLE_BANK.flatMap((row) => row.titles);
  return [...new Set([...topicTitles, ...phraseTitles, ...keywordTitles, "{team} Coach Opens Up", "{mascot} Speaks Candidly", "{team} Midseason Check-In"])];
}

function topicFromQuestionId(questionId: string | undefined): string | null {
  if (!questionId) return null;
  const topic = questionId.split(":")[0]?.trim().toLowerCase();
  return topic && TOPIC_TITLE_BANK[topic] ? topic : null;
}

function fillTemplate(template: string, team: string, mascot: string, weekNumber: number): string {
  return template
    .replaceAll("{team}", team)
    .replaceAll("{mascot}", mascot)
    .replaceAll("{week}", String(weekNumber));
}

export function buildShortInterviewHeadline(input: {
  teamName?: string | null;
  mascotOrNick?: string | null;
  answers: InterviewAnswer[];
  weekNumber: number;
}): string {
  const team = (input.teamName ?? "").trim() || "League";
  const mascot = (input.mascotOrNick ?? team).trim() || team;
  const questions = input.answers.map((a) => a.question ?? "").filter(Boolean);
  const corpus = input.answers.map((a) => `${a.question} ${a.answer}`).join(" ");

  const scored = new Map<string, number>();
  const bump = (title: string, weight: number) => {
    scored.set(title, (scored.get(title) ?? 0) + weight);
  };

  // 1) Question-phrase titles (highest signal)
  for (const question of questions) {
    for (const row of QUESTION_PHRASE_TITLES) {
      if (row.match.test(question)) {
        for (const title of row.titles) bump(title, 8);
      }
    }
  }

  // 2) Topic of each chosen question
  for (const answer of input.answers) {
    const topic = topicFromQuestionId(answer.questionId);
    if (!topic) continue;
    for (const title of TOPIC_TITLE_BANK[topic] ?? []) bump(title, 5);
  }

  // Infer topic from question text if ids missing
  for (const question of questions) {
    const lower = question.toLowerCase();
    if (lower.includes("portal")) for (const t of TOPIC_TITLE_BANK.transfer_portal) bump(t, 4);
    if (lower.includes("recruit")) for (const t of TOPIC_TITLE_BANK.recruiting_trail) bump(t, 4);
    if (lower.includes("rival")) for (const t of TOPIC_TITLE_BANK.rivalry_week) bump(t, 4);
    if (lower.includes("playoff") || lower.includes("championship")) {
      for (const t of TOPIC_TITLE_BANK.playoff_push) bump(t, 3);
    }
    if (lower.includes("philosophy") || lower.includes("culture") || lower.includes("as a coach")) {
      for (const t of TOPIC_TITLE_BANK.coach_spotlight) bump(t, 4);
    }
  }

  // 3) Answer keyword bank (lighter weight — avoids "League Portal Impact" winning on one word)
  const lowerCorpus = corpus.toLowerCase();
  for (const row of INTERVIEW_TITLE_BANK) {
    if (row.keys.some((k) => lowerCorpus.includes(k))) {
      for (const title of row.titles) bump(title, 2);
    }
  }

  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]);
  const topScore = ranked[0]?.[1] ?? 0;
  const topPool = ranked.filter(([, score]) => score === topScore).map(([title]) => title);
  const pool = topPool.length
    ? topPool
    : ["{team} Coach Opens Up", "{mascot} Speaks Candidly", "{team} Midseason Check-In"];
  const template = pool[Math.floor(Math.random() * pool.length)] ?? "{team} Coach Opens Up";
  return fillTemplate(template, team, mascot, input.weekNumber);
}
