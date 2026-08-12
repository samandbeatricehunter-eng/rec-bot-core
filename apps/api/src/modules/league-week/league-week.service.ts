import { regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { applyAdvanceSavingsInterest } from "./advance-interest.service.js";
import { wipeCpuTeamSeasonStats } from "../cpu-team-stats/cpu-team-stats.service.js";
import { wipeLeagueChatForSeasonRollover } from "../league-chat/league-chat.service.js";
import { wipeBacklogForSeason } from "../economy/economy-backlog.js";
import { materializeSignedRecruits } from "../recruiting/recruiting.service.js";
import { recordHubAnnouncement } from "../hub/hub.service.js";
import { generateRollingDraftClass } from "../draft-picks/draft-picks.service.js";

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
  // Hitting preseason always means the next consecutive season, in every league — this is
  // the ONE rule for when the season number advances, so it applies regardless of which
  // caller (Advance wizard, manual Set Week, etc.) triggers the transition. An explicit
  // input.seasonNumber (e.g. the Discord "Set Season" override) still wins when given.
  const enteringPreseason = input.seasonStage === "preseason" && previousStage !== "preseason";
  const effectiveSeasonNumber = input.seasonNumber ?? (enteringPreseason ? previousSeasonNumber + 1 : undefined);
  const payload = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    ...(effectiveSeasonNumber ? { season_number: effectiveSeasonNumber } : {}),
    updated_at: new Date().toISOString()
  };

  const result = await supabase
    .from("rec_leagues")
    .update(payload)
    .eq("id", context.leagueId)
    .select("*")
    .single();

  if (result.error) throw new ApiError(500, "We couldn't update the league week. Please try again.", result.error);

  if (effectiveSeasonNumber && effectiveSeasonNumber !== previousSeasonNumber) {
    if (context.rec_leagues.game === "madden_26" || context.rec_leagues.game === "madden_27") {
      await generateRollingDraftClass({
        leagueId: context.leagueId,
        completedSeasonNumber: previousSeasonNumber,
        targetSeasonNumber: effectiveSeasonNumber + 2,
      }).catch(async (error) => {
        console.error("[ERROR] Failed to generate the rolling Madden draft class on season rollover:", error);
        const errorName = error instanceof Error ? error.name : "NonErrorThrown";
        const errorMessage = error instanceof Error ? error.message : String(error);
        const incident = await supabase.from("rec_admin_incidents").insert({
          league_id: context.leagueId,
          guild_id: input.guildId,
          process: "generate_rolling_madden_draft_class",
          severity: "high",
          status: "open",
          title: "Madden season rollover could not generate future draft picks",
          detail: `${errorName}: ${errorMessage}`,
          error_name: errorName,
          error_message: errorMessage,
          error_stack: error instanceof Error ? error.stack ?? null : null,
          context: { previousSeasonNumber, targetSeasonNumber: effectiveSeasonNumber + 2 },
        });
        if (incident.error) console.error("[ERROR] Failed to record draft-generation incident:", incident.error);
      });
    }
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

    // Signing day has passed — every recruit who signed and committed in-league becomes a
    // real roster player as of this new season's preseason.
    await materializeSignedRecruits(context.leagueId).catch((error) => {
      console.error("[ERROR] Failed to materialize signed recruits on season rollover:", error);
    });

    // CFB's store (custom recruits, Campus Legends, dev upgrades, attributes, traits) is
    // locked through Season 1 (see CFB_SEASON_ONE_LOCKED_PURCHASE_TYPES in
    // purchases.service.ts) and opens automatically the moment the league rolls into Season
    // 2 — announce that transition the same way any other hub announcement goes out.
    if (context.rec_leagues.game === "cfb_27" && previousSeasonNumber < 2 && effectiveSeasonNumber >= 2) {
      await recordHubAnnouncement({
        guildId: input.guildId,
        title: "The REC Store Is Open!",
        body: "Season 2 has arrived — Custom Recruits, Campus Legends, Development Upgrades, Attribute Points, and Traits are now unlocked in the REC Store.",
      }).catch((error) => {
        console.error("[ERROR] Failed to post CFB store-unlock announcement:", error);
      });
    }
  }

  const seasonNumber = Number(effectiveSeasonNumber ?? result.data.season_number ?? result.data.display_season_number ?? 1);
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
