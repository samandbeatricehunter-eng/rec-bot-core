import { isRegularSeasonWeek, maxSeasonWeek } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { parseScheduleImages, type ParsedScheduleGame } from "../schedule/schedule.parser.js";
import { buildAbbrMap, resolveScheduleAbbr } from "../schedule/schedule.service.js";
import { persistStitchedUploadImage } from "../box-score/box-score.service.js";

const SCHEDULE_SOURCE = "schedule_screenshot";
const REVIEW_TABLE = "rec_weekly_score_reviews";

type TeamRow = {
  id: string;
  name: string | null;
  abbreviation: string | null;
  display_abbr: string | null;
  display_city: string | null;
  display_nick: string | null;
  original_abbreviation: string | null;
  is_relocated: boolean | null;
};

export type WeeklyScoreGame = {
  gameId: string;
  awayTeamId: string | null;
  homeTeamId: string | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
  awayName: string | null;
  homeName: string | null;
  awayScore: number | null;
  homeScore: number | null;
  hasBoxScore: boolean;
};

export type WeeklyScoreReview = {
  reviewId: string;
  seasonNumber: number;
  weekNumber: number;
  status: string;
  games: WeeklyScoreGame[];
  imageUrl: string | null;
  warnings: string[];
  readCount: number;
};

async function loadWeekContext(guildId: string, weekNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const week = Number(weekNumber ?? context.rec_leagues.current_week ?? 1);
  if (!Number.isInteger(week) || week < 1 || week > maxSeasonWeek(context.rec_leagues.game ?? null)) throw new ApiError(400, "Invalid week number.");
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  return { context, leagueId: context.leagueId, seasonNumber, seasonId, weekNumber: week };
}

async function loadScheduledGamesWithTeams(leagueId: string, seasonId: string, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,original_abbreviation,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick,original_abbreviation,is_relocated)")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load the week's scheduled games.", error);
  return data ?? [];
}

// Games with a box-score submission that is pending OR approved — those stay
// authoritative, so the schedule pre-log marks them locked and never overwrites
// them (a pending box score has no result row yet but will once approved).
async function boxScoreGameIds(leagueId: string, seasonNumber: number, weekNumber: number): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("game_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["pending", "approved"]);
  if (error) throw new ApiError(500, "Failed to load box scores for the week.", error);
  return new Set((data ?? []).map((r) => String(r.game_id)).filter(Boolean));
}

// Pair a scheduled game with a parsed row by unordered team set, then orient the
// scores to the scheduled home/away (so an away/home swap in the read is tolerated).
function scoresForScheduledGame(
  game: { away_team_id: string | null; home_team_id: string | null },
  parsed: ParsedScheduleGame[],
  abbrMap: Map<string, string>,
): { awayScore: number | null; homeScore: number | null } {
  for (const p of parsed) {
    const pAway = resolveScheduleAbbr(abbrMap, p.awayAbbr);
    const pHome = resolveScheduleAbbr(abbrMap, p.homeAbbr);
    if (!pAway || !pHome) continue;
    if (pAway === game.away_team_id && pHome === game.home_team_id) {
      return { awayScore: p.awayScore, homeScore: p.homeScore };
    }
    if (pAway === game.home_team_id && pHome === game.away_team_id) {
      return { awayScore: p.homeScore, homeScore: p.awayScore };
    }
  }
  return { awayScore: null, homeScore: null };
}

function teamLabel(team: TeamRow | null): string | null {
  if (!team) return null;
  return formatTeamDisplayName(team) ?? team.name ?? team.display_abbr ?? team.abbreviation ?? null;
}

function teamAbbr(team: TeamRow | null): string | null {
  return team?.display_abbr ?? team?.abbreviation ?? null;
}

function shapeReview(row: any): WeeklyScoreReview {
  const games = (row.games ?? []) as WeeklyScoreGame[];
  return {
    reviewId: row.id,
    seasonNumber: row.season_number,
    weekNumber: row.week_number,
    status: row.status,
    games,
    imageUrl: row.image_url ?? null,
    warnings: [],
    readCount: games.filter((g) => g.awayScore != null && g.homeScore != null).length,
  };
}

// ─── Create a review (parse + match + persist; supersedes any prior pending) ─────

export async function createWeeklyScoreReview(input: {
  guildId: string;
  weekNumber?: number | null;
  imageUrls: string[];
  createdByDiscordId: string;
}): Promise<WeeklyScoreReview> {
  const { leagueId, seasonNumber, seasonId, weekNumber } = await loadWeekContext(input.guildId, input.weekNumber);

  const [scheduled, parsedWeek, boxScored] = await Promise.all([
    loadScheduledGamesWithTeams(leagueId, seasonId, weekNumber),
    parseScheduleImages(input.imageUrls),
    boxScoreGameIds(leagueId, seasonNumber, weekNumber),
  ]);

  if (!scheduled.length) {
    throw new ApiError(400, `No games are scheduled for Week ${weekNumber}. Import the schedule first, then upload scores.`);
  }

  const teams: TeamRow[] = [];
  for (const g of scheduled as any[]) {
    if (g.away_team) teams.push(g.away_team);
    if (g.home_team) teams.push(g.home_team);
  }
  const abbrMap = buildAbbrMap(teams);

  const games: WeeklyScoreGame[] = (scheduled as any[]).map((g) => {
    const scores = scoresForScheduledGame(g, parsedWeek.games, abbrMap);
    return {
      gameId: g.id,
      awayTeamId: g.away_team_id,
      homeTeamId: g.home_team_id,
      awayAbbr: teamAbbr(g.away_team),
      homeAbbr: teamAbbr(g.home_team),
      awayName: teamLabel(g.away_team),
      homeName: teamLabel(g.home_team),
      awayScore: scores.awayScore,
      homeScore: scores.homeScore,
      hasBoxScore: boxScored.has(String(g.id)),
    };
  });

  // Use a timestamp suffix so each upload gets a unique storage path — re-uploading
  // the same week would otherwise hit Supabase CDN cache and show the old image.
  const imageUrl = input.imageUrls.length
    ? await persistStitchedUploadImage(`schedule-${leagueId}-${seasonNumber}-${weekNumber}-${Date.now()}`, input.imageUrls)
    : null;

  // A new upload supersedes any prior pending review for this week.
  await clearWeeklyScoreReviewsForWeek(leagueId, seasonNumber, weekNumber);

  const { data, error } = await supabase
    .from(REVIEW_TABLE)
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      guild_id: input.guildId,
      image_url: imageUrl ?? input.imageUrls[0] ?? null,
      games,
      status: "pending",
      created_by_discord_id: input.createdByDiscordId,
    })
    .select("*")
    .single();
  if (error || !data) throw new ApiError(500, "Failed to save the weekly score review.", error);

  return { ...shapeReview(data), warnings: parsedWeek.warnings };
}

async function loadPendingReview(reviewId: string) {
  const { data, error } = await supabase.from(REVIEW_TABLE).select("*").eq("id", reviewId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load the weekly score review.", error);
  if (!data) throw new ApiError(404, "This weekly score review no longer exists (it may have been superseded or the week advanced).");
  if (data.status !== "pending") throw new ApiError(409, "This weekly score review has already been logged or cancelled.");
  return data;
}

export async function getWeeklyScoreReview(reviewId: string): Promise<WeeklyScoreReview> {
  const { data, error } = await supabase.from(REVIEW_TABLE).select("*").eq("id", reviewId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load the weekly score review.", error);
  if (!data) throw new ApiError(404, "This weekly score review no longer exists.");
  return shapeReview(data);
}

export async function correctWeeklyScoreReview(input: {
  reviewId: string;
  gameId: string;
  awayScore: number | null;
  homeScore: number | null;
}): Promise<WeeklyScoreReview> {
  const row = await loadPendingReview(input.reviewId);
  const games = (row.games ?? []) as WeeklyScoreGame[];
  const game = games.find((g) => g.gameId === input.gameId);
  if (!game) throw new ApiError(400, "That game isn't part of this review.");
  game.awayScore = input.awayScore;
  game.homeScore = input.homeScore;

  const { data, error } = await supabase
    .from(REVIEW_TABLE)
    .update({ games, updated_at: new Date().toISOString() })
    .eq("id", input.reviewId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (error || !data) throw new ApiError(500, "Failed to apply the correction.", error);
  return shapeReview(data);
}

export async function cancelWeeklyScoreReview(reviewId: string): Promise<{ ok: true }> {
  await supabase.from(REVIEW_TABLE).update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", reviewId);
  return { ok: true };
}

export async function clearWeeklyScoreReviewsForWeek(leagueId: string, seasonNumber: number, weekNumber: number): Promise<void> {
  await supabase
    .from(REVIEW_TABLE)
    .delete()
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
}

// ─── Approve: pre-log the review's scores to rec_game_results ────────────────────

export async function approveWeeklyScoreReview(input: {
  reviewId: string;
  loggedByDiscordId: string;
}): Promise<{ seasonNumber: number; weekNumber: number; logged: number; skipped: number }> {
  const row = await loadPendingReview(input.reviewId);
  const leagueId = row.league_id as string;
  const seasonNumber = row.season_number as number;
  const weekNumber = row.week_number as number;
  const games = (row.games ?? []) as WeeklyScoreGame[];
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  const result = await writePrelogResults(leagueId, seasonNumber, seasonId, weekNumber, games);

  await supabase.from(REVIEW_TABLE).update({ status: "logged", updated_at: new Date().toISOString() }).eq("id", input.reviewId);
  return { seasonNumber, weekNumber, ...result };
}

// Write real final scores to rec_game_results, skipping games that already have a
// box-score submission (pending/approved) and any game missing a score. Mirrors the
// result-writing + rollups in completeAdvanceWeek.
async function writePrelogResults(
  leagueId: string,
  seasonNumber: number,
  seasonId: string,
  weekNumber: number,
  games: WeeklyScoreGame[],
): Promise<{ logged: number; skipped: number }> {
  const now = new Date().toISOString();
  const league = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
  const leagueGame = league.data?.game ?? null;
  const scheduled = await loadScheduledGamesWithTeams(leagueId, seasonId, weekNumber);
  const byId = new Map((scheduled as any[]).map((g) => [String(g.id), g]));
  const boxScored = await boxScoreGameIds(leagueId, seasonNumber, weekNumber);

  const teamIds = [...new Set((scheduled as any[]).flatMap((g) => [g.away_team_id, g.home_team_id]).filter(Boolean))];
  const assignments = teamIds.length
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,user_id")
        .eq("league_id", leagueId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .in("team_id", teamIds)
    : { data: [], error: null };
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments for score logging.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((r: any) => [r.team_id, r.user_id]));

  let logged = 0;
  let skipped = 0;
  const rows: any[] = [];
  for (const g of games) {
    const game = byId.get(String(g.gameId));
    if (!game || g.awayScore == null || g.homeScore == null || boxScored.has(String(g.gameId))) {
      skipped++;
      continue;
    }
    const homeUserId = userByTeam.get(game.home_team_id) ?? null;
    const awayUserId = userByTeam.get(game.away_team_id) ?? null;
    const isTie = g.homeScore === g.awayScore;
    const homeWon = g.homeScore > g.awayScore;
    rows.push({
      league_id: leagueId,
      game_id: game.id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_type: isRegularSeasonWeek(weekNumber, leagueGame) ? "regular_season" : "postseason",
      external_game_id: game.external_game_id ?? null,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_user_id: homeUserId,
      away_user_id: awayUserId,
      home_score: g.homeScore,
      away_score: g.awayScore,
      winning_user_id: isTie ? null : homeWon ? homeUserId : awayUserId,
      losing_user_id: isTie ? null : homeWon ? awayUserId : homeUserId,
      winning_team_id: isTie ? null : homeWon ? game.home_team_id : game.away_team_id,
      losing_team_id: isTie ? null : homeWon ? game.away_team_id : game.home_team_id,
      is_user_h2h: Boolean(homeUserId && awayUserId),
      is_cpu_game: !(homeUserId && awayUserId),
      is_tie: isTie,
      is_playoff: !isRegularSeasonWeek(weekNumber, leagueGame),
      source: SCHEDULE_SOURCE,
      records_apply_key: `schedule:${leagueId}:${seasonNumber}:${weekNumber}:${game.home_team_id}:${game.away_team_id}`,
      created_at: now,
      updated_at: now,
    });
    logged++;
  }

  if (rows.length) {
    const result = await supabase.from("rec_game_results").upsert(rows, { onConflict: "records_apply_key", ignoreDuplicates: false });
    if (result.error) throw new ApiError(500, "Failed to log weekly scores.", result.error);

    await rebuildSeasonDisplayRecords(leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] rebuildSeasonDisplayRecords failed after weekly score prelog (non-fatal):", err);
    });
    await snapshotPowerRankings(leagueId, seasonNumber, weekNumber).catch((err) => {
      console.error("[ERROR] snapshotPowerRankings failed after weekly score prelog (non-fatal):", err);
    });
  }

  return { logged, skipped };
}
