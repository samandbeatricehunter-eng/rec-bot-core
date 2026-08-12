import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";

export async function getLeagueConferences(guildId: string) {
  const [result, context] = await Promise.all([
    supabase.rpc("rec_roster_league_conferences", { p_guild_id: guildId }),
    findCurrentLeagueContext(guildId),
  ]);
  if (result.error) throw new ApiError(500, "We couldn't load the league conferences. Please try again.", result.error);
  const payload = (result.data ?? { conferences: [] }) as { conferences?: unknown };
  return {
    conferences: Array.isArray(payload.conferences) ? payload.conferences : [],
    league: context?.rec_leagues
      ? {
          id: context.rec_leagues.id,
          name: context.rec_leagues.name,
          game: context.rec_leagues.game,
        }
      : null,
  };
}
