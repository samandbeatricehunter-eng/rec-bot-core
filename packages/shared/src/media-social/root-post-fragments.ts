// Deterministic "mock-LLM" wording layer for claim-grounded root posts. This codebase has no
// LLM integration anywhere (confirmed by inspection: the uploaded package's
// tweet_blueprints_contextual.json templates are written as generation PROMPTS -- e.g. "Write as
// a real social post; do not mention template fields or internal event names" -- meaning they
// expect an LLM to read them and produce fresh text, which this project does not have and was
// not asked to add). Per direction, this is the semi-deterministic substitute, deliberately built
// to COMPOSE from independent rotating slots rather than pick one whole sentence, so variety
// scales combinatorially instead of linearly with how much is hand-authored:
//
//   body = {fact_line} + MOVE CLAUSE (persona x move, ~6 variants) + optional TAG (persona-wide,
//          ~10 variants) + optional STORYLINE CALLBACK (dynamic, references real persisted
//          evidence count -- not static text)
//
// 4 personas x 6 moves x 6 clauses x (1 + 10 tag options) = 1,584 distinct combinations before
// the storyline callback or the fact_line itself (which the caller varies too) are even counted.
// Fatigue tracking (account-memory.service.ts) excludes whole combined-ids already used, so the
// pool a persona draws from keeps shrinking correctly rather than just looking novel by accident.
import { type SocialClaimMove } from "./social-claim-plan.js";

export type ReactivePersonaKey = "marcus" | "vaughn" | "elliot" | "darius";

export type RootPostFragment = { id: string; move: SocialClaimMove; text: string };

function clauseBank(persona: ReactivePersonaKey, move: SocialClaimMove, texts: string[]): Array<{ id: string; text: string }> {
  return texts.map((text, index) => ({ id: `${persona}:${move}:c${index + 1}`, text }));
}

function tagBank(persona: ReactivePersonaKey, texts: string[]): Array<{ id: string; text: string }> {
  return texts.map((text, index) => ({ id: `${persona}:tag${index + 1}`, text }));
}

// ---------------------------------------------------------------------------------------------
// Marcus Vale -- "The Veteran": process over results, skeptical of small samples, wants things
// repeated before he'll move anyone up his board.
// ---------------------------------------------------------------------------------------------
const MARCUS_CLAUSES: Record<SocialClaimMove, string[]> = {
  report: [
    "{fact_line} One data point. I want to see it again before I say anything more.",
    "{fact_line} Noting it. Not crowning anything off a single week.",
    "{fact_line} That's the report. The evaluation comes later, once there's a pattern.",
    "{fact_line} On the record, that happened. What it means is a separate question.",
    "{fact_line} Writing that down. Not reading anything into it yet.",
    "{fact_line} That's this week's entry. The file's getting longer either way.",
  ],
  interpret: [
    "{fact_line} That reads more like a process signal than a results one -- worth tracking either way.",
    "{fact_line} The number matters less than whether the habit behind it repeats.",
    "{fact_line} I care about the how more than the what here, and the how looked sustainable.",
    "{fact_line} That's a discipline result before it's a talent result. Different conversation.",
    "{fact_line} The situational football behind that is the part worth studying, not the total.",
    "{fact_line} That's what a repeatable process looks like in a single week. Whether it stays repeatable is the question.",
  ],
  compare: [
    "{fact_line} Stack that against the last few weeks and the trend either holds or it doesn't. We'll know soon.",
    "{fact_line} Compared to where this group was a month ago, that's a real jump -- if it's real.",
    "{fact_line} That's a different level than earlier in the season. One week isn't a new baseline yet.",
    "{fact_line} Set that next to the season-long body of work and it either fits the pattern or it doesn't.",
    "{fact_line} That's a jump from where the film had this group a few weeks back.",
    "{fact_line} Relative to the season so far, that's an outlier. Outliers need a second data point before I trust them.",
  ],
  question: [
    "{fact_line} The real question: is that sustainable, or a soft-schedule spike?",
    "{fact_line} Is that a new standard or a good matchup? I'm not ready to answer that yet.",
    "{fact_line} What does the next rep look like against a real test? That's the only question that matters.",
    "{fact_line} Is that the player or the plan? Worth separating before anyone gets credit.",
    "{fact_line} Does that hold up on the road, against a real front? We'll find out.",
    "{fact_line} Is that a trend starting or a ceiling showing up once? Too early to say.",
  ],
  receipt: [
    "{fact_line} Filing that next to what I said about this group a few weeks back.",
    "{fact_line} I flagged this exact pattern earlier this season. Consistent so far.",
    "{fact_line} That lines up with what I've been saying, not against it.",
    "{fact_line} Matches the note I had on this team from before the season even started.",
    "{fact_line} That's the same trend I pointed out a few weeks ago, still holding.",
    "{fact_line} Going back through my notes, that's not a surprise -- it's a confirmation.",
  ],
  project: [
    "{fact_line} If that holds for a month, it changes how I grade the whole unit.",
    "{fact_line} One more week like that and I'll start believing it's the real level, not the ceiling.",
    "{fact_line} That's the kind of week that either starts a trend or gets forgotten by October. Time will tell.",
    "{fact_line} If the process behind that repeats, the results follow. If it doesn't, this was a peak.",
    "{fact_line} Give that four more weeks before calling it anything more than a good week.",
    "{fact_line} That's a real building block if they build on it. If not, it's a footnote.",
  ],
};
const MARCUS_TAGS: string[] = [
  "I don't move boards off one week.",
  "Ask me again in three weeks.",
  "I'll have more once the sample grows.",
  "Not changing my evaluation off that alone.",
  "That's a note, not a conclusion.",
  "Repeatability is the whole ballgame for me.",
  "I've been wrong betting against patience before. Staying patient here too.",
  "Good process shows up before good results do. Keep an eye on both.",
  "I grade the operation, not the highlight.",
  "December football is a different test. We'll see.",
];

// ---------------------------------------------------------------------------------------------
// Vaughn Price -- "The Instigator": receipts, confidence, public accountability, loves being
// right in front of everyone.
// ---------------------------------------------------------------------------------------------
const VAUGHN_CLAUSES: Record<SocialClaimMove, string[]> = {
  report: [
    "{fact_line} Say it with your chest, because I already am.",
    "{fact_line} That's the headline. Everybody can stop pretending otherwise.",
    "{fact_line} Put that on the board and leave it there.",
    "{fact_line} That's not a rumor, that's a stat line. Deal with it.",
    "{fact_line} Somebody screenshot that before the excuses start rolling in.",
    "{fact_line} That happened in front of everybody. No spin available.",
  ],
  interpret: [
    "{fact_line} That's the loudest data point of the week and I'm not being quiet about it.",
    "{fact_line} That's not a fluke, that's a statement, and I'm treating it like one.",
    "{fact_line} People are gonna undersell that. I'm not one of them.",
    "{fact_line} That's a message being sent, whether anyone wants to hear it or not.",
    "{fact_line} That's the kind of week that changes how a room talks about you.",
    "{fact_line} That's confidence turning into results, right on schedule.",
  ],
  compare: [
    "{fact_line} Put that next to the preseason talk and tell me who was right.",
    "{fact_line} Compare that to what the doubters were saying a month ago. Loudly, please.",
    "{fact_line} That's a completely different team than the one everybody wrote off. Say it louder for the back.",
    "{fact_line} Line that up against last month's takes and watch how fast they disappear.",
    "{fact_line} That's not the same group people were sleeping on in the preseason.",
    "{fact_line} Put that next to the discourse from two weeks ago. Night and day.",
  ],
  question: [
    "{fact_line} So who's still doubting this? Raise your hand, I'll wait.",
    "{fact_line} Anybody still want to defend that take from a few weeks ago?",
    "{fact_line} Somebody explain to me how that's not the story of the week.",
    "{fact_line} Who's got the counterargument? Genuinely asking.",
    "{fact_line} At what point does the skepticism actually have to end?",
    "{fact_line} Is anybody still on the fence after that, or are we all caught up now?",
  ],
  receipt: [
    "{fact_line} I called this. Receipts don't lie, and neither do I.",
    "{fact_line} Screenshotting this for the next time somebody wants to argue with me.",
    "{fact_line} Filed right next to the take I made that everyone laughed at. Not laughing now.",
    "{fact_line} That's the receipt. Print it, frame it, whatever you need to do.",
    "{fact_line} Told you weeks ago. Just adding this to the pile of proof.",
    "{fact_line} I've got the original take saved. This is exactly what it predicted.",
  ],
  project: [
    "{fact_line} If this is the new normal, some people owe apologies.",
    "{fact_line} Keep this up and there's no argument left to make against them.",
    "{fact_line} That's the kind of week that ages a take badly if it keeps happening. Watching closely.",
    "{fact_line} Do that again next week and this conversation is officially over.",
    "{fact_line} One more like that and I'm retiring the debate entirely.",
    "{fact_line} If that's the real level now, buckle up for the rest of this.",
  ],
};
const VAUGHN_TAGS: string[] = [
  "I don't do quiet takes. Never have.",
  "Say it louder for whoever's still not listening.",
  "I'll be here when this ages well.",
  "Bookmark this. You'll want it later.",
  "Not backing off this one, ever.",
  "That's just facts with attitude.",
  "I've been early on this the whole time.",
  "Come argue with the stat line, not with me.",
  "This is exactly the energy I've had all season.",
  "Somebody had to say it. Might as well be me.",
];

// ---------------------------------------------------------------------------------------------
// Elliot Mercer -- "The Strategist": rates over totals, efficiency, sample-size discipline,
// allergic to overreacting to one week.
// ---------------------------------------------------------------------------------------------
const ELLIOT_CLAUSES: Record<SocialClaimMove, string[]> = {
  report: [
    "{fact_line} That's the number. I'll have the rate context once I run it against the season sample.",
    "{fact_line} Logging it. The volume-adjusted version tells the real story.",
    "{fact_line} That's the total. The per-play number is what I actually care about.",
    "{fact_line} That's this week's raw figure, unadjusted for opponent quality.",
    "{fact_line} Recording that for the model. Context comes after I run the numbers.",
    "{fact_line} That's the headline stat. The efficiency version is more interesting.",
  ],
  interpret: [
    "{fact_line} One data point moved the mean; it didn't rewrite the prior.",
    "{fact_line} That's opportunity as much as it's efficiency -- the split matters and I'll have it soon.",
    "{fact_line} The underlying rate is what I'm watching, not the box score total by itself.",
    "{fact_line} That's a usage story wearing an efficiency costume. Worth separating.",
    "{fact_line} That could be scheme, matchup, or talent -- I won't guess which without the split.",
    "{fact_line} That's a real signal if the rate holds. If it's volume-driven, it's noise.",
  ],
  compare: [
    "{fact_line} Stack that against the season-long rate and the picture gets clearer, not blurrier.",
    "{fact_line} Relative to the opponent-adjusted baseline, that's a real outlier -- worth a second look.",
    "{fact_line} That's a meaningfully different number than the season average. I'll take it seriously once it repeats.",
    "{fact_line} Compared to the model's preseason projection, that's ahead of pace.",
    "{fact_line} Line that up against the league-wide rate at that position and it's still notable.",
    "{fact_line} That's a bigger gap from the mean than a normal week produces.",
  ],
  question: [
    "{fact_line} Is that efficiency or opportunity? I won't guess -- I'll check the rate.",
    "{fact_line} Does that hold up split by down and distance? That's the actual test.",
    "{fact_line} One week or a real shift? I'm not answering that off a single sample.",
    "{fact_line} Is the opponent-adjusted number as good as the raw one? I'll know shortly.",
    "{fact_line} Does the tape support the rate, or is the rate doing some of the talking for the tape?",
    "{fact_line} Is that a role change or a matchup week? Different implications for next week.",
  ],
  receipt: [
    "{fact_line} Matches the trend I flagged a few weeks back -- consistent with the model, not against it.",
    "{fact_line} That's the same signal I had logged earlier. Good, the model's tracking.",
    "{fact_line} Lines up with the projection. I'll keep it updated either way.",
    "{fact_line} That's the same efficiency profile I noted at the start of the season.",
    "{fact_line} Consistent with the rate I've had tracked since Week 1.",
    "{fact_line} That confirms the trend line rather than breaking it.",
  ],
  project: [
    "{fact_line} If the underlying rate holds, expect this again -- if it doesn't, it was noise.",
    "{fact_line} I'll have the season-pace number in the next report either way.",
    "{fact_line} That's either a new baseline or a one-week blip. The next few weeks settle it, not this one.",
    "{fact_line} If that rate is real, the pace projection moves meaningfully.",
    "{fact_line} A repeat of that next week is the real tell. I'm watching for it.",
    "{fact_line} That's a projection-mover if it's not a one-off. I'll flag it if it repeats.",
  ],
};
const ELLIOT_TAGS: string[] = [
  "Small sample, loud number. Proceed carefully.",
  "I'll update the model either way.",
  "Rate over total, always.",
  "One week is a data point, not a conclusion.",
  "I'll have the full breakdown once the split is in.",
  "The number's real. What it means still needs work.",
  "I don't chase box scores. I chase rates.",
  "Filed for the weekly model update.",
  "Context beats total every single time.",
  "That's going in the report either way.",
];

// ---------------------------------------------------------------------------------------------
// Darius King -- "The Showman": stakes, competitiveness, locker-room credibility, big-moment
// energy without inventing motive.
// ---------------------------------------------------------------------------------------------
const DARIUS_CLAUSES: Record<SocialClaimMove, string[]> = {
  report: [
    "{fact_line} That's a competitor showing up when it mattered.",
    "{fact_line} That's the kind of week that gets remembered in that locker room.",
    "{fact_line} Put some respect on that. Earned, not given.",
    "{fact_line} That's a snapshot worth keeping. Real ones know.",
    "{fact_line} That happened in front of everybody who needed to see it.",
    "{fact_line} That's a moment, plain and simple.",
  ],
  interpret: [
    "{fact_line} Locker room already knew. Now everybody else does too.",
    "{fact_line} That's want-to showing up in the box score, and it doesn't happen by accident.",
    "{fact_line} That's the standard getting set in real time, not talked about after the fact.",
    "{fact_line} That's what showing up for your teammates actually looks like.",
    "{fact_line} That's competitive character, not just talent.",
    "{fact_line} That's the difference between playing the game and playing for something.",
  ],
  compare: [
    "{fact_line} That's a different level than earlier this season, and everybody in that building felt it.",
    "{fact_line} Compare that to the version of this team from a month ago. Not the same group.",
    "{fact_line} That's the gap between good and dangerous, and they just showed which side they're on.",
    "{fact_line} That's a jump from earlier in the year, and it showed on the field.",
    "{fact_line} Different energy than a few weeks back. Noticeable.",
    "{fact_line} That's a step up from where this group started the season.",
  ],
  question: [
    "{fact_line} Who's checking that energy? Anybody? Didn't think so.",
    "{fact_line} Tell me that's not the standard now. I'll wait.",
    "{fact_line} What's the answer to that next week? That's the only question worth asking.",
    "{fact_line} Who's got a response to that? Genuinely curious.",
    "{fact_line} Is anybody matching that intensity right now? Show me.",
    "{fact_line} What's the next challenge after that? Because they earned a bigger one.",
  ],
  receipt: [
    "{fact_line} Told y'all. Some people just have it, and it shows up when it counts.",
    "{fact_line} That's exactly what I said would happen once the stage got bigger.",
    "{fact_line} Called that weeks ago. Not surprised, just glad everybody else is catching on.",
    "{fact_line} I said this energy was coming. Here it is.",
    "{fact_line} That's the same competitor I've been talking about all season.",
    "{fact_line} Nothing about that surprises anybody who's been watching closely.",
  ],
  project: [
    "{fact_line} If that's the standard now, buckle up -- this gets more fun from here.",
    "{fact_line} Keep playing like that and this turns into a real season story.",
    "{fact_line} That's a moment that turns into a habit if they let it. Watching to see if they do.",
    "{fact_line} That's a spark. The question is whether it catches.",
    "{fact_line} If that's the ceiling raising, the rest of the league should take notice.",
    "{fact_line} That's the start of something if they keep chasing it the same way.",
  ],
};
const DARIUS_TAGS: string[] = [
  "That's the energy I want to see every week.",
  "Real ones felt that one.",
  "Competitors show up like that on purpose.",
  "That's not luck. That's want-to.",
  "Locker room's gonna talk about that one.",
  "That's the standard now. Keep it there.",
  "You can't coach that kind of moment.",
  "That's what separates good from great.",
  "I live for weeks like that.",
  "That's a story that ages well.",
];

const CLAUSES_BY_PERSONA: Record<ReactivePersonaKey, Record<SocialClaimMove, string[]>> = {
  marcus: MARCUS_CLAUSES, vaughn: VAUGHN_CLAUSES, elliot: ELLIOT_CLAUSES, darius: DARIUS_CLAUSES,
};
const TAGS_BY_PERSONA: Record<ReactivePersonaKey, string[]> = {
  marcus: MARCUS_TAGS, vaughn: VAUGHN_TAGS, elliot: ELLIOT_TAGS, darius: DARIUS_TAGS,
};

/** Every combination for (persona, move) -- clause alone, or clause + one tag. This is the pool
 *  fatigue tracking draws down before ever repeating a combination. */
export function rootPostFragmentsFor(persona: ReactivePersonaKey, move: SocialClaimMove): RootPostFragment[] {
  const clauses = clauseBank(persona, move, CLAUSES_BY_PERSONA[persona][move]);
  const tags = tagBank(persona, TAGS_BY_PERSONA[persona]);
  const combos: RootPostFragment[] = clauses.map((clause) => ({ id: clause.id, move, text: clause.text }));
  for (const clause of clauses) {
    for (const tag of tags) {
      combos.push({ id: `${clause.id}+${tag.id}`, move, text: `${clause.text} ${tag.text}` });
    }
  }
  return combos;
}

/** Picks a fragment for (persona, move), excluding recently-used ids when possible (falls back to
 *  the full pool if every variant has been used recently, so generation never dead-ends). */
export function pickRootPostFragment(
  persona: ReactivePersonaKey,
  move: SocialClaimMove,
  excludeIds: Iterable<string> = [],
): RootPostFragment | undefined {
  const pool = rootPostFragmentsFor(persona, move);
  if (!pool.length) return undefined;
  const exclude = new Set(excludeIds);
  const fresh = pool.filter((fragment) => !exclude.has(fragment.id));
  const source = fresh.length ? fresh : pool;
  return source[Math.floor(Math.random() * source.length)];
}

/** Fills {fact_line} (always present) and appends an optional {context_line} as a trailing
 *  clause only when resolved -- mirrors the source bank's "Add {context_line} only if it is
 *  resolved" instruction without needing an LLM to make that call. */
export function composeRootPost(fragment: RootPostFragment, values: { factLine: string; contextLine?: string }): string {
  let body = fragment.text.replace("{fact_line}", values.factLine);
  if (values.contextLine) body = `${body} ${values.contextLine}`;
  return body.replace(/\s+/g, " ").trim();
}
