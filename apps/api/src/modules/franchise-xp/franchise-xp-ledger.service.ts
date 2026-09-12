// Minimal, real (not throwaway) implementation of docs/handoff-xp-progression/02_FRANCHISE/
// FRANCHISE_XP_ENGINE.md's data model -- rec_franchise_xp_ledger / rec_franchise_xp_state,
// field-for-field, mirroring player-xp-ledger.service.ts one level up (user-owner-scoped Franchise
// Progress Points instead of player-scoped Player XP). See that doc's "Ownership gap" note for why
// this is keyed by (league_id, user_id) rather than team_id.
//
// Only crediting is implemented, and only two of the doc's six earning sources are wired up
// (weekly challenge FPP, team win/streak/playoff-win FPP) -- see weekly-challenge-issuance.service.ts
// and advance-results.service.ts for the callers. NOT implemented: Player Performance Dividend
// (needs a top-5-by-PPP box-score ranking this codebase doesn't compute yet), Media Day commitment
// FPP (needs the Media Day answer-grading pipeline), player recognition dividend (POTW/season
// award hooks), and the 6,000-FPP-per-game regular-season cap. Each becomes a new event_type
// writing into the same tables when built -- no migration needed.
import { displayedXpFromPoints } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const FORMULA_VERSION = "franchise_xp_ledger.v1";

/** Idempotent: a second call with the same (eventType, sourceId) is a no-op (unique constraint
 * on rec_franchise_xp_ledger) -- safe to call again if a game/advance gets reprocessed. */
export async function creditFranchiseXp(input: {
  leagueId: string;
  userId: string;
  teamId: string | null;
  seasonNumber: number;
  weekNumber: number | null;
  eventType: string;
  sourceId: string;
  rawFpp: number;
  metadata?: Record<string, unknown>;
}): Promise<{ credited: boolean; awardedFpp: number }> {
  const awardedFpp = Math.max(0, Math.round(input.rawFpp));
  if (awardedFpp <= 0) return { credited: false, awardedFpp: 0 };

  const inserted = await supabase.from("rec_franchise_xp_ledger").insert({
    league_id: input.leagueId,
    user_id: input.userId,
    team_id: input.teamId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    event_type: input.eventType,
    source_id: input.sourceId,
    raw_fpp: awardedFpp,
    formula_version: FORMULA_VERSION,
    metadata: input.metadata ?? {},
  }).select("id");
  if (inserted.error) {
    if (inserted.error.code === "23505") return { credited: false, awardedFpp: 0 }; // already credited
    throw inserted.error;
  }

  const state = await supabase.from("rec_franchise_xp_state").select("balance_fpp,lifetime_earned_fpp")
    .eq("league_id", input.leagueId).eq("user_id", input.userId).maybeSingle();
  const nowIso = new Date().toISOString();
  await supabase.from("rec_franchise_xp_state").upsert({
    league_id: input.leagueId,
    user_id: input.userId,
    balance_fpp: (state.data?.balance_fpp ?? 0) + awardedFpp,
    lifetime_earned_fpp: (state.data?.lifetime_earned_fpp ?? 0) + awardedFpp,
    last_award_at: nowIso,
    updated_at: nowIso,
  }, { onConflict: "league_id,user_id" });

  return { credited: true, awardedFpp };
}

export async function getFranchiseXpState(leagueId: string, userId: string) {
  const state = await supabase.from("rec_franchise_xp_state").select("*")
    .eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  const balanceFpp = state.data?.balance_fpp ?? 0;
  const lifetimeEarnedFpp = state.data?.lifetime_earned_fpp ?? 0;
  return {
    balanceFpp,
    lifetimeEarnedFpp,
    balanceXp: displayedXpFromPoints(balanceFpp),
    lifetimeEarnedXp: displayedXpFromPoints(lifetimeEarnedFpp),
  };
}
