import { stageLabel } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { withComputeCache } from "../../lib/compute-cache.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { computePowerRankings } from "./power-rankings.service.js";

const LEAGUE_SUMMARY_CACHE_TTL_MS = 30_000;

// Compact league-wide state for the /league Discord command: season/week/stage, advance
// timing, this week's selected Game of the Week, the top of the power rankings as "leaders",
// and EA sync freshness (most recent rec_players.updated_at for this league, which every
// import path -- EA Direct and Madden Companion -- touches on write).
export async function getLeagueSummary(guildId: string) {
  return withComputeCache(`league-summary:${guildId}`, LEAGUE_SUMMARY_CACHE_TTL_MS, async () => {
    const context = await getCurrentLeagueContext(guildId);
    const league: any = context.rec_leagues;
    const leagueId = context.leagueId;
    const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
    const currentWeek = league.current_week ?? 1;
    const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");

    const [rankings, gotwResult, eaSyncResult] = await Promise.all([
      computePowerRankings(guildId, null).catch(() => null),
      supabase
        .from("rec_game_of_week_candidates")
        .select("matchup_title,away_team_name,home_team_name,strength_rating")
        .eq("league_id", leagueId)
        .eq("season_number", seasonNumber)
        .eq("week_number", currentWeek)
        .eq("is_selected", true)
        .maybeSingle(),
      supabase
        .from("rec_players")
        .select("updated_at")
        .eq("league_id", leagueId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const leaders = (rankings?.teams ?? []).slice(0, 3).map((t: any) => ({
      rank: t.rank,
      teamName: t.teamName,
      ownerLabel: t.ownerLabel ?? null,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
    }));

    const gotw = gotwResult.data
      ? {
          matchupTitle: gotwResult.data.matchup_title || `${gotwResult.data.away_team_name} @ ${gotwResult.data.home_team_name}`,
          strengthRating: gotwResult.data.strength_rating != null ? Number(gotwResult.data.strength_rating) : null,
        }
      : null;

    return {
      league: {
        id: leagueId,
        name: league.name ?? "Current League",
        game: league.game ?? "madden_26",
        seasonNumber,
        currentWeek,
        seasonStage: stage,
        seasonStageLabel: stageLabel(stage, currentWeek, league.game ?? null),
      },
      advance: {
        nextAdvanceAt: league.next_advance_at ?? null,
        nextAdvanceTimezone: league.next_advance_timezone ?? null,
        lastAdvanceAt: league.last_advance_at ?? null,
      },
      gotw,
      leaders,
      eaSync: {
        lastSyncedAt: eaSyncResult.data?.updated_at ?? null,
      },
    };
  });
}
