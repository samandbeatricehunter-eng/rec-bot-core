// Import-time orchestration: runs after a box score is approved and its
// rec_team_game_stats rows are written. Computes game profiles, generates the
// game story, and recomputes the participants' weekly/season/global badges, then
// persists everything. Advance only READS these rows — it must not call this.
//
// Idempotent / re-import-safe: game-scoped derived rows (profile, story, events)
// are deleted before re-insert, and season/global badge progress is recomputed
// from the stored games rather than incremented, so re-uploading a corrected box
// score self-heals instead of double-counting.
//
// Badge recompute across a whole league (recomputeActiveLeagueBadgeBaselines,
// issueSeasonTotalBadges) is fully batched — one flat set of reads/writes for the
// whole league regardless of roster size, not one round-trip per coach. This
// matters at scale: a 100-league fleet firing per-coach queries on every advance
// would multiply badly under concurrent load.

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
  const leagueGame = await loadLeagueGame(sub.league_id);

  const { data: rows, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("submission_id", sub.id);
  if (error) throw error;
  if (!rows || rows.length === 0) return;

  const games = rows.map((r) => rowToGameStats(r as TeamGameStatsRow, leagueGame));
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
    const winnerBadges = qualifyWeeklyBadges(winner, leagueGame).map((b) => b.label);
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

  // Per-team profile + per-user badge recompute — both teams are independent, run in parallel.
  // (Only 2 teams per game, so this doesn't need the full-league batching below.)
  await Promise.all(games.map(async (g) => {
    if (gameId) {
      const profile = computeGameProfile(g, leagueGame);
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
    if (g.userId) await recomputeSingleUserBadges(g, leagueGame);
  }));
}

// ─── Pure badge computation (no I/O) — shared by the single-user and batch paths ──

type CareerRecordOverride = { wins: number; gamesPlayed: number; playoffWins: number; superBowlTitles: number };
type PreviousSeasonBadge = { badge_key: string; tier: string | null; earned_count: number; best_streak: number };

type UserBadgeComputeInput = {
  leagueId: string;
  userId: string;
  teamId: string | null;
  season: number;
  leagueGame: string;
  allGames: GameStats[];
  careerRecordOverride: CareerRecordOverride | null;
  previousSeasonBadges: Map<string, PreviousSeasonBadge>;
  /** Only set on the single-game path (processGameIntelligence) — drives the game-scoped weekly-badge-event audit row. */
  current?: GameStats | null;
};

type UserBadgeComputeResult = {
  weeklyRows: any[];
  seasonRows: any[];
  globalRows: any[];
  eventRows: any[];
};

function computeUserBadgeUpdate(input: UserBadgeComputeInput): UserBadgeComputeResult {
  const { leagueId, userId, teamId, season, leagueGame, allGames, careerRecordOverride, previousSeasonBadges, current } = input;
  const seasonGames = allGames.filter((g) => g.season === season);
  const now = new Date().toISOString();

  let careerTotals = careerTotalsFromGames(allGames);
  if (careerRecordOverride) {
    careerTotals = {
      ...careerTotals,
      wins: Math.max(careerTotals.wins, careerRecordOverride.wins),
      gamesPlayed: Math.max(careerTotals.gamesPlayed, careerRecordOverride.gamesPlayed),
      playoffWins: Math.max(careerTotals.playoffWins, careerRecordOverride.playoffWins),
      superBowlTitles: Math.max(careerTotals.superBowlTitles, careerRecordOverride.superBowlTitles),
    };
  }

  const streaks = weeklyStreaks(seasonGames, leagueGame);

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
  const globalRows = qualifyGlobalBadges(careerTotals, leagueGame).map((b) => ({
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

  const eventRows: any[] = [];

  const newXfRows = seasonRows.filter((row) => {
    if (row.tier !== "xf") return false;
    const previous = previousSeasonBadges.get(row.badge_key);
    return previous?.tier !== "xf";
  });
  eventRows.push(...newXfRows.map((row) => ({
    league_id: leagueId,
    user_id: userId,
    team_id: teamId,
    badge_key: row.badge_key,
    badge_scope: "season",
    tier: "xf",
    season,
    week: row.last_earned_week,
    game_id: current?.gameId ?? null,
    reason: `XF season badge earned: ${row.earned_count} total earns this season`,
    stats_snapshot: {
      earnedCount: row.earned_count,
      currentStreak: row.current_streak,
      bestStreak: row.best_streak,
      lastEarnedWeek: row.last_earned_week,
    },
  })));

  // Audit: weekly badges earned in THIS game (game-scoped, re-import-safe).
  const earnedThisGame = current ? qualifyWeeklyBadges(current, leagueGame) : [];
  if (current?.gameId && earnedThisGame.length) {
    eventRows.push(...earnedThisGame.map((b) => ({
      league_id: leagueId,
      user_id: userId,
      team_id: teamId,
      badge_key: b.key,
      badge_scope: "weekly",
      tier: getWeeklyTier(streaks.find((s) => s.badgeKey === b.key)?.currentStreak ?? 1),
      season,
      week: current?.week,
      game_id: current?.gameId,
      reason: "Weekly badge earned",
      stats_snapshot: {
        pointsFor: current?.pointsFor,
        pointsAgainst: current?.pointsAgainst,
        passingYards: current?.passingYards,
        rushingYards: current?.rushingYards,
      },
    })));
  }

  return { weeklyRows, seasonRows, globalRows, eventRows };
}

// ─── Single-user path (called per-team from processGameIntelligence) ─────────────

async function recomputeSingleUserBadges(current: GameStats, leagueGame: string): Promise<void> {
  const leagueId = current.leagueId;
  const userId = current.userId!;
  const season = current.season;

  const [statsResult, recordResult, previousSeasonResult] = await Promise.all([
    supabase.from("rec_team_game_stats").select("*").eq("league_id", leagueId).eq("user_id", userId),
    supabase.from("rec_global_user_game_records").select("wins,games_played,playoff_wins,superbowl_wins").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
    supabase.from("rec_badge_ownership").select("badge_key,tier,earned_count,best_streak").eq("league_id", leagueId).eq("user_id", userId).eq("season", season).eq("badge_scope", "season"),
  ]);
  if (statsResult.error) throw statsResult.error;
  if (previousSeasonResult.error) throw previousSeasonResult.error;

  const allGames = (statsResult.data ?? []).map((r) => rowToGameStats(r as TeamGameStatsRow, leagueGame));
  const careerRecordOverride = toCareerRecordOverride(recordResult.data);
  const previousSeasonBadges = new Map((previousSeasonResult.data ?? []).map((row) => [row.badge_key, row as PreviousSeasonBadge]));

  const result = computeUserBadgeUpdate({
    leagueId, userId, teamId: current.teamId, season, leagueGame, allGames, careerRecordOverride, previousSeasonBadges, current,
  });

  await writeBadgeUpdates(leagueId, season, [userId], result.weeklyRows, result.seasonRows, result.globalRows, result.eventRows);
}

function toCareerRecordOverride(record: { wins?: unknown; games_played?: unknown; playoff_wins?: unknown; superbowl_wins?: unknown } | null | undefined): CareerRecordOverride | null {
  if (!record) return null;
  return {
    wins: Number(record.wins ?? 0),
    gamesPlayed: Number(record.games_played ?? 0),
    playoffWins: Number(record.playoff_wins ?? 0),
    superBowlTitles: Number(record.superbowl_wins ?? 0),
  };
}

// Replace the given users' weekly+season (this season) and global badge ownership
// rows, then insert the freshly computed set, plus any new badge-event audit rows.
async function writeBadgeUpdates(leagueId: string, season: number, userIds: string[], weeklyRows: any[], seasonRows: any[], globalRows: any[], eventRows: any[]): Promise<void> {
  await Promise.all([
    supabase.from("rec_badge_ownership").delete().eq("league_id", leagueId).eq("season", season).in("badge_scope", ["weekly", "season"]).in("user_id", userIds),
    supabase.from("rec_badge_ownership").delete().eq("league_id", leagueId).is("season", null).eq("badge_scope", "global").in("user_id", userIds),
  ]);
  const ownership = [...weeklyRows, ...seasonRows, ...globalRows];
  if (ownership.length) {
    const { error: insErr } = await supabase.from("rec_badge_ownership").insert(ownership);
    if (insErr) throw insErr;
  }
  if (eventRows.length) {
    const { error: eventErr } = await supabase.from("rec_badge_events").insert(eventRows);
    if (eventErr) throw eventErr;
  }
}

async function loadLeagueGame(leagueId: string): Promise<string> {
  const leagueResult = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
  return String(leagueResult.data?.game ?? "madden_26");
}

/**
 * Madden-only: the team with the best regular-season record in each conference/division
 * (rec_teams.conference + division, e.g. "AFC North") is that division's champion.
 * CFB has no equivalent sub-conference division structure, so callers should skip this
 * entirely for CFB leagues (the division_champion badge itself is also Madden-only).
 * Ties broken by point differential, then fewer losses.
 */
async function computeDivisionChampions(leagueId: string, season: number): Promise<Set<string>> {
  const [teamsRes, resultsRes] = await Promise.all([
    supabase.from("rec_teams").select("id,conference,division").eq("league_id", leagueId),
    supabase
      .from("rec_game_results")
      .select("home_team_id,away_team_id,winning_team_id,is_tie,home_score,away_score")
      .eq("league_id", leagueId)
      .eq("season_number", season)
      .eq("is_playoff", false),
  ]);
  if (teamsRes.error || resultsRes.error || !teamsRes.data?.length) return new Set();

  type Standing = { wins: number; losses: number; ties: number; pointDiff: number };
  const standings = new Map<string, Standing>();
  const get = (teamId: string) => {
    let s = standings.get(teamId);
    if (!s) { s = { wins: 0, losses: 0, ties: 0, pointDiff: 0 }; standings.set(teamId, s); }
    return s;
  };
  for (const row of resultsRes.data ?? []) {
    const home = row.home_team_id, away = row.away_team_id;
    const homeScore = Number(row.home_score ?? 0), awayScore = Number(row.away_score ?? 0);
    if (home) get(home).pointDiff += homeScore - awayScore;
    if (away) get(away).pointDiff += awayScore - homeScore;
    if (row.is_tie) {
      if (home) get(home).ties++;
      if (away) get(away).ties++;
      continue;
    }
    if (row.winning_team_id === home && home) get(home).wins++;
    else if (home) get(home).losses++;
    if (row.winning_team_id === away && away) get(away).wins++;
    else if (away) get(away).losses++;
  }

  const byDivision = new Map<string, { teamId: string; standing: Standing }[]>();
  for (const team of teamsRes.data ?? []) {
    if (!team.conference || !team.division) continue;
    const key = `${team.conference}:${team.division}`;
    const list = byDivision.get(key) ?? [];
    list.push({ teamId: team.id, standing: standings.get(team.id) ?? { wins: 0, losses: 0, ties: 0, pointDiff: 0 } });
    byDivision.set(key, list);
  }

  const champions = new Set<string>();
  for (const teams of byDivision.values()) {
    if (!teams.length) continue;
    const best = teams.reduce((top, cur) =>
      cur.standing.wins !== top.standing.wins ? (cur.standing.wins > top.standing.wins ? cur : top)
      : cur.standing.pointDiff !== top.standing.pointDiff ? (cur.standing.pointDiff > top.standing.pointDiff ? cur : top)
      : cur.standing.losses < top.standing.losses ? cur : top
    );
    champions.add(best.teamId);
  }
  return champions;
}

// ─── Whole-league batch recompute (advance / catch-up) ────────────────────────────
// One flat set of reads and writes for the entire league's roster, instead of one
// round-trip per coach — this is the hot path on every advance, so it needs to stay
// O(1) queries per league regardless of roster size.

export async function recomputeActiveLeagueBadgeBaselines(leagueId: string, season: number): Promise<{ usersUpdated: number }> {
  const { data: assignments, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;

  const seen = new Set<string>();
  const uniqueAssignments = (assignments ?? []).filter((assignment) => {
    if (!assignment.user_id || seen.has(assignment.user_id)) return false;
    seen.add(assignment.user_id);
    return true;
  });
  if (!uniqueAssignments.length) return { usersUpdated: 0 };

  const userIds = uniqueAssignments.map((a) => a.user_id!);
  const leagueGame = await loadLeagueGame(leagueId);

  const [statsResult, recordsResult, previousSeasonResult] = await Promise.all([
    supabase.from("rec_team_game_stats").select("*").eq("league_id", leagueId).in("user_id", userIds),
    supabase.from("rec_global_user_game_records").select("user_id,wins,games_played,playoff_wins,superbowl_wins").in("user_id", userIds).eq("game", leagueGame),
    supabase.from("rec_badge_ownership").select("user_id,badge_key,tier,earned_count,best_streak").eq("league_id", leagueId).in("user_id", userIds).eq("season", season).eq("badge_scope", "season"),
  ]);
  if (statsResult.error) throw statsResult.error;
  if (recordsResult.error) throw recordsResult.error;
  if (previousSeasonResult.error) throw previousSeasonResult.error;

  const gamesByUser = new Map<string, GameStats[]>();
  for (const row of statsResult.data ?? []) {
    const g = rowToGameStats(row as TeamGameStatsRow, leagueGame);
    if (!g.userId) continue;
    const list = gamesByUser.get(g.userId) ?? [];
    list.push(g);
    gamesByUser.set(g.userId, list);
  }
  const recordByUser = new Map((recordsResult.data ?? []).map((row) => [row.user_id, toCareerRecordOverride(row)]));
  const previousSeasonByUser = new Map<string, Map<string, PreviousSeasonBadge>>();
  for (const row of previousSeasonResult.data ?? []) {
    const m = previousSeasonByUser.get(row.user_id) ?? new Map<string, PreviousSeasonBadge>();
    m.set(row.badge_key, row as PreviousSeasonBadge);
    previousSeasonByUser.set(row.user_id, m);
  }

  const allWeekly: any[] = [];
  const allSeason: any[] = [];
  const allGlobal: any[] = [];
  const allEvents: any[] = [];
  for (const { user_id: userId, team_id: teamId } of uniqueAssignments) {
    const result = computeUserBadgeUpdate({
      leagueId,
      userId: userId!,
      teamId: teamId ?? null,
      season,
      leagueGame,
      allGames: gamesByUser.get(userId!) ?? [],
      careerRecordOverride: recordByUser.get(userId!) ?? null,
      previousSeasonBadges: previousSeasonByUser.get(userId!) ?? new Map(),
      current: null,
    });
    allWeekly.push(...result.weeklyRows);
    allSeason.push(...result.seasonRows);
    allGlobal.push(...result.globalRows);
    allEvents.push(...result.eventRows);
  }

  await writeBadgeUpdates(leagueId, season, userIds, allWeekly, allSeason, allGlobal, allEvents);

  return { usersUpdated: uniqueAssignments.length };
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
 * the regular season (i.e. nextSeasonStage becomes "wild_card"/"cfp_first_round"
 * or any playoff stage). These badges are based on full-season totals and must
 * not be issued mid-season because the totals are still changing.
 *
 * Batched: one stats read for the whole roster, one upsert for all qualifying
 * badges, instead of one read per coach.
 */
export async function issueSeasonTotalBadges(leagueId: string, season: number): Promise<void> {
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (!assignments?.length) return;

  const userIds = [...new Set(assignments.map((a) => a.user_id).filter((id): id is string => Boolean(id)))];
  const now = new Date().toISOString();
  const leagueGame = await loadLeagueGame(leagueId);
  const divisionChampionTeamIds = leagueGame === "cfb_27" ? new Set<string>() : await computeDivisionChampions(leagueId, season);

  const { data: statsRows, error: statsError } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .in("user_id", userIds);
  if (statsError) {
    console.error("[ERROR] issueSeasonTotalBadges: failed to load stats:", statsError);
    return;
  }

  const gamesByUser = new Map<string, GameStats[]>();
  for (const row of statsRows ?? []) {
    const g = rowToGameStats(row as TeamGameStatsRow, leagueGame);
    if (!g.userId) continue;
    const list = gamesByUser.get(g.userId) ?? [];
    list.push(g);
    gamesByUser.set(g.userId, list);
  }

  const badgeRows: any[] = [];
  for (const { user_id: userId, team_id: teamId } of assignments) {
    if (!userId) continue;
    const seasonGames = (gamesByUser.get(userId) ?? []).filter((g) => g.season === season);
    if (!seasonGames.length) continue;
    const seasonTotals = { ...seasonTotalsFromGames(seasonGames), wonDivision: divisionChampionTeamIds.has(teamId) };
    const qualified = qualifySeasonBadges(seasonTotals, leagueGame);
    if (!qualified.length) continue;
    badgeRows.push(...qualified.map((b) => ({
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
    })));
  }

  if (!badgeRows.length) return;
  // Upsert so re-running at season end is safe and doesn't duplicate.
  const { error } = await supabase
    .from("rec_badge_ownership")
    .upsert(badgeRows, { onConflict: "league_id,user_id,badge_key,badge_scope,season" });
  if (error) console.error("[ERROR] issueSeasonTotalBadges upsert failed:", error);
}
