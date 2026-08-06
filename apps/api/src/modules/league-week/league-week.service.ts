import { regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { applyAdvanceSavingsInterest } from "./advance-interest.service.js";
import { wipeCpuTeamSeasonStats } from "../cpu-team-stats/cpu-team-stats.service.js";
import { wipeLeagueChatForSeasonRollover } from "../league-chat/league-chat.service.js";
import { wipeBacklogForSeason } from "../economy/economy-backlog.js";

type SetLeagueWeekInput = {
  guildId: string;
  weekNumber: number;
  seasonStage: string;
  seasonNumber?: number;
};

export async function viewLeagueWeek(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return {
    league: context.rec_leagues,
    server: context.rec_discord_servers
  };
}

export async function setLeagueWeek(input: SetLeagueWeekInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const previousWeek = Number(context.rec_leagues.current_week ?? 1);
  const previousStage = String(context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "regular_season");
  const previousSeasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const highlightAwardsDue = previousStage === "regular_season"
    && previousWeek === regularSeasonWeeks(context.rec_leagues.game)
    && input.seasonStage !== "regular_season";
  const payload = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    ...(input.seasonNumber ? { season_number: input.seasonNumber } : {}),
    updated_at: new Date().toISOString()
  };

  const result = await supabase
    .from("rec_leagues")
    .update(payload)
    .eq("id", context.leagueId)
    .select("*")
    .single();

  if (result.error) throw new ApiError(500, "Failed to update league week.", result.error);

  if (input.seasonNumber && input.seasonNumber !== previousSeasonNumber) {
    await wipeCpuTeamSeasonStats(context.leagueId, previousSeasonNumber).catch((error) => {
      console.error("[ERROR] Failed to wipe CPU team season stats on rollover:", error);
    });
    await wipeLeagueChatForSeasonRollover(context.leagueId).catch((error) => {
      console.error("[ERROR] Failed to wipe league chat on season rollover:", error);
    });
    // Any payout still sitting in the backlog for the ending season doesn't carry into the
    // new one — it's dropped rather than released once the season it belongs to is over.
    await wipeBacklogForSeason(context.leagueId, previousSeasonNumber).catch((error) => {
      console.error("[ERROR] Failed to wipe payout backlog on season rollover:", error);
    });
    // Clear out the ending season's Campus Buzz articles/announcements so the new season
    // starts with a clean feed — except the national championship recap, which stays as the
    // season's closing headline.
    // .neq() alone would silently exclude every row with a null primary_angle (SQL `<>`
    // never matches NULL) — most stories have no primary_angle at all, so that would leave
    // almost everything undeleted. or() with an explicit is-null clause covers those too.
    const storiesWipe = await supabase.from("rec_game_stories").delete()
      .eq("league_id", context.leagueId).eq("season", previousSeasonNumber)
      .or("primary_angle.is.null,primary_angle.neq.national_championship_recap");
    if (storiesWipe.error) console.error("[ERROR] Failed to wipe game stories on season rollover:", storiesWipe.error);
    const announcementsWipe = await supabase.from("rec_hub_announcements").delete()
      .eq("league_id", context.leagueId).eq("season_number", previousSeasonNumber);
    if (announcementsWipe.error) console.error("[ERROR] Failed to wipe hub announcements on season rollover:", announcementsWipe.error);
  }

  const seasonNumber = Number(input.seasonNumber ?? result.data.season_number ?? result.data.display_season_number ?? 1);
  const savingsInterest = await applyAdvanceSavingsInterest({
    leagueId: context.leagueId,
    serverId: context.serverId,
    seasonNumber,
    previousWeek,
    previousStage,
    nextWeek: input.weekNumber,
    nextStage: input.seasonStage,
    leagueRow: {
      interest_disabled_until: context.rec_leagues.interest_disabled_until ?? null,
      advance_rate_window_start: context.rec_leagues.advance_rate_window_start ?? null,
      advance_rate_count: context.rec_leagues.advance_rate_count ?? 0,
    },
  }).catch((error) => {
    console.error("[ERROR] Failed to apply savings interest on advance:", error);
    return { applied: false as const, reason: "error" as const, usersCredited: 0, totalInterest: 0 };
  });

  return {
    league: result.data,
    highlightAwardsDue,
    savingsInterest,
    warning: savingsInterest.applied && savingsInterest.usersCredited > 0
      ? undefined
      : "Advance week updated. Savings interest applies only on forward advances for linked users with savings.",
  };
}
