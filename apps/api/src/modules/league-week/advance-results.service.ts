// @ts-nocheck
import { firstOffseasonStage, isCfb, isRegularSeasonWeek, isTerminalSeasonStage, nextLeagueStage, postseasonPayoutStages, stageForWeek, stageLabel } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { loadResultsAndPendingSubmissions } from "../schedule/team-schedule.service.js";
import { setLeagueWeek } from "./league-week.service.js";
import { recordAdvanceDmRun } from "./advance-dm.service.js";
import { zonedWallTimeToUtc } from "../../lib/timezone.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { CAREER_BADGES, GAME_BADGES, SEASON_BADGES } from "../box-score-intelligence/badge-rules.js";
import { issueSeasonTotalBadges, recomputeActiveLeagueBadgeBaselines } from "../box-score-intelligence/persistence.js";
import { resolveWagersOnAdvance } from "../wagers/wagers.service.js";
import { stageHasScheduledGames } from "./league-stage.util.js";
import { clearWeeklyScoreReviewsForWeek } from "./weekly-scores.service.js";
import { publishScheduledMediaForAdvance } from "../hub/story-publishing.js";
import { autoAssignGotwForWeek, settleGotwPollsForGame } from "../gotw/gotw.service.js";
import { autoPrepareEosPayouts } from "./eos-payouts.service.js";
import { retireStaleDefenseNicknames } from "./defense-nicknames.service.js";
import { cleanupSeasonHighlights, settleSeasonHighlightAwards } from "../highlights/highlights.service.js";
import { saveWeeklyPanel } from "../submission-state/submission-state.service.js";
import { postDiscordChannelMessage, purgeDiscordChannelMessages } from "../../lib/discord-guild.js";

const WEEKLY_SUBMISSIONS_PLAYABLE_STAGES = new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"]);

function weeklySubmissionsDescription(input: { seasonNumber: number; weekText: string }) {
  return [
    `Season ${input.seasonNumber} - ${input.weekText}`,
    "",
    "Use the buttons below to send this week's league submissions. Anything you type or upload during a submission is captured by REC Scout and removed from this channel so the panel stays easy to find.",
    "",
    "**Box Scores** - upload the required game screenshots. This creates a shared box-score submission for your current matchup and sends it to commissioner review for score/stat import and payout handling.",
    "**Player Stats** - submit standout stat lines after a box score is pending or approved. These feed player tracking, stories, and league content.",
    "**Recruiting Commits** - CFB only. Submit a recruit commitment to your school with position, star rating, and hometown so it can be logged and used in league news.",
  ].join("\n");
}

// Server-side twin of the bot's publishWeeklySubmissionsPanel (apps/bot/src/flows/weekly-submissions.ts)
// — posts straight to Discord's REST API instead of through a live gateway client, since
// advance completion can now be triggered from the web with no bot process involved. Custom
// IDs must stay byte-identical to WEEKLY_SUBMISSIONS_CUSTOM_IDS so the bot's interaction
// handler still responds to clicks on this panel.
async function republishWeeklySubmissionsPanel(input: { guildId: string; routes: Record<string, unknown>; seasonNumber: number; seasonStage: string; weekNumber: number }) {
  if (!WEEKLY_SUBMISSIONS_PLAYABLE_STAGES.has(input.seasonStage)) return;
  const channelId = String(input.routes?.weekly_submissions_channel_id ?? input.routes?.box_scores_channel_id ?? "");
  if (!channelId) return;
  await purgeDiscordChannelMessages(channelId);
  const stageText = input.seasonStage.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  const weekText = input.seasonStage === "regular_season" ? `Week ${input.weekNumber}` : stageText;
  {
    const sent = await postDiscordChannelMessage(channelId, {
      content: "@everyone",
      embeds: [{
        title: "REC Weekly Submissions",
        color: 0xd9a521,
        description: weeklySubmissionsDescription({ seasonNumber: input.seasonNumber, weekText }),
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: "rec:weekly_submissions:box_scores", label: "Box Scores" },
          { type: 2, style: 2, custom_id: "rec:weekly_submissions:player_stats", label: "Player Stats" },
          { type: 2, style: 3, custom_id: "rec:weekly_submissions:recruiting", label: "Recruiting Commits" },
        ],
      }],
      allowed_mentions: { parse: ["everyone"] },
    });
    if (sent) {
      await saveWeeklyPanel({ guildId: input.guildId, seasonNumber: input.seasonNumber, seasonStage: input.seasonStage, weekNumber: input.weekNumber, channelId, messageId: sent.id });
    }
    return;
  }
  const sent = await postDiscordChannelMessage(channelId, {
    embeds: [{
      title: "REC Weekly Submissions",
      color: 0xd9a521,
      description: `Season ${input.seasonNumber} • ${weekText}\n\nUse the buttons below. Submission messages are captured and removed so this panel stays in focus.`,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: "rec:weekly_submissions:box_scores", label: "Box Scores" },
        { type: 2, style: 2, custom_id: "rec:weekly_submissions:player_stats", label: "Player Stats" },
        { type: 2, style: 3, custom_id: "rec:weekly_submissions:recruiting", label: "Recruiting Commits" },
      ],
    }],
  });
  if (sent) {
    await saveWeeklyPanel({ guildId: input.guildId, seasonNumber: input.seasonNumber, seasonStage: input.seasonStage, weekNumber: input.weekNumber, channelId, messageId: sent.id });
  }
}

type AdvanceGameResultInput = {
  gameId: string;
  outcome: "home" | "away" | "tie";
  // Optional real final scores; when absent we fall back to a 1–0 win/loss flag.
  homeScore?: number | null;
  awayScore?: number | null;
};

// Delegates to the shared canonical week->stage mapping instead of hand-rolling a second,
// independently-drifting copy of it (this one had fallen out of sync with league-stage.ts twice).
function phaseForWeek(weekNumber: number, game: string | null) {
  return stageForWeek(weekNumber, game);
}

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];
// Sources that already settle a game so the advance wizard doesn't re-ask for it.
// schedule_screenshot = scores pre-logged from a League Schedule screenshot upload.
// manual = scores/outcomes entered via the Manual Scores tool.
const RESOLVED_RESULT_SOURCES = [...BOX_SCORE_SOURCES, "schedule_screenshot", "manual"];
const BADGE_LABELS = new Map(
  [...GAME_BADGES, ...SEASON_BADGES, ...CAREER_BADGES].map((badge) => [badge.key, badge.label]),
);

export async function getAdvanceWeekGames(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const nextTarget = nextLeagueStage(currentWeek, currentStage, context.rec_leagues.game);
  const nextLabel = stageLabel(nextTarget.seasonStage, nextTarget.weekNumber, context.rec_leagues.game);

  if (!stageHasScheduledGames(currentStage, context.rec_leagues.game)) {
    return {
      league: context.rec_leagues,
      seasonNumber,
      currentWeek,
      currentStage,
      nextWeekNumber: nextTarget.weekNumber,
      nextSeasonStage: nextTarget.seasonStage,
      nextLabel,
      games: [],
      gamesNeedingInput: [],
    };
  }

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,is_bowl_game,is_national_championship,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", currentWeek);
  if (error) throw new ApiError(500, "Failed to load week schedule.", error);

  const [results, boxScores] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("id,external_game_id,home_team_id,away_team_id,source")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", currentWeek),
    supabase
      .from("rec_box_score_submissions")
      .select("id,game_id,status")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", currentWeek)
      .in("status", ["pending", "approved"]),
  ]);

  if (results.error) throw new ApiError(500, "Failed to load existing game results.", results.error);
  if (boxScores.error) throw new ApiError(500, "Failed to load box score submissions.", boxScores.error);

  const boxScoreGameIds = new Set((boxScores.data ?? []).map((row) => String(row.game_id)).filter(Boolean));
  const resultByMatchup = new Map(
    (results.data ?? []).map((row) => [`${row.home_team_id}:${row.away_team_id}`, row.source ?? null]),
  );

  const mapped = (games ?? []).map((game: any) => {
    const hasBoxScore = boxScoreGameIds.has(String(game.id));
    const existingSource = resultByMatchup.get(`${game.home_team_id}:${game.away_team_id}`) ?? null;
    const hasOfficialResult = existingSource != null && RESOLVED_RESULT_SOURCES.includes(String(existingSource));
    const needsInput = !hasBoxScore && !hasOfficialResult;
    return {
      gameId: game.id,
      weekNumber: game.week_number,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeUserId: game.home_user_id,
      awayUserId: game.away_user_id,
      homeTeamName: formatTeamDisplayName(game.home_team) ?? game.home_team?.name ?? "Home",
      awayTeamName: formatTeamDisplayName(game.away_team) ?? game.away_team?.name ?? "Away",
      hasBoxScore,
      existingResultSource: existingSource,
      needsInput,
      isCpuGame: !(game.home_user_id && game.away_user_id),
      isH2h: Boolean(game.home_user_id && game.away_user_id),
      isBowlGame: Boolean(game.is_bowl_game),
      isNationalChampionship: Boolean(game.is_national_championship),
    };
  });

  return {
    league: context.rec_leagues,
    seasonNumber,
    currentWeek,
    currentStage,
    nextWeekNumber: nextTarget.weekNumber,
    nextSeasonStage: nextTarget.seasonStage,
    nextLabel,
    games: mapped,
    gamesNeedingInput: mapped.filter((game) => game.needsInput),
  };
}

// Commissioner marks a CFB postseason game as a bowl game / the national championship
// (auto-suggested by week where derivable, but always editable) — both are automatic GOTW
// games, so flagging one immediately assigns its poll if it's an H2H matchup without one yet.
export async function setGamePostseasonFlags(input: { guildId: string; gameId: string; isBowlGame: boolean; isNationalChampionship: boolean }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id")
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to load game.", game.error);
  if (!game.data) throw new ApiError(404, "Game was not found in this league.");

  const updated = await supabase
    .from("rec_games")
    .update({ is_bowl_game: input.isBowlGame, is_national_championship: input.isNationalChampionship, updated_at: new Date().toISOString() })
    .eq("id", input.gameId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to save postseason flags.", updated.error);

  if ((input.isBowlGame || input.isNationalChampionship) && game.data.home_user_id && game.data.away_user_id) {
    await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: game.data.week_number }).catch((err) => {
      console.error("[ERROR] autoAssignGotwForWeek failed after flagging a postseason game (non-fatal):", err);
    });
  }

  return { game: updated.data };
}

export type WeeklyH2hGame = {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  status: "missing" | "awaiting_review" | "final";
  result: { homeScore: number; awayScore: number; isTie: boolean; winnerTeamName: string | null } | null;
};

// Home page's read-only "this week's H2H games" panel — same week/team-pair source as
// getAdvanceWeekGames above, but scoped to human-vs-human matchups only and enriched with
// actual scores (getAdvanceWeekGames only needs to know IF a result exists, not what it
// says, so it never selects home_score/away_score). Reuses the same result/pending-
// submission correlation as the schedule builder (loadResultsAndPendingSubmissions) instead
// of re-deriving that logic a third time.
export async function getWeeklyH2hGames(guildId: string): Promise<{ weekLabel: string; games: WeeklyH2hGame[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const weekLabel = stageLabel(currentStage, currentWeek, context.rec_leagues.game ?? null);

  if (!stageHasScheduledGames(currentStage, context.rec_leagues.game)) {
    return { weekLabel, games: [] };
  }

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", currentWeek);
  if (error) throw new ApiError(500, "Failed to load week schedule.", error);

  const h2hGames = (games ?? []).filter((g: any) => g.home_user_id && g.away_user_id);
  const resultsAndSubmissions = await loadResultsAndPendingSubmissions(
    context.leagueId,
    seasonNumber,
    h2hGames.map((g: any) => ({ id: g.id, weekNumber: g.week_number, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id })),
  );

  const mapped: WeeklyH2hGame[] = h2hGames.map((g: any) => {
    const extra = resultsAndSubmissions.get(g.id);
    const homeTeamName = formatTeamDisplayName(g.home_team) ?? g.home_team?.name ?? "Home";
    const awayTeamName = formatTeamDisplayName(g.away_team) ?? g.away_team?.name ?? "Away";
    let status: WeeklyH2hGame["status"] = "missing";
    let result: WeeklyH2hGame["result"] = null;
    if (extra?.result) {
      status = "final";
      const winnerTeamName = extra.result.isTie ? null : extra.result.homeScore > extra.result.awayScore ? homeTeamName : awayTeamName;
      result = { homeScore: extra.result.homeScore, awayScore: extra.result.awayScore, isTie: extra.result.isTie, winnerTeamName };
    } else if (extra?.pendingBoxScoreSubmissionId) {
      status = "awaiting_review";
    }
    return { gameId: g.id, homeTeamName, awayTeamName, status, result };
  });

  return { weekLabel, games: mapped };
}

export async function completeAdvanceWeek(input: {
  guildId: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  advancedByDiscordId: string;
  results: AdvanceGameResultInput[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const nextTarget = nextLeagueStage(currentWeek, currentStage, context.rec_leagues.game);
  const now = new Date().toISOString();

  for (const result of input.results) {
    const game = await supabase
      .from("rec_games")
      .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id")
      .eq("id", result.gameId)
      .eq("league_id", context.leagueId)
      .maybeSingle();
    if (game.error) throw new ApiError(500, "Failed to load game for advance result.", game.error);
    if (!game.data) throw new ApiError(404, "Scheduled game not found.");

    // Prefer real final scores when the commissioner supplied them; otherwise fall
    // back to a 1–0 win/loss flag (legacy behavior).
    const hasRealScores = result.homeScore != null && result.awayScore != null;
    const homeScore = hasRealScores ? Number(result.homeScore) : result.outcome === "home" ? 1 : 0;
    const awayScore = hasRealScores ? Number(result.awayScore) : result.outcome === "away" ? 1 : 0;
    const isTie = result.outcome === "tie";
    const winningUserId = isTie ? null : result.outcome === "home" ? game.data.home_user_id : game.data.away_user_id;
    const losingUserId = isTie ? null : result.outcome === "home" ? game.data.away_user_id : game.data.home_user_id;
    const winningTeamId = isTie ? null : result.outcome === "home" ? game.data.home_team_id : game.data.away_team_id;
    const losingTeamId = isTie ? null : result.outcome === "home" ? game.data.away_team_id : game.data.home_team_id;
    const recordsApplyKey = `advance:${context.leagueId}:${seasonNumber}:${game.data.week_number ?? currentWeek}:${game.data.home_team_id}:${game.data.away_team_id}`;

    await supabase.from("rec_game_results").upsert(
      {
        league_id: context.leagueId,
        game_id: game.data.id,
        season_number: seasonNumber,
        week_number: game.data.week_number ?? currentWeek,
        game_type: game.data.phase ?? phaseForWeek(currentWeek, context.rec_leagues.game),
        external_game_id: game.data.external_game_id ?? null,
        home_team_id: game.data.home_team_id,
        away_team_id: game.data.away_team_id,
        home_user_id: game.data.home_user_id,
        away_user_id: game.data.away_user_id,
        home_score: homeScore,
        away_score: awayScore,
        winning_user_id: winningUserId,
        losing_user_id: losingUserId,
        winning_team_id: winningTeamId,
        losing_team_id: losingTeamId,
        is_user_h2h: Boolean(game.data.home_user_id && game.data.away_user_id),
        is_cpu_game: !(game.data.home_user_id && game.data.away_user_id),
        is_tie: isTie,
        is_playoff: !isRegularSeasonWeek(game.data.week_number ?? currentWeek, context.rec_leagues.game),
        source: "commissioner_advance",
        records_apply_key: recordsApplyKey,
        updated_at: now,
      },
      { onConflict: "records_apply_key", ignoreDuplicates: false },
    );

    // Settle any GOTW poll tied to this game against the real result (idempotent — a no-op
    // if box-score approval or manual score entry already settled it earlier).
    await settleGotwPollsForGame({ guildId: input.guildId, gameId: game.data.id, winningTeamId }).catch((err) => {
      console.error("[ERROR] settleGotwPollsForGame failed during advance (non-fatal):", err);
    });
  }

  const advanceResult = await setLeagueWeek({
    guildId: input.guildId,
    weekNumber: nextTarget.weekNumber,
    seasonStage: nextTarget.seasonStage,
    seasonNumber,
  });

  // Bowl games / the national championship are automatic GOTW games in CFB leagues —
  // catches any flagged game in the week just advanced INTO that doesn't have a poll yet.
  await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: nextTarget.weekNumber }).catch((err) => {
    console.error("[ERROR] autoAssignGotwForWeek failed after advance (non-fatal):", err);
  });

  // EOS payouts: automatic for every league, firing once postseason play actually ends —
  // advancing out of the terminal stage (super_bowl/national_championship) into the first
  // offseason stage (coach_hiring for Madden, players_leaving for CFB's dynasty pipeline).
  const isPostseasonEnd = isTerminalSeasonStage(String(context.rec_leagues.season_stage ?? ""), context.rec_leagues.game)
    && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game);
  if (isPostseasonEnd) {
    await autoPrepareEosPayouts({
      guildId: input.guildId,
      leagueId: context.leagueId,
      game: context.rec_leagues.game,
      seasonNumber,
      requestedByDiscordId: input.advancedByDiscordId,
    }).catch((err) => console.error("[ERROR] autoPrepareEosPayouts failed after advance (non-fatal):", err));
  }

  // Refresh the Weekly Submissions panel for the new week (same channel the bot used to
  // reset at the end of its wizard) — purges last week's submissions/chatter and posts a
  // fresh panel pointed at the new week.
  await republishWeeklySubmissionsPanel({
    guildId: input.guildId,
    routes: context.routes,
    seasonNumber,
    seasonStage: nextTarget.seasonStage,
    weekNumber: nextTarget.weekNumber,
  }).catch((err) => console.error("[ERROR] republishWeeklySubmissionsPanel failed after advance (non-fatal):", err));

  // Five independent, non-fatal cleanup/rebuild steps — none feed data into another,
  // so run them in parallel instead of one after another.
  await Promise.all([
    // The previously-scheduled advance just happened, so clear it. A fresh time is
    // set by the next-advance step (or left null if the commissioner skips).
    supabase
      .from("rec_leagues")
      .update({ next_advance_at: null, next_advance_timezone: null })
      .eq("id", context.leagueId)
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to clear next_advance_at on advance (non-fatal):", error);
      }),
    // The completed week's weekly-score review is now stale — clear it.
    clearWeeklyScoreReviewsForWeek(context.leagueId, seasonNumber, currentWeek).catch((err) => {
      console.error("[ERROR] clearWeeklyScoreReviewsForWeek failed after advance (non-fatal):", err);
    }),
    // Rebuild display records after advancing — non-fatal so a stale/empty table doesn't block the week flip.
    rebuildSeasonDisplayRecords(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] rebuildSeasonDisplayRecords failed after advance (non-fatal):", err);
    }),
    recomputeActiveLeagueBadgeBaselines(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] recomputeActiveLeagueBadgeBaselines failed after advance (non-fatal):", err);
    }),
    // Snapshot power rankings for the week that just completed, so next week can show movement.
    snapshotPowerRankings(context.leagueId, seasonNumber, currentWeek, context.rec_leagues.game).catch((err) => {
      console.error("[ERROR] snapshotPowerRankings failed after advance (non-fatal):", err);
    }),
  ]);

  // When the regular season ends (next stage is a playoff stage), issue the
  // season-total badges (Winning Season, Ball Control Season, etc.) for every
  // active user. These are only valid once the full season is in the books.
  const playoffStages = postseasonPayoutStages(context.rec_leagues.game);
  if (playoffStages.has(nextTarget.seasonStage)) {
    await issueSeasonTotalBadges(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] issueSeasonTotalBadges failed after advance to playoffs (non-fatal):", err);
    });
  }

  // Mark the advance run last, after badges/baselines settle, so its badge snapshot
  // reflects end-of-week state and `advanced_at` anchors the next Advance DM window.
  await recordAdvanceDmRun({
    leagueId: context.leagueId,
    seasonNumber,
    fromWeek: currentWeek,
    toWeek: nextTarget.weekNumber,
    advancedByDiscordId: input.advancedByDiscordId,
  }).catch((err) => {
    console.error("[ERROR] recordAdvanceDmRun failed after advance (non-fatal):", err);
  });

  await publishScheduledMediaForAdvance(input.guildId).catch((err) => {
    console.error("[ERROR] publishScheduledMediaForAdvance failed after advance (non-fatal):", err);
  });

  // Career badges are always computed continuously from all-time stored games (see
  // box-score-intelligence/persistence.ts), and game/season-scope badges naturally
  // start fresh once the next season's games begin — no season-end conversion or
  // wipe step needed.

  // Retire any "This Defense Needs a Name" nickname that didn't requalify this season
  // (CFB only — the category itself is CFB-only). Runs on the same terminal-stage ->
  // offseason boundary as the EOS payout auto-fire above.
  if (isCfb(context.rec_leagues.game) && isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await retireStaleDefenseNicknames(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] retireStaleDefenseNicknames failed after advance (non-fatal):", err);
    });
  }

  // Play of the Year: auto-tallies every regular-season highlight's reactions (Discord +
  // web) and creates a pending award review per category winner (commissioner still
  // approves the payout in Pending Payouts, same as every other payout in this app —
  // this step only auto-determines the winner and drafts the payout, never issues it
  // itself). Same terminal-stage -> offseason boundary as the automations above, and
  // must run BEFORE the highlight cleanup right below it, which only preserves
  // highlights that already have a season_award review on record.
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await settleSeasonHighlightAwards(input.guildId).catch((err) => {
      console.error("[ERROR] settleSeasonHighlightAwards failed after advance (non-fatal):", err);
    });
  }

  // Season-end highlight cleanup: hard-deletes every non-POTY-winning highlight
  // (Discord message + DB row), keeping POTY winners in the carousel permanently,
  // and posts one combined headline announcing every category winner. Same
  // terminal-stage -> offseason boundary as the automations above — must run AFTER
  // settleSeasonHighlightAwards immediately above, which is what actually creates
  // the season_award reviews this cleanup checks for.
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await cleanupSeasonHighlights(input.guildId, context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] cleanupSeasonHighlights failed after advance (non-fatal):", err);
    });
  }

  // Refund + close any wager on the completed week whose result was never logged
  // (and any peer challenge nobody took). Returns Discord message coords so the bot
  // can delete the stale pending embeds / open-challenge announcements. Non-fatal.
  const wagerCleanup = await resolveWagersOnAdvance(context.leagueId, seasonNumber, currentWeek).catch((err) => {
    console.error("[ERROR] resolveWagersOnAdvance failed after advance (non-fatal):", err);
    return { refundedCount: 0, refundedMessages: [] as any[] };
  });

  return { ...advanceResult, nextWeekNumber: nextTarget.weekNumber, nextSeasonStage: nextTarget.seasonStage, nextLabel: stageLabel(nextTarget.seasonStage, nextTarget.weekNumber, context.rec_leagues.game), wagerCleanup };
}

export async function getDivisionWinnerOptions(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_city,display_nick,is_relocated,conference,division")
    .eq("league_id", context.leagueId)
    .order("conference", { ascending: true })
    .order("division", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load teams for division winner selection.", error);

  const divisions = new Map<string, any>();
  for (const team of teams ?? []) {
    const conference = String(team.conference ?? "Conference");
    const division = String(team.division ?? "Division");
    const key = `${conference}:${division}`;
    const existing = divisions.get(key) ?? {
      key,
      conference,
      division,
      label: `${conference} ${division}`.trim(),
      teams: [],
    };
    existing.teams.push({
      id: team.id,
      name: formatTeamDisplayName(team) ?? team.name ?? team.abbreviation ?? "Team",
      abbreviation: team.abbreviation ?? null,
    });
    divisions.set(key, existing);
  }

  return { league: { id: context.leagueId, seasonNumber }, divisions: [...divisions.values()] };
}

export async function saveDivisionWinners(input: {
  guildId: string;
  seasonNumber: number;
  selectedByDiscordId: string;
  winners: Array<{ divisionKey: string; teamId: string }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();
  const requested = new Map(input.winners.map((winner) => [winner.divisionKey, winner.teamId]));
  if (!requested.size) throw new ApiError(400, "Select at least one division winner.");

  const teamIds = [...new Set(input.winners.map((winner) => winner.teamId))];
  const { data: teams, error: teamsError } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division")
    .eq("league_id", context.leagueId)
    .in("id", teamIds);
  if (teamsError) throw new ApiError(500, "Failed to validate division winners.", teamsError);

  const teamsById = new Map((teams ?? []).map((team) => [team.id, team]));
  const seedRows = [];
  for (const [divisionKey, teamId] of requested.entries()) {
    const team = teamsById.get(teamId);
    if (!team) throw new ApiError(400, "One selected division winner is not in this league.");
    const expectedKey = `${team.conference ?? "Conference"}:${team.division ?? "Division"}`;
    if (expectedKey !== divisionKey) {
      throw new ApiError(400, `${team.name ?? team.abbreviation ?? "Selected team"} is not in ${divisionKey.replace(":", " ")}.`);
    }
    seedRows.push({
      league_id: context.leagueId,
      season_number: input.seasonNumber,
      team_id: teamId,
      conference: team.conference ?? null,
      division_name: team.division ?? null,
      division_winner: true,
      made_playoffs: true,
      updated_at: now,
    });
  }

  await supabase
    .from("rec_season_team_seeds")
    .update({ division_winner: false, updated_at: now })
    .eq("league_id", context.leagueId)
    .eq("season_number", input.seasonNumber)
    .then(({ error }) => {
      if (error) throw new ApiError(500, "Failed to clear previous division winners.", error);
    });

  const upsert = await supabase
    .from("rec_season_team_seeds")
    .upsert(seedRows, { onConflict: "league_id,season_number,team_id" })
    .select("team_id,conference,division_name,division_winner");
  if (upsert.error) throw new ApiError(500, "Failed to save division winners.", upsert.error);

  // Division standings/seeding is still real structure for Madden's playoff bracket
  // (rec_season_team_seeds.division_winner/made_playoffs above) — only the badge that
  // used to piggyback on this selection is gone: the new badge set replaces
  // division_champion with conf_champion/div_champion, which are earned automatically
  // by actually winning the conference-championship/divisional-round game (see
  // reigningChampionBadges in box-score-intelligence/persistence.ts), not hand-picked
  // by a commissioner here.
  return {
    saved: upsert.data ?? [],
  };
}

export async function listAdvanceGameStories(input: {
  guildId: string;
  seasonNumber: number;
  weekNumber: number;
  includePosted?: boolean;
}) {
  const context = await getCurrentLeagueContext(input.guildId);

  let query = supabase
    .from("rec_game_stories")
    .select("id,game_id,season,week,winner_team_id,loser_team_id,primary_angle,headline,body,notes,posted_message_id,posted_channel_id,created_at")
    .eq("league_id", context.leagueId)
    .eq("season", input.seasonNumber)
    .eq("week", input.weekNumber)
    .order("created_at", { ascending: true });
  if (!input.includePosted) query = query.is("posted_message_id", null);
  const { data: stories, error } = await query;
  if (error) throw new ApiError(500, "Failed to load game stories for advance publishing.", error);

  const gameIds = [...new Set((stories ?? []).map((story) => story.game_id).filter(Boolean))];
  const teamIds = [...new Set((stories ?? []).flatMap((story) => [story.winner_team_id, story.loser_team_id]).filter(Boolean))];

  const [eventsResult, teamsResult] = await Promise.all([
    gameIds.length
      ? supabase
          .from("rec_badge_events")
          .select("game_id,user_id,team_id,badge_key,badge_scope,tier,season,week")
          .eq("league_id", context.leagueId)
          .eq("season", input.seasonNumber)
          .eq("week", input.weekNumber)
          .in("game_id", gameIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase
          .from("rec_teams")
          .select("id,name,abbreviation,display_city,display_nick,is_relocated")
          .in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsResult.error) throw new ApiError(500, "Failed to load badge events for advance publishing.", eventsResult.error);
  if (teamsResult.error) throw new ApiError(500, "Failed to load story teams for advance publishing.", teamsResult.error);

  const teamById = new Map((teamsResult.data ?? []).map((team: any) => [team.id, formatTeamDisplayName(team) ?? team.name ?? team.abbreviation ?? "Team"]));
  const badgesByGame = new Map<string, any[]>();
  for (const event of eventsResult.data ?? []) {
    const key = String(event.game_id ?? "");
    if (!key) continue;
    const rows = badgesByGame.get(key) ?? [];
    rows.push({
      userId: event.user_id,
      teamId: event.team_id,
      teamName: teamById.get(event.team_id) ?? null,
      badgeKey: event.badge_key,
      badgeLabel: BADGE_LABELS.get(event.badge_key) ?? event.badge_key,
      scope: event.badge_scope,
      tier: event.tier ?? "normal",
    });
    badgesByGame.set(key, rows);
  }

  return {
    league: { id: context.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber },
    stories: (stories ?? []).map((story) => ({
      id: story.id,
      gameId: story.game_id,
      season: story.season,
      week: story.week,
      winnerTeamId: story.winner_team_id,
      loserTeamId: story.loser_team_id,
      winnerTeamName: teamById.get(story.winner_team_id) ?? null,
      loserTeamName: teamById.get(story.loser_team_id) ?? null,
      primaryAngle: story.primary_angle,
      headline: story.headline,
      body: story.body,
      notes: Array.isArray(story.notes) ? story.notes : [],
      badges: story.game_id ? badgesByGame.get(story.game_id) ?? [] : [],
    })),
  };
}

export async function markAdvanceGameStoryPosted(input: {
  guildId: string;
  storyId: string;
  channelId: string;
  messageId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { data, error } = await supabase
    .from("rec_game_stories")
    .update({
      posted_channel_id: input.channelId,
      posted_message_id: input.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", context.leagueId)
    .eq("id", input.storyId)
    .select("id,posted_channel_id,posted_message_id")
    .single();
  if (error) throw new ApiError(500, "Failed to mark game story as posted.", error);
  return { story: data };
}

// Store (or clear) the league's next scheduled advance time. The bot supplies a
// wall-clock date/hour plus a timezone label; we resolve it to a UTC instant.
export async function setNextAdvanceTime(input: {
  guildId: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  tzLabel: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);

  const when = zonedWallTimeToUtc(input.year, input.month, input.day, input.hour, input.minute, input.tzLabel);
  if (isNaN(when.getTime())) throw new ApiError(400, "Invalid next advance date/time.");
  if (when.getTime() <= Date.now()) throw new ApiError(400, "The next advance time must be in the future.");

  const nextAdvanceAt = when.toISOString();
  const result = await supabase
    .from("rec_leagues")
    .update({ next_advance_at: nextAdvanceAt, next_advance_timezone: input.tzLabel })
    .eq("id", context.leagueId)
    .select("id")
    .single();
  if (result.error) throw new ApiError(500, "Failed to save next advance time.", result.error);

  return {
    nextAdvanceAt,
    epochSeconds: Math.floor(when.getTime() / 1000),
    tzLabel: input.tzLabel,
  };
}
