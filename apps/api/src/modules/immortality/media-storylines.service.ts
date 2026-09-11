// Story-arc persistence -- see SOCIAL_SYSTEM_ARCHITECTURE.md's "Story arcs" section and
// rec_media_storylines (supabase/migrations/20260911140000_media_social_event_graph.sql). A
// storyline persists across advances for one subject (team or user); each touch bumps
// last_event_at and priority (used as the "heat" signal) and appends to premise_json's evidence
// list so later posts can reference what's already been established instead of restating it.
import { supabase } from "../../lib/supabase.js";
import { STORYLINE_TYPE_BY_EVENT, type SocialEventType, type SocialStorylineType } from "@rec/shared";

const MAX_EVIDENCE_ENTRIES = 12;

type StorylinePremise = { evidence: string[]; unresolvedQuestions: string[] };

export type MediaStoryline = {
  id: string;
  storylineType: SocialStorylineType;
  title: string;
  priority: number;
  evidence: string[];
};

/** Which storyline type (if any) this event type feeds -- undefined means the event doesn't open
 *  or touch a story arc. */
export function storylineTypeForEvent(eventType: SocialEventType): SocialStorylineType | undefined {
  return STORYLINE_TYPE_BY_EVENT[eventType];
}

/** Finds the open storyline for this subject + storyline type, if any (one subject can only have
 *  one open arc of a given type at a time -- a second one waits for the first to resolve).
 *  Player-scoped arcs (playerId set) match on player_id alone, deliberately ignoring team_id --
 *  a breakout/slump narrative should follow the player through a trade, not reset or bleed into
 *  a teammate's arc just because they share a roster slot this week. */
async function findOpenStoryline(input: {
  leagueId: string; storylineType: SocialStorylineType; teamId?: string | null; userId?: string | null; playerId?: string | null;
}): Promise<{ id: string; title: string; priority: number; premise_json: unknown } | null> {
  let query = supabase.from("rec_media_storylines").select("id,title,priority,premise_json")
    .eq("league_id", input.leagueId).eq("storyline_type", input.storylineType).eq("status", "open");
  if (input.playerId) {
    query = query.eq("player_id", input.playerId);
  } else {
    query = input.teamId ? query.eq("team_id", input.teamId) : query.is("team_id", null);
    query = input.userId ? query.eq("user_id", input.userId) : query.is("user_id", null);
  }
  const row = await query.maybeSingle();
  return row.data ?? null;
}

/**
 * Opens a new storyline for this subject if none is open, or touches (bumps heat/evidence on)
 * the existing one. Returns the storyline so callers can attach it to a media event/tweet and
 * reference prior evidence instead of repeating themselves.
 */
export async function touchOrOpenStoryline(input: {
  leagueId: string;
  eventType: SocialEventType;
  teamId?: string | null;
  userId?: string | null;
  playerId?: string | null;
  title: string;
  evidenceLine: string;
}): Promise<MediaStoryline | null> {
  const storylineType = storylineTypeForEvent(input.eventType);
  if (!storylineType) return null;

  const existing = await findOpenStoryline({
    leagueId: input.leagueId, storylineType, teamId: input.teamId, userId: input.userId, playerId: input.playerId,
  });
  const nowIso = new Date().toISOString();

  if (existing) {
    const premise = (existing.premise_json ?? {}) as Partial<StorylinePremise>;
    const evidence = [...(premise.evidence ?? []), input.evidenceLine].slice(-MAX_EVIDENCE_ENTRIES);
    const priority = existing.priority + 1;
    await supabase.from("rec_media_storylines").update({
      last_event_at: nowIso,
      priority,
      premise_json: { evidence, unresolvedQuestions: premise.unresolvedQuestions ?? [] } satisfies StorylinePremise,
    }).eq("id", existing.id);
    return { id: existing.id, storylineType, title: existing.title, priority, evidence };
  }

  const inserted = await supabase.from("rec_media_storylines").insert({
    league_id: input.leagueId,
    team_id: input.playerId ? null : (input.teamId ?? null),
    user_id: input.userId ?? null,
    player_id: input.playerId ?? null,
    storyline_type: storylineType,
    title: input.title,
    premise_json: { evidence: [input.evidenceLine], unresolvedQuestions: [] } satisfies StorylinePremise,
    status: "open",
    priority: 1,
    opened_at: nowIso,
    last_event_at: nowIso,
  }).select("id").maybeSingle();
  if (!inserted.data) return null;
  return { id: inserted.data.id, storylineType, title: input.title, priority: 1, evidence: [input.evidenceLine] };
}
