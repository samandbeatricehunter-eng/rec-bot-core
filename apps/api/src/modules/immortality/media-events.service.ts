// Append-only event bus logger -- see rec_media_events
// (supabase/migrations/20260911140000_media_social_event_graph.sql). Every claim-grounded post
// records the verified event it was built from here, giving future consumers (Media Day reveals,
// the Post-Advance Experience, a future reply/thread generator) a real, queryable history of what
// actually happened instead of re-deriving it from tweet bodies.
import { supabase } from "../../lib/supabase.js";
import type { SocialEventType } from "@rec/shared";

export async function logMediaEvent(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber?: number;
  eventType: SocialEventType;
  teamId?: string | null;
  userId?: string | null;
  playerId?: string | null;
  gameId?: string | null;
  importanceScore?: number;
  facts: Record<string, unknown>;
}): Promise<string | null> {
  const inserted = await supabase.from("rec_media_events").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber ?? null,
    event_type: input.eventType,
    team_id: input.teamId ?? null,
    user_id: input.userId ?? null,
    player_id: input.playerId ?? null,
    game_id: input.gameId ?? null,
    importance_score: input.importanceScore ?? 0,
    facts_json: input.facts,
  }).select("id").maybeSingle();
  return inserted.data?.id ?? null;
}
