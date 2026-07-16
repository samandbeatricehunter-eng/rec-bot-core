// Coach Rating (team performance: win%, point differential, strength of schedule,
// playoff/bowl success) and User Rating (individual skill: per-game stat efficiency
// + badge quality mix) — two independent 0-100 scores. Coach Rating answers "is this
// team winning, against what schedule"; User Rating answers "is this coach playing
// well," on purpose decoupled from the team's win/loss record. Madden displays the
// raw number; CFB converts the same 0-100 scale to a letter grade (this feature's
// original ask was "numeric for Madden, letter grade for CFB").
import { isCfb } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { computeLeagueSos } from "../schedule/sos.service.js";
import { rowToGameStats, type TeamGameStatsRow } from "../box-score-intelligence/game-profile.js";
import { seasonTotalsFromGames } from "../box-score-intelligence/aggregate.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 1) => { const f = 10 ** p; return Math.round(n * f) / f; };

export function letterGradeForRating(rating: number): string {
  if (rating >= 97) return "A+";
  if (rating >= 93) return "A";
  if (rating >= 90) return "A-";
  if (rating >= 87) return "B+";
  if (rating >= 83) return "B";
  if (rating >= 80) return "B-";
  if (rating >= 77) return "C+";
  if (rating >= 73) return "C";
  if (rating >= 70) return "C-";
  if (rating >= 67) return "D+";
  if (rating >= 63) return "D";
  if (rating >= 60) return "D-";
  return "F";
}

function teamDisplayName(t: any): string {
  if (t?.is_relocated && (t.display_city || t.display_nick)) {
    return `${t.display_city ?? ""} ${t.display_nick ?? ""}`.trim() || (t.name ?? "Team");
  }
  return t?.name ?? "Team";
}

type TeamAgg = {
  wins: number; losses: number; ties: number; pf: number; pa: number; scored: number;
  madePlayoffs: boolean; playoffWins: number; wonBowlOrRing: boolean;
};
const emptyAgg = (): TeamAgg => ({ wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, scored: 0, madePlayoffs: false, playoffWins: 0, wonBowlOrRing: false });

async function aggregateTeamResults(leagueId: string, seasonNumber: number): Promise<Map<string, TeamAgg>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,is_playoff,is_super_bowl")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "Failed to load results for Coach Rating.", error);

  const map = new Map<string, TeamAgg>();
  const get = (id: string) => { let a = map.get(id); if (!a) { a = emptyAgg(); map.set(id, a); } return a; };
  for (const g of data ?? []) {
    const { home_team_id: h, away_team_id: a, home_score: hs, away_score: as_, winning_team_id: w, losing_team_id: l, is_tie, is_playoff, is_super_bowl } = g as any;
    for (const teamId of [h, a] as (string | null)[]) {
      if (!teamId) continue;
      const t = get(teamId);
      if (is_tie) t.ties++;
      else if (w === teamId) { t.wins++; if (is_playoff) t.playoffWins++; if (is_super_bowl) t.wonBowlOrRing = true; }
      else if (l === teamId) t.losses++;
      if (is_playoff) t.madePlayoffs = true;
      if (hs != null && as_ != null) {
        const pf = teamId === h ? hs : as_;
        const pa = teamId === h ? as_ : hs;
        t.pf += pf; t.pa += pa; t.scored++;
      }
    }
  }
  return map;
}

export type CoachRatingRow = {
  teamId: string;
  teamName: string;
  abbr: string | null;
  isHuman: boolean;
  userId: string | null;
  rank: number;
  rating: number;
  grade: string;
  record: string;
  sos: number;
  madePlayoffs: boolean;
};

/**
 * rating = 50 (baseline .500 team) + up to ±30 for win%, ±15 for point differential,
 * ±20 for strength of schedule (rewards a tough slate, penalizes a soft one — this is
 * intentionally separate credit from win%, not a multiplier on it), + up to 25 for
 * playoff success (made playoffs, each playoff win, winning the title game).
 */
export async function computeCoachRatings(guildId: string, viewerDiscordId?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const game = context.rec_leagues.game;

  const [aggs, sos, teamsRes, assignmentsRes] = await Promise.all([
    aggregateTeamResults(leagueId, seasonNumber),
    computeLeagueSos(guildId, viewerDiscordId).catch(() => null),
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
  ]);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for Coach Rating.", teamsRes.error);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load assignments for Coach Rating.", assignmentsRes.error);

  const humanTeamIds = new Set((assignmentsRes.data ?? []).map((r: any) => r.team_id).filter(Boolean));
  const userIdByTeam = new Map<string, string>((assignmentsRes.data ?? []).map((r: any): [string, string] => [r.team_id, r.user_id]));
  const sosByTeam = new Map((sos?.teams ?? []).map((t) => [t.teamId, t.sosFull]));

  const rows: CoachRatingRow[] = (teamsRes.data ?? [])
    .filter((t: any) => humanTeamIds.has(t.id))
    .map((t: any) => {
      const a = aggs.get(t.id) ?? emptyAgg();
      const gp = a.wins + a.losses + a.ties;
      const winPct = gp > 0 ? (a.wins + 0.5 * a.ties) / gp : 0.5;
      const avgPd = a.scored > 0 ? (a.pf - a.pa) / a.scored : 0;
      const normPd = clamp(avgPd / 14, -1, 1);
      const sosFull = sosByTeam.get(t.id) ?? 1;
      const sosAdj = clamp(sosFull - 1, -0.5, 0.5);
      let bonus = a.playoffWins * 5 + (a.madePlayoffs ? 5 : 0) + (a.wonBowlOrRing ? 10 : 0);
      bonus = clamp(bonus, 0, 25);
      const rating = clamp(50 + 30 * (winPct - 0.5) * 2 + 15 * normPd + 20 * sosAdj * 2 + bonus, 0, 100);
      return {
        teamId: t.id,
        teamName: teamDisplayName(t),
        abbr: t.display_abbr ?? t.abbreviation ?? null,
        isHuman: true,
        userId: userIdByTeam.get(t.id) ?? null,
        rank: 0,
        rating: round(rating, 1),
        grade: letterGradeForRating(rating),
        record: a.ties > 0 ? `${a.wins}-${a.losses}-${a.ties}` : `${a.wins}-${a.losses}`,
        sos: round(sosFull, 2),
        madePlayoffs: a.madePlayoffs,
      };
    });

  rows.sort((x, y) => y.rating - x.rating || x.teamName.localeCompare(y.teamName));
  rows.forEach((r, i) => { r.rank = i + 1; });

  let viewerTeamId: string | null = null;
  if (viewerDiscordId) {
    const acct = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", viewerDiscordId).maybeSingle();
    const userId = acct.data?.user_id ?? null;
    if (userId) {
      for (const [teamId, uId] of userIdByTeam.entries()) {
        if (uId === userId) { viewerTeamId = teamId; break; }
      }
    }
  }

  return { displayAsGrade: isCfb(game), viewerTeamId, teams: rows };
}

export type UserRatingRow = {
  userId: string;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
  rank: number;
  rating: number;
  grade: string;
  statScore: number;
  badgeScore: number;
};

const BADGE_TIER_WEIGHT: Record<string, number> = {
  normal: 2, bronze: 4, silver: 7, gold: 12,
  needs_work: 2, warning: 4, serious_problem: 7, shit_show: 12,
};

/**
 * statScore rewards production (yards/game), finishing drives (red-zone %), ball
 * security (turnovers/game), opportunism (takeaways/game), and moving the chains
 * (first downs/game) — the fields both Madden and CFB track identically, same
 * cross-game-compatible approach as the Most Heart EOS award formula. badgeScore
 * folds in this season's game+season badge mix (tier-weighted, negative badges
 * subtract). Final rating blends 65% stats / 35% badges.
 */
export async function computeUserRatings(guildId: string, viewerDiscordId?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const game = context.rec_leagues.game;

  const assignmentsRes = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,team:rec_teams(name,abbreviation,display_abbr,display_city,display_nick,is_relocated),user:rec_users(display_name)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load assignments for User Rating.", assignmentsRes.error);

  const userIds = [...new Set((assignmentsRes.data ?? []).map((a: any) => a.user_id).filter(Boolean))] as string[];
  if (!userIds.length) return { displayAsGrade: isCfb(game), viewerUserId: null, users: [] };

  const [statsRes, badgesRes] = await Promise.all([
    supabase.from("rec_team_game_stats").select("*").eq("league_id", leagueId).eq("season_number", seasonNumber).in("user_id", userIds),
    supabase.from("rec_badge_ownership").select("user_id,badge_scope,polarity,tier,earned_count").eq("league_id", leagueId).eq("season", seasonNumber).in("badge_scope", ["game", "season"]).in("user_id", userIds),
  ]);
  if (statsRes.error) throw new ApiError(500, "Failed to load stats for User Rating.", statsRes.error);
  if (badgesRes.error) throw new ApiError(500, "Failed to load badges for User Rating.", badgesRes.error);

  const gamesByUser = new Map<string, ReturnType<typeof rowToGameStats>[]>();
  for (const row of statsRes.data ?? []) {
    const g = rowToGameStats(row as TeamGameStatsRow, game);
    if (!g.userId || g.statsQuarantined) continue;
    const list = gamesByUser.get(g.userId) ?? [];
    list.push(g);
    gamesByUser.set(g.userId, list);
  }

  const badgeScoreByUser = new Map<string, number>();
  for (const row of badgesRes.data ?? []) {
    const weight = BADGE_TIER_WEIGHT[row.tier as string] ?? 2;
    const sign = row.polarity === "negative" ? -1 : 1;
    const multiplier = Math.max(1, Math.min(Number(row.earned_count ?? 1), 3));
    badgeScoreByUser.set(row.user_id, (badgeScoreByUser.get(row.user_id) ?? 0) + sign * weight * multiplier);
  }

  const rows: UserRatingRow[] = (assignmentsRes.data ?? []).map((a: any) => {
    const team = Array.isArray(a.team) ? a.team[0] : a.team;
    const user = Array.isArray(a.user) ? a.user[0] : a.user;
    const games = gamesByUser.get(a.user_id) ?? [];
    const totals = seasonTotalsFromGames(games);
    const gp = totals.gamesPlayed || 1;
    const yardsPerGame = (totals.passingYards + totals.rushingYards) / gp;
    const normYards = clamp(yardsPerGame / 400, 0, 1.2);
    const normRedZone = clamp(totals.seasonRedZoneOffPct / 100, 0, 1);
    const normTurnovers = clamp(1 - (totals.turnoversCommitted / gp) / 3, 0, 1);
    const normTakeaways = clamp((totals.opponentTurnovers / gp) / 2, 0, 1);
    const normFirstDowns = clamp((totals.firstDowns / gp) / 22, 0, 1);
    const statScore = clamp(30 * normYards + 20 * normRedZone + 20 * normTurnovers + 15 * normTakeaways + 15 * normFirstDowns, 0, 100);
    const badgeScore = badgeScoreByUser.get(a.user_id) ?? 0;
    const badgeComponent = clamp(50 + badgeScore * 2, 0, 100);
    const rating = clamp(0.65 * statScore + 0.35 * badgeComponent, 0, 100);
    return {
      userId: a.user_id,
      displayName: user?.display_name ?? "REC Member",
      teamId: a.team_id ?? null,
      teamName: team ? teamDisplayName(team) : null,
      rank: 0,
      rating: round(rating, 1),
      grade: letterGradeForRating(rating),
      statScore: round(statScore, 1),
      badgeScore: round(badgeScore, 1),
    };
  });

  rows.sort((x, y) => y.rating - x.rating || x.displayName.localeCompare(y.displayName));
  rows.forEach((r, i) => { r.rank = i + 1; });

  let viewerUserId: string | null = null;
  if (viewerDiscordId) {
    const acct = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", viewerDiscordId).maybeSingle();
    viewerUserId = acct.data?.user_id ?? null;
  }

  return { displayAsGrade: isCfb(game), viewerUserId, users: rows };
}
