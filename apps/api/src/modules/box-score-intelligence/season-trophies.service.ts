// Season → Career Trophy conversion. When a league advances out of super_bowl into
// the offseason, every season badge a coach holds is converted into a permanent
// Career Trophy (one per badge_key + tier + season). The coach's weekly + season
// badge ownership is then wiped so the next season starts clean — but only AFTER
// the trophies are safely persisted.

import { supabase } from "../../lib/supabase.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES } from "./badge-rules.js";

const BADGE_LABEL = new Map(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((b) => [b.key, b.label] as const),
);
const BADGE_DESCRIPTION = new Map(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((b) => [b.key, b.description] as const),
);

const TIER_STRENGTH: Record<string, number> = { xf: 5, gold: 4, silver: 3, bronze: 2, normal: 1 };

export async function convertSeasonBadgesToTrophies(
  leagueId: string,
  season: number,
): Promise<{ usersConverted: number; trophiesCreated: number }> {
  const { data: assignments, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) {
    console.error("[ERROR] convertSeasonBadgesToTrophies: failed to load assignments:", error);
    return { usersConverted: 0, trophiesCreated: 0 };
  }

  const seen = new Set<string>();
  let usersConverted = 0;
  let trophiesCreated = 0;

  for (const { user_id: userId } of assignments ?? []) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);

    const { data: seasonRows, error: rowsError } = await supabase
      .from("rec_badge_ownership")
      .select("badge_key,tier")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .eq("season", season)
      .eq("badge_scope", "season");
    if (rowsError) {
      console.error("[ERROR] convertSeasonBadgesToTrophies: failed to load season badges:", rowsError);
      continue;
    }

    // Persist trophies first. If this fails, skip the wipe so nothing is lost and
    // the next advance can retry (the upsert is idempotent on the unique key).
    if (seasonRows?.length) {
      const trophyRows = seasonRows.map((r) => ({
        league_id: leagueId,
        user_id: userId,
        badge_key: r.badge_key,
        tier: r.tier ?? "normal",
        season_number: season,
        badge_label: BADGE_LABEL.get(r.badge_key) ?? r.badge_key,
        badge_description: BADGE_DESCRIPTION.get(r.badge_key) ?? null,
      }));
      const { error: upsertError } = await supabase
        .from("rec_user_season_badge_trophies")
        .upsert(trophyRows, { onConflict: "league_id,user_id,badge_key,tier,season_number", ignoreDuplicates: true });
      if (upsertError) {
        console.error("[ERROR] convertSeasonBadgesToTrophies: trophy upsert failed (skipping wipe):", upsertError);
        continue;
      }
      trophiesCreated += trophyRows.length;
      usersConverted += 1;
    }

    // Reset: wipe this season's weekly + season ownership now that trophies are saved.
    const { error: wipeError } = await supabase
      .from("rec_badge_ownership")
      .delete()
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .eq("season", season)
      .in("badge_scope", ["weekly", "season"]);
    if (wipeError) console.error("[ERROR] convertSeasonBadgesToTrophies: badge wipe failed:", wipeError);
  }

  return { usersConverted, trophiesCreated };
}

export type CareerTrophy = {
  badgeKey: string;
  tier: string;
  label: string;
  description: string | null;
  seasonsEarned: number;
};

function groupTrophyRows(rows: Array<{ badge_key: string; tier: string | null; badge_label: string | null; badge_description: string | null; season_number: number }>): CareerTrophy[] {
  const byKey = new Map<string, { badgeKey: string; tier: string; label: string; description: string | null; seasons: Set<number> }>();
  for (const r of rows) {
    const tier = r.tier ?? "normal";
    const key = `${r.badge_key}:${tier}`;
    const entry = byKey.get(key) ?? {
      badgeKey: r.badge_key,
      tier,
      label: r.badge_label ?? BADGE_LABEL.get(r.badge_key) ?? r.badge_key,
      description: r.badge_description ?? BADGE_DESCRIPTION.get(r.badge_key) ?? null,
      seasons: new Set<number>(),
    };
    entry.seasons.add(Number(r.season_number));
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((e) => ({ badgeKey: e.badgeKey, tier: e.tier, label: e.label, description: e.description, seasonsEarned: e.seasons.size }))
    .sort((a, b) => (TIER_STRENGTH[b.tier] ?? 0) - (TIER_STRENGTH[a.tier] ?? 0) || a.label.localeCompare(b.label));
}

// Per-coach trophies grouped by (badge, tier); seasonsEarned drives the "×N" badge.
export async function loadCareerTrophies(userId: string, leagueId: string): Promise<CareerTrophy[]> {
  const { data, error } = await supabase
    .from("rec_user_season_badge_trophies")
    .select("badge_key,tier,badge_label,badge_description,season_number")
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  if (error) {
    console.error("[ERROR] loadCareerTrophies failed:", error);
    return [];
  }
  return groupTrophyRows(data ?? []);
}

// All coaches' trophies in one query, grouped per user — for league-wide views.
export async function loadLeagueCareerTrophies(leagueId: string): Promise<Map<string, CareerTrophy[]>> {
  const { data, error } = await supabase
    .from("rec_user_season_badge_trophies")
    .select("user_id,badge_key,tier,badge_label,badge_description,season_number")
    .eq("league_id", leagueId);
  if (error) {
    console.error("[ERROR] loadLeagueCareerTrophies failed:", error);
    return new Map();
  }
  const byUser = new Map<string, any[]>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);
  }
  const result = new Map<string, CareerTrophy[]>();
  for (const [userId, rows] of byUser) result.set(userId, groupTrophyRows(rows));
  return result;
}
