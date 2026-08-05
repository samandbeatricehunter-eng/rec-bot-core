import { supabase } from "../../lib/supabase.js";

type BadgeSnapshotEntry = { badge_key: string; badge_scope: string | null; tier: string | null; earned_count: number | null };
type BadgeState = Record<string, BadgeSnapshotEntry[]>;

// ─── Per-advance run marker (written at the end of completeAdvanceWeek) ─────────
// Records the advance timestamp (anchor for "since the previous advance" windows)
// and a snapshot of every active badge per user, so a future consumer could diff
// gained / maintained / lost badges for each coach. (The per-coach DM feature that
// originally consumed this snapshot was removed as dead/unreachable code — nothing
// ever called it end to end — but the run marker itself stays since nothing else
// records these advance boundaries.)
export async function recordAdvanceDmRun(input: {
  leagueId: string;
  seasonNumber: number;
  fromWeek: number;
  toWeek: number;
  fromStage: string;
  toStage: string;
  advancedByDiscordId: string | null;
}): Promise<void> {
  const { data: ownership, error } = await supabase
    .from("rec_badge_ownership")
    .select("user_id,badge_key,badge_scope,tier,earned_count")
    .eq("league_id", input.leagueId)
    .eq("season", input.seasonNumber);
  if (error) {
    console.error("[ERROR] Failed to snapshot badge ownership for advance DM run:", error);
  }

  const badgeState: BadgeState = {};
  for (const row of ownership ?? []) {
    if (!row.user_id) continue;
    (badgeState[row.user_id] ??= []).push({
      badge_key: row.badge_key,
      badge_scope: row.badge_scope,
      tier: row.tier,
      earned_count: row.earned_count,
    });
  }

  const { error: insertError } = await supabase.from("rec_advance_dm_runs").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    from_week: input.fromWeek,
    to_week: input.toWeek,
    from_stage: input.fromStage,
    to_stage: input.toStage,
    advanced_by_discord_id: input.advancedByDiscordId,
    badge_state: badgeState,
  });
  if (insertError) console.error("[ERROR] Failed to insert advance DM run:", insertError);
}
