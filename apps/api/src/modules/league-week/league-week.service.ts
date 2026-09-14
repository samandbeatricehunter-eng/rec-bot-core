import { regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { applyAdvanceSavingsInterest } from "./advance-interest.service.js";
import { wipeCpuTeamSeasonStats } from "../cpu-team-stats/cpu-team-stats.service.js";
import { wipeBacklogForSeason } from "../economy/economy-backlog.js";
import { recordHubAnnouncement } from "../hub/hub.service.js";
import { generateRollingDraftClass, syncDraftOrderFromLeagueStandings } from "../draft-picks/draft-picks.service.js";
import { tickSuspensionsOnAdvance } from "../users/user-moderation.service.js";

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
  // caller (Advance wizard, manual Set Week, etc.) triggers the transition.
  // Madden's actual stage name here is "preseason_training_camp" (league-stage.ts's "draft" ->
  // "preseason_training_camp" transition), not "preseason" -- CFB uses "preseason" directly.
  // Checking only the literal "preseason" string meant season_number NEVER advanced for any
  // Madden league: the season "reset" to Week 1 but stayed tagged under the same season_id,
  // so schedule regeneration doubled up Week 1 (old completed games + new ones sharing a
  // season) and every season-scoped stat/record silently mixed the two seasons together.
  //
  // completeAdvanceWeek used to pass the *current* seasonNumber into this call on every
  // advance. Because `input.seasonNumber ?? autoBump` treats any defined value as authoritative,
  // that froze Madden leagues on season 1 forever through the draft -> training camp boundary.
  // Entering preseason always bumps at least +1; an explicit seasonNumber may only raise further
  // (commissioner Set Season), never pin the league to the season that just ended.
  const isPreseasonStageName = (stage: string) => stage === "preseason" || stage === "preseason_training_camp";
  const enteringPreseason = isPreseasonStageName(input.seasonStage) && !isPreseasonStageName(previousStage);
  const effectiveSeasonNumber = enteringPreseason
    ? Math.max(previousSeasonNumber + 1, input.seasonNumber ?? 0)
    : input.seasonNumber;
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

  // Madden year-1 (and later unlocked classes): once games exist, pick order tracks league
  // standings so traded picks follow the original franchise's slot as rankings shift.
  if ((context.rec_leagues.game === "madden_26" || context.rec_leagues.game === "madden_27") && input.seasonStage === "regular_season") {
    const standingsSeason = effectiveSeasonNumber ?? previousSeasonNumber;
    await syncDraftOrderFromLeagueStandings({
      leagueId: context.leagueId,
      draftSeasonNumber: standingsSeason,
      standingsSeasonNumber: standingsSeason,
    }).catch((error) => {
      console.error("[ERROR] Failed to sync Madden draft order from standings (non-fatal):", error);
    });
  }

  if (effectiveSeasonNumber && effectiveSeasonNumber !== previousSeasonNumber) {
    if (context.rec_leagues.game === "madden_26" || context.rec_leagues.game === "madden_27") {
      // Finalize the next draft class from the season that just ended (season 2 from S1, etc.).
      await syncDraftOrderFromLeagueStandings({
        leagueId: context.leagueId,
        draftSeasonNumber: previousSeasonNumber + 1,
        standingsSeasonNumber: previousSeasonNumber,
      }).catch((error) => {
        console.error("[ERROR] Failed to finalize next draft class order on rollover (non-fatal):", error);
      });
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
    // The offseason purchase-cap reset marker (see resetLeaguePurchaseCapsForOffseason) belongs
    // to the season that just ended — clear it so a stale timestamp doesn't linger into the new
    // season's config. Harmless either way (new-season purchases always postdate it), but this
    // keeps the column self-documenting: set only while the marked season's offseason is live.
    const purchaseCapsResetClear = await supabase.from("rec_league_configuration")
      .update({ purchase_caps_reset_at: null }).eq("league_id", context.leagueId);
    if (purchaseCapsResetClear.error) console.error("[ERROR] Failed to clear purchase_caps_reset_at on season rollover:", purchaseCapsResetClear.error);
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

  await tickSuspensionsOnAdvance({ leagueId: context.leagueId, guildId: input.guildId }).catch((error) => {
    console.error("[ERROR] Failed to tick advance-based suspensions (non-fatal):", error);
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
