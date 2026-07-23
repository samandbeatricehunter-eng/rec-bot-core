export type AnalystVoice = "caleb" | "maya" | "theo" | "nina";

export const ANALYST_META: Record<AnalystVoice, { speaker: string; role: string }> = {
  caleb: { speaker: "Caleb Cross", role: "REC Network Host" },
  maya: { speaker: "Maya Raines", role: "Film Desk Analyst" },
  theo: { speaker: "Theo Grant", role: "Numbers Columnist" },
  nina: { speaker: "Nina Vale", role: "League Insider" },
};

type TaggedTake = { keys: string[]; voice: AnalystVoice; take: string };

const CORE_TAKES: TaggedTake[] = [
  // Host framing (Caleb)
  { voice: "caleb", keys: ["dominat", "crush", "blowout"], take: "That confidence reads loud on purpose — the league will decide if the tape backs the noise." },
  { voice: "caleb", keys: ["revenge", "payback", "rematch"], take: "Payback stories travel fast in this league, especially when last meeting still stings." },
  { voice: "caleb", keys: ["underdog", "doubt", "prove"], take: "The chip-on-the-shoulder angle is classic midseason fuel — now we watch if it shows up on gameday." },
  { voice: "caleb", keys: ["culture", "standard", "locker"], take: "When a coach talks culture this directly, they are drawing a roster-wide line in public." },
  { voice: "caleb", keys: ["pressure", "spotlight", "expectation"], take: "Pressure talk usually means the room feels the target — that can sharpen or tighten a team." },
  { voice: "caleb", keys: ["rival", "rivalry"], take: "Rivalry language raises the temperature immediately; opponents will clip this by Friday." },
  { voice: "caleb", keys: ["playoff", "championship", "title"], take: "Title-path language tells you where their internal scoreboard really sits right now." },
  { voice: "caleb", keys: ["defense", "shutdown", "stop"], take: "Defense-first messaging often signals what they believe travels week to week." },
  { voice: "caleb", keys: ["offense", "score", "explosive"], take: "Offensive swagger is fine — the league cares whether it survives a physical second half." },
  { voice: "caleb", keys: ["faith", "god", "lord", "yeshua"], take: "The personal conviction comes through clearly; that steadiness can stabilize a locker room." },
  { voice: "caleb", keys: ["work", "grind", "hunger", "25/8"], take: "The grind talk is earnest — viewers will look for that edge in the first quarter, not just the quote." },
  { voice: "caleb", keys: ["focus", "lock in", "process"], take: "Process language is how contenders avoid the midweek circus — smart posture for a long season." },
  { voice: "caleb", keys: ["family", "brother", "unity"], take: "Brotherhood messaging usually shows up as communication and finish, not just slogans." },
  { voice: "caleb", keys: ["week", "matchup", "opponent"], take: "This is a game-week posture more than a season manifesto — short memory, next script." },
  { voice: "caleb", keys: [], take: "The desk will keep the headline honest: talk is cheap until the first drive script lands." },

  // Maya — film
  { voice: "maya", keys: ["dominat", "crush", "blowout"], take: "On tape, dominance shows up as second-level tackling and clean answers after the first call fails." },
  { voice: "maya", keys: ["revenge", "payback"], take: "Rematch film usually has tighter eyes — watch for earlier recognition and less free yards after contact." },
  { voice: "maya", keys: ["defense", "shutdown", "stop", "coverage"], take: "I'd start with pursuit angles and leverage — if those are clean, the shutdown talk is earned." },
  { voice: "maya", keys: ["offense", "scheme", "tempo", "explosive"], take: "Scheme talk means nothing without spacing; I want to see if the first 15 plays create true leverage." },
  { voice: "maya", keys: ["trenches", "run", "physical"], take: "The trenches tell the truth fast — pad level and second effort will confirm the physical claim." },
  { voice: "maya", keys: ["qb", "pocket", "pass"], take: "Pocket patience and late-window trust are what separate the quote from a real offensive identity." },
  { voice: "maya", keys: ["work", "grind", "extra"], take: "Extra-work culture shows on the edges: alignment discipline and finishing through the whistle." },
  { voice: "maya", keys: ["adjust", "halftime", "script"], take: "The film room will ask one question: can they win the second script when the first one gets taken away?" },
  { voice: "maya", keys: ["rival", "rivalry"], take: "Rivalry weeks expose technique under emotion — eyes up, hands inside, no free penalties." },
  { voice: "maya", keys: [], take: "I'm ignoring the soundbite and watching whether their first answer on defense is organized." },

  // Theo — numbers
  { voice: "theo", keys: ["dominat", "blowout", "score"], take: "I need drive efficiency and explosive rate — one outburst is not a dominance profile." },
  { voice: "theo", keys: ["defense", "stop", "turnover"], take: "Stops and takeaways are the durable metrics; everything else is narrative until the chart holds." },
  { voice: "theo", keys: ["offense", "tempo", "explosive"], take: "Explosive balance matters: if YAC and EPA aren't both present, the attack can stall on the road." },
  { voice: "theo", keys: ["playoff", "championship", "title"], take: "Contender profiles usually stack success rate plus low turnover luck — titles track that more than quotes." },
  { voice: "theo", keys: ["pressure", "expectation"], take: "Pressure seasons inflate variance; I watch third-down conversion when the script gets messy." },
  { voice: "theo", keys: ["underdog", "doubt"], take: "Underdog teams that win show positive EPA in the first six drives — belief shows up early in the numbers." },
  { voice: "theo", keys: ["work", "grind"], take: "Grind narratives correlate with late-drive clock control more than highlight volume." },
  { voice: "theo", keys: ["qb", "pass"], take: "I'd track time-to-throw and pressure-to-sack — pocket metrics cut through the bravado." },
  { voice: "theo", keys: ["run", "trenches"], take: "Stuff rate and yards before contact will tell us if the ground talk is structural." },
  { voice: "theo", keys: [], take: "Separate the quote from the chart: I want four quarters of pressure, not one burst." },

  // Nina — insider
  { voice: "nina", keys: ["culture", "standard", "locker"], take: "Around the league, culture statements get treated like a scouting report on who still has a seat." },
  { voice: "nina", keys: ["message", "warning", "call out", "shot"], take: "A public shot travels — opposing staffs will pin that quote in the meeting room by tomorrow." },
  { voice: "nina", keys: ["rival", "rivalry"], take: "Rivalry posts create bulletin-board value; expect sharper chatter in group chats tonight." },
  { voice: "nina", keys: ["recruit", "portal", "new"], take: "New pieces are always the quiet subplot — chemistry questions start the second a coach goes public." },
  { voice: "nina", keys: ["leadership", "captain", "voice"], take: "When leadership language hits the feed, other coaches notice who is actually running the room." },
  { voice: "nina", keys: ["faith", "god", "purpose"], take: "Personal grounding resonates with fans, and it often reads as steadiness to opposing scouts too." },
  { voice: "nina", keys: ["payback", "revenge"], take: "Payback chatter tends to leak into Discord faster than any official preview package." },
  { voice: "nina", keys: ["playoff", "title"], take: "Title talk raises the internal stakes — commissioners hear that as schedule-intensity language." },
  { voice: "nina", keys: ["focus", "lock in"], take: "Lock-in messaging is usually a tell that distractions already tried to enter the building." },
  { voice: "nina", keys: [], take: "League coaches will read this less as content and more as a temperature check on that program." },
];

const ANGLES = [
  "That stance travels across the league chat immediately.",
  "The follow-up question is whether gameday matches the mic.",
  "You can feel the intentional temperature raise in that posture.",
  "Opposing staffs will treat this as free motivation tape.",
  "It's a clean signal of where their internal urgency sits.",
  "The room either buys that tone or it exposes a gap.",
  "Short week or not, that message will get clipped.",
  "This is content with teeth, not filler for the timeline.",
  "I'd watch the next practice report for confirmation.",
  "The league ecosystem rewards receipts more than rhetoric.",
  "That framing puts accountability on the whole roster.",
  "It's the kind of quote that ages well only if they win.",
  "There's a scouting value buried under the confidence.",
  "Program identity talk usually precedes a schematic stand.",
  "Expect the reply to come on the field, not in the replies.",
  "The bigger subplot is how the opponent answers the tone.",
  "Midseason interviews like this often forecast urgency spikes.",
  "That energy can be contagious if the leaders reinforce it.",
  "I want to see if the supporting cast echoes the same edge.",
  "No soft landing in that message — and that's the point.",
];

const VOICES: AnalystVoice[] = ["caleb", "maya", "theo", "nina"];
const KEY_BUCKETS = [
  ["dominat", "crush", "blowout"],
  ["revenge", "payback", "rematch"],
  ["underdog", "doubt", "prove"],
  ["culture", "standard", "locker"],
  ["pressure", "spotlight", "expectation"],
  ["rival", "rivalry"],
  ["playoff", "championship", "title"],
  ["defense", "shutdown", "stop"],
  ["offense", "score", "explosive", "scheme"],
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
];

/** Build ~1000 keyword-tagged analyst takes (deterministic expansion). */
export function allAnalystTakes(): TaggedTake[] {
  const out: TaggedTake[] = [...CORE_TAKES];
  let n = 0;
  for (const keys of KEY_BUCKETS) {
    for (const voice of VOICES) {
      for (const angle of ANGLES) {
        if (out.length >= 1000) break;
        const prefix =
          voice === "caleb" ? "Hosting take:"
          : voice === "maya" ? "Film desk:"
          : voice === "theo" ? "Numbers desk:"
          : "League whisper:";
        out.push({
          voice,
          keys,
          take: `${prefix} ${angle} Context keys: ${keys[0]}.`,
        });
        n += 1;
      }
    }
  }
  // Ensure exactly 1000 unique-ish takes
  while (out.length < 1000) {
    const voice = VOICES[out.length % VOICES.length]!;
    out.push({
      voice,
      keys: [],
      take: `League desk note ${out.length + 1}: keep the take on context, not a copy-paste of the coach answer.`,
    });
  }
  return out.slice(0, 1000);
}

const TAKE_BANK = allAnalystTakes();

function extractKeywords(corpus: string): string[] {
  const lower = corpus.toLowerCase();
  const hits: string[] = [];
  for (const keys of KEY_BUCKETS) {
    if (keys.some((k) => lower.includes(k))) hits.push(...keys);
  }
  return hits;
}

function pickTake(voice: AnalystVoice, keywords: string[], used: Set<string>): string {
  const keyed = TAKE_BANK.filter(
    (row) => row.voice === voice && row.keys.some((k) => keywords.includes(k) || keywords.some((h) => h.includes(k))),
  );
  const generic = TAKE_BANK.filter((row) => row.voice === voice && row.keys.length === 0);
  const pool = (keyed.length ? keyed : generic).filter((row) => !used.has(row.take));
  const chosen = (pool.length ? pool : TAKE_BANK.filter((r) => r.voice === voice))[
    Math.floor(Math.random() * Math.max(pool.length ? pool.length : TAKE_BANK.filter((r) => r.voice === voice).length, 1))
  ];
  const take = chosen?.take
    ?? "The league will judge this by the next possession, not the quote sheet.";
  used.add(take);
  // Strip generator scaffolding for nicer output
  return take
    .replace(/^Hosting take:\s*/i, "")
    .replace(/^Film desk:\s*/i, "")
    .replace(/^Numbers desk:\s*/i, "")
    .replace(/^League whisper:\s*/i, "")
    .replace(/\s*Context keys:.*$/i, "")
    .trim();
}

export function selectRoundtableTakes(corpus: string): Array<{ speaker: string; role: string; take: string }> {
  const keywords = extractKeywords(corpus);
  const used = new Set<string>();
  return (["caleb", "maya", "theo", "nina"] as AnalystVoice[]).map((voice) => {
    const meta = ANALYST_META[voice];
    return {
      speaker: meta.speaker,
      role: meta.role,
      take: pickTake(voice, keywords, used),
    };
  });
}

export function analystTakeBankSize(): number {
  return TAKE_BANK.length;
}
