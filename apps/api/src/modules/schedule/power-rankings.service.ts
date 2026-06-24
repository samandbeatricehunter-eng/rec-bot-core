import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

// PR = 0.45·winPct + 0.20·normPD + 0.20·engagement + 0.15·closeClutch
//   winPct      — official win% (ties = ½)
//   normPD      — avg point differential / 14, mapped to 0..1
//   engagement  — share of games reported via an approved box score (rewards
//                 actually playing/posting over advance-only force-wins)
//   closeClutch — full credit if >50% of H2H games are won AND those wins
//                 average a ≤7-point margin (winning close games vs humans)
const W_WIN = 0.45;
const W_PD = 0.20;
const W_ENGAGE = 0.20;
const W_CLUTCH = 0.15;
const PD_SCALE = 14;
const CLOSE_MARGIN = 7;
const BOX_SCORE_SOURCES = new Set(["box_score", "box_score_screenshot"]);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 3) => { const f = 10 ** p; return Math.round(n * f) / f; };

function teamDisplayName(t: any): string {
  if (t?.is_relocated && (t.display_city || t.display_nick)) {
    return `${t.display_city ?? ""} ${t.display_nick ?? ""}`.trim() || (t.name ?? "Team");
  }
  return t?.name ?? "Team";
}

type Agg = {
  wins: number; losses: number; ties: number; pf: number; pa: number; scored: number; total: number;
  boxScoreGames: number; h2hGames: number; h2hWins: number; h2hWinMargin: number;
};
const emptyAgg = (): Agg => ({ wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, scored: 0, total: 0, boxScoreGames: 0, h2hGames: 0, h2hWins: 0, h2hWinMargin: 0 });

async function aggregateTeams(leagueId: string, seasonNumber: number): Promise<Map<string, Agg>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,is_user_h2h,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "Failed to load results for power rankings.", error);

  const map = new Map<string, Agg>();
  const get = (id: string) => { let a = map.get(id); if (!a) { a = emptyAgg(); map.set(id, a); } return a; };

  for (const g of data ?? []) {
    const { home_team_id: h, away_team_id: a, home_score: hs, away_score: as_, winning_team_id: w, losing_team_id: l, is_tie, is_user_h2h, source } = g as any;
    const isBox = BOX_SCORE_SOURCES.has(String(source));
    const margin = hs != null && as_ != null ? Math.abs(hs - as_) : null;
    for (const teamId of [h, a] as (string | null)[]) {
      if (!teamId) continue;
      const t = get(teamId);
      t.total++;
      if (isBox) t.boxScoreGames++;
      if (is_user_h2h) t.h2hGames++;
      if (is_tie) t.ties++;
      else if (w === teamId) { t.wins++; if (is_user_h2h && margin != null) { t.h2hWins++; t.h2hWinMargin += margin; } }
      else if (l === teamId) t.losses++;
      if (hs != null && as_ != null) {
        const pf = teamId === h ? hs : as_;
        const pa = teamId === h ? as_ : hs;
        t.pf += pf; t.pa += pa; t.scored++;
      }
    }
  }
  return map;
}

function scoreFor(a: Agg): number {
  const gp = a.wins + a.losses + a.ties;
  const winPct = gp > 0 ? (a.wins + 0.5 * a.ties) / gp : 0.5;
  const avgPd = a.scored > 0 ? (a.pf - a.pa) / a.scored : 0;
  const normPd01 = (clamp(avgPd / PD_SCALE, -1, 1) + 1) / 2;
  const engagement = a.total > 0 ? a.boxScoreGames / a.total : 0;
  const h2hWinRate = a.h2hGames > 0 ? a.h2hWins / a.h2hGames : 0;
  const avgWinMargin = a.h2hWins > 0 ? a.h2hWinMargin / a.h2hWins : Infinity;
  const closeClutch = h2hWinRate > 0.5 && avgWinMargin <= CLOSE_MARGIN ? 1 : 0;
  return W_WIN * winPct + W_PD * normPd01 + W_ENGAGE * engagement + W_CLUTCH * closeClutch;
}

type RankedTeam = { teamId: string; score: number; rank: number };

async function rankTeams(leagueId: string, seasonNumber: number): Promise<RankedTeam[]> {
  const teamsRes = await supabase.from("rec_teams").select("id").eq("league_id", leagueId);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for power rankings.", teamsRes.error);
  const aggs = await aggregateTeams(leagueId, seasonNumber);
  const rows = (teamsRes.data ?? []).map((t) => {
    const a = aggs.get(t.id) ?? emptyAgg();
    return { teamId: t.id, agg: a, score: scoreFor(a) };
  });
  rows.sort((x, y) =>
    y.score - x.score ||
    (y.agg.wins - y.agg.losses) - (x.agg.wins - x.agg.losses) ||
    (y.agg.pf - y.agg.pa) - (x.agg.pf - x.agg.pa),
  );
  return rows.map((r, i) => ({ teamId: r.teamId, score: r.score, rank: i + 1 }));
}

// Store the current rankings for `weekNumber` (called at each advance for the
// week that just completed) so movement can be shown next week.
export async function snapshotPowerRankings(leagueId: string, seasonNumber: number, weekNumber: number) {
  const ranked = await rankTeams(leagueId, seasonNumber);
  if (!ranked.length) return;
  const now = new Date().toISOString();
  const rows = ranked.map((r) => ({
    league_id: leagueId,
    season_number: seasonNumber,
    week_number: weekNumber,
    team_id: r.teamId,
    rank: r.rank,
    score: round(r.score, 4),
    created_at: now,
  }));
  const { error } = await supabase
    .from("rec_power_ranking_snapshots")
    .upsert(rows, { onConflict: "league_id,season_number,week_number,team_id" });
  if (error) throw new ApiError(500, "Failed to write power-ranking snapshot.", error);
}

export async function computePowerRankings(guildId: string, viewerDiscordId?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const currentSeason = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);

  const [teamsRes, assignmentsRes, ranked, prevSnap] = await Promise.all([
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
    rankTeams(leagueId, currentSeason),
    // Most recent snapshot week for this season (the "previous week").
    supabase.from("rec_power_ranking_snapshots").select("week_number,team_id,rank").eq("league_id", leagueId).eq("season_number", currentSeason).order("week_number", { ascending: false }),
  ]);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for power rankings.", teamsRes.error);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load assignments for power rankings.", assignmentsRes.error);
  if (prevSnap.error) throw new ApiError(500, "Failed to load previous power rankings.", prevSnap.error);

  const teamById = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const humanTeamIds = new Set((assignmentsRes.data ?? []).map((r) => r.team_id).filter(Boolean));
  const userIdByTeam = new Map((assignmentsRes.data ?? []).map((r) => [r.team_id, r.user_id]));

  // Prior ranks from the latest snapshot week only.
  const latestWeek = (prevSnap.data ?? [])[0]?.week_number ?? null;
  const prevRankByTeam = new Map<string, number>();
  if (latestWeek != null) {
    for (const row of prevSnap.data ?? []) {
      if (row.week_number === latestWeek) prevRankByTeam.set(row.team_id, row.rank);
    }
  }

  const teams = ranked.map((r) => {
    const t = teamById.get(r.teamId);
    const prevRank = prevRankByTeam.get(r.teamId) ?? null;
    return {
      teamId: r.teamId,
      teamName: teamDisplayName(t),
      abbr: t?.display_abbr ?? t?.abbreviation ?? null,
      isHuman: humanTeamIds.has(r.teamId),
      rank: r.rank,
      score: round(r.score, 3),
      prevRank,
      change: prevRank == null ? null : prevRank - r.rank, // + = moved up
    };
  });

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

  return {
    league: { id: leagueId, name: context.rec_leagues.name ?? null },
    currentSeason,
    currentWeek,
    hasPreviousWeek: latestWeek != null,
    totalTeams: teams.length,
    viewerTeamId,
    teams,
  };
}
