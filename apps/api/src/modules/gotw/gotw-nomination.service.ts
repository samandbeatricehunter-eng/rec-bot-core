// Automated Game-of-the-Week nomination scoring. Runs over a week's eligible H2H games
// and ranks them so the advance flow can present a score-ordered dropdown with the top
// game recommended. Approved formula (see memory/docs): clamp 0-100 of
//   Rivalry(0-25) + Competitive Parity(0-35) + Matchup Quality(0-20) + Recent Form(0-20)
//   - Repeat GOTW Penalty(0-5).
// Parity is intentionally the largest factor; rivalry is a flat boost.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { computeCoachRatings, computeUserRatings } from "../league-week/ratings.service.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 1) => { const f = 10 ** p; return Math.round(n * f) / f; };

export type GotwBreakdown = {
  rivalry: number; parity: number; quality: number; recentForm: number; repeatPenalty: number; total: number;
};

export type GotwCandidate = {
  gameId: string; weekNumber: number;
  awayTeamId: string; homeTeamId: string;
  awayTeamName: string; homeTeamName: string;
  awayUserId: string | null; homeUserId: string | null;
  isRivalry: boolean; rivalryName: string | null;
  breakdown: GotwBreakdown; score: number; recommended: boolean;
};

export type ScoreGotwInput = {
  isRivalry: boolean;
  awayUserRating: number | null; homeUserRating: number | null;   // 0-100 (skill)
  awayCoachRating: number | null; homeCoachRating: number | null; // 0-100 (team strength)
  awaySos: number | null; homeSos: number | null;                 // ~1.0 baseline
  awayRecentForm: number; homeRecentForm: number;                 // 0..1
  repeatCount: number;                                            // 0..2 recent GOTW appearances
};

/**
 * Pure scoring — no I/O, unit-testable. Every sub-score is clamped to its band before the
 * clamped total so a single dominant factor can never blow past its cap.
 */
export function scoreGotwMatchup(input: ScoreGotwInput): GotwBreakdown {
  // Rivalry — flat 25 for any active rivalry game (per approved spec), else 0.
  const rivalry = input.isRivalry ? 25 : 0;

  // Competitive parity (largest factor) — closeness of the two USERS' skill ratings.
  // A 0-point gap = 35; the credit decays to 0 by a 50-point gap. Unknown ratings (e.g.
  // brand-new coaches with no games yet) fall back to a neutral half so they neither
  // dominate nor sink the matchup.
  let parity: number;
  if (input.awayUserRating == null || input.homeUserRating == null) {
    parity = 17.5;
  } else {
    parity = 35 * clamp(1 - Math.abs(input.awayUserRating - input.homeUserRating) / 50, 0, 1);
  }

  // Matchup quality — average COACH (team-strength) rating plus schedule strength faced.
  // NOTE(v1): strength-of-schedule stands in for "competitiveness vs higher-ranked
  // opponents this season"; replace the SOS term with explicit quality-wins-vs-higher-rank
  // once power-ranking history is persisted.
  const coachAvg = (input.awayCoachRating != null && input.homeCoachRating != null)
    ? (input.awayCoachRating + input.homeCoachRating) / 2
    : 50;
  const sosAvg = ((input.awaySos ?? 1) + (input.homeSos ?? 1)) / 2;
  const quality = clamp(14 * (coachAvg / 100) + 6 * clamp((sosAvg - 1) / 0.5, 0, 1), 0, 20);

  // Recent form — blend of both teams' recent W/L and scoring margin (0..1 each). NOTE(v1):
  // power-ranking momentum folds in once ranking snapshots are persisted; today the recent
  // scoring margin carries the "trending" signal.
  const recentForm = clamp(20 * ((input.awayRecentForm + input.homeRecentForm) / 2), 0, 20);

  // Repeat GOTW penalty — 2.5 per team featured in a recent GOTW, capped at 5.
  const repeatPenalty = clamp(input.repeatCount * 2.5, 0, 5);

  const total = clamp(rivalry + parity + quality + recentForm - repeatPenalty, 0, 100);
  return {
    rivalry: round(rivalry), parity: round(parity), quality: round(quality),
    recentForm: round(recentForm), repeatPenalty: round(repeatPenalty), total: round(total),
  };
}

// Last-3-games form (0..1) per team from official results before the target week.
async function computeRecentForm(leagueId: string, seasonNumber: number, beforeWeek: number): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,is_tie,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lt("week_number", beforeWeek)
    .order("week_number", { ascending: false });
  if (error) throw new ApiError(500, "Failed to load results for GOTW recent form.", error);

  const byTeam = new Map<string, { win: number; margin: number }[]>();
  for (const g of (data ?? []) as any[]) {
    for (const teamId of [g.home_team_id, g.away_team_id] as (string | null)[]) {
      if (!teamId) continue;
      const list = byTeam.get(teamId) ?? [];
      if (list.length >= 3) continue; // results are week-desc, so this keeps the latest 3
      const isHome = teamId === g.home_team_id;
      const pf = isHome ? g.home_score : g.away_score;
      const pa = isHome ? g.away_score : g.home_score;
      const win = g.is_tie ? 0.5 : g.winning_team_id === teamId ? 1 : 0;
      const margin = (pf != null && pa != null) ? pf - pa : 0;
      list.push({ win, margin });
      byTeam.set(teamId, list);
    }
  }

  const form = new Map<string, number>();
  for (const [teamId, list] of byTeam) {
    if (!list.length) { form.set(teamId, 0.5); continue; }
    const winFrac = list.reduce((s, x) => s + x.win, 0) / list.length;
    const avgMargin = list.reduce((s, x) => s + x.margin, 0) / list.length;
    form.set(teamId, clamp(winFrac + clamp(avgMargin / 21, -0.25, 0.25), 0, 1));
  }
  return form;
}

// Team ids featured in a GOTW over the previous three weeks (for the repeat penalty).
async function recentGotwTeamIds(leagueId: string, seasonNumber: number, weekNumber: number): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("away_team_id,home_team_id,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .gte("week_number", weekNumber - 3)
    .lt("week_number", weekNumber);
  if (error) throw new ApiError(500, "Failed to load recent GOTW history.", error);
  const ids = new Set<string>();
  for (const p of (data ?? []) as any[]) {
    if (p.away_team_id) ids.add(p.away_team_id);
    if (p.home_team_id) ids.add(p.home_team_id);
  }
  return ids;
}

/**
 * Score and rank every eligible H2H matchup in a week. Eligibility: both teams assigned,
 * both users linked, and the game is not already completed. The highest score is flagged
 * `recommended`; ties break on home-team name for stable ordering.
 */
export async function scoreWeekGotwCandidates(guildId: string, weekNumber: number): Promise<GotwCandidate[]> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const gamesRes = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,rivalry_id,rivalry_opt_out,status,home_score,away_score," +
      "home_team:rec_teams!rec_games_home_team_id_fkey(name,display_city,display_nick,is_relocated)," +
      "away_team:rec_teams!rec_games_away_team_id_fkey(name,display_city,display_nick,is_relocated)," +
      "rivalry:rec_league_rivalries(rivalry_name,is_active)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (gamesRes.error) throw new ApiError(500, "Failed to load games for GOTW nomination.", gamesRes.error);

  const eligible = ((gamesRes.data ?? []) as any[]).filter((g) =>
    g.home_team_id && g.away_team_id && g.home_user_id && g.away_user_id &&
    g.status !== "completed" && g.status !== "final" && g.home_score == null && g.away_score == null);
  if (!eligible.length) return [];

  const [coach, users, recentForm, recentTeams] = await Promise.all([
    computeCoachRatings(guildId).catch(() => null),
    computeUserRatings(guildId).catch(() => null),
    computeRecentForm(leagueId, seasonNumber, weekNumber),
    recentGotwTeamIds(leagueId, seasonNumber, weekNumber),
  ]);
  const coachByTeam = new Map((coach?.teams ?? []).map((t: any) => [t.teamId, t]));
  const userRatingById = new Map((users?.users ?? []).map((u: any) => [u.userId, u.rating]));

  const candidates: GotwCandidate[] = eligible.map((g) => {
    const rivalry = Array.isArray(g.rivalry) ? g.rivalry[0] : g.rivalry;
    const isRivalry = Boolean(g.rivalry_id) && !g.rivalry_opt_out && (rivalry?.is_active ?? true);
    const homeCoach: any = coachByTeam.get(g.home_team_id);
    const awayCoach: any = coachByTeam.get(g.away_team_id);
    let repeatCount = 0;
    if (recentTeams.has(g.home_team_id)) repeatCount++;
    if (recentTeams.has(g.away_team_id)) repeatCount++;

    const breakdown = scoreGotwMatchup({
      isRivalry,
      awayUserRating: userRatingById.get(g.away_user_id) ?? null,
      homeUserRating: userRatingById.get(g.home_user_id) ?? null,
      awayCoachRating: awayCoach?.rating ?? null,
      homeCoachRating: homeCoach?.rating ?? null,
      awaySos: awayCoach?.sos ?? null,
      homeSos: homeCoach?.sos ?? null,
      awayRecentForm: recentForm.get(g.away_team_id) ?? 0.5,
      homeRecentForm: recentForm.get(g.home_team_id) ?? 0.5,
      repeatCount,
    });

    return {
      gameId: g.id,
      weekNumber: g.week_number,
      awayTeamId: g.away_team_id,
      homeTeamId: g.home_team_id,
      awayTeamName: formatTeamDisplayName(Array.isArray(g.away_team) ? g.away_team[0] : g.away_team) ?? "Away",
      homeTeamName: formatTeamDisplayName(Array.isArray(g.home_team) ? g.home_team[0] : g.home_team) ?? "Home",
      awayUserId: g.away_user_id ?? null,
      homeUserId: g.home_user_id ?? null,
      isRivalry,
      rivalryName: rivalry?.rivalry_name ?? null,
      breakdown,
      score: breakdown.total,
      recommended: false,
    };
  });

  candidates.sort((a, b) => b.score - a.score || a.homeTeamName.localeCompare(b.homeTeamName));
  if (candidates.length) candidates[0].recommended = true;
  return candidates;
}
