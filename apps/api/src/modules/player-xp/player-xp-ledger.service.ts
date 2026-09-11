// Minimal, real (not throwaway) implementation of docs/handoff/docs/PLAYER_XP_REWARDS.md's data
// model -- rec_player_xp_ledger / rec_player_xp_state, field-for-field. Only crediting is
// implemented here; the full weekly-stat-line/percentile/streak/season-award SCORING engine that
// doc also specifies is a separate, much larger project and is NOT part of this. "weekly_challenge"
// (see weekly-challenge-issuance.service.ts) is the first event_type to write into this ledger --
// when the full scoring engine is eventually built, it becomes a second event_type writing to the
// same tables, no migration needed.
import { supabase } from "../../lib/supabase.js";

const FORMULA_VERSION = "player_xp_ledger.v1";

/** Idempotent: a second call with the same idempotencyKey is a no-op (unique constraint on
 * rec_player_xp_ledger.idempotency_key) -- safe to call again if a box score gets reprocessed. */
export async function creditPlayerXp(input: {
  leagueId: string;
  playerId: string;
  creditedToUserId: string | null;
  seasonNumber: number;
  weekNumber: number | null;
  eventType: string;
  sourceId: string;
  rawXp: number;
  devTraitAtEvent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ credited: boolean; awardedXp: number }> {
  const idempotencyKey = `${input.eventType}:${input.sourceId}:${input.playerId}`;
  const awardedXp = Math.max(0, Math.round(input.rawXp));
  if (awardedXp <= 0) return { credited: false, awardedXp: 0 };

  const inserted = await supabase.from("rec_player_xp_ledger").insert({
    league_id: input.leagueId,
    player_id: input.playerId,
    credited_to_user_id: input.creditedToUserId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    event_type: input.eventType,
    source_id: input.sourceId,
    raw_xp: input.rawXp,
    dev_trait_at_event: input.devTraitAtEvent ?? null,
    dev_multiplier: 1,
    rivalry_multiplier: 1,
    other_multiplier: 1,
    awarded_xp: awardedXp,
    remainder_before: 0,
    remainder_after: 0,
    formula_version: FORMULA_VERSION,
    idempotency_key: idempotencyKey,
    metadata: input.metadata ?? {},
  }).select("id");
  if (inserted.error) {
    if (inserted.error.code === "23505") return { credited: false, awardedXp: 0 }; // already credited
    throw inserted.error;
  }

  const state = await supabase.from("rec_player_xp_state").select("balance_xp,lifetime_earned_xp")
    .eq("league_id", input.leagueId).eq("player_id", input.playerId).maybeSingle();
  const nowIso = new Date().toISOString();
  await supabase.from("rec_player_xp_state").upsert({
    league_id: input.leagueId,
    player_id: input.playerId,
    balance_xp: (state.data?.balance_xp ?? 0) + awardedXp,
    lifetime_earned_xp: (state.data?.lifetime_earned_xp ?? 0) + awardedXp,
    last_award_at: nowIso,
    updated_at: nowIso,
  }, { onConflict: "league_id,player_id" });

  return { credited: true, awardedXp };
}

export async function getPlayerXpState(leagueId: string, playerId: string) {
  const state = await supabase.from("rec_player_xp_state").select("*")
    .eq("league_id", leagueId).eq("player_id", playerId).maybeSingle();
  return state.data ?? { balance_xp: 0, lifetime_earned_xp: 0, lifetime_spent_xp: 0 };
}
