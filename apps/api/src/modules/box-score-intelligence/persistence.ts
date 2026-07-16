// @ts-nocheck
// Import-time orchestration: runs after a box score is approved and its
// rec_team_game_stats rows are written. Computes game profiles, generates the
// game story, and recomputes the participants' game/season/career badges, then
// persists everything. Advance only READS these rows — it must not call this.
//
// Idempotent / re-import-safe: game-scoped derived rows (profile, story, events)
// are deleted before re-insert, and game/season/career badge progress is
// recomputed from the stored games rather than incremented, so re-uploading a
// corrected box score self-heals instead of double-counting.
//
// Badge recompute across a whole league (recomputeActiveLeagueBadgeBaselines,
// issueSeasonTotalBadges) is fully batched — one flat set of reads/writes for the
// whole league regardless of roster size, not one round-trip per coach.
//
// Three independent badge tracks (see badge-rules.ts):
//   game    — per-game personality/performance badges, tiered by this season's
//             occurrence count (no streak tracking — just a tally).
//   season  — per-season cumulative-total badges, always tier "normal".
//   career  — all-time cumulative-total badges (never reset), including the
//             ladder badges (wins/games/yardage milestones) that grade into
//             bronze/silver/gold at the highest threshold crossed.
// There is no career-trophy conversion step anymore — career badges are always
// live/continuous, so nothing needs to be "converted" at season end.

import { isCfb } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { seasonTotalsFromGames, careerTotalsFromGames, gameBadgeOccurrences } from "./aggregate.js";
import {
  qualifyCareerBadges,
  qualifyGameBadges,
  qualifyLadderBadges,
  qualifySeasonBadges,
  tierForOccurrenceCount,
} from "./badge-rules.js";
import { computeGameProfile, rowToGameStats, type TeamGameStatsRow } from "./game-profile.js";
import { generateGameStory } from "./story-angles.js";
import { buildRoundtableDiscussion } from "../hub/roundtable.js";
import { type CareerTotals, type GameStats, type SeasonTotals } from "./types.js";

/** The box-score submission row (rec_box_score_submissions). Loosely typed — only a few fields are read. */
type SubmissionRow = {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  game_id: string | null;
};

type PerformanceTagRow = {
  team_id: string;
  subject_type: "player" | "unit";
  watched_player_id: string | null;
  unit: string | null;
  stat_lines: Array<{ statKey: string; label: string; value: number }>;
  performance_grade: "standout" | "solid" | "neutral" | "poor";
};

// Turns commissioner-entered player/unit performance tags into roundtable notes, and — for
// a standout player tag on the winning team with a real stat line — a sharper, named
// headline in place of the generic angle-based one. Leaves the 20-angle scoring system
// (story-angles.ts) as the untouched fallback for the common case where no tags exist yet.
async function loadPerformanceTagNotes(gameId: string, winnerTeamId: string | null): Promise<{ notes: string[]; headline: string | null }> {
  const tagsResult = await supabase.from("rec_game_performance_tags").select("team_id,subject_type,watched_player_id,unit,stat_lines,performance_grade").eq("game_id", gameId);
  if (tagsResult.error || !tagsResult.data?.length) return { notes: [], headline: null };
  const tags = tagsResult.data as PerformanceTagRow[];

  const playerIds = [...new Set(tags.filter((tag) => tag.subject_type === "player" && tag.watched_player_id).map((tag) => tag.watched_player_id!))];
  const playersResult = playerIds.length
    ? await supabase.from("rec_watched_players").select("id,player_name,position,class_year").in("id", playerIds)
    : { data: [] as any[] };
  const playerById = new Map((playersResult.data ?? []).map((row: any) => [row.id, row]));

  const notes: string[] = [];
  let bestStandout: { text: string; magnitude: number } | null = null;

  for (const tag of tags) {
    if (tag.subject_type === "player" && tag.watched_player_id) {
      const player = playerById.get(tag.watched_player_id);
      if (!player) continue;
      const classLabel = player.class_year ? `${player.class_year} ` : "";
      const statText = (tag.stat_lines ?? []).map((line) => `${line.value} ${line.label.toLowerCase()}`).join(", ");
      const gradeWord = tag.performance_grade === "standout" ? "stood out" : tag.performance_grade === "poor" ? "struggled" : null;
      const sentence = statText
        ? `${classLabel}${player.position} ${player.player_name} posted ${statText}${gradeWord ? ` and ${gradeWord}` : ""}.`
        : gradeWord ? `${classLabel}${player.position} ${player.player_name} ${gradeWord} this week.` : null;
      if (sentence) notes.push(sentence);
      if (tag.performance_grade === "standout" && tag.stat_lines?.length && tag.team_id === winnerTeamId) {
        const magnitude = Math.max(...tag.stat_lines.map((line) => Number(line.value) || 0));
        const headlineText = `${classLabel}${player.position} ${player.player_name} Shines With ${tag.stat_lines[0].value} ${tag.stat_lines[0].label}`;
        if (!bestStandout || magnitude > bestStandout.magnitude) bestStandout = { text: headlineText, magnitude };
      }
    } else if (tag.subject_type === "unit" && tag.unit) {
      const unitLabel = tag.unit.replace("_", " ");
      const gradeWord = tag.performance_grade === "standout" || tag.performance_grade === "solid" ? "had a strong showing" : tag.performance_grade === "poor" ? "had a rough night" : null;
      if (gradeWord) notes.push(`The ${unitLabel} unit ${gradeWord}.`);
    }
  }

  return { notes, headline: bestStandout?.text ?? null };
}

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
    const winnerBadges = qualifyGameBadges(winner, leagueGame).filter((b) => b.polarity === "positive").map((b) => b.label);
    const story = generateGameStory(
      {
        winner,
        loser,
        winnerName: nameById.get(winner.teamId ?? "") ?? "Home",
        loserName: nameById.get(loser.teamId ?? "") ?? "Away",
      },
      winnerBadges,
    );
    const performanceNotes = await loadPerformanceTagNotes(gameId, winner.teamId ?? null);
    await supabase.from("rec_game_stories").insert({
      league_id: sub.league_id,
      season: sub.season_number,
      week: sub.week_number,
      game_id: gameId,
      winner_team_id: winner.teamId,
      loser_team_id: loser.teamId,
      primary_angle: story.primaryAngle,
      headline: performanceNotes.headline ?? story.headline,
      body: story.body,
      notes: story.notes,
      story_type: "game_article",
      roundtable: buildRoundtableDiscussion({ headline: story.headline, body: story.body, notes: [...story.notes, ...performanceNotes.notes] }),
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

type CareerRecordOverride = { wins: number; gamesPlayed: number; playoffWins: number; championships: number };
type UserBadgeComputeInput = {
  leagueId: string;
  userId: string;
  teamId: string | null;
  season: number;
  leagueGame: string;
  allGames: GameStats[];
  careerRecordOverride: CareerRecordOverride | null;
  /** Only set on the single-game path (processGameIntelligence) — drives the game-scoped badge-event audit row. */
  current?: GameStats | null;
};

type UserBadgeComputeResult = {
  gameRows: any[];
  seasonRows: any[];
  careerRows: any[];
  eventRows: any[];
};

function computeUserBadgeUpdate(input: UserBadgeComputeInput): UserBadgeComputeResult {
  const { leagueId, userId, teamId, season, leagueGame, allGames, careerRecordOverride, current } = input;
  const seasonGames = allGames.filter((g) => g.season === season);
  const now = new Date().toISOString();

  let careerTotals = careerTotalsFromGames(allGames);
  if (careerRecordOverride) {
    careerTotals = {
      ...careerTotals,
      wins: Math.max(careerTotals.wins, careerRecordOverride.wins),
      gamesPlayed: Math.max(careerTotals.gamesPlayed, careerRecordOverride.gamesPlayed),
      playoffWins: Math.max(careerTotals.playoffWins, careerRecordOverride.playoffWins),
      championships: Math.max(careerTotals.championships, careerRecordOverride.championships),
    };
  }

  // Game-scope: one row per badge this user has earned at least once this season,
  // tiered purely by how many times (no streaks).
  const occurrences = gameBadgeOccurrences(seasonGames, leagueGame);
  const polarityByKey = new Map<string, "positive" | "negative">();
  for (const g of seasonGames) for (const b of qualifyGameBadges(g, leagueGame)) polarityByKey.set(b.key, b.polarity);

  const gameRows = occurrences.map((o) => {
    const polarity = polarityByKey.get(o.badgeKey) ?? "positive";
    return {
      league_id: leagueId,
      user_id: userId,
      team_id: teamId,
      badge_key: o.badgeKey,
      badge_scope: "game",
      polarity,
      tier: tierForOccurrenceCount(o.earnedCount, polarity),
      season,
      week: null,
      earned_count: o.earnedCount,
      last_earned_week: o.lastEarnedWeek,
      updated_at: now,
    };
  });

  // Season-scope: qualified straight from this season's cumulative totals, tier always "normal".
  const seasonTotals = seasonTotalsFromGames(seasonGames);
  const seasonRows = qualifySeasonBadges(seasonTotals, leagueGame).map((b) => ({
    league_id: leagueId,
    user_id: userId,
    team_id: teamId,
    badge_key: b.key,
    badge_scope: "season",
    polarity: b.polarity,
    tier: "normal",
    season,
    week: null,
    earned_count: 1,
    last_earned_week: null,
    updated_at: now,
  }));

  // Career-scope: simple boolean/threshold badges (tier "normal") + graded ladder badges.
  const careerRows = [
    ...qualifyCareerBadges(careerTotals, leagueGame).map((b) => ({
      league_id: leagueId, user_id: userId, team_id: teamId, badge_key: b.key, badge_scope: "career",
      polarity: b.polarity, tier: "normal", season: null, week: null, earned_count: 1, last_earned_week: null, updated_at: now,
    })),
    ...qualifyLadderBadges(careerTotals, leagueGame).map((b) => ({
      league_id: leagueId, user_id: userId, team_id: teamId, badge_key: b.key, badge_scope: "career",
      polarity: "positive", tier: b.tier, season: null, week: null, earned_count: 1, last_earned_week: null, updated_at: now,
    })),
  ];

  // Audit trail + badge-bonus economy: log one event per POSITIVE game-scope badge
  // actually earned in THIS game (box-score.service.ts's issueBadgeBonusesForSubmission
  // pays a real cash bonus per event row here — negative badges must never generate
  // one). Only meaningful on the single-game import path (current is set); the
  // whole-league batch recompute path never fires this (current is null there).
  const eventRows: any[] = [];
  if (current?.gameId) {
    const tierByKey = new Map(gameRows.map((row) => [row.badge_key, row.tier]));
    for (const badge of qualifyGameBadges(current, leagueGame)) {
      if (badge.polarity !== "positive") continue;
      eventRows.push({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        badge_key: badge.key,
        badge_scope: "game",
        tier: tierByKey.get(badge.key) ?? "normal",
        season,
        week: current.week,
        game_id: current.gameId,
        reason: "Game badge earned",
        stats_snapshot: { pointsFor: current.pointsFor, pointsAgainst: current.pointsAgainst, passingYards: current.passingYards, rushingYards: current.rushingYards },
      });
    }
  }

  return { gameRows, seasonRows, careerRows, eventRows };
}

// ─── Single-user path (called per-team from processGameIntelligence) ─────────────

async function recomputeSingleUserBadges(current: GameStats, leagueGame: string): Promise<void> {
  const leagueId = current.leagueId;
  const userId = current.userId!;
  const season = current.season;

  const [statsResult, recordResult] = await Promise.all([
    supabase.from("rec_team_game_stats").select("*").eq("league_id", leagueId).eq("user_id", userId),
    supabase.from("rec_global_user_game_records").select("wins,games_played,playoff_wins,superbowl_wins").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
  ]);
  if (statsResult.error) throw statsResult.error;

  const allGames = (statsResult.data ?? []).map((r) => rowToGameStats(r as TeamGameStatsRow, leagueGame));
  const careerRecordOverride = toCareerRecordOverride(recordResult.data);

  const result = computeUserBadgeUpdate({
    leagueId, userId, teamId: current.teamId, season, leagueGame, allGames, careerRecordOverride, current,
  });

  await writeBadgeUpdates(leagueId, season, [userId], result.gameRows, result.seasonRows, result.careerRows, result.eventRows);
}

function toCareerRecordOverride(record: { wins?: unknown; games_played?: unknown; playoff_wins?: unknown; superbowl_wins?: unknown } | null | undefined): CareerRecordOverride | null {
  if (!record) return null;
  return {
    wins: Number(record.wins ?? 0),
    gamesPlayed: Number(record.games_played ?? 0),
    playoffWins: Number(record.playoff_wins ?? 0),
    championships: Number(record.superbowl_wins ?? 0),
  };
}

// Replace the given users' game+season (this season) and career badge ownership
// rows, then insert the freshly computed set, plus any new badge-event audit rows.
async function writeBadgeUpdates(leagueId: string, season: number, userIds: string[], gameRows: any[], seasonRows: any[], careerRows: any[], eventRows: any[]): Promise<void> {
  await Promise.all([
    supabase.from("rec_badge_ownership").delete().eq("league_id", leagueId).eq("season", season).in("badge_scope", ["game", "season"]).in("user_id", userIds),
    supabase.from("rec_badge_ownership").delete().eq("league_id", leagueId).is("season", null).eq("badge_scope", "career").in("user_id", userIds),
  ]);
  const ownership = [...gameRows, ...seasonRows, ...careerRows];
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

  const [statsResult, recordsResult] = await Promise.all([
    supabase.from("rec_team_game_stats").select("*").eq("league_id", leagueId).in("user_id", userIds),
    supabase.from("rec_global_user_game_records").select("user_id,wins,games_played,playoff_wins,superbowl_wins").in("user_id", userIds).eq("game", leagueGame),
  ]);
  if (statsResult.error) throw statsResult.error;
  if (recordsResult.error) throw recordsResult.error;

  const gamesByUser = new Map<string, GameStats[]>();
  for (const row of statsResult.data ?? []) {
    const g = rowToGameStats(row as TeamGameStatsRow, leagueGame);
    if (!g.userId) continue;
    const list = gamesByUser.get(g.userId) ?? [];
    list.push(g);
    gamesByUser.set(g.userId, list);
  }
  const recordByUser = new Map((recordsResult.data ?? []).map((row) => [row.user_id, toCareerRecordOverride(row)]));

  const allGame: any[] = [];
  const allSeason: any[] = [];
  const allCareer: any[] = [];
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
      current: null,
    });
    allGame.push(...result.gameRows);
    allSeason.push(...result.seasonRows);
    allCareer.push(...result.careerRows);
    allEvents.push(...result.eventRows);
  }

  await writeBadgeUpdates(leagueId, season, userIds, allGame, allSeason, allCareer, allEvents);

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
 * Issues season-total badges (Prolific Passer, Perfect Regular Season, etc.) plus
 * the "Reigning ___" badges (which depend on whether this user won the relevant
 * game in the PRIOR season) for every active user in a league. Call this once when
 * the league advances OUT of the regular season (i.e. nextSeasonStage becomes a
 * playoff/CFP stage). These are based on full-season totals and must not be issued
 * mid-season because the totals are still changing.
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
  const cfb = isCfb(leagueGame);

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
    const games = gamesByUser.get(userId) ?? [];
    const seasonGames = games.filter((g) => g.season === season);
    const priorSeasonGames = games.filter((g) => g.season === season - 1);
    if (!seasonGames.length) continue;

    const seasonTotals = seasonTotalsFromGames(seasonGames);
    const qualified = qualifySeasonBadges(seasonTotals, leagueGame);
    const reigning = reigningChampionBadges(priorSeasonGames.length ? seasonTotalsFromGames(priorSeasonGames) : null, cfb);

    for (const b of [...qualified, ...reigning]) {
      badgeRows.push({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        badge_key: b.key,
        badge_scope: "season",
        polarity: "positive",
        tier: "normal",
        season,
        week: null,
        earned_count: 1,
        last_earned_week: null,
        updated_at: now,
      });
    }
  }

  if (!badgeRows.length) return;
  // Upsert so re-running at season end is safe and doesn't duplicate.
  const { error } = await supabase
    .from("rec_badge_ownership")
    .upsert(badgeRows, { onConflict: "league_id,user_id,badge_key,badge_scope,season" });
  if (error) console.error("[ERROR] issueSeasonTotalBadges upsert failed:", error);
}

/** "Reigning ___" badges — earned for the season right after winning the relevant game. */
function reigningChampionBadges(priorSeason: SeasonTotals | null, cfb: boolean): Array<{ key: string; label: string }> {
  if (!priorSeason) return [];
  if (cfb) {
    const out: Array<{ key: string; label: string }> = [];
    if (priorSeason.wonChampionship) out.push({ key: "national_champion", label: "Reigning National Champ" });
    if (priorSeason.wonAnyBowlGame) out.push({ key: "bowl_winner", label: "Won Bowl Game" });
    return out;
  }
  const out: Array<{ key: string; label: string }> = [];
  if (priorSeason.wonChampionship) out.push({ key: "super_bowl_champion", label: "Reigning SB Champ" });
  if (priorSeason.wonConferenceChampionship) out.push({ key: "conf_champion", label: "Reigning Conference Champ" });
  if (priorSeason.wonDivisionalRound) out.push({ key: "div_champion", label: "Divisional Round Winner" });
  return out;
}
