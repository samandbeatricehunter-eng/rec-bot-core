import { convertXpToSp, devTraitXpMultiplier, playerXpPerSp } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const FORMULA_VERSION = "player_xp_ledger.v1";

/** Event types the dev-trait multiplier applies to (PLAYER_XP_ENGINE.md's "player challenge
 *  PPP" + game performance) -- explicit allowlist, not a denylist, so a new event type defaults
 *  to unmultiplied until someone deliberately opts it in (the doc excludes MVP/OPOY/DPOY/Pro
 *  Bowl/season awards/records, and "record_book" is the only other event type today). */
const DEV_MULTIPLIER_EVENT_TYPES = new Set(["weekly_challenge"]);

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
}): Promise<{ credited: boolean; awardedXp: number; spEarned: number; remainderXp: number }> {
  const idempotencyKey = `${input.eventType}:${input.sourceId}:${input.playerId}`;
  const devMultiplier = DEV_MULTIPLIER_EVENT_TYPES.has(input.eventType)
    ? devTraitXpMultiplier(input.devTraitAtEvent)
    : 1;
  const awardedXp = Math.max(0, Math.round(input.rawXp * devMultiplier));
  if (awardedXp <= 0) return { credited: false, awardedXp: 0, spEarned: 0, remainderXp: 0 };

  const [state, player] = await Promise.all([
    supabase.from("rec_player_xp_state")
      .select("balance_xp,lifetime_earned_xp,balance_sp,lifetime_earned_sp,xp_toward_next_sp,last_sp_conversion_at")
      .eq("league_id", input.leagueId).eq("player_id", input.playerId).maybeSingle(),
    supabase.from("rec_players").select("overall_rating").eq("id", input.playerId).maybeSingle(),
  ]);
  const ovr = player.data?.overall_rating == null ? null : Number(player.data.overall_rating);
  const threshold = playerXpPerSp(ovr);
  const priorRemainder = Number(state.data?.xp_toward_next_sp ?? state.data?.balance_xp ?? 0);
  const conversion = convertXpToSp(priorRemainder + awardedXp, threshold);

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
    dev_multiplier: devMultiplier,
    rivalry_multiplier: 1,
    other_multiplier: 1,
    awarded_xp: awardedXp,
    remainder_before: priorRemainder,
    remainder_after: conversion.remainderXp,
    formula_version: FORMULA_VERSION,
    idempotency_key: idempotencyKey,
    metadata: {
      ...(input.metadata ?? {}),
      spEarned: conversion.spEarned,
      remainderXp: conversion.remainderXp,
      xpPerSp: threshold,
      ovrSnapshot: ovr,
    },
  }).select("id");
  if (inserted.error) {
    if (inserted.error.code === "23505") return { credited: false, awardedXp: 0, spEarned: 0, remainderXp: 0 };
    throw inserted.error;
  }

  const nowIso = new Date().toISOString();
  await supabase.from("rec_player_xp_state").upsert({
    league_id: input.leagueId,
    player_id: input.playerId,
    balance_xp: (state.data?.balance_xp ?? 0) + awardedXp,
    lifetime_earned_xp: (state.data?.lifetime_earned_xp ?? 0) + awardedXp,
    balance_sp: (state.data?.balance_sp ?? 0) + conversion.spEarned,
    lifetime_earned_sp: (state.data?.lifetime_earned_sp ?? 0) + conversion.spEarned,
    xp_toward_next_sp: conversion.remainderXp,
    last_sp_threshold: threshold,
    last_sp_ovr: ovr,
    last_sp_conversion_at: conversion.spEarned > 0 ? nowIso : (state.data?.last_sp_conversion_at ?? null),
    last_award_at: nowIso,
    updated_at: nowIso,
  }, { onConflict: "league_id,player_id" });

  return { credited: true, awardedXp, spEarned: conversion.spEarned, remainderXp: conversion.remainderXp };
}

/** Batched dev_trait lookup for creditPlayerXp callers crediting several players at once
 *  (e.g. weekly-challenge-issuance.service.ts's role beneficiaries). */
export async function devTraitsForPlayers(playerIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!playerIds.length) return map;
  const rows = await supabase.from("rec_players").select("id,dev_trait").in("id", playerIds);
  for (const row of rows.data ?? []) map.set(String(row.id), row.dev_trait == null ? null : String(row.dev_trait));
  return map;
}

export async function getPlayerXpState(leagueId: string, playerId: string) {
  const state = await supabase.from("rec_player_xp_state").select("*")
    .eq("league_id", leagueId).eq("player_id", playerId).maybeSingle();
  return state.data ?? {
    balance_xp: 0,
    lifetime_earned_xp: 0,
    lifetime_spent_xp: 0,
    balance_sp: 0,
    lifetime_earned_sp: 0,
    xp_toward_next_sp: 0,
  };
}
