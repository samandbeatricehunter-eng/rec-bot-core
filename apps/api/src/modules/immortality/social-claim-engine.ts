// Claim-first generation orchestrator -- see SOCIAL_SYSTEM_ARCHITECTURE.md's "Claim-first
// generation" section. Wired into the weekly recap's host-voiced candidates
// (tweet-generation.service.ts's generateAndQueueImmortalityTweets): for each notable-performance
// candidate, this builds a social_claim_plan (event type, subject, discourse move, story arc)
// from the already-verified stat/game data before any wording is produced, checks the account's
// persistent memory for repetition, composes the post from the deterministic fragment catalog,
// and records the event/storyline/memory side effects. Returns null (never throws) whenever a
// claim-grounded post can't be built so callers fall back to the legacy static-template bank
// rather than dropping a queue slot.
import {
  contextualBlueprintPolicy, socialEventPlaybook, type ReactivePersonaKey, type SocialClaimMove,
  type SocialEventType, composeRootPost, pickRootPostFragment,
} from "@rec/shared";
import {
  buildFingerprint, loadAccountMemory, pickUnfatiguedMove, recentFragmentIds, recordAccountMemoryEntry,
} from "./account-memory.service.js";
import { touchOrOpenStoryline } from "./media-storylines.service.js";
import { logMediaEvent } from "./media-events.service.js";
import { TWEET_HOSTS } from "./tweet-bank.js";

const REACTIVE_PERSONAS: ReactivePersonaKey[] = ["marcus", "vaughn", "elliot", "darius"];

/** Rough per-category affinity so the "right kind" of voice leans into the right kind of event
 *  (Elliot on efficiency, Darius on big moments, etc.) without making any persona exclusive to
 *  a category -- mirrors the spread already present across the legacy static template bank.
 *  `exclude` is a real exclusion (not just a missing weight, which still defaults to 1) -- use it
 *  to pick N distinct personas for one event without risking the same voice twice. */
export function pickReactivePersona(
  weights: Partial<Record<ReactivePersonaKey, number>>,
  exclude: ReactivePersonaKey[] = [],
): ReactivePersonaKey {
  const excluded = new Set(exclude);
  const pool = REACTIVE_PERSONAS.filter((persona) => !excluded.has(persona));
  const entries = (pool.length ? pool : REACTIVE_PERSONAS).map((persona) => [persona, weights[persona] ?? 1] as const);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [persona, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return persona;
  }
  return entries[entries.length - 1]![0];
}

export type ClaimGroundedInput = {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  eventType: SocialEventType;
  persona: ReactivePersonaKey;
  /** Stable identifier for repetition tracking -- e.g. `player:<id>` or `team:<id>`. Never a
   *  display name, so renames/relocations don't reset fatigue. */
  subjectKey: string;
  /** The one required, verified fact every post anchors on (never fabricated -- built by the
   *  caller directly from real stat/game rows). */
  factLine: string;
  contextLine?: string;
  teamId?: string | null;
  userId?: string | null;
  playerId?: string | null;
  gameId?: string | null;
  /** When set, this event also touches/opens a story arc titled with this text. */
  storylineTitle?: string;
  importanceScore?: number;
};

/** Builds and books a claim-grounded root post body, or returns null if this event/persona
 *  combination isn't covered by the bank or every fragment has recently been used. Side effects
 *  (media event log, storyline touch, account memory update) only happen when a body is
 *  successfully produced. */
export async function buildClaimGroundedPostBody(input: ClaimGroundedInput): Promise<string | null> {
  const playbook = socialEventPlaybook(input.eventType);
  const policy = contextualBlueprintPolicy(input.eventType, input.persona);
  if (!playbook || !policy) return null;

  const memory = await loadAccountMemory(input.leagueId, input.persona);
  const move: SocialClaimMove = pickUnfatiguedMove(memory, input.eventType, input.subjectKey, playbook.allowedMoves);
  const fragment = pickRootPostFragment(input.persona, move, recentFragmentIds(memory));
  if (!fragment) return null;

  const body = composeRootPost(fragment, { factLine: input.factLine, contextLine: input.contextLine });
  if (!body) return null;

  const storyline = input.storylineTitle
    ? await touchOrOpenStoryline({
        leagueId: input.leagueId, eventType: input.eventType, teamId: input.teamId, userId: input.userId, playerId: input.playerId,
        title: input.storylineTitle, evidenceLine: input.factLine,
      }).catch(() => null)
    : null;

  await logMediaEvent({
    leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
    eventType: input.eventType, teamId: input.teamId, userId: input.userId, playerId: input.playerId,
    gameId: input.gameId, importanceScore: input.importanceScore ?? 0,
    facts: { factLine: input.factLine, contextLine: input.contextLine ?? null, move, persona: input.persona, storylineId: storyline?.id ?? null },
  }).catch((error) => console.error("[ERROR] logMediaEvent failed (non-fatal):", error));

  await recordAccountMemoryEntry(input.leagueId, input.persona, {
    fingerprint: buildFingerprint({ eventType: input.eventType, subjectKey: input.subjectKey, move }),
    eventType: input.eventType, subjectKey: input.subjectKey, move, fragmentId: fragment.id,
    postedAt: new Date().toISOString(),
  }).catch((error) => console.error("[ERROR] recordAccountMemoryEntry failed (non-fatal):", error));

  return body;
}

/** author_kind/handle/displayName for a claim-grounded post, same shape resolveAuthor() returns
 *  for the legacy bank so callers can treat the two paths interchangeably. */
export function reactivePersonaAuthor(persona: ReactivePersonaKey): { authorKind: "host"; handle: string; displayName: string } {
  const host = TWEET_HOSTS[persona];
  return { authorKind: "host", handle: host.handle, displayName: host.displayName };
}
