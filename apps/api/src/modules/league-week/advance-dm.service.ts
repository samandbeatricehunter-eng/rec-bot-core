import { supabase } from "../../lib/supabase.js";

// ─── Per-advance run marker (written at the end of completeAdvanceWeek) ─────────
// Records the advance timestamp (anchor for "since the previous advance" windows).
// (The per-coach DM feature that originally consumed this was removed as
// dead/unreachable code — nothing ever called it end to end — but the run marker
// itself stays since nothing else records these advance boundaries.)
export async function recordAdvanceDmRun(input: {
  leagueId: string;
  seasonNumber: number;
  fromWeek: number;
  toWeek: number;
  fromStage: string;
  toStage: string;
  advancedByDiscordId: string | null;
}): Promise<void> {
  const { error: insertError } = await supabase.from("rec_advance_dm_runs").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    from_week: input.fromWeek,
    to_week: input.toWeek,
    from_stage: input.fromStage,
    to_stage: input.toStage,
    advanced_by_discord_id: input.advancedByDiscordId,
  });
  if (insertError) console.error("[ERROR] Failed to insert advance DM run:", insertError);
}
