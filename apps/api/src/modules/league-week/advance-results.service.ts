import { isRegularSeasonWeek, isTerminalSeasonStage, postseasonPayoutStages } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { setLeagueWeek } from "./league-week.service.js";
import { recordAdvanceDmRun } from "./advance-dm.service.js";
import { zonedWallTimeToUtc } from "../../lib/timezone.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES } from "../box-score-intelligence/badge-rules.js";
import { issueSeasonTotalBadges, recomputeActiveLeagueBadgeBaselines } from "../box-score-intelligence/persistence.js";
import { convertSeasonBadgesToTrophies } from "../box-score-intelligence/season-trophies.service.js";
import { resolveWagersOnAdvance } from "../wagers/wagers.service.js";
import { stageHasScheduledGames } from "./league-stage.util.js";
import { clearWeeklyScoreReviewsForWeek } from "./weekly-scores.service.js";

type AdvanceGameResultInput = {
  gameId: string;
  outcome: "home" | "away" | "tie";
  // Optional real final scores; when absent we fall back to a 1–0 win/loss flag.
  homeScore?: number | null;
  awayScore?: number | null;
};

function phaseForWeek(weekNumber: number, game: string | null) {
  if (isRegularSeasonWeek(weekNumber, game)) return "regular_season";
  if (game === "cfb_27") {
    if (weekNumber === 13) return "cfp_first_round";
    if (weekNumber === 14) return "cfp_quarterfinals";
    if (weekNumber === 15) return "cfp_semifinals";
    if (weekNumber === 16) return "cfp_bye_week";
    if (weekNumber === 17) return "national_championship";
    return "postseason";
  }
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  if (weekNumber === 22) return "super_bowl";
  return "postseason";
}

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];
// Sources that already settle a game so the advance wizard doesn't re-ask for it.
// schedule_screenshot = scores pre-logged from a League Schedule screenshot upload.
// manual = scores/outcomes entered via the Manual Scores tool.
const RESOLVED_RESULT_SOURCES = [...BOX_SCORE_SOURCES, "schedule_screenshot", "manual"];
const BADGE_LABELS = new Map(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((badge) => [badge.key, badge.label]),
);
const DIVISION_CHAMPION_BADGE = "division_champion";

export async function getAdvanceWeekGames(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");

  if (!stageHasScheduledGames(currentStage, context.rec_leagues.game)) {
    return {
      league: context.rec_leagues,
      seasonNumber,
      currentWeek,
      currentStage,
      games: [],
      gamesNeedingInput: [],
    };
  }

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
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
    };
  });

  return {
    league: context.rec_leagues,
    seasonNumber,
    currentWeek,
    currentStage,
    games: mapped,
    gamesNeedingInput: mapped.filter((game) => game.needsInput),
  };
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
  }

  const advanceResult = await setLeagueWeek({
    guildId: input.guildId,
    weekNumber: input.nextWeekNumber,
    seasonStage: input.nextSeasonStage,
    seasonNumber,
  });

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
    snapshotPowerRankings(context.leagueId, seasonNumber, currentWeek).catch((err) => {
      console.error("[ERROR] snapshotPowerRankings failed after advance (non-fatal):", err);
    }),
  ]);

  // When the regular season ends (next stage is a playoff stage), issue the
  // season-total badges (Winning Season, Ball Control Season, etc.) for every
  // active user. These are only valid once the full season is in the books.
  const playoffStages = postseasonPayoutStages(context.rec_leagues.game);
  if (playoffStages.has(input.nextSeasonStage)) {
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
    toWeek: input.nextWeekNumber,
    advancedByDiscordId: input.advancedByDiscordId,
  }).catch((err) => {
    console.error("[ERROR] recordAdvanceDmRun failed after advance (non-fatal):", err);
  });

  // Season end (advancing out of the Super Bowl into the offseason): convert every
  // active coach's season badges into permanent Career Trophies, then wipe their
  // weekly + season badges for next season. Runs after recordAdvanceDmRun so the
  // offseason DM snapshot still reflects this season's badges. Non-fatal.
  const currentStage = String(context.rec_leagues.season_stage ?? "");
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && input.nextSeasonStage === "coach_hiring") {
    await convertSeasonBadgesToTrophies(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] convertSeasonBadgesToTrophies failed after advance (non-fatal):", err);
    });
  }

  // Refund + close any wager on the completed week whose result was never logged
  // (and any peer challenge nobody took). Returns Discord message coords so the bot
  // can delete the stale pending embeds / open-challenge announcements. Non-fatal.
  const wagerCleanup = await resolveWagersOnAdvance(context.leagueId, seasonNumber, currentWeek).catch((err) => {
    console.error("[ERROR] resolveWagersOnAdvance failed after advance (non-fatal):", err);
    return { refundedCount: 0, refundedMessages: [] as any[] };
  });

  return { ...advanceResult, wagerCleanup };
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

  const assignmentResult = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", context.leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("team_id", teamIds);
  if (assignmentResult.error) throw new ApiError(500, "Failed to load division winner users.", assignmentResult.error);

  const winnerAssignments = assignmentResult.data ?? [];
  await supabase
    .from("rec_badge_ownership")
    .delete()
    .eq("league_id", context.leagueId)
    .eq("season", input.seasonNumber)
    .eq("badge_scope", "season")
    .eq("badge_key", DIVISION_CHAMPION_BADGE);
  await supabase
    .from("rec_badge_events")
    .delete()
    .eq("league_id", context.leagueId)
    .eq("season", input.seasonNumber)
    .eq("badge_scope", "season")
    .eq("badge_key", DIVISION_CHAMPION_BADGE);

  if (winnerAssignments.length) {
    const ownershipRows = winnerAssignments.map((assignment) => ({
      league_id: context.leagueId,
      user_id: assignment.user_id,
      team_id: assignment.team_id,
      badge_key: DIVISION_CHAMPION_BADGE,
      badge_scope: "season",
      tier: "normal",
      season: input.seasonNumber,
      earned_count: 1,
      current_streak: 1,
      best_streak: 1,
      active: true,
      updated_at: now,
    }));
    const ownership = await supabase.from("rec_badge_ownership").insert(ownershipRows);
    if (ownership.error) throw new ApiError(500, "Failed to award division champion badges.", ownership.error);

    const events = await supabase.from("rec_badge_events").insert(
      winnerAssignments.map((assignment) => ({
        league_id: context.leagueId,
        user_id: assignment.user_id,
        team_id: assignment.team_id,
        badge_key: DIVISION_CHAMPION_BADGE,
        badge_scope: "season",
        tier: "normal",
        season: input.seasonNumber,
        reason: `Division winner selected by discord:${input.selectedByDiscordId}`,
      })),
    );
    if (events.error) throw new ApiError(500, "Failed to record division champion badge events.", events.error);
  }

  return {
    saved: upsert.data ?? [],
    badgesAwarded: winnerAssignments.length,
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
