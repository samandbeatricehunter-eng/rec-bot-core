export type AnalystVoice = "caleb" | "maya" | "theo" | "nina";

export const ANALYST_META: Record<AnalystVoice, { speaker: string; role: string }> = {
  caleb: { speaker: "Caleb Cross", role: "REC Network Host" },
  maya: { speaker: "Maya Raines", role: "Film Desk Analyst" },
  theo: { speaker: "Theo Grant", role: "Numbers Columnist" },
  nina: { speaker: "Nina Vale", role: "League Insider" },
};

type TaggedTake = { keys: string[]; voice: AnalystVoice; take: string };

/** Voice-owned takes only — never share identical stripped copy across analysts. */
const CORE_TAKES: TaggedTake[] = [
  // Caleb — host framing
  { voice: "caleb", keys: ["dominat", "crush", "blowout"], take: "That confidence reads loud on purpose — the league will decide if the tape backs the noise." },
  { voice: "caleb", keys: ["revenge", "payback", "rematch"], take: "Payback stories travel fast in this league, especially when last meeting still stings." },
  { voice: "caleb", keys: ["underdog", "doubt", "prove"], take: "The chip-on-the-shoulder angle is classic midseason fuel — now we watch if it shows up on gameday." },
  { voice: "caleb", keys: ["culture", "standard", "locker"], take: "When a coach talks culture this directly, they are drawing a roster-wide line in public." },
  { voice: "caleb", keys: ["pressure", "spotlight", "expectation"], take: "Pressure talk usually means the room feels the target — that can sharpen or tighten a team." },
  { voice: "caleb", keys: ["rival", "rivalry"], take: "Rivalry language raises the temperature immediately; opponents will clip this by Friday." },
  { voice: "caleb", keys: ["playoff", "championship", "title"], take: "Title-path language tells you where their internal scoreboard really sits right now." },
  { voice: "caleb", keys: ["defense", "shutdown", "stop"], take: "Defense-first messaging often signals what they believe travels week to week." },
  { voice: "caleb", keys: ["offense", "score", "explosive"], take: "Offensive swagger is fine — the league cares whether it survives a physical second half." },
  { voice: "caleb", keys: ["faith", "god", "lord", "yeshua", "prayer"], take: "The personal conviction comes through clearly; that steadiness can stabilize a locker room." },
  { voice: "caleb", keys: ["work", "grind", "hunger", "25/8"], take: "The grind talk is earnest — viewers will look for that edge in the first quarter, not just the quote." },
  { voice: "caleb", keys: ["focus", "lock in", "process"], take: "Process language is how contenders avoid the midweek circus — smart posture for a long season." },
  { voice: "caleb", keys: ["family", "brother", "unity"], take: "Brotherhood messaging usually shows up as communication and finish, not just slogans." },
  { voice: "caleb", keys: ["recruit", "portal", "transfer"], take: "Roster-building talk is a midseason subplot — the league will watch who actually lands and contributes." },
  { voice: "caleb", keys: ["gameplan", "philosophy", "scheme"], take: "Philosophy talk is the host's favorite tell: it reveals what they refuse to abandon under stress." },
  { voice: "caleb", keys: ["week", "matchup", "opponent"], take: "This is a game-week posture more than a season manifesto — short memory, next script." },
  { voice: "caleb", keys: [], take: "The desk will keep the headline honest: talk is cheap until the first drive script lands." },

  // Maya — film
  { voice: "maya", keys: ["dominat", "crush", "blowout"], take: "On tape, dominance shows up as second-level tackling and clean answers after the first call fails." },
  { voice: "maya", keys: ["revenge", "payback"], take: "Rematch film usually has tighter eyes — watch for earlier recognition and less free yards after contact." },
  { voice: "maya", keys: ["defense", "shutdown", "stop", "coverage"], take: "I'd start with pursuit angles and leverage — if those are clean, the shutdown talk is earned." },
  { voice: "maya", keys: ["offense", "scheme", "tempo", "explosive", "gameplan", "philosophy"], take: "Scheme talk means nothing without spacing; I want to see if the first 15 plays create true leverage." },
  { voice: "maya", keys: ["trenches", "run", "physical"], take: "The trenches tell the truth fast — pad level and second effort will confirm the physical claim." },
  { voice: "maya", keys: ["qb", "pocket", "pass"], take: "Pocket patience and late-window trust are what separate the quote from a real offensive identity." },
  { voice: "maya", keys: ["work", "grind", "extra"], take: "Extra-work culture shows on the edges: alignment discipline and finishing through the whistle." },
  { voice: "maya", keys: ["adjust", "halftime", "script"], take: "The film room will ask one question: can they win the second script when the first one gets taken away?" },
  { voice: "maya", keys: ["rival", "rivalry"], take: "Rivalry weeks expose technique under emotion — eyes up, hands inside, no free penalties." },
  { voice: "maya", keys: ["recruit", "portal", "transfer"], take: "New pieces show first in spacing and assignment clarity — chemistry tells on film before the box score." },
  { voice: "maya", keys: ["faith", "god", "lord"], take: "Steady body language between plays often tracks with that kind of grounding — watch the sideline between series." },
  { voice: "maya", keys: [], take: "I'm ignoring the soundbite and watching whether their first answer on defense is organized." },

  // Theo — numbers
  { voice: "theo", keys: ["dominat", "blowout", "score"], take: "I need drive efficiency and explosive rate — one outburst is not a dominance profile." },
  { voice: "theo", keys: ["defense", "stop", "turnover"], take: "Stops and takeaways are the durable metrics; everything else is narrative until the chart holds." },
  { voice: "theo", keys: ["offense", "tempo", "explosive", "gameplan", "philosophy"], take: "Explosive balance matters: if YAC and EPA aren't both present, the attack can stall on the road." },
  { voice: "theo", keys: ["playoff", "championship", "title"], take: "Contender profiles usually stack success rate plus low turnover luck — titles track that more than quotes." },
  { voice: "theo", keys: ["pressure", "expectation"], take: "Pressure seasons inflate variance; I watch third-down conversion when the script gets messy." },
  { voice: "theo", keys: ["underdog", "doubt"], take: "Underdog teams that win show positive EPA in the first six drives — belief shows up early in the numbers." },
  { voice: "theo", keys: ["work", "grind"], take: "Grind narratives correlate with late-drive clock control more than highlight volume." },
  { voice: "theo", keys: ["qb", "pass"], take: "I'd track time-to-throw and pressure-to-sack — pocket metrics cut through the bravado." },
  { voice: "theo", keys: ["run", "trenches"], take: "Stuff rate and yards before contact will tell us if the ground talk is structural." },
  { voice: "theo", keys: ["recruit", "portal", "transfer"], take: "Portal churn shows in snap continuity — I want to see snap-share stability before buying the upside." },
  { voice: "theo", keys: [], take: "Separate the quote from the chart: I want four quarters of pressure, not one burst." },

  // Nina — insider
  { voice: "nina", keys: ["culture", "standard", "locker"], take: "Around the league, culture statements get treated like a scouting report on who still has a seat." },
  { voice: "nina", keys: ["message", "warning", "call out", "shot"], take: "A public shot travels — opposing staffs will pin that quote in the meeting room by tomorrow." },
  { voice: "nina", keys: ["rival", "rivalry"], take: "Rivalry posts create bulletin-board value; expect sharper chatter in group chats tonight." },
  { voice: "nina", keys: ["recruit", "portal", "transfer", "new"], take: "New pieces are always the quiet subplot — chemistry questions start the second a coach goes public." },
  { voice: "nina", keys: ["leadership", "captain", "voice"], take: "When leadership language hits the feed, other coaches notice who is actually running the room." },
  { voice: "nina", keys: ["faith", "god", "purpose", "lord", "yeshua"], take: "Personal grounding resonates with fans, and it often reads as steadiness to opposing scouts too." },
  { voice: "nina", keys: ["payback", "revenge"], take: "Payback chatter tends to leak into Discord faster than any official preview package." },
  { voice: "nina", keys: ["playoff", "title"], take: "Title talk raises the internal stakes — commissioners hear that as schedule-intensity language." },
  { voice: "nina", keys: ["focus", "lock in"], take: "Lock-in messaging is usually a tell that distractions already tried to enter the building." },
  { voice: "nina", keys: ["gameplan", "philosophy"], take: "When a coach defines their philosophy on mic, rival coordinators start clipping the exact phrasing." },
  { voice: "nina", keys: [], take: "League coaches will read this less as content and more as a temperature check on that program." },
];

const KEY_BUCKETS = [
  ["dominat", "crush", "blowout"],
  ["revenge", "payback", "rematch"],
  ["underdog", "doubt", "prove"],
  ["culture", "standard", "locker"],
  ["pressure", "spotlight", "expectation"],
  ["rival", "rivalry"],
  ["playoff", "championship", "title"],
  ["defense", "shutdown", "stop"],
  ["offense", "score", "explosive", "scheme", "gameplan", "philosophy"],
  ["faith", "god", "lord", "yeshua", "prayer"],
  ["work", "grind", "hunger", "25/8", "extra"],
  ["focus", "lock in", "process"],
  ["family", "brother", "unity"],
  ["qb", "pocket", "pass"],
  ["run", "trenches", "ground"],
  ["message", "warning", "shot", "call out"],
  ["week", "matchup", "opponent"],
  ["leadership", "captain", "voice"],
  ["adjust", "halftime", "script"],
  ["legacy", "tradition", "program"],
  ["recruit", "portal", "transfer"],
];

const TAKE_BANK = CORE_TAKES;

function extractKeywords(corpus: string): string[] {
  const lower = corpus.toLowerCase();
  const hits: string[] = [];
  for (const keys of KEY_BUCKETS) {
    if (keys.some((k) => lower.includes(k))) hits.push(...keys);
  }
  return hits;
}

function normalizeTake(take: string): string {
  return take
    .replace(/^Hosting take:\s*/i, "")
    .replace(/^Film desk:\s*/i, "")
    .replace(/^Numbers desk:\s*/i, "")
    .replace(/^League whisper:\s*/i, "")
    .replace(/\s*Context keys:.*$/i, "")
    .trim()
    .toLowerCase();
}

function pickTake(voice: AnalystVoice, keywords: string[], usedNormalized: Set<string>): string {
  const keyed = TAKE_BANK.filter(
    (row) =>
      row.voice === voice &&
      row.keys.length > 0 &&
      row.keys.some((k) => keywords.includes(k) || keywords.some((h) => h.includes(k))),
  );
  const generic = TAKE_BANK.filter((row) => row.voice === voice && row.keys.length === 0);
  const voicePool = TAKE_BANK.filter((row) => row.voice === voice);
  const prefer = (keyed.length ? keyed : generic.length ? generic : voicePool).filter(
    (row) => !usedNormalized.has(normalizeTake(row.take)),
  );
  const pool = prefer.length ? prefer : voicePool.filter((row) => !usedNormalized.has(normalizeTake(row.take)));
  const fallback = voicePool;
  const chosen = (pool.length ? pool : fallback)[
    Math.floor(Math.random() * Math.max((pool.length ? pool : fallback).length, 1))
  ];
  const take =
    chosen?.take ??
    "The league will judge this by the next possession, not the quote sheet.";
  usedNormalized.add(normalizeTake(take));
  return take.trim();
}

export function selectRoundtableTakes(corpus: string): Array<{ speaker: string; role: string; take: string }> {
  const keywords = extractKeywords(corpus);
  const usedNormalized = new Set<string>();
  return (["caleb", "maya", "theo", "nina"] as AnalystVoice[]).map((voice) => {
    const meta = ANALYST_META[voice];
    return {
      speaker: meta.speaker,
      role: meta.role,
      take: pickTake(voice, keywords, usedNormalized),
    };
  });
}

export function analystTakeBankSize(): number {
  return TAKE_BANK.length;
}

/** @deprecated kept for any tooling that expected the expanded bank */
export function allAnalystTakes(): TaggedTake[] {
  return TAKE_BANK;
}
