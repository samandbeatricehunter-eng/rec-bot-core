import { supabase } from "../../lib/supabase.js";

export type LeagueDataMode = "import" | "manual";

/** How this league's game results/stats/rosters get entered — set in League Settings. */
export async function getLeagueDataMode(leagueId: string): Promise<LeagueDataMode> {
  const result = await supabase
    .from("rec_league_configuration")
    .select("data_mode")
    .eq("league_id", leagueId)
    .maybeSingle();
  return result.data?.data_mode === "manual" ? "manual" : "import";
}
