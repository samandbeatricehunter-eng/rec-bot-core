// Resolves "this Discord user's active team and their scheduled game for the current (or
// requested) week" — shared by any self-serve Discord flow that needs to know which game a
// coach's action applies to (originally part of the box-score upload-eligibility check; box
// scores are gone, but Watched Players' self-serve stat-line submission still needs this).
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "./league-context.service.js";
import { resolveSeasonId } from "./season.service.js";
import { leagueWeekGamesQuery } from "./league-games.query.js";

export type CurrentWeekTeamGame = {
  seasonNumber: number;
  weekNumber: number;
  teamId: string | null;
  gameId: string | null;
};

export async function getCurrentWeekTeamGame(input: { guildId: string; discordId: string }): Promise<CurrentWeekTeamGame> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't load your Discord account. Please try again.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");

  const leagueId = context.leagueId;
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", leagueId).eq("user_id", account.data.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team assignment. Please try again.", assignment.error);
  const teamId = assignment.data?.team_id ?? null;

  let gameId: string | null = null;
  if (teamId) {
    const seasonId = await resolveSeasonId(leagueId, seasonNumber);
    const game = await leagueWeekGamesQuery(supabase, { leagueId, seasonId, weekNumber }, "id,home_team_id,away_team_id")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .maybeSingle();
    if (game.error) throw new ApiError(500, "We couldn't load that scheduled game. Please try again.", game.error);
    gameId = game.data?.id ?? null;
  }

  return { seasonNumber, weekNumber, teamId, gameId };
}
