import type { InterviewAnswer } from "./interview-headlines.js";

/** Short interview title templates. Placeholders: {team} {mascot} {week} */
export const INTERVIEW_TITLE_BANK: Array<{ keys: string[]; titles: string[] }> = [
  { keys: ["dominat", "crush", "blowout", "destroy", "run the table", "unstoppable"], titles: [
    "{team} Coach Talks Dominance", "{mascot} Feeling Unstoppable", "{team} Sets a High Bar",
    "{team} Embraces the Blowout Talk", "{mascot} Won't Soften the Message",
  ]},
  { keys: ["revenge", "payback", "owe", "last time", "rematch", "get back"], titles: [
    "{team} Wants Payback", "{mascot} Circles the Rematch", "{team} Coach Seeks Revenge",
    "{team} Has Unfinished Business", "{mascot} Remembers Last Time",
  ]},
  { keys: ["underdog", "doubt", "prove", "respect", "chip", "overlooked"], titles: [
    "{team} Embraces the Doubt", "{mascot} Playing With a Chip", "{team} Out to Prove It",
    "{team} Coach Demands Respect", "{mascot} Tired of Being Overlooked",
  ]},
  { keys: ["culture", "locker room", "identity", "standard", "buy in"], titles: [
    "{team} Draws a Culture Line", "{mascot} Defines the Standard", "{team} Locker Room Speaks",
    "{team} Coach on Program Identity", "{mascot} Builds Buy-In",
  ]},
  { keys: ["pressure", "heat", "spotlight", "expectation", "noise", "target"], titles: [
    "{team} Coach on the Pressure", "{mascot} Faces the Noise", "{team} Owns the Spotlight",
    "{team} Handles Expectation", "{mascot} Under the Microscope",
  ]},
  { keys: ["rival", "enemy", "hate", "border", "rivalry", "nemesis"], titles: [
    "{team} Turns Up Rivalry Week", "{mascot} Sends a Rivalry Message", "{team} Coach on the Rival",
    "{team} Stokes the Rivalry", "{mascot} Draws Battle Lines",
  ]},
  { keys: ["playoff", "championship", "title", "final", "trophy", "ring"], titles: [
    "{team} Eyes the Finish Line", "{mascot} Talks Title Path", "{team} Championship Mentality",
    "{team} Coach on the Trophy Hunt", "{mascot} Chasing Hardware",
  ]},
  { keys: ["defense", "stop", "shutdown", "d-line", "coverage", "bend"], titles: [
    "{team} Trusts the Defense", "{mascot} Defense Sets the Tone", "{team} Coach on Stops",
    "{team} Built to Shutdown", "{mascot} Bends but Doesn't Break",
  ]},
  { keys: ["offense", "score", "attack", "scheme", "tempo", "explosive"], titles: [
    "{team} Opens Up the Offense", "{mascot} Attack Mode", "{team} Scheme Talk",
    "{team} Coach on Explosive Plays", "{mascot} Wants Tempo",
  ]},
  { keys: ["message", "warning", "notice", "call out", "shot", "bulletin"], titles: [
    "{team} Delivers a Message", "{mascot} Fires a Shot", "{team} Bulletin-Board Material",
    "{team} Coach Issues a Warning", "{mascot} Sends Notice",
  ]},
  { keys: ["faith", "god", "lord", "yeshua", "prayer", "blessed", "grateful"], titles: [
    "{team} Coach Keeps Faith First", "{mascot} Grateful and Locked In", "{team} Grounded Message",
    "{team} Coach on Purpose", "{mascot} Speaks From the Heart",
  ]},
  { keys: ["work", "grind", "25/8", "extra", "hunger", "determination", "sun up"], titles: [
    "{team} Coach on the Grind", "{mascot} Extra Work Mentality", "{team} Hunger Check",
    "{team} Sun-Up Standard", "{mascot} Living in the Lab",
  ]},
  { keys: ["family", "brother", "together", "unity", "bond"], titles: [
    "{team} Family First", "{mascot} Bonds Show Up", "{team} Unity Message",
    "{team} Coach on Brotherhood", "{mascot} Together Mentality",
  ]},
  { keys: ["focus", "locked", "lock in", "details", "process", "one game"], titles: [
    "{team} Stays Locked In", "{mascot} Process Over Noise", "{team} One-Game Mentality",
    "{team} Coach on Focus", "{mascot} Details Win",
  ]},
  { keys: ["qb", "quarterback", "pocket", "pass", "arm"], titles: [
    "{team} Coach on the QB Room", "{mascot} Passing Attack Talk", "{team} Trusts the Arm",
  ]},
  { keys: ["run", "ground", "rush", "backfield", "trenches"], titles: [
    "{team} Ground Game Focus", "{mascot} Owns the Trenches", "{team} Run-First Mindset",
  ]},
  { keys: ["special teams", "kick", "punt", "return", "field position"], titles: [
    "{team} Values Field Position", "{mascot} Special Teams Matter",
  ]},
  { keys: ["injury", "healthy", "depth", "next man"], titles: [
    "{team} Next-Man Mentality", "{mascot} Depth Chart Talk",
  ]},
  { keys: ["recruit", "transfer", "portal", "new guys", "additions"], titles: [
    "{team} New Pieces Fit In", "{mascot} Portal Impact", "{team} Fresh Legs Mentality",
  ]},
  { keys: ["week", "matchup", "opponent", "this week", "upcoming"], titles: [
    "{team} Preview Week {week}", "{mascot} Locked on the Matchup", "{team} Week {week} Focus",
    "{team} Coach Previews the Opponents", "{mascot} Ready for Week {week}",
  ]},
  { keys: ["confidence", "belief", "swagger", "believe"], titles: [
    "{team} Confidence Is High", "{mascot} Belief Check", "{team} Swagger With Substance",
  ]},
  { keys: ["humble", "quiet", "work speaks"], titles: [
    "{team} Lets the Work Speak", "{mascot} Quiet Confidence",
  ]},
  { keys: ["adjust", "halftime", "script", "adapt"], titles: [
    "{team} Adjustment Mentality", "{mascot} Script and Adapt",
  ]},
  { keys: ["leadership", "captain", "voice", "lead"], titles: [
    "{team} Leadership Speaks Up", "{mascot} Voices in the Room",
  ]},
  { keys: ["legacy", "history", "tradition", "program"], titles: [
    "{team} Protects the Legacy", "{mascot} Tradition Check", "{team} Program Standard",
  ]},
];

export function allInterviewTitles(): string[] {
  const base = INTERVIEW_TITLE_BANK.flatMap((row) => row.titles);
  const extras = [
    "{team} Coach Opens Up", "{mascot} Speaks Candidly", "{team} Unfiltered",
    "{team} In Their Own Words", "{mascot} Mic'd Up Mentality", "{team} Hot Seat Answers",
    "{team} Midseason Check-In", "{mascot} State of the Program", "{team} Straight Talk",
    "{team} Locker Room Access", "{mascot} Behind the Headset", "{team} Film-Room Focus",
    "{team} Sideline Mentality", "{mascot} Game-Week Voice", "{team} Presser Energy",
    "{team} Keeps It Real", "{mascot} No Filter Friday", "{team} Coach Confidential",
    "{team} Weekly Sit-Down", "{mascot} Truth Session", "{team} Ask Me Anything",
    "{team} Mindset Monday", "{mascot} Cleared for Takeoff", "{team} Ready Point",
    "{team} Edge Finding", "{mascot} Contender Talk", "{team} Spoiler Alert",
    "{team} Statement Week", "{mascot} Measuring Stick", "{team} Proof of Work",
    "{team} Coach on Winning Ugly", "{mascot} Celebrates the Grind", "{team} Clutch Mentality",
    "{team} Red-Zone Focus", "{mascot} Third-Down Talk", "{team} Turnover Battle",
    "{team} Clock Management", "{mascot} Situational Football", "{team} Physicality First",
    "{team} Speed Kills", "{mascot} Scheme Diversity", "{team} Matchup Nightmare",
    "{team} Home-Field Edge", "{mascot} Road Warriors", "{team} Primetime Ready",
    "{team} Must-Win Energy", "{mascot} Elimination Mode", "{team} Reset Button",
    "{team} Bounce-Back Plan", "{mascot} Stay Hungry", "{team} Don't Flinch",
    "{team} Control What You Can", "{mascot} Next Possession", "{team} Finish Strong",
    "{team} Start Fast", "{mascot} Close the Deal", "{team} Own the Middle",
    "{team} Perimeter Pressure", "{mascot} Pocket Presence", "{team} Play-Action Threat",
    "{team} Blitz Package", "{mascot} Coverage Disguises", "{team} Run Fits",
    "{team} Tackle Finish", "{mascot} Ball Security", "{team} Explosive Balance",
    "{team} Coach on Chemistry", "{mascot} Practice Habits", "{team} Meeting Mentality",
    "{team} Film Study", "{mascot} Walkthrough Focus", "{team} Travel Day Mindset",
  ];
  const out = [...new Set([...base, ...extras])];
  let i = 0;
  while (out.length < 150) {
    out.push(`{team} Week {week} Notebook`);
    i += 1;
    if (i > 5) out.push(`{mascot} Week {week} Notebook`);
    if (out.length >= 150) break;
  }
  return out.slice(0, 150);
}

export function buildShortInterviewHeadline(input: {
  teamName?: string | null;
  mascotOrNick?: string | null;
  answers: InterviewAnswer[];
  weekNumber: number;
}): string {
  const team = (input.teamName ?? "League").trim() || "League";
  const mascot = (input.mascotOrNick ?? team).trim() || team;
  const corpus = input.answers.map((a) => `${a.question} ${a.answer}`).join(" ").toLowerCase();
  const matched = INTERVIEW_TITLE_BANK.filter((row) => row.keys.some((k) => corpus.includes(k)));
  const pool = matched.length
    ? matched.flatMap((row) => row.titles)
    : allInterviewTitles().filter((t) => !t.includes("Notebook"));
  const template = pool[Math.floor(Math.random() * pool.length)] ?? "{team} Coach Opens Up";
  return template
    .replaceAll("{team}", team)
    .replaceAll("{mascot}", mascot)
    .replaceAll("{week}", String(input.weekNumber));
}
