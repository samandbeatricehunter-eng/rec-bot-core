import type { SocialClaimMove } from "./social-claim-plan.js";

// Lightweight keyword/heuristic tone classifier for a targeted user's reply into an open beef
// storyline -- this codebase has no LLM integration anywhere (every tweet body is template/
// fragment composition, see root-post-fragments.ts), so this follows the same deterministic
// pattern rather than adding a first-of-its-kind generative dependency. First matching bucket
// wins (checked in priority order below); no match falls back to "neutral".

export type ReplyTone = "defiant" | "mocking" | "conciliatory" | "dismissive" | "neutral";

const TONE_KEYWORDS: Record<Exclude<ReplyTone, "neutral">, string[]> = {
  // Doubling down / promising to prove it on the field.
  defiant: [
    "watch", "we'll see", "well see", "bet", "guarantee", "promise", "bring it", "any time",
    "anytime", "come get some", "try it", "next time", "run it back", "run it back up",
    "see you", "circle", "mark it", "book it", "count on it", "not scared", "we ready",
  ],
  // Belittling the other side rather than engaging the substance.
  mocking: [
    "lol", "lmao", "haha", "funny", "cute", "joke", "clown", "cap", "no cap", "embarrassing",
    "sit down", "stay in your lane", "nobody asked", "irrelevant", "washed", "cooked",
    "smh", "weird flex", "ok buddy", "sure jan", "adorable",
  ],
  // De-escalating, giving credit, or admitting the point.
  conciliatory: [
    "respect", "good point", "fair", "you're right", "youre right", "my bad", "apolog",
    "no disrespect", "salute", "props", "well earned", "well played", "deserved",
    "credit where", "hats off", "gg", "congrat",
  ],
  // Refusing to engage at all.
  dismissive: [
    "don't care", "dont care", "whatever", "not worth", "moving on", "next", "boring",
    "who cares", "not interested", "block", "muted", "done here", "not talking about",
    "no comment",
  ],
};

const TONE_PRIORITY: Array<Exclude<ReplyTone, "neutral">> = ["mocking", "defiant", "dismissive", "conciliatory"];

/** Classifies a reply's tone by keyword match, checked in a fixed priority order (mocking and
 *  defiant read as more escalatory than dismissive/conciliatory, so they win ties -- a reply
 *  that's both dismissive-sounding and mocking is still a mock, not a shrug). Case-insensitive,
 *  substring match. */
export function classifyReplyTone(text: string): ReplyTone {
  const normalized = text.toLowerCase();
  for (const tone of TONE_PRIORITY) {
    if (TONE_KEYWORDS[tone].some((phrase) => normalized.includes(phrase))) return tone;
  }
  return "neutral";
}

/** Which analytical "move" (root-post-fragments.ts's existing 6-move vocabulary) best carries a
 *  beef response for a given reply tone -- reuses the existing move/fragment/playbook machinery
 *  entirely; this is only a selector in front of it, not new generation infra. */
export function moveForReplyTone(tone: ReplyTone): SocialClaimMove {
  switch (tone) {
    case "mocking":
    case "defiant":
      return "receipt"; // hold them to what they just said
    case "dismissive":
      return "compare"; // let the tape/stat line do the talking instead
    case "conciliatory":
      return "interpret"; // read into the walk-back rather than pile on
    case "neutral":
    default:
      return "report";
  }
}
