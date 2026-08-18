import { supabase } from "../../lib/supabase.js";
import { syncBoxScoreCommandVisibility } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export type LeagueDataMode = "import" | "box_scores" | "manual";

/** How this league's game results/stats/rosters get entered — set in League Settings. */
export async function getLeagueDataMode(leagueId: string): Promise<LeagueDataMode> {
  const result = await supabase
    .from("rec_league_configuration")
    .select("data_mode")
    .eq("league_id", leagueId)
    .maybeSingle();
  const mode = result.data?.data_mode;
  return mode === "import" || mode === "manual" ? mode : "box_scores";
}

/**
 * Idempotent, cheap enough to call unconditionally whenever a league's Discord server or data
 * mode might have just changed (initial setup, a later settings edit, or claiming a server for
 * an already-configured league) — /boxscore should only ever be visible in a guild whose league
 * is actually in box_scores mode, and this doesn't need the caller to track whether the mode
 * actually changed. Non-fatal by design: a guild that hasn't gotten the bot yet, or a transient
 * Discord API error, shouldn't block league setup/settings from saving.
 */
export async function syncBoxScoreCommandForLeague(guildId: string, leagueId: string): Promise<void> {
  try {
    const mode = await getLeagueDataMode(leagueId);
    await syncBoxScoreCommandVisibility(guildId, mode === "box_scores");
  } catch (error) {
    console.error(`[WARN] Failed to sync /boxscore command visibility for guild ${guildId}:`, error);
  }
}

/** Read-only check for whether /boxscore should be visible in this guild right now — used by
 * the bot's own guild command sync at startup/guild-join (apps/bot/src/commands.ts
 * guildCommandSet), so a bot restart re-registering commands from scratch derives the same
 * answer as syncBoxScoreCommandForLeague instead of resetting the guild back to base commands
 * and dropping /boxscore until the next settings edit. */
export async function getBoxScoreCommandState(guildId: string): Promise<{ includeBoxScore: boolean }> {
  const context = await getCurrentLeagueContext(guildId).catch(() => null);
  if (!context?.leagueId) return { includeBoxScore: false };
  const mode = await getLeagueDataMode(context.leagueId);
  return { includeBoxScore: mode === "box_scores" };
}
