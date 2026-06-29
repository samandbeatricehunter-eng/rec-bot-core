// Import-time orchestration: runs after a box score is approved and its
// rec_team_game_stats rows are written. Computes game profiles, generates the
// game story, and recomputes the participants' weekly/season/global badges, then
// persists everything. Advance only READS these rows — it must not call this.
//
// Idempotent / re-import-safe: game-scoped derived rows (profile, story, events)
// are deleted before re-insert, and season/global badge progress is recomputed
// from the stored games rather than incremented, so re-uploading a corrected box
// score self-heals instead of double-counting.

import { supabase } from "../../lib/supabase.js";
import { seasonTotalsFromGames, careerTotalsFromGames, weeklyStreaks } from "./aggregate.js";
import {
  WEEKLY_BADGES,
  getSeasonTier,
  getWeeklyTier,
  qualifyGlobalBadges,
  qualifySeasonBadges,
  qualifyWeeklyBadges,
} from "./badge-rules.js";
import { computeGameProfile, rowToGameStats, type TeamGameStatsRow } from "./game-profile.js";
import { generateGameStory } from "./story-angles.js";
import { type CareerTotals, type GameStats } from "./types.js";

/** The box-score submission row (rec_box_score_submissions). Loosely typed — only a few fields are read. */
type SubmissionRow = {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  game_id: string | null;
};

const WEEKLY_LABEL = new Map(WEEKLY_BADGES.map((b) => [b.key, b.label]));

export async function processGameIntelligence(sub: SubmissionRow): Promise<void> {
  const gameId = sub.game_id ?? null;

  const { data: rows, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("submission_id", sub.id);
  if (error) throw error;
  if (!rows || rows.length === 0) return;

  const games = rows.map((r) => rowToGameStats(r as TeamGameStatsRow));
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter((t): t is string => !!t))];
  const nameById = await loadTeamNames(teamIds);

  // Re-import safety: clear game-scoped derived rows before recompute.
  if (gameId) {
    await supabase.from("rec_game_stories").delete().eq("game_id", gameId);
    await supabase.from("rec_game_profiles").delete().eq("game_id", gameId);
    await supabase.from("rec_badge_events").delete().eq("game_id", gameId);
  }

  // Game story (one per game; needs a distinct winner/loser).
  const winner = games.find((g) => g.won);
  const loser = games.find((g) => g.lost);
  if (gameId && winner && loser) {
    const winnerBadges = qualifyWeeklyBadges(winner).map((b) => b.label);
    const story = generateGameStory(
      {
        winner,
        loser,
        winnerName: nameById.get(winner.teamId ?? "") ?? "Home",
        loserName: nameById.get(loser.teamId ?? "") ?? "Away",
      },
      winnerBadges,
    );
    await supabase.from("rec_game_stories").insert({
      league_id: sub.league_id,
      season: sub.season_number,
      week: sub.week_number,
      game_id: gameId,
      winner_team_id: winner.teamId,
      loser_team_id: loser.teamId,
      primary_angle: story.primaryAngle,
      headline: story.headline,
      body: story.body,
      notes: story.notes,
    });
  }

  // Per-team profile + per-user badge recompute.
  for (const g of games) {
    if (gameId) {
      const profile = computeGameProfile(g);
      await supabase.from("rec_game_profiles").insert({
        league_id: g.leagueId,
        season: g.season,
        week: g.week,
        game_id: gameId,
        team_id: g.teamId,
        user_id: g.userId,
        opponent_team_id: g.opponentTeamId,
        won: g.won,
        margin: g.margin,
        story_angles: winner && loser ? generateGameStory({ winner, loser, winnerName: "", loserName: "" }).angleScores : null,
        qualified_badges: profile.qualifiedBadges,
        profile,
      });
    }
    if (g.userId) await recomputeUserBadges(g);
  }
}

type RecomputeUserBadgeInput = {
  leagueId: string;
  userId: string;
  teamId: string | null;
  season: number;
  current?: GameStats | null;
};

async function recomputeUserBadges(current: GameStats): Promise<void> {
  await recomputeUserBadgeOwnership({
    leagueId: current.leagueId,
    userId: current.userId!,
    teamId: current.teamId,
    season: current.season,
    current,
  });
}

async function recomputeUserBadgeOwnership(input: RecomputeUserBadgeInput): Promise<void> {
  const userId = input.userId;
  const leagueId = input.leagueId;
  const season = input.season;

  const { data: allRows, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  if (error) throw error;
  if (!allRows) return;

  const allGames = allRows.map((r) => rowToGameStats(r as TeamGameStatsRow));
  const seasonGames = allGames.filter((g) => g.season === season);

  const careerTotals = await applyOfficialRecordMilestones(leagueId, userId, careerTotalsFromGames(allGames));
  const streaks = weeklyStreaks(seasonGames);
  const now = new Date().toISOString();
  const teamId = input.teamId;

  const weeklyRows = streaks.map((s) => ({
    league_id: leagueId,
    user_id: userId,
    team_id: teamId,
    badge_key: s.badgeKey,
    badge_scope: "weekly",
    tier: getWeeklyTier(s.currentStreak),
    season,
    week: s.lastEarnedWeek,
    earned_count: s.earnedCount,
    current_streak: s.currentStreak,
    best_streak: s.bestStreak,
    last_earned_week: s.lastEarnedWeek,
    active: s.currentStreak > 0,
    updated_at: now,
  }));

  // Season-long tiered versions of repeated weekly badges (bronze/silver/gold/xf).
  // Use bestStreak (not currentStreak) so a broken streak doesn't erase the tier
  // a user already earned — the badge is kept at the highest tier reached.
  const previousSeasonRows = await supabase
    .from("rec_badge_ownership")
    .select("badge_key,tier,earned_count,best_streak")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("season", season)
    .eq("badge_scope", "season");
  const previousSeasonByKey = new Map((previousSeasonRows.data ?? []).map((row) => [row.badge_key, row]));

  const seasonRows = streaks
    .map((s) => ({ s, tier: getSeasonTier(s.bestStreak, s.earnedCount) }))
    .filter((x): x is { s: typeof x.s; tier: NonNullable<typeof x.tier> } => x.tier !== null)
    .map(({ s, tier }) => ({
      league_id: leagueId,
      user_id: userId,
      team_id: teamId,
      badge_key: s.badgeKey,
      badge_scope: "season",
      tier,
      season,
      earned_count: s.earnedCount,
      current_streak: s.currentStreak,
      best_streak: s.bestStreak,
      last_earned_week: s.lastEarnedWeek,
      active: s.currentStreak > 0,
      updated_at: now,
    }));

  // NOTE: qualifySeasonBadges (season-total badges like "Winning Season",
  // "Ball Control Season") are NOT issued here — they only apply once the
  // regular season is complete. Call issueSeasonTotalBadges() from the
  // advance service when the league transitions to playoffs.

  // Global / career badges (per-league career; season is null).
  const globalRows = qualifyGlobalBadges(careerTotals).map((b) => ({
    league_id: leagueId,
    user_id: userId,
    team_id: teamId,
    badge_key: b.key,
    badge_scope: "global",
    tier: "normal",
    season: null,
    earned_count: 1,
    current_streak: 1,
    best_streak: 1,
    last_earned_week: null,
    active: true,
    updated_at: now,
  }));

  // Replace this season's weekly+season rows and the user's global rows, then insert fresh.
  await supabase
    .from("rec_badge_ownership")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("season", season)
    .in("badge_scope", ["weekly", "season"]);
  await supabase
    .from("rec_badge_ownership")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .is("season", null)
    .eq("badge_scope", "global");

  const ownership = [...weeklyRows, ...seasonRows, ...globalRows];
  if (ownership.length) {
    const { error: insErr } = await supabase.from("rec_badge_ownership").insert(ownership);
    if (insErr) throw insErr;
  }

  const newXfRows = seasonRows.filter((row) => {
    if (row.tier !== "xf") return false;
    const previous = previousSeasonByKey.get(row.badge_key);
    return previous?.tier !== "xf";
  });
  if (newXfRows.length) {
    await supabase.from("rec_badge_events").insert(
      newXfRows.map((row) => ({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        badge_key: row.badge_key,
        badge_scope: "season",
        tier: "xf",
        season,
        week: row.last_earned_week,
        game_id: input.current?.gameId ?? null,
        reason: `XF season badge earned: ${row.earned_count} total earns this season`,
        stats_snapshot: {
          earnedCount: row.earned_count,
          currentStreak: row.current_streak,
          bestStreak: row.best_streak,
          lastEarnedWeek: row.last_earned_week,
        },
      })),
    );
  }

  // Audit: weekly badges earned in THIS game (game-scoped, re-import-safe).
  const earnedThisGame = input.current ? qualifyWeeklyBadges(input.current) : [];
  if (input.current?.gameId && earnedThisGame.length) {
    await supabase.from("rec_badge_events").insert(
      earnedThisGame.map((b) => ({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        badge_key: b.key,
        badge_scope: "weekly",
        tier: getWeeklyTier(streaks.find((s) => s.badgeKey === b.key)?.currentStreak ?? 1),
        season,
        week: input.current?.week,
        game_id: input.current?.gameId,
        reason: "Weekly badge earned",
        stats_snapshot: {
          pointsFor: input.current?.pointsFor,
          pointsAgainst: input.current?.pointsAgainst,
          passingYards: input.current?.passingYards,
          rushingYards: input.current?.rushingYards,
        },
      })),
    );
  }
}

async function applyOfficialRecordMilestones(leagueId: string, userId: string, careerTotals: CareerTotals): Promise<CareerTotals> {
  const leagueResult = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
  const game = String(leagueResult.data?.game ?? "madden_26");
  const recordResult = await supabase
    .from("rec_global_user_game_records")
    .select("wins,games_played,playoff_wins,superbowl_wins")
    .eq("user_id", userId)
    .eq("game", game)
    .maybeSingle();

  const record = recordResult.data;
  if (!record) return careerTotals;
  return {
    ...careerTotals,
    wins: Math.max(careerTotals.wins, Number(record.wins ?? 0)),
    gamesPlayed: Math.max(careerTotals.gamesPlayed, Number(record.games_played ?? 0)),
    playoffWins: Math.max(careerTotals.playoffWins, Number(record.playoff_wins ?? 0)),
    superBowlTitles: Math.max(careerTotals.superBowlTitles, Number(record.superbowl_wins ?? 0)),
  };
}

export async function recomputeActiveLeagueBadgeBaselines(leagueId: string, season: number): Promise<{ usersUpdated: number }> {
  const { data: assignments, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;

  const seen = new Set<string>();
  for (const assignment of assignments ?? []) {
    if (!assignment.user_id || seen.has(assignment.user_id)) continue;
    seen.add(assignment.user_id);
    await recomputeUserBadgeOwnership({
      leagueId,
      userId: assignment.user_id,
      teamId: assignment.team_id ?? null,
      season,
      current: null,
    });
  }

  return { usersUpdated: seen.size };
}

async function loadTeamNames(teamIds: string[]): Promise<Map<string, string>> {
  if (!teamIds.length) return new Map();
  const { data } = await supabase
    .from("rec_teams")
    .select("id,name,display_abbr,abbreviation")
    .in("id", teamIds);
  const map = new Map<string, string>();
  for (const t of data ?? []) {
    map.set(t.id, (t.name as string) || (t.display_abbr as string) || (t.abbreviation as string) || "Team");
  }
  return map;
}

/**
 * Issues season-total badges (Winning Season, Ball Control Season, etc.) for
 * every active user in a league. Call this once when the league advances OUT of
 * the regular season (i.e. nextSeasonStage becomes "wild_card" or any playoff
 * stage). These badges are based on full-season totals and must not be issued
 * mid-season because the totals are still changing.
 */
export async function issueSeasonTotalBadges(leagueId: string, season: number): Promise<void> {
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (!assignments?.length) return;

  const now = new Date().toISOString();

  for (const { user_id: userId, team_id: teamId } of assignments) {
    const { data: rows } = await supabase
      .from("rec_team_game_stats")
      .select("*")
      .eq("league_id", leagueId)
      .eq("user_id", userId);

    if (!rows?.length) continue;

    const allGames = rows.map((r) => rowToGameStats(r as TeamGameStatsRow));
    const seasonGames = allGames.filter((g) => g.season === season);
    if (!seasonGames.length) continue;

    const seasonTotals = seasonTotalsFromGames(seasonGames);
    const qualified = qualifySeasonBadges(seasonTotals);
    if (!qualified.length) continue;

    const badgeRows = qualified.map((b) => ({
      league_id: leagueId,
      user_id: userId,
      team_id: teamId,
      badge_key: b.key,
      badge_scope: "season",
      tier: "normal",
      season,
      earned_count: 1,
      current_streak: 1,
      best_streak: 1,
      last_earned_week: null,
      active: true,
      updated_at: now,
    }));

    // Upsert so re-running at season end is safe and doesn't duplicate.
    await supabase
      .from("rec_badge_ownership")
      .upsert(badgeRows, { onConflict: "league_id,user_id,badge_key,badge_scope,season" })
      .then(({ error }) => {
        if (error) console.error("[ERROR] issueSeasonTotalBadges upsert failed:", error);
      });
  }
}
