import { isCfb, isMadden, type LeagueGame } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { withComputeCache } from "../../lib/compute-cache.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { computeLeagueSos } from "./sos.service.js";
import { computeUserRatings } from "../league-week/ratings.service.js";

// Ordinary reads (hub loads, wager-option views, game-channel renders) all hit this same
// per-league computation; a short TTL means "current week" views share one computation
// instead of each triggering a full rec_game_results/SOS/ratings recompute. Historical
// (completedWeekNumber) views are cheap already (served from the snapshot table) and don't
// strictly need caching, but sharing the cache key format costs nothing.
const POWER_RANKINGS_CACHE_TTL_MS = 60_000;

// PR = 0.45·winPct + 0.20·normPD + 0.20·engagement + 0.15·closeClutch
//   winPct      — official win% (ties = ½)
//   normPD      — avg point differential / 14, mapped to 0..1
//   engagement  — share of games reported via an approved box score (rewards
//                 actually playing/posting over advance-only force-wins)
//   closeClutch — full credit if >50% of H2H games are won AND those wins
//                 average a ≤7-point margin (winning close games vs humans)
// For Madden leagues, an additional OVR component blends team average OVR and QB OVR
// to give lines more pre-season/early-season differentiation before enough games
// have been played for win% to diverge meaningfully.
const W_WIN = 0.30;
const W_PD = 0.15;
const W_SOS = 0.12;
const W_STATS = 0.08;
const W_ENGAGE = 0.12;
const W_CLUTCH = 0.08;
const W_OVR_MADDEN = 0.15;  // Madden-only: team OVR + QB OVR signal
const PD_SCALE = 14;
const CLOSE_MARGIN = 7;
const BOX_SCORE_SOURCES = new Set(["box_score", "box_score_screenshot"]);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 3) => { const f = 10 ** p; return Math.round(n * f) / f; };

function teamDisplayName(t: any): string {
  const name = (t?.name ?? "").trim();
  const nick = (t?.display_nick ?? "").trim();
  if (t?.is_relocated) {
    if (name && (!nick || name.toLowerCase() !== nick.toLowerCase())) return name;
    const combined = `${t?.display_city ?? ""} ${nick}`.trim();
    if (combined) return combined;
  }
  return name || nick || "Team";
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

function scoreFor(a: Agg, sosFull = 1, statScore = 50, ovrBonus = 0): number {
  const gp = a.wins + a.losses + a.ties;
  const winPct = gp > 0 ? (a.wins + 0.5 * a.ties) / gp : 0.5;
  const avgPd = a.scored > 0 ? (a.pf - a.pa) / a.scored : 0;
  const normPd01 = (clamp(avgPd / PD_SCALE, -1, 1) + 1) / 2;
  const engagement = a.total > 0 ? a.boxScoreGames / a.total : 0;
  const h2hWinRate = a.h2hGames > 0 ? a.h2hWins / a.h2hGames : 0;
  const avgWinMargin = a.h2hWins > 0 ? a.h2hWinMargin / a.h2hWins : Infinity;
  const closeClutch = h2hWinRate > 0.5 && avgWinMargin <= CLOSE_MARGIN ? 1 : 0;
  const normalizedSos = clamp(0.5 + (sosFull - 1), 0, 1);
  const normalizedStats = clamp(statScore / 100, 0, 1);
  const base = W_WIN * winPct + W_PD * normPd01 + W_SOS * normalizedSos
    + W_STATS * normalizedStats + W_ENGAGE * engagement + W_CLUTCH * closeClutch;
  // Madden leagues: blend in team OVR signal (weighted to not overwhelm early-season data)
  return base + (ovrBonus > 0 ? W_OVR_MADDEN * ovrBonus : 0);
}

type RankedTeam = { teamId: string; score: number; rank: number };
type ComputePowerRankingsOptions = {
  completedWeekNumber?: number | null;
};

/** For Madden leagues, compute a 0-1 OVR bonus per team from roster snapshots.
 *  Blends team average OVR (60%) with starting QB OVR (40%) — QB play is the single
 *  biggest differentiator in Madden outcomes. Returns 0 for non-Madden or when no
 *  player data is available (early pre-roster-import). */
async function computeTeamOvrBonus(leagueId: string, teamIds: string[], game: LeagueGame): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!isMadden(game) || !teamIds.length) return result;

  const { data: players, error } = await supabase
    .from("rec_players")
    .select("team_id,position,overall_rating")
    .eq("league_id", leagueId)
    .in("team_id", teamIds)
    .not("overall_rating", "is", null);
  if (error || !players?.length) return result;

  const byTeam = new Map<string, any[]>();
  for (const p of players) {
    const list = byTeam.get(p.team_id) ?? [];
    list.push(p);
    byTeam.set(p.team_id, list);
  }

  for (const [teamId, roster] of byTeam) {
    if (!roster.length) continue;
    const avgOvr = roster.reduce((s, p) => s + (p.overall_rating ?? 0), 0) / roster.length;
    const qb = roster.find((p) => p.position === "QB");
    const qbOvr = qb?.overall_rating ?? avgOvr;
    // Normalize to 0..1 range (Madden OVRs typically 50-99)
    const teamBonus = clamp((avgOvr - 50) / 49, 0, 1);
    const qbBonus = clamp((qbOvr - 50) / 49, 0, 1);
    result.set(teamId, 0.6 * teamBonus + 0.4 * qbBonus);
  }
  return result;
}

async function rankTeams(guildId: string, leagueId: string, seasonNumber: number, game: LeagueGame = null): Promise<RankedTeam[]> {
  const [teamsRes, aggs, sos, userRatings] = await Promise.all([
    supabase.from("rec_teams").select("id").eq("league_id", leagueId),
    aggregateTeams(leagueId, seasonNumber),
    bestEffort("power_rankings.league_sos", () => computeLeagueSos(guildId), { guildId }).then((v) => v ?? null),
    bestEffort("power_rankings.user_ratings", () => computeUserRatings(guildId), { guildId }).then((v) => v ?? null),
  ]);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for power rankings.", teamsRes.error);

  // CFB leagues can have 100+ CPU-only teams across conferences that would swamp the
  // rankings with noise; only rank the user-controlled teams there, regardless of
  // conference. Madden leagues (typically fully human-controlled) keep ranking every team.
  let teamIds = (teamsRes.data ?? []).map((t) => t.id);
  if (isCfb(game)) {
    const assignments = await supabase
      .from("rec_team_assignments")
      .select("team_id")
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null);
    if (assignments.error) throw new ApiError(500, "Failed to load team assignments for power rankings.", assignments.error);
    const humanTeamIds = new Set((assignments.data ?? []).map((r) => r.team_id));
    teamIds = teamIds.filter((id) => humanTeamIds.has(id));
  }

  // For Madden leagues, fetch OVR data with the actual team IDs
  const maddenOvrBonuses = isMadden(game) ? await computeTeamOvrBonus(leagueId, teamIds, game) : new Map<string, number>();

  const sosByTeam = new Map((sos?.teams ?? []).map((row) => [row.teamId, row.sosFull]));
  const statsByTeam = new Map((userRatings?.users ?? []).filter((row) => row.teamId).map((row) => [row.teamId!, row.statScore]));
  const rows = teamIds.map((id) => {
    const a = aggs.get(id) ?? emptyAgg();
    const ovrBonus = maddenOvrBonuses.get(id) ?? 0;
    return { teamId: id, agg: a, score: scoreFor(a, sosByTeam.get(id) ?? 1, statsByTeam.get(id) ?? 50, ovrBonus) };
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
export async function snapshotPowerRankings(leagueId: string, seasonNumber: number, weekNumber: number, game: LeagueGame = null) {
  const link = await supabase.from("rec_server_league_links").select("server:rec_discord_servers(guild_id)").eq("league_id", leagueId).eq("is_primary", true).maybeSingle();
  const guildId = (link.data as any)?.server?.guild_id;
  if (!guildId) return;
  const ranked = await rankTeams(String(guildId), leagueId, seasonNumber, game);
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

// Resolves just the week number of the latest snapshot (optionally strictly before
// `beforeWeek`), instead of downloading every prior week's full team-row history only to
// keep the first one client-side — a query that used to grow with every week of the season.
async function loadLatestSnapshotWeek(leagueId: string, seasonNumber: number, beforeWeek?: number | null): Promise<number | null> {
  let query = supabase
    .from("rec_power_ranking_snapshots")
    .select("week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("week_number", { ascending: false })
    .limit(1);
  if (beforeWeek != null) query = query.lt("week_number", beforeWeek);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load latest power-ranking snapshot week.", error);
  return data?.[0]?.week_number ?? null;
}

// A new season starts with zero games played, which would otherwise make every team's
// score tie at the defaults and rank essentially arbitrarily. Carry over last season's
// final power rankings instead, until this season has actually recorded a result.
async function loadPreviousSeasonFinalRankings(leagueId: string, seasonNumber: number): Promise<RankedTeam[] | null> {
  if (seasonNumber <= 1) return null;
  const prevSeason = seasonNumber - 1;
  const latestWeek = await loadLatestSnapshotWeek(leagueId, prevSeason);
  if (latestWeek == null) return null;
  return loadSnapshotRankings(leagueId, prevSeason, latestWeek);
}

async function loadSnapshotRankings(leagueId: string, seasonNumber: number, weekNumber: number): Promise<RankedTeam[] | null> {
  const { data, error } = await supabase
    .from("rec_power_ranking_snapshots")
    .select("team_id,rank,score")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .order("rank", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load power-ranking snapshot.", error);
  if (!data?.length) return null;
  return data.map((row: any) => ({ teamId: row.team_id, rank: Number(row.rank), score: Number(row.score ?? 0) }));
}

// Everything except the viewer-specific lookup below — this is the part shared by every
// caller regardless of which Discord user is asking, so it's the part worth caching.
async function computePowerRankingsBase(guildId: string, completedWeekNumber: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const currentSeason = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const leagueGame = context.rec_leagues.game;
  let ranked: RankedTeam[];
  if (completedWeekNumber) {
    ranked = (await loadSnapshotRankings(leagueId, currentSeason, completedWeekNumber)) ?? await rankTeams(guildId, leagueId, currentSeason, leagueGame);
  } else {
    const seasonHasResults = (await aggregateTeams(leagueId, currentSeason)).size > 0;
    ranked = seasonHasResults
      ? await rankTeams(guildId, leagueId, currentSeason, leagueGame)
      : (await loadPreviousSeasonFinalRankings(leagueId, currentSeason)) ?? await rankTeams(guildId, leagueId, currentSeason, leagueGame);
  }

  const [teamsRes, assignmentsRes, latestWeek] = await Promise.all([
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated,conference").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
    loadLatestSnapshotWeek(leagueId, currentSeason, completedWeekNumber),
  ]);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for power rankings.", teamsRes.error);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load assignments for power rankings.", assignmentsRes.error);

  const teamById = new Map<string, any>((teamsRes.data ?? []).map((t: any) => [t.id, t]));
  const humanTeamIds = new Set((assignmentsRes.data ?? []).map((r) => r.team_id).filter(Boolean));
  const userIdByTeam = new Map((assignmentsRes.data ?? []).map((r) => [r.team_id, r.user_id]));

  // Prior ranks from the latest snapshot week only — a single fixed-size query instead of
  // downloading the whole season's snapshot history to discard everything but this week.
  const prevRankByTeam = new Map<string, number>();
  if (latestWeek != null) {
    const prevSnap = await supabase
      .from("rec_power_ranking_snapshots")
      .select("team_id,rank")
      .eq("league_id", leagueId)
      .eq("season_number", currentSeason)
      .eq("week_number", latestWeek);
    if (prevSnap.error) throw new ApiError(500, "Failed to load previous power rankings.", prevSnap.error);
    for (const row of prevSnap.data ?? []) prevRankByTeam.set(row.team_id, row.rank);
  }

  const teams = ranked.map((r) => {
    const t = teamById.get(r.teamId);
    const prevRank = prevRankByTeam.get(r.teamId) ?? null;
    return {
      teamId: r.teamId,
      teamName: teamDisplayName(t),
      abbr: t?.display_abbr ?? t?.abbreviation ?? null,
      conference: t?.conference ?? null,
      isHuman: humanTeamIds.has(r.teamId),
      rank: r.rank,
      score: round(r.score, 3),
      prevRank,
      change: prevRank == null ? null : prevRank - r.rank, // + = moved up
    };
  });

  return {
    league: { id: leagueId, name: context.rec_leagues.name ?? null },
    currentSeason,
    currentWeek,
    completedWeekNumber,
    hasPreviousWeek: latestWeek != null,
    previousWeekNumber: latestWeek,
    totalTeams: teams.length,
    teams,
    userIdByTeam,
  };
}

export async function computePowerRankings(guildId: string, viewerDiscordId?: string | null, options: ComputePowerRankingsOptions = {}) {
  const completedWeekNumber = options.completedWeekNumber ?? null;
  const cacheKey = `power-rankings:${guildId}:${completedWeekNumber ?? "current"}`;
  const base = await withComputeCache(cacheKey, POWER_RANKINGS_CACHE_TTL_MS, () => computePowerRankingsBase(guildId, completedWeekNumber));

  let viewerTeamId: string | null = null;
  if (viewerDiscordId) {
    const acct = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", viewerDiscordId).maybeSingle();
    const userId = (acct.data?.user_id as string | undefined) ?? null;
    if (userId) {
      for (const [teamId, uId] of base.userIdByTeam.entries()) {
        if (uId === userId) { viewerTeamId = String(teamId); break; }
      }
    }
  }

  const { userIdByTeam: _userIdByTeam, ...rest } = base;
  return { ...rest, viewerTeamId };
}
