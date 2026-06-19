import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export async function getLeagueConferences(guildId: string) {
  const result = await supabase.rpc("rec_roster_league_conferences", { p_guild_id: guildId });
  if (result.error) throw new ApiError(500, "Failed to load league conferences.", result.error);
  return result.data ?? { conferences: [] };
}
