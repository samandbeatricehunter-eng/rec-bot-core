// Persistent per-account repetition control -- see SOCIAL_SYSTEM_ARCHITECTURE.md's "Persistent
// account memory" section and rec_account_memory (one row per league+author_key, added in
// supabase/migrations/20260911140000_media_social_event_graph.sql). Drives fingerprint fatigue
// (event + subject + move) so a fixed persona doesn't repeat the same reaction to the same
// subject, and tracks recently-used root-post fragment ids so the wording layer
// (root-post-fragments.ts) doesn't loop the same phrasing back to back.
import { supabase } from "../../lib/supabase.js";
import type { SocialClaimMove, SocialEventType } from "@rec/shared";

const MAX_MEMORY_ENTRIES = 40;
const SUBJECT_FATIGUE_WINDOW_MS = 6 * 24 * 60 * 60 * 1000; // ~one advance cycle

export type AccountMemoryEntry = {
  fingerprint: string;
  eventType: SocialEventType;
  subjectKey: string;
  move: SocialClaimMove;
  fragmentId: string;
  postedAt: string;
};

type AccountMemoryPayload = { recent: AccountMemoryEntry[] };

export function buildFingerprint(input: { eventType: SocialEventType; subjectKey: string; move: SocialClaimMove }): string {
  return `${input.eventType}:${input.subjectKey}:${input.move}`;
}

export async function loadAccountMemory(leagueId: string, authorKey: string): Promise<AccountMemoryPayload> {
  const row = await supabase.from("rec_account_memory").select("memory_json")
    .eq("league_id", leagueId).eq("author_key", authorKey).maybeSingle();
  const payload = row.data?.memory_json as AccountMemoryPayload | undefined;
  return { recent: payload?.recent ?? [] };
}

/** True if this exact (event type, subject, move) fingerprint fired recently for this account --
 *  callers should try a different move or subject before falling back to posting anyway. */
export function isFingerprintFatigued(memory: AccountMemoryPayload, fingerprint: string, windowMs = SUBJECT_FATIGUE_WINDOW_MS): boolean {
  const cutoff = Date.now() - windowMs;
  return memory.recent.some((entry) => entry.fingerprint === fingerprint && new Date(entry.postedAt).getTime() >= cutoff);
}

/** True if this account has commented on this subject at all recently, regardless of move --
 *  used to avoid an account dogpiling the same player/team every week even with a fresh angle. */
export function isSubjectFatigued(memory: AccountMemoryPayload, subjectKey: string, windowMs = SUBJECT_FATIGUE_WINDOW_MS): boolean {
  const cutoff = Date.now() - windowMs;
  return memory.recent.some((entry) => entry.subjectKey === subjectKey && new Date(entry.postedAt).getTime() >= cutoff);
}

export function recentFragmentIds(memory: AccountMemoryPayload): string[] {
  return memory.recent.map((entry) => entry.fragmentId);
}

/** Picks the first move (in the playbook's declared order) that isn't fingerprint-fatigued for
 *  this subject; falls back to the least-recently-used move if every move has fired recently so
 *  generation never dead-ends on a hot subject. */
export function pickUnfatiguedMove(
  memory: AccountMemoryPayload,
  eventType: SocialEventType,
  subjectKey: string,
  allowedMoves: SocialClaimMove[],
): SocialClaimMove {
  const fresh = allowedMoves.find((move) => !isFingerprintFatigued(memory, buildFingerprint({ eventType, subjectKey, move })));
  if (fresh) return fresh;
  let oldestMove = allowedMoves[0]!;
  let oldestAt = Infinity;
  for (const move of allowedMoves) {
    const fingerprint = buildFingerprint({ eventType, subjectKey, move });
    const lastAt = Math.max(0, ...memory.recent.filter((e) => e.fingerprint === fingerprint).map((e) => new Date(e.postedAt).getTime()));
    if (lastAt < oldestAt) { oldestAt = lastAt; oldestMove = move; }
  }
  return oldestMove;
}

export async function recordAccountMemoryEntry(leagueId: string, authorKey: string, entry: AccountMemoryEntry): Promise<void> {
  const current = await loadAccountMemory(leagueId, authorKey);
  const recent = [...current.recent, entry].slice(-MAX_MEMORY_ENTRIES);
  await supabase.from("rec_account_memory").upsert(
    { league_id: leagueId, author_key: authorKey, memory_json: { recent }, updated_at: new Date().toISOString() },
    { onConflict: "league_id,author_key" },
  );
}
