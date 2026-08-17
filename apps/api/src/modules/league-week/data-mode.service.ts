import { supabase } from "../../lib/supabase.js";

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
