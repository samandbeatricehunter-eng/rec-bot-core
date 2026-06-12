import { formatStatValue, getStatShortLabel, readStat } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { AWARD_DEFINITIONS, AWARD_KEYS, getAwardDef } from "./rec-awards-config.js";
import { creditUserWallet } from "../advance/advance.service.js";

function asNum(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nowIso() {
  return new Date().toISOString();
}

async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);

    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

// Normalize an array of raw scores to 0-100
function normalizeScores(rawMap: Map<string, number>): Map<string, number> {
  const values = [...rawMap.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const result = new Map<string, number>();
  for (const [uid, raw] of rawMap) {
    result.set(uid, range > 0 ? ((raw - min) / range) * 100 : (raw > 0 ? 100 : 0));
  }
  return result;
}

async function getLeagueContext(guildId: string) {
  const { data: server } = await supabase
    .from("rec_discord_servers")
    .select("id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (!server?.id) throw new Error("Server not found.");

  const { data: link } = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (!link?.league_id) throw new Error("No league linked to this server.");

  const { data: league } = await supabase
    .from("rec_leagues")
    .select("id,name,season_number,display_season_number,current_week")
    .eq("id", link.league_id)
    .single();
  if (!league) throw new Error("League not found.");

  const { data: routes } = await supabase
    .from("rec_server_routes")
    .select("*")
    .eq("server_id", server.id)
    .maybeSingle();

  return { leagueId: league.id as string, league, routes, serverId: server.id as string };
}

// Get all active user → team assignments for this league
async function getActiveCoaches(leagueId: string) {
  const { data: assignments, error: assignmentsError } = await supabase
    .from("rec_team_assignments")
    .select("user_id, team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (assignmentsError) throw assignmentsError;

  const cleanAssignments = (assignments ?? [])
    .map((a: any) => ({ userId: String(a.user_id ?? ""), teamId: String(a.team_id ?? "") }))
    .filter((a) => a.userId && a.teamId);

  const userIds = [...new Set(cleanAssignments.map((a) => a.userId))];
  const teamIds = [...new Set(cleanAssignments.map((a) => a.teamId))];

  const [{ data: discordAccounts, error: discordError }, { data: teams, error: teamsError }] = await Promise.all([
    userIds.length
      ? supabase.from("rec_discord_accounts").select("user_id,discord_id,global_name,username").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("rec_teams").select("id,name,abbreviation,ovr_rating").in("id", teamIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (discordError) throw discordError;
  if (teamsError) throw teamsError;

  const discordMap = new Map<string, { discordId: string; displayName: string }>();
  for (const d of discordAccounts ?? []) {
    if (d.user_id) {
      discordMap.set(String(d.user_id), {
        discordId: d.discord_id ? String(d.discord_id) : "",
        displayName: d.global_name ?? d.username ?? "Coach"
      });
    }
  }

  const teamMap = new Map<string, { name: string | null; abbreviation: string | null; ovr_rating: number | null }>();
  for (const t of teams ?? []) {
    if (t.id) teamMap.set(String(t.id), t as any);
  }

  return cleanAssignments.map((a) => {
    const team = teamMap.get(a.teamId);
    const discord = discordMap.get(a.userId);
    return {
      userId: a.userId,
      teamId: a.teamId,
      teamName: team?.name ?? team?.abbreviation ?? "Unknown",
      teamOvr: asNum(team?.ovr_rating),
      discordId: discord?.discordId || null,
      displayName: discord?.displayName ?? team?.name ?? team?.abbreviation ?? "Coach"
    };
  });
}

// Average OL (LT/LG/C/RG/RT) overall rating per team, for Best OL team award
async function getOLTeamRatings(leagueId: string): Promise<Map<string, number>> {
  const OL_POSITIONS = ["LT", "LG", "C", "RG", "RT"];
  const [teamsResult, playersResult] = await Promise.all([
    supabase.from("rec_teams").select("id,madden_team_id").eq("league_id", leagueId),
    supabase.from("rec_players").select("position,overall_rating,raw_payload").eq("league_id", leagueId).in("position", OL_POSITIONS)
  ]);

  const teamByMaddenId = new Map<string, string>(); // madden external id → uuid
  for (const t of teamsResult.data ?? []) {
    if (t.madden_team_id) teamByMaddenId.set(String(t.madden_team_id), String(t.id));
  }

  const olByTeam = new Map<string, { total: number; count: number }>();
  for (const p of playersResult.data ?? []) {
    const raw = (p.raw_payload ?? {}) as Record<string, unknown>;
    const maddenTeamId = String(raw.teamId ?? "0");
    if (maddenTeamId === "0") continue; // skip free agents
    const teamId = teamByMaddenId.get(maddenTeamId);
    if (!teamId) continue;
    const ovr = asNum((p as any).overall_rating ?? raw.playerBestOvr ?? raw.playerSchemeOvr ?? 0);
    if (!olByTeam.has(teamId)) olByTeam.set(teamId, { total: 0, count: 0 });
    const agg = olByTeam.get(teamId)!;
    agg.total += ovr;
    agg.count += 1;
  }

  const result = new Map<string, number>();
  for (const [teamId, { total, count }] of olByTeam) {
    result.set(teamId, count > 0 ? total / count : 0);
  }
  return result;
}

// Aggregate team stats across all regular season committed games
async function getTeamSeasonStats(leagueId: string, seasonNumber: number): Promise<Map<string, Record<string, number>>> {
  const data = await selectAllPages<any>((from, to) =>
    supabase
      .from("rec_player_weekly_stats")
      .select("team_id, stat_category, stats")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("season_stage", "regular_season")
      .range(from, to)
  );

  const teamStats = new Map<string, Record<string, number>>();
  for (const row of data ?? []) {
    const tid = String(row.team_id ?? "");
    if (!tid) continue;
    if (!teamStats.has(tid)) teamStats.set(tid, {});
    const agg = teamStats.get(tid)!;
    const s = (row.stats ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(s)) {
      agg[k] = (agg[k] ?? 0) + asNum(v);
    }
  }
  return teamStats;
}

// Get team stat totals by category for position-specific awards
async function getTeamStatsByCategory(leagueId: string, seasonNumber: number, category: string): Promise<Map<string, Record<string, number>>> {
  const data = await selectAllPages<any>((from, to) =>
    supabase
      .from("rec_player_weekly_stats")
      .select("team_id, stats")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("season_stage", "regular_season")
      .eq("stat_category", category)
      .range(from, to)
  );

  const teamStats = new Map<string, Record<string, number>>();
  for (const row of data ?? []) {
    const tid = String(row.team_id ?? "");
    if (!tid) continue;
    if (!teamStats.has(tid)) teamStats.set(tid, {});
    const agg = teamStats.get(tid)!;
    const s = (row.stats ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(s)) {
      agg[k] = (agg[k] ?? 0) + asNum(v);
    }
  }
  return teamStats;
}

// Get season records for all coaches
async function getSeasonRecords(leagueId: string, seasonNumber: number): Promise<Map<string, { wins: number; losses: number; ties: number; pd: number; games: number }>> {
  const { data } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  const map = new Map<string, { wins: number; losses: number; ties: number; pd: number; games: number }>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    const games = asNum(r.games_played) || (asNum(r.wins) + asNum(r.losses) + asNum(r.ties));
    map.set(String(r.user_id), {
      wins: asNum(r.wins),
      losses: asNum(r.losses),
      ties: asNum(r.ties),
      pd: asNum(r.point_differential),
      games
    });
  }
  return map;
}

// Get season records from prior season (for Coach of the Year "improvement" metric)
async function getPriorSeasonRecords(leagueId: string, seasonNumber: number): Promise<Map<string, { wins: number; games: number }>> {
  if (seasonNumber <= 1) return new Map();
  const { data } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,games_played,losses,ties")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber - 1);

  const map = new Map<string, { wins: number; games: number }>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    const games = asNum(r.games_played) || (asNum(r.wins) + asNum(r.losses) + asNum(r.ties));
    map.set(String(r.user_id), { wins: asNum(r.wins), games });
  }
  return map;
}

// Count upset wins (wins against opponents with better record)
async function getUpsetWins(leagueId: string, seasonNumber: number, records: Map<string, { wins: number; games: number }>): Promise<Map<string, number>> {
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,winning_team_id,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);

  const upsets = new Map<string, number>();
  for (const g of games ?? []) {
    const homeId = String(g.home_user_id ?? "");
    const awayId = String(g.away_user_id ?? "");
    if (!homeId || !awayId) continue;
    const homeScore = asNum(g.home_score);
    const awayScore = asNum(g.away_score);
    if (homeScore === awayScore) continue;

    const winner = homeScore > awayScore ? homeId : awayId;
    const loser = homeScore > awayScore ? awayId : homeId;

    const winnerRec = records.get(winner);
    const loserRec = records.get(loser);
    if (!winnerRec || !loserRec) continue;

    const winnerWinPct = winnerRec.games > 0 ? winnerRec.wins / winnerRec.games : 0;
    const loserWinPct = loserRec.games > 0 ? loserRec.wins / loserRec.games : 0;

    if (loserWinPct > winnerWinPct + 0.1) {
      upsets.set(winner, (upsets.get(winner) ?? 0) + 1);
    }
  }
  return upsets;
}

// Strength of schedule: average opponent win% for a given user
async function getStrengthOfSchedule(leagueId: string, seasonNumber: number, records: Map<string, { wins: number; games: number }>): Promise<Map<string, number>> {
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);

  const opponentPctSums = new Map<string, { sum: number; count: number }>();
  for (const g of games ?? []) {
    const homeId = String(g.home_user_id ?? "");
    const awayId = String(g.away_user_id ?? "");
    if (!homeId || !awayId) continue;

    for (const [uid, oppId] of [[homeId, awayId], [awayId, homeId]]) {
      const oppRec = records.get(oppId);
      const oppWinPct = oppRec && oppRec.games > 0 ? oppRec.wins / oppRec.games : 0;
      const entry = opponentPctSums.get(uid) ?? { sum: 0, count: 0 };
      entry.sum += oppWinPct;
      entry.count++;
      opponentPctSums.set(uid, entry);
    }
  }

  const sos = new Map<string, number>();
  for (const [uid, { sum, count }] of opponentPctSums) {
    sos.set(uid, count > 0 ? sum / count : 0);
  }
  return sos;
}

// Get stream counts per user
async function getStreamCounts(leagueId: string, seasonNumber: number, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("rec_stream_posts")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season")
    .in("user_id", userIds);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    counts.set(String(r.user_id), (counts.get(String(r.user_id)) ?? 0) + 1);
  }
  return counts;
}

// Get completed challenge counts per user
async function getChallengeCounts(leagueId: string, seasonNumber: number, userIds: string[]): Promise<Map<string, { total: number; sTier: number; aTier: number }>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("rec_weekly_challenges")
    .select("user_id,earned_tier")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season")
    .in("status", ["completed", "earned"])
    .in("user_id", userIds);

  const counts = new Map<string, { total: number; sTier: number; aTier: number }>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    const uid = String(r.user_id);
    const entry = counts.get(uid) ?? { total: 0, sTier: 0, aTier: 0 };
    entry.total++;
    if (r.earned_tier === "S") entry.sTier++;
    else if (r.earned_tier === "A") entry.aTier++;
    counts.set(uid, entry);
  }
  return counts;
}

// Get badge counts per user for this season
async function getBadgeCounts(leagueId: string, userIds: string[]): Promise<Map<string, { total: number; platinum: number; gold: number; silver: number }>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("rec_user_badges")
    .select("user_id,badge_tier")
    .eq("league_id", leagueId)
    .in("user_id", userIds);

  const counts = new Map<string, { total: number; platinum: number; gold: number; silver: number }>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    const uid = String(r.user_id);
    const entry = counts.get(uid) ?? { total: 0, platinum: 0, gold: 0, silver: 0 };
    entry.total++;
    const tier = String(r.badge_tier ?? "").toLowerCase();
    if (tier === "platinum") entry.platinum++;
    else if (tier === "gold") entry.gold++;
    else if (tier === "silver") entry.silver++;
    counts.set(uid, entry);
  }
  return counts;
}

// Score calculators — all return a normalized 0-100 score (higher = better).
// All components are individually normalized to 0-100 before weighting so each
// path (passing/rushing/receiving) uses the same scale and Math.max() is fair.
// Caps are set to elite-but-achievable 17-game team season totals.

function scorePassingStats(s: Record<string, number>, winPct: number): number {
  const passYds  = awardStat(s, "pass_yards");
  const passTDs  = awardStat(s, "pass_tds");
  const passAtt  = awardStat(s, "pass_attempts") || 1;
  const passComp = awardStat(s, "pass_completions");
  const ints     = awardStat(s, "interceptions_thrown");
  const compPct  = passComp / passAtt;

  // Component normalizations (0-100 each):
  const ydsScore  = Math.min(passYds / 65, 100);                              // 6500 yds = 100
  const tdScore   = Math.min(passTDs * 100 / 65, 100);                        // 65 TDs = 100
  const compScore = Math.min(Math.max((compPct - 0.50) / 0.25 * 100, 0), 100); // 50%-75% → 0-100
  const intScore  = Math.max(0, 100 * (1 - ints / 25));                       // 25 INTs = 0
  const winScore  = winPct * 100;

  // 35% yards, 30% TDs, 15% completion%, 10% INT avoidance, 10% wins
  return ydsScore  * 0.35
       + tdScore   * 0.30
       + compScore * 0.15
       + intScore  * 0.10
       + winScore  * 0.10;
}

function scoreRushingStats(s: Record<string, number>, winPct: number): number {
  const rushYds = awardStat(s, "rush_yards");
  const rushTDs = awardStat(s, "rush_tds");
  const rushAtt = awardStat(s, "rush_attempts") || 1;
  const ypc     = rushYds / rushAtt;

  // Component normalizations (0-100 each):
  const ydsScore = Math.min(rushYds / 28, 100);                               // 2800 yds = 100
  const tdScore  = Math.min(rushTDs * 100 / 40, 100);                         // 40 TDs = 100
  const ypcScore = Math.min(Math.max((ypc - 3.5) / 3.5 * 100, 0), 100);      // 3.5–7.0 YPC → 0-100
  const winScore = winPct * 100;

  // 40% yards, 30% TDs, 15% YPC efficiency, 15% wins
  return ydsScore  * 0.40
       + tdScore   * 0.30
       + ypcScore  * 0.15
       + winScore  * 0.15;
}

function scoreReceivingStats(s: Record<string, number>, winPct: number): number {
  const recYds     = awardStat(s, "receiving_yards");
  const recTDs     = awardStat(s, "receiving_tds");
  const receptions = awardStat(s, "receptions");

  // Component normalizations (0-100 each):
  const ydsScore  = Math.min(recYds / 65, 100);            // 6500 yds = 100
  const tdScore   = Math.min(recTDs * 100 / 65, 100);      // 65 TDs = 100
  const recScore  = Math.min(receptions / 3, 100);         // 300 rec = 100; 0 when not tracked
  const winScore  = winPct * 100;

  // 45% yards, 35% TDs, 10% reception volume, 10% wins (receptions often absent — keep weight low)
  return ydsScore  * 0.45
       + tdScore   * 0.35
       + recScore  * 0.10
       + winScore  * 0.10;
}

function scoreDefensiveStats(s: Record<string, number>): number {
  const sacks   = awardStat(s, "sacks");
  const ints    = awardStat(s, "interceptions");
  const ff      = awardStat(s, "forced_fumbles");
  const tackles = awardStat(s, "tackles");

  // Component normalizations (0-100 each):
  const sacksScore   = Math.min(sacks * 100 / 60, 100);    // 60 sacks = 100
  const intsScore    = Math.min(ints * 100 / 25, 100);     // 25 INTs = 100
  const ffScore      = Math.min(ff * 100 / 15, 100);       // 15 FF = 100
  const tacklesScore = Math.min(tackles / 6, 100);         // 600 tackles = 100

  // 40% sacks, 30% INTs, 20% forced fumbles, 10% tackles
  return sacksScore   * 0.40
       + intsScore    * 0.30
       + ffScore      * 0.20
       + tacklesScore * 0.10;
}

function scoreOLStats(s: Record<string, number>): number {
  // sacks_taken = QB sacks taken across all QBs (proxy for sacks allowed by OL)
  // avgOlOvr = average overall rating of LT/LG/C/RG/RT, injected from getOLTeamRatings
  const passSacks = awardStat(s, "sacks_taken");
  const avgOlOvr  = s.avgOlOvr ?? 0;

  // Component normalizations (0-100 each):
  // Fewer sacks allowed = better: 0 allowed = 100, 50+ allowed = 0
  const sackScore = Math.min(Math.max((50 - passSacks) / 50 * 100, 0), 100);
  const ovrScore  = Math.min((avgOlOvr / 99) * 100, 100);

  // 60% sack prevention, 40% OL OVR
  return sackScore * 0.60 + ovrScore * 0.40;
}

function scoreDLStats(s: Record<string, number>): number {
  const sacks   = awardStat(s, "sacks");
  const ff      = awardStat(s, "forced_fumbles");
  const tackles = awardStat(s, "tackles");

  // Component normalizations (0-100 each):
  const sacksScore   = Math.min(sacks * 100 / 60, 100);    // 60 sacks = 100
  const ffScore      = Math.min(ff * 100 / 15, 100);       // 15 FF = 100
  const tacklesScore = Math.min(tackles / 6, 100);         // 600 tackles = 100

  // 65% sacks, 25% forced fumbles, 10% tackles
  return sacksScore   * 0.65
       + ffScore      * 0.25
       + tacklesScore * 0.10;
}

function scoreLBStats(s: Record<string, number>): number {
  const tackles = awardStat(s, "tackles");
  const sacks   = awardStat(s, "sacks");
  const ints    = awardStat(s, "interceptions");

  // Component normalizations (0-100 each):
  const tacklesScore = Math.min(tackles / 6, 100);          // 600 tackles = 100
  const sacksScore   = Math.min(sacks * 100 / 60, 100);     // 60 sacks = 100
  const intsScore    = Math.min(ints * 100 / 25, 100);      // 25 INTs = 100

  // 50% tackles, 30% sacks, 20% INTs
  return tacklesScore * 0.50
       + sacksScore   * 0.30
       + intsScore    * 0.20;
}

function scoreDBStats(s: Record<string, number>): number {
  const ints    = awardStat(s, "interceptions");
  const pd      = awardStat(s, "pass_deflections");
  const tackles = awardStat(s, "tackles");
  const defTDs  = awardStat(s, "defensive_tds");

  // Component normalizations (0-100 each):
  const intsScore    = Math.min(ints * 100 / 25, 100);      // 25 INTs = 100
  const pdScore      = Math.min(pd * 100 / 60, 100);        // 60 PDs = 100
  const tacklesScore = Math.min(tackles / 6, 100);          // 600 tackles = 100
  const tdScore      = Math.min(defTDs * 100 / 8, 100);     // 8 def TDs = 100

  // 45% INTs, 25% pass deflections, 20% tackles, 10% defensive TDs
  return intsScore    * 0.45
       + pdScore      * 0.25
       + tacklesScore * 0.20
       + tdScore      * 0.10;
}

function scoreKickerStats(s: Record<string, number>): number {
  // Canonical kicking keys (aliases cover Madden fGMade/fGAtt/xPMade/xPAtt/fGLongest)
  const fgMade = awardStat(s, "fg_made");
  const fgAtt = awardStat(s, "fg_attempts");
  const xpMade = awardStat(s, "xp_made");
  const xpAtt = awardStat(s, "xp_attempts");
  const longFG = awardStat(s, "fg_long");
  const totalAttempts = fgAtt + xpAtt;
  if (totalAttempts < 50) return 0; // Minimum 50 combined FG+XP attempts across season
  const fgPct = fgAtt > 0 ? fgMade / fgAtt : 0;
  const xpPct = xpAtt > 0 ? xpMade / xpAtt : 0;
  return fgPct * 100 * 0.55 + xpPct * 100 * 0.30 + (longFG / 60) * 100 * 0.15;
}


type CoachAssignment = {
  userId: string;
  teamId: string;
  teamName: string;
  teamOvr: number;
  discordId: string | null;
  displayName: string;
};

type PlayerAwardCandidate = {
  playerId: string;
  userId: string;
  teamId: string;
  teamName: string;
  coachDisplayName: string;
  playerName: string;
  position: string;
  yearsPro: number;
  stats: Record<string, number>;
  statsByCategory: Record<string, Record<string, number>>;
  winPct: number;
  scores: Record<string, number>;
};

type PlayerAwardDetail = {
  userId: string;
  playerId: string;
  playerName: string;
  position: string;
  teamName: string;
  displayLabel: string;
  statLine: string;
  rawStats: Record<string, unknown>;
  scoreBreakdown: Record<string, number>;
};

const OFFENSIVE_SKILL_POSITIONS = new Set(["QB", "HB", "FB", "WR", "TE"]);
const DEFENSIVE_POSITIONS = new Set(["DT", "LE", "RE", "REDGE", "LEDGE", "MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM", "CB", "FS", "SS"]);
const DL_POSITIONS = new Set(["DT", "LE", "RE", "REDGE", "LEDGE"]);
const LB_POSITIONS = new Set(["MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM"]);
const DB_POSITIONS = new Set(["CB", "FS", "SS"]);

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(Math.max(n, min), max);
}

function component(value: number, cap: number): number {
  return cap > 0 ? clamp((value / cap) * 100) : 0;
}

const STAT_ALIASES: Record<string, string[]> = {
  pass_yards: ["passYds", "passingYards", "passing_yards"],
  pass_tds: ["passTDs", "passingTDs", "passing_tds", "pass_tds"],
  pass_attempts: ["passAtt", "passAttempts", "passingAttempts", "pass_attempts"],
  pass_completions: ["passComp", "passCompletions", "passingCompletions", "pass_completions"],
  interceptions_thrown: ["passInts", "passINTs", "interceptionsThrown", "intsThrown", "interceptions_thrown"],
  sacks_taken: ["sacksTaken", "passSacks", "sacks_taken"],
  rush_yards: ["rushYds", "rushingYards", "rushing_yards"],
  rush_tds: ["rushTDs", "rushingTDs", "rushing_tds", "rush_tds"],
  rush_attempts: ["rushAtt", "rushAttempts", "rushingAttempts", "rush_attempts"],
  rushing_fumbles: ["rushFumbles", "rushingFumbles", "fumbles", "fumblesLost", "fumLost", "rushing_fumbles"],
  receiving_yards: ["recYds", "receivingYards", "receiving_yards"],
  receiving_tds: ["recTDs", "receivingTDs", "receiving_tds"],
  receptions: ["rec", "catches", "receptions"],
  receiving_drops: ["recDrops", "drops", "receivingDrops", "receiving_drops"],
  receiving_fumbles: ["recFumbles", "receivingFumbles", "fumbles", "fumblesLost", "receiving_fumbles"],
  tackles: ["defTotalTackles", "tackles", "soloTackles"],
  tackles_for_loss: ["defTFL", "tfl", "tacklesForLoss", "tackles_for_loss"],
  sacks: ["defSacks", "sacks"],
  interceptions: ["defInts", "defINTs", "interceptions", "ints"],
  forced_fumbles: ["defForcedFumbles", "forcedFumbles", "forced_fumbles", "ff"],
  fumble_recoveries: ["defFumbleRecoveries", "fumbleRecoveries", "fumble_recoveries", "fr"],
  pass_deflections: ["defPassDeflections", "passDeflections", "pass_deflections", "pd"],
  defensive_tds: ["defTDs", "defensiveTDs", "defensive_tds"],
  fg_made: ["fgMade", "fGMade", "fg_made"],
  fg_attempts: ["fgAtt", "fGAtt", "fgAttempts", "fg_attempts"],
  fg_long: ["fgLong", "fGLongest", "fg_long"],
  xp_made: ["xpMade", "xPMade", "xp_made"],
  xp_attempts: ["xpAtt", "xPAtt", "xpAttempts", "xp_attempts"]
};

function awardStat(stats: Record<string, number>, canonicalKey: string, extraAliases: string[] = []): number {
  const canonical = readStat(stats, canonicalKey);
  if (canonical) return canonical;
  for (const key of [...(STAT_ALIASES[canonicalKey] ?? []), ...extraAliases]) {
    const value = asNum((stats as any)[key]);
    if (value) return value;
  }
  return 0;
}

function looseStat(stats: Record<string, number>, canonicalKey: string, aliases: string[] = []): number {
  return awardStat(stats, canonicalKey, aliases);
}

function addStat(target: Record<string, number>, key: string, value: unknown) {
  const numeric = asNum(value);
  if (!numeric) return;
  if (key.toLowerCase().includes("long")) target[key] = Math.max(target[key] ?? 0, numeric);
  else target[key] = (target[key] ?? 0) + numeric;
}

function mergeStats(target: Record<string, number>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source ?? {})) addStat(target, key, value);
}

function yearsProFromPlayer(player: any): number {
  return asNum(player?.years_pro ?? player?.raw_payload?.yearsPro ?? player?.raw_payload?.years_pro ?? 0);
}

function scorePassingPlayer(stats: Record<string, number>): number {
  const passYds = awardStat(stats, "pass_yards");
  const passTds = awardStat(stats, "pass_tds");
  const attempts = awardStat(stats, "pass_attempts");
  const completions = awardStat(stats, "pass_completions");
  const ints = awardStat(stats, "interceptions_thrown");
  const sacksTaken = awardStat(stats, "sacks_taken");
  const compPct = attempts > 0 ? completions / attempts : 0;
  const ypa = attempts > 0 ? passYds / attempts : 0;

  const volume = component(passYds, 5000) * 0.36 + component(passTds, 45) * 0.29;
  const efficiency = clamp(((compPct - 0.54) / 0.18) * 100) * 0.16 + clamp(((ypa - 6.0) / 4.0) * 100) * 0.09;
  const turnoverPenalty = ints * 2.75 + sacksTaken * 0.18;
  return clamp(volume + efficiency + 10 - turnoverPenalty);
}

function scoreRushingPlayer(stats: Record<string, number>): number {
  const rushYds = awardStat(stats, "rush_yards");
  const rushTds = awardStat(stats, "rush_tds");
  const carries = awardStat(stats, "rush_attempts");
  const ypc = carries > 0 ? rushYds / carries : 0;
  const fumbles = looseStat(stats, "rushing_fumbles", ["fumbles_lost", "fumblesLost", "fumLost", "rush_fumbles_lost"]);

  const volume = component(rushYds, 1700) * 0.43 + component(rushTds, 22) * 0.30;
  const efficiency = clamp(((ypc - 3.6) / 2.6) * 100) * 0.17;
  const usage = component(carries, 280) * 0.05;
  const turnoverPenalty = fumbles * 3.25;
  return clamp(volume + efficiency + usage + 5 - turnoverPenalty);
}

function scoreReceivingPlayer(stats: Record<string, number>): number {
  const recYds = awardStat(stats, "receiving_yards");
  const recTds = awardStat(stats, "receiving_tds");
  const receptions = awardStat(stats, "receptions");
  const drops = awardStat(stats, "receiving_drops");
  const receivingFumbles = looseStat(stats, "receiving_fumbles", ["fumbles_lost", "fumblesLost", "recFumbles", "recFum", "receivingFumbles"]);
  const chances = receptions + drops;
  const catchPct = chances > 0 ? receptions / chances : 1;

  const volume = component(recYds, 1700) * 0.43 + component(recTds, 18) * 0.28 + component(receptions, 115) * 0.12;
  const efficiency = clamp(((recYds / Math.max(receptions, 1)) - 9) / 8 * 100) * 0.07;
  const dropPenalty = drops * 1.35;
  const fumblePenalty = receivingFumbles * 3.25;
  const catchPenalty = chances >= 20 && catchPct < 0.55 ? (0.55 - catchPct) * 55 : 0;
  return clamp(volume + efficiency + 10 - dropPenalty - fumblePenalty - catchPenalty);
}

function scoreDefensivePlayer(stats: Record<string, number>, position: string): number {
  const tackles = awardStat(stats, "tackles");
  const tfl = awardStat(stats, "tackles_for_loss");
  const sacks = awardStat(stats, "sacks");
  const ints = awardStat(stats, "interceptions");
  const ff = awardStat(stats, "forced_fumbles");
  const fr = awardStat(stats, "fumble_recoveries");
  const pd = awardStat(stats, "pass_deflections");
  const defTds = awardStat(stats, "defensive_tds");

  if (DL_POSITIONS.has(position)) {
    return clamp(component(sacks, 22) * 0.42 + component(tfl, 28) * 0.18 + component(ff, 7) * 0.16 + component(tackles, 80) * 0.14 + component(defTds, 3) * 0.10);
  }
  if (LB_POSITIONS.has(position)) {
    return clamp(component(tackles, 150) * 0.34 + component(tfl, 24) * 0.18 + component(sacks, 16) * 0.20 + component(ints, 6) * 0.12 + component(ff + fr, 7) * 0.10 + component(defTds, 3) * 0.06);
  }
  if (DB_POSITIONS.has(position)) {
    return clamp(component(ints, 10) * 0.32 + component(pd, 24) * 0.22 + component(tackles, 90) * 0.17 + component(ff + fr, 6) * 0.12 + component(defTds, 4) * 0.17);
  }
  return clamp(component(tackles, 100) * 0.25 + component(sacks, 15) * 0.25 + component(ints, 8) * 0.20 + component(ff + fr, 7) * 0.15 + component(defTds, 4) * 0.15);
}

function scoreKickerPlayer(stats: Record<string, number>): number {
  return scoreKickerStats(stats);
}

function scoreOffensiveImpact(candidate: PlayerAwardCandidate): number {
  const passing = scorePassingPlayer(candidate.stats);
  const rushing = scoreRushingPlayer(candidate.stats);
  const receiving = scoreReceivingPlayer(candidate.stats);
  const position = candidate.position;

  if (position === "QB") return clamp(passing * 0.76 + rushing * 0.22 + receiving * 0.02 + candidate.winPct * 100 * 0.04);
  if (position === "HB" || position === "FB") return clamp(rushing * 0.70 + receiving * 0.27 + passing * 0.03 + candidate.winPct * 100 * 0.03);
  if (position === "WR" || position === "TE") return clamp(receiving * 0.78 + rushing * 0.17 + passing * 0.05 + candidate.winPct * 100 * 0.03);
  return clamp(Math.max(passing, rushing, receiving));
}

function roleGroup(position: string): string {
  if (position === "QB") return "QB";
  if (position === "HB" || position === "FB") return "RB";
  if (position === "WR" || position === "TE") return "REC";
  if (DL_POSITIONS.has(position)) return "FRONT";
  if (LB_POSITIONS.has(position)) return "LB";
  if (DB_POSITIONS.has(position)) return "DB";
  if (position === "K") return "K";
  return position || "UNK";
}

function relativeScores(candidates: PlayerAwardCandidate[], scoreFor: (candidate: PlayerAwardCandidate) => number): Map<string, number> {
  const bySpecific = new Map<string, PlayerAwardCandidate[]>();
  const byRole = new Map<string, PlayerAwardCandidate[]>();
  for (const candidate of candidates) {
    const specific = candidate.position || "UNK";
    const role = roleGroup(candidate.position);
    bySpecific.set(specific, [...(bySpecific.get(specific) ?? []), candidate]);
    byRole.set(role, [...(byRole.get(role) ?? []), candidate]);
  }

  const out = new Map<string, number>();
  for (const candidate of candidates) {
    const group = (bySpecific.get(candidate.position) ?? []).length >= 3
      ? (bySpecific.get(candidate.position) ?? [])
      : (byRole.get(roleGroup(candidate.position)) ?? []);
    const values = group.map(scoreFor);
    const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / Math.max(values.length, 1);
    const stdDev = Math.sqrt(variance) || 1;
    const z = (scoreFor(candidate) - avg) / stdDev;
    out.set(candidate.playerId, clamp(50 + z * 15));
  }
  return out;
}

function statText(key: string, value: number): string | null {
  if (!value) return null;
  return `${formatStatValue(key, value)} ${getStatShortLabel(key)}`;
}

function buildAwardStatLine(awardKey: string, candidate: PlayerAwardCandidate): string {
  const s = candidate.stats;
  const parts: Array<string | null> = [];
  if (["best_qb", "opoy", "offensive_rookie"].includes(awardKey) || (awardKey === "mvp" && scoreOffensiveImpact(candidate) >= scoreDefensivePlayer(candidate.stats, candidate.position))) {
    if (awardStat(s, "pass_yards") > 0) parts.push(statText("pass_yards", awardStat(s, "pass_yards")), statText("pass_tds", awardStat(s, "pass_tds")), statText("interceptions_thrown", awardStat(s, "interceptions_thrown")));
    if (awardStat(s, "rush_yards") > 0) parts.push(statText("rush_yards", awardStat(s, "rush_yards")), statText("rush_tds", awardStat(s, "rush_tds")));
    if (awardStat(s, "receiving_yards") > 0) parts.push(statText("receiving_yards", awardStat(s, "receiving_yards")), statText("receiving_tds", awardStat(s, "receiving_tds")));
    if (awardStat(s, "receiving_drops") > 0) parts.push(statText("receiving_drops", awardStat(s, "receiving_drops")));
  } else if (["best_rb"].includes(awardKey)) {
    parts.push(statText("rush_yards", awardStat(s, "rush_yards")), statText("rush_tds", awardStat(s, "rush_tds")), statText("receiving_yards", awardStat(s, "receiving_yards")), statText("rushing_fumbles", awardStat(s, "rushing_fumbles")));
  } else if (["best_wr"].includes(awardKey)) {
    parts.push(statText("receiving_yards", awardStat(s, "receiving_yards")), statText("receiving_tds", awardStat(s, "receiving_tds")), statText("receptions", awardStat(s, "receptions")), statText("receiving_drops", awardStat(s, "receiving_drops")));
  } else if (["best_kicker"].includes(awardKey)) {
    parts.push(statText("fg_made", awardStat(s, "fg_made")), statText("fg_attempts", awardStat(s, "fg_attempts")), statText("fg_long", awardStat(s, "fg_long")), statText("xp_made", awardStat(s, "xp_made")));
  } else {
    parts.push(statText("tackles", awardStat(s, "tackles")), statText("sacks", awardStat(s, "sacks")), statText("interceptions", awardStat(s, "interceptions")), statText("forced_fumbles", awardStat(s, "forced_fumbles")), statText("pass_deflections", awardStat(s, "pass_deflections")), statText("defensive_tds", awardStat(s, "defensive_tds")));
    if (awardStat(s, "pass_yards") || awardStat(s, "rush_yards") || awardStat(s, "receiving_yards")) {
      parts.push(statText("pass_yards", awardStat(s, "pass_yards")), statText("rush_yards", awardStat(s, "rush_yards")), statText("receiving_yards", awardStat(s, "receiving_yards")));
    }
  }
  return parts.filter(Boolean).slice(0, 7).join(" · ") || "Impact score built from season totals.";
}

async function getPlayerAwardCandidates(
  leagueId: string,
  seasonNumber: number,
  coachByTeamId: Map<string, CoachAssignment>,
  seasonRecords: Map<string, { wins: number; losses: number; ties: number; pd: number; games: number }>
): Promise<PlayerAwardCandidate[]> {
  const categories = ["passing", "rushing", "receiving", "defense", "kicking"];
  const pages = await Promise.all(categories.map((category) =>
    selectAllPages<any>((from, to) =>
      supabase
        .from("rec_player_weekly_stats")
        .select("player_id,team_id,stat_category,stats,rec_players(full_name,position,raw_payload,years_pro)")
        .eq("league_id", leagueId)
        .eq("season_number", seasonNumber)
        .eq("season_stage", "regular_season")
        .eq("stat_category", category)
        .range(from, to)
    )
  ));

  const byPlayer = new Map<string, PlayerAwardCandidate>();
  for (const rows of pages) {
    for (const row of rows ?? []) {
      const teamId = String(row.team_id ?? "");
      const playerId = String(row.player_id ?? "");
      const coach = coachByTeamId.get(teamId);
      if (!teamId || !playerId || !coach) continue;
      const player = row.rec_players as any;
      const position = String(player?.position ?? "").toUpperCase();
      const record = seasonRecords.get(coach.userId);
      const winPct = record && record.games > 0 ? record.wins / record.games : 0;
      if (!byPlayer.has(playerId)) {
        byPlayer.set(playerId, {
          playerId,
          userId: coach.userId,
          teamId,
          teamName: coach.teamName,
          coachDisplayName: coach.displayName,
          playerName: player?.full_name ?? "Unknown",
          position,
          yearsPro: yearsProFromPlayer(player),
          stats: {},
          statsByCategory: {},
          winPct,
          scores: {}
        });
      }
      const candidate = byPlayer.get(playerId)!;
      const category = String(row.stat_category ?? "unknown");
      if (!candidate.statsByCategory[category]) candidate.statsByCategory[category] = {};
      mergeStats(candidate.statsByCategory[category], row.stats ?? {});
      mergeStats(candidate.stats, row.stats ?? {});
    }
  }

  for (const candidate of byPlayer.values()) {
    candidate.scores.passing = scorePassingPlayer(candidate.stats);
    candidate.scores.rushing = scoreRushingPlayer(candidate.stats);
    candidate.scores.receiving = scoreReceivingPlayer(candidate.stats);
    candidate.scores.offense = scoreOffensiveImpact(candidate);
    candidate.scores.defense = scoreDefensivePlayer(candidate.stats, candidate.position);
    candidate.scores.kicking = scoreKickerPlayer(candidate.stats);
  }

  return [...byPlayer.values()];
}

function buildPlayerAwardScoreMaps(candidates: PlayerAwardCandidate[]) {
  const rawScores: Record<string, Map<string, number>> = {};
  const detailsByAward = new Map<string, Map<string, PlayerAwardDetail>>();
  const mvpBase = new Map<string, number>();
  const mvpRelative = relativeScores(candidates, (candidate) => Math.max(candidate.scores.offense, candidate.scores.defense));

  function add(awardKey: string, candidate: PlayerAwardCandidate, rawScore: number) {
    if (!Number.isFinite(rawScore) || rawScore <= 0) return;
    if (!rawScores[awardKey]) rawScores[awardKey] = new Map();
    const existing = rawScores[awardKey].get(candidate.userId) ?? -Infinity;
    if (rawScore <= existing) return;
    rawScores[awardKey].set(candidate.userId, rawScore);
    if (!detailsByAward.has(awardKey)) detailsByAward.set(awardKey, new Map());
    detailsByAward.get(awardKey)!.set(candidate.userId, {
      userId: candidate.userId,
      playerId: candidate.playerId,
      playerName: candidate.playerName,
      position: candidate.position,
      teamName: candidate.teamName,
      displayLabel: `${candidate.playerName} (${candidate.position || "?"}) · ${candidate.teamName}`,
      statLine: buildAwardStatLine(awardKey, candidate),
      rawStats: {
        playerId: candidate.playerId,
        playerName: candidate.playerName,
        position: candidate.position,
        yearsPro: candidate.yearsPro,
        statLine: buildAwardStatLine(awardKey, candidate),
        stats: candidate.stats,
        statsByCategory: candidate.statsByCategory,
        scoreBreakdown: candidate.scores
      },
      scoreBreakdown: candidate.scores
    });
  }

  for (const candidate of candidates) {
    const twoWayBonus = Math.min(Math.min(candidate.scores.offense, candidate.scores.defense) * 0.18, 10);
    const baseImpact = Math.max(candidate.scores.offense, candidate.scores.defense) + twoWayBonus + candidate.winPct * 100 * 0.04;
    mvpBase.set(candidate.playerId, baseImpact);
  }

  for (const candidate of candidates) {
    const relative = mvpRelative.get(candidate.playerId) ?? 50;
    const mvpScore = clamp((mvpBase.get(candidate.playerId) ?? 0) * 0.60 + relative * 0.40);
    add("mvp", candidate, mvpScore);

    if (OFFENSIVE_SKILL_POSITIONS.has(candidate.position)) {
      if (candidate.yearsPro > 0) add("opoy", candidate, candidate.scores.offense);
      if (candidate.yearsPro === 0) add("offensive_rookie", candidate, candidate.scores.offense);
    }
    if (DEFENSIVE_POSITIONS.has(candidate.position)) {
      if (candidate.yearsPro > 0) add("dpoy", candidate, candidate.scores.defense);
      if (candidate.yearsPro === 0) add("defensive_rookie", candidate, candidate.scores.defense);
    }
    if (candidate.position === "QB" && awardStat(candidate.stats, "pass_attempts") >= 80) {
      add("best_qb", candidate, clamp(candidate.scores.passing * 0.78 + candidate.scores.rushing * 0.20 + candidate.scores.receiving * 0.02));
    }
    if ((candidate.position === "HB" || candidate.position === "FB") && (awardStat(candidate.stats, "rush_attempts") >= 50 || awardStat(candidate.stats, "rush_yards") >= 300)) {
      add("best_rb", candidate, clamp(candidate.scores.rushing * 0.72 + candidate.scores.receiving * 0.25 + candidate.scores.passing * 0.03));
    }
    if ((candidate.position === "WR" || candidate.position === "TE") && (awardStat(candidate.stats, "receptions") >= 15 || awardStat(candidate.stats, "receiving_yards") >= 250)) {
      add("best_wr", candidate, clamp(candidate.scores.receiving * 0.80 + candidate.scores.rushing * 0.15 + candidate.scores.passing * 0.05));
    }
    if (DL_POSITIONS.has(candidate.position)) add("best_dl", candidate, candidate.scores.defense);
    if (LB_POSITIONS.has(candidate.position)) add("best_lb", candidate, candidate.scores.defense);
    if (DB_POSITIONS.has(candidate.position)) add("best_db", candidate, candidate.scores.defense);
    if (candidate.position === "K") add("best_kicker", candidate, candidate.scores.kicking);
  }

  return { rawScores, detailsByAward };
}

// Maps award key → which stat category + Madden positions identify the representative player
const POSITION_AWARD_PLAYER_CONFIG: Record<string, { category: string; positions: string[]; rankByStat: string; rookieFilter?: "veteran_only" | "rookie_only" }> = {
  best_qb: { category: "passing", positions: ["QB"], rankByStat: "pass_yards" },
  best_rb: { category: "rushing", positions: ["HB"], rankByStat: "rush_yards" },
  best_wr: { category: "receiving", positions: ["WR", "TE"], rankByStat: "receiving_yards" },
  best_dl: { category: "defense", positions: ["DT", "REDGE", "LEDGE"], rankByStat: "sacks" },
  best_lb: { category: "defense", positions: ["MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM"], rankByStat: "tackles" },
  best_db: { category: "defense", positions: ["CB", "FS", "SS"], rankByStat: "interceptions" },
  best_kicker: { category: "kicking", positions: ["K"], rankByStat: "fg_made" },
  // Composite: best player across all offensive positions
  mvp: { category: "passing", positions: ["QB", "HB", "WR", "TE"], rankByStat: "pass_yards" },
  opoy: { category: "passing", positions: ["QB", "HB", "WR", "TE"], rankByStat: "pass_yards", rookieFilter: "veteran_only" },
  offensive_rookie: { category: "passing", positions: ["QB", "HB", "WR", "TE"], rankByStat: "pass_yards", rookieFilter: "rookie_only" },
  // Composite: best player across all defensive positions
  dpoy: { category: "defense", positions: ["DT", "REDGE", "LEDGE", "MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM", "CB", "FS", "SS"], rankByStat: "sacks", rookieFilter: "veteran_only" },
  defensive_rookie: { category: "defense", positions: ["DT", "REDGE", "LEDGE", "MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM", "CB", "FS", "SS"], rankByStat: "sacks", rookieFilter: "rookie_only" },
};

// For composite awards (mvp, opoy, dpoy) that span multiple stat categories,
// also pull rushing/receiving so RBs and WRs compete with QBs fairly.
const COMPOSITE_EXTRA_CATEGORIES: Record<string, string[]> = {
  mvp: ["rushing", "receiving"],
  opoy: ["rushing", "receiving"],
  offensive_rookie: ["rushing", "receiving"],
};

// Returns the best individual Madden player per team for position awards (by primary rankByStat).
// For composite awards, competitions are ranked by the highest value across all their categories.
// rookieFilter: "veteran_only" excludes players with yearsPro === 0; "rookie_only" requires yearsPro === 0.
async function getTopPlayerPerTeam(
  leagueId: string,
  seasonNumber: number,
  config: { category: string; positions: string[]; rankByStat: string; rookieFilter?: "veteran_only" | "rookie_only" },
  extraCategories: string[] = []
): Promise<Map<string, { playerName: string; position: string }>> {
  const categories = [config.category, ...extraCategories];
  const posSet = new Set(config.positions);

  const results = await Promise.all(
    categories.map((cat) =>
      selectAllPages<any>((from, to) =>
        supabase
          .from("rec_player_weekly_stats")
          .select("player_id,team_id,stats,rec_players(full_name,position,raw_payload)")
          .eq("league_id", leagueId)
          .eq("season_number", seasonNumber)
          .eq("season_stage", "regular_season")
          .eq("stat_category", cat)
          .range(from, to)
      )
    )
  );

  // Accumulate per player + team
  const playerAgg = new Map<string, { teamId: string; playerName: string; position: string; stats: Record<string, number> }>();
  for (const result of results) {
    for (const row of result ?? []) {
      const teamId = String(row.team_id ?? "");
      const playerId = String((row as any).player_id ?? "");
      if (!teamId || !playerId) continue;
      const playerRec = (row as any).rec_players;
      const position = String(playerRec?.position ?? "");
      if (!posSet.has(position)) continue;
      // Apply rookie/veteran filter using Madden's yearsPro field from raw_payload
      if (config.rookieFilter) {
        const yearsPro = playerRec?.raw_payload?.yearsPro;
        if (config.rookieFilter === "veteran_only" && yearsPro === 0) continue;
        if (config.rookieFilter === "rookie_only" && yearsPro !== 0) continue;
      }
      const key = `${teamId}:::${playerId}`;
      if (!playerAgg.has(key)) {
        playerAgg.set(key, { teamId, playerName: playerRec?.full_name ?? "Unknown", position, stats: {} });
      }
      const agg = playerAgg.get(key)!;
      for (const [k, v] of Object.entries((row.stats ?? {}) as Record<string, unknown>)) {
        agg.stats[k] = (agg.stats[k] ?? 0) + asNum(v);
      }
    }
  }

  // Pick the highest-ranked player per team
  const bestPerTeam = new Map<string, { playerName: string; position: string; topVal: number }>();
  for (const [, { teamId, playerName, position, stats }] of playerAgg) {
    const val = awardStat(stats, config.rankByStat);
    const existing = bestPerTeam.get(teamId);
    if (!existing || val > existing.topVal) {
      bestPerTeam.set(teamId, { playerName, position, topVal: val });
    }
  }

  return new Map([...bestPerTeam.entries()].map(([tid, { playerName, position }]) => [tid, { playerName, position }]));
}

// Build nominees list for one award, returning top N sorted by performance score
function topN(rawMap: Map<string, number>, n: number): { userId: string; rawScore: number }[] {
  return [...rawMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([userId, rawScore]) => ({ userId, rawScore }));
}

export async function generateAwardNominees(guildId: string) {
  const { leagueId, league, routes } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const coaches = (await getActiveCoaches(leagueId)) as CoachAssignment[];
  if (!coaches.length) {
    return {
      generated: 0,
      awards: [],
      diagnostics: {
        earlyReturn: "no_active_coaches",
        leagueId,
        seasonNumber,
        activeCoaches: 0
      },
      leagueId,
      seasonNumber,
      announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
    };
  }

  const userIds = coaches.map((c: CoachAssignment) => c.userId);
  const teamByUser = new Map<string, CoachAssignment>(coaches.map((c: CoachAssignment) => [c.userId, c]));
  const teamByTeamId = new Map<string, CoachAssignment>(coaches.map((c: CoachAssignment) => [c.teamId, c]));

  const [allTeamStats, passingStats, rushingStats, receivingStats, defStats, kickingStats, seasonRecords, priorSeasonRecords, olTeamRatings] = await Promise.all([
    getTeamSeasonStats(leagueId, seasonNumber),
    getTeamStatsByCategory(leagueId, seasonNumber, "passing"),
    getTeamStatsByCategory(leagueId, seasonNumber, "rushing"),
    getTeamStatsByCategory(leagueId, seasonNumber, "receiving"),
    getTeamStatsByCategory(leagueId, seasonNumber, "defense"),
    getTeamStatsByCategory(leagueId, seasonNumber, "kicking"),
    getSeasonRecords(leagueId, seasonNumber),
    getPriorSeasonRecords(leagueId, seasonNumber),
    getOLTeamRatings(leagueId)
  ]);

  const [upsetWins, sosMap, streamCounts, challengeCounts, badgeCounts, playerAwardCandidates] = await Promise.all([
    getUpsetWins(leagueId, seasonNumber, new Map<string, { wins: number; games: number }>(coaches.map((c: CoachAssignment) => [c.userId, { wins: seasonRecords.get(c.userId)?.wins ?? 0, games: seasonRecords.get(c.userId)?.games ?? 0 }]))),
    getStrengthOfSchedule(leagueId, seasonNumber, new Map<string, { wins: number; games: number }>(coaches.map((c: CoachAssignment) => [c.userId, { wins: seasonRecords.get(c.userId)?.wins ?? 0, games: seasonRecords.get(c.userId)?.games ?? 0 }]))),
    getStreamCounts(leagueId, seasonNumber, userIds),
    getChallengeCounts(leagueId, seasonNumber, userIds),
    getBadgeCounts(leagueId, userIds),
    getPlayerAwardCandidates(leagueId, seasonNumber, teamByTeamId, seasonRecords)
  ]);

  const playerAwardData = buildPlayerAwardScoreMaps(playerAwardCandidates);

  // Pre-fetch best individual Madden player per team for every position-based award.
  // This powers "PlayerName · TeamName" display labels in voting embeds.
  const positionAwardKeys = Object.keys(POSITION_AWARD_PLAYER_CONFIG);
  const positionPlayerMaps = await Promise.all(
    positionAwardKeys.map((key) =>
      getTopPlayerPerTeam(
        leagueId, seasonNumber,
        POSITION_AWARD_PLAYER_CONFIG[key],
        COMPOSITE_EXTRA_CATEGORIES[key] ?? []
      )
    )
  );
  // playersByAward: awardKey → (teamId → { playerName, position })
  const playersByAward = new Map(positionAwardKeys.map((key, i) => [key, positionPlayerMaps[i]]));

  // Build score maps per award key
  const rawScores: Record<string, Map<string, number>> = {};
  const rawStatsPerUser: Record<string, Record<string, Record<string, number>>> = {};

  for (const coach of coaches) {
    const { userId, teamId } = coach;
    const rec = seasonRecords.get(userId) ?? { wins: 0, losses: 0, ties: 0, pd: 0, games: 0 };
    const winPct = rec.games > 0 ? rec.wins / rec.games : 0;
    const teamAllStats = allTeamStats.get(teamId) ?? {};
    const teamPassStats = passingStats.get(teamId) ?? {};
    const teamRushStats = rushingStats.get(teamId) ?? {};
    const teamRecStats = receivingStats.get(teamId) ?? {};
    const teamDefStats = defStats.get(teamId) ?? {};
    const teamKickStats = kickingStats.get(teamId) ?? {};
    const totalOffYds = awardStat(teamAllStats, "pass_yards") + awardStat(teamAllStats, "rush_yards");

    rawStatsPerUser[userId] = {
      all: teamAllStats, passing: teamPassStats, rushing: teamRushStats,
      receiving: teamRecStats, defense: teamDefStats, kicking: teamKickStats
    };

    // MVP: best of QB, RB, WR paths
    const mvpScore = Math.max(
      scorePassingStats(teamPassStats, winPct),
      scoreRushingStats(teamRushStats, winPct),
      scoreReceivingStats(teamRecStats, winPct)
    );
    if (!rawScores.mvp) rawScores.mvp = new Map();
    rawScores.mvp.set(userId, mvpScore);

    // Coach of the Year: 40% win%, 20% improvement, 15% SOS, 15% upsets, 10% PD
    const priorRec = priorSeasonRecords.get(userId);
    const priorWinPct = priorRec && priorRec.games > 0 ? priorRec.wins / priorRec.games : 0;
    const improvement = Math.max(0, winPct - priorWinPct);
    const sos = sosMap.get(userId) ?? 0;
    const upsets = upsetWins.get(userId) ?? 0;
    const cotyScore = winPct * 100 * 0.40 + improvement * 100 * 0.20 + sos * 100 * 0.15 + Math.min(upsets, 5) * 20 * 0.15 + Math.min(Math.max(rec.pd + 200, 0), 400) / 4 * 0.10;
    if (!rawScores.coach_of_the_year) rawScores.coach_of_the_year = new Map();
    rawScores.coach_of_the_year.set(userId, cotyScore);

    // opoyScore and offensive_rookie use the same composite formula as MVP
    const opoyScore = mvpScore;
    const dpoyScore = scoreDefensiveStats(teamDefStats);

    // OPOY: only teams whose best offensive player has years_pro > 0
    if (playersByAward.get("opoy")?.get(teamId)) {
      if (!rawScores.opoy) rawScores.opoy = new Map();
      rawScores.opoy.set(userId, opoyScore);
    }

    // DPOY: only teams whose best defensive player has years_pro > 0
    if (playersByAward.get("dpoy")?.get(teamId)) {
      if (!rawScores.dpoy) rawScores.dpoy = new Map();
      rawScores.dpoy.set(userId, dpoyScore);
    }

    // Offensive Rookie: only teams whose best offensive player has years_pro === 0
    if (playersByAward.get("offensive_rookie")?.get(teamId)) {
      if (!rawScores.offensive_rookie) rawScores.offensive_rookie = new Map();
      rawScores.offensive_rookie.set(userId, opoyScore);
    }

    // Defensive Rookie: only teams whose best defensive player has years_pro === 0
    if (playersByAward.get("defensive_rookie")?.get(teamId)) {
      if (!rawScores.defensive_rookie) rawScores.defensive_rookie = new Map();
      rawScores.defensive_rookie.set(userId, dpoyScore);
    }

    // Best QB
    const qbScore = scorePassingStats(teamPassStats, winPct);
    if (!rawScores.best_qb) rawScores.best_qb = new Map();
    rawScores.best_qb.set(userId, qbScore);

    // Best RB
    const rbScore = scoreRushingStats(teamRushStats, winPct);
    if (!rawScores.best_rb) rawScores.best_rb = new Map();
    rawScores.best_rb.set(userId, rbScore);

    // Best WR
    const wrScore = scoreReceivingStats(teamRecStats, winPct);
    if (!rawScores.best_wr) rawScores.best_wr = new Map();
    rawScores.best_wr.set(userId, wrScore);

    // Best OL (team award: sacks allowed via QB passSacks + avg OL OVR)
    const olScore = scoreOLStats({ ...teamPassStats, avgOlOvr: olTeamRatings.get(teamId) ?? 0 });
    if (!rawScores.best_ol) rawScores.best_ol = new Map();
    rawScores.best_ol.set(userId, olScore);

    // Best DL
    const dlScore = scoreDLStats(teamDefStats);
    if (!rawScores.best_dl) rawScores.best_dl = new Map();
    rawScores.best_dl.set(userId, dlScore);

    // Best LB
    const lbScore = scoreLBStats(teamDefStats);
    if (!rawScores.best_lb) rawScores.best_lb = new Map();
    rawScores.best_lb.set(userId, lbScore);

    // Best DB
    const dbScore = scoreDBStats(teamDefStats);
    if (!rawScores.best_db) rawScores.best_db = new Map();
    rawScores.best_db.set(userId, dbScore);

    // Best Kicker
    const kickScore = scoreKickerStats(teamKickStats);
    if (!rawScores.best_kicker) rawScores.best_kicker = new Map();
    rawScores.best_kicker.set(userId, kickScore);

    // Commissioner's Award — all coaches, voting only, performance score = 0
    if (!rawScores.commissioners_award) rawScores.commissioners_award = new Map();
    rawScores.commissioners_award.set(userId, 0);

    // Best H2H Record
    const h2hScore = rec.games >= 8 ? winPct * 100 : -1;
    if (!rawScores.best_h2h_record) rawScores.best_h2h_record = new Map();
    if (h2hScore >= 0) rawScores.best_h2h_record.set(userId, h2hScore);

    // Best Streamer
    const streamScore = streamCounts.get(userId) ?? 0;
    if (!rawScores.best_streamer) rawScores.best_streamer = new Map();
    if (streamScore > 0) rawScores.best_streamer.set(userId, streamScore);

    // Challenge King
    const challengeData = challengeCounts.get(userId) ?? { total: 0, sTier: 0, aTier: 0 };
    const challengeScore = challengeData.total * 1 + challengeData.sTier * 2 + challengeData.aTier * 1;
    if (!rawScores.challenge_king) rawScores.challenge_king = new Map();
    if (challengeScore > 0) rawScores.challenge_king.set(userId, challengeScore);

    // Badge Collector
    const badgeData = badgeCounts.get(userId) ?? { total: 0, platinum: 0, gold: 0, silver: 0 };
    const badgeScore = badgeData.total + badgeData.platinum * 3 + badgeData.gold * 2 + badgeData.silver;
    if (!rawScores.badge_collector) rawScores.badge_collector = new Map();
    if (badgeScore > 0) rawScores.badge_collector.set(userId, badgeScore);

    // Best Roster Construction
    const rosterScore = coach.teamOvr;
    if (!rawScores.best_roster) rawScores.best_roster = new Map();
    if (rosterScore > 0) rawScores.best_roster.set(userId, rosterScore);
  }

  for (const [awardKey, scoreMap] of Object.entries(playerAwardData.rawScores)) {
    rawScores[awardKey] = scoreMap;
  }

  const votingClosesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const generatedAwards: any[] = [];

  const allCoachUserIds = [...teamByUser.keys()];

  for (const def of AWARD_DEFINITIONS) {
    let scoreMap = rawScores[def.key];
    let nomineeCap = def.nomineeCount;
    if (!scoreMap?.size) {
      if (def.requiresVoting && allCoachUserIds.length > 0) {
        // Voting award with no stat basis (e.g. Best Streamer with no logged streams) — still launch
        // the poll by nominating all active coaches so the league can vote.
        scoreMap = new Map<string, number>(allCoachUserIds.map((uid) => [uid, 0]));
        nomineeCap = Math.min(allCoachUserIds.length, 25);
      } else {
        // Non-voting (auto-awarded) category with no data → record as no_nominees.
        const { data: award } = await supabase
          .from("rec_awards")
          .upsert({
            league_id: leagueId,
            season_number: seasonNumber,
            award_key: def.key,
            award_name: def.name,
            award_category: def.category,
            requires_voting: def.requiresVoting,
            payout_amount: def.payoutAmount,
            status: "no_nominees",
            updated_at: nowIso()
          }, { onConflict: "league_id,season_number,award_key", ignoreDuplicates: false })
          .select("id")
          .maybeSingle();
        if (award?.id) generatedAwards.push({ awardId: award.id, key: def.key, name: def.name, nomineeCount: 0, status: "no_nominees" });
        continue;
      }
    }

    const nominees = topN(scoreMap, nomineeCap);
    const normalizedScores = normalizeScores(new Map(nominees.map((n) => [n.userId, n.rawScore])));

    const { data: award } = await supabase
      .from("rec_awards")
      .upsert({
        league_id: leagueId,
        season_number: seasonNumber,
        award_key: def.key,
        award_name: def.name,
        award_category: def.category,
        requires_voting: def.requiresVoting,
        payout_amount: def.payoutAmount,
        status: def.requiresVoting ? "voting" : "commissioner_review",
        voting_opens_at: def.requiresVoting ? new Date().toISOString() : null,
        voting_closes_at: def.requiresVoting ? votingClosesAt : null,
        updated_at: nowIso()
      }, { onConflict: "league_id,season_number,award_key", ignoreDuplicates: false })
      .select("id")
      .maybeSingle();

    if (!award?.id) continue;

    // For position-based awards, surface the named Madden player so voters see
    // "Patrick Mahomes · Chiefs" rather than just the coach's Discord name.
    const positionPlayerMap = playersByAward.get(def.key);
    const awardDetailMap = playerAwardData.detailsByAward.get(def.key);
    const nomineeRows = nominees
      .map((nominee) => {
        const coach = teamByUser.get(nominee.userId);
        if (!coach) return null;
        const playerDetail = awardDetailMap?.get(nominee.userId) ?? null;
        const playerInfo = positionPlayerMap?.get(coach.teamId) ?? null;
        const performanceScore = Math.round((normalizedScores.get(nominee.userId) ?? 0) * 100) / 100;
        const displayLabel = playerDetail?.displayLabel
          ?? (playerInfo ? `${playerInfo.playerName} (${playerInfo.position}) · ${coach.teamName}` : `${coach.teamName} (${coach.displayName})`);
        return {
          award_id: award.id,
          user_id: nominee.userId,
          team_name: coach.teamName,
          performance_score: performanceScore,
          vote_count: 0,
          final_score: performanceScore,
          display_label: displayLabel,
          player_name: playerDetail?.playerName ?? playerInfo?.playerName ?? null,
          raw_stats: playerDetail?.rawStats ?? rawStatsPerUser[nominee.userId] ?? null,
          updated_at: nowIso()
        };
      })
      .filter(Boolean) as any[];

    if (nomineeRows.length > 0) {
      await supabase.from("rec_award_nominees").upsert(nomineeRows, { onConflict: "award_id,user_id", ignoreDuplicates: false });
    }

    if (!def.requiresVoting) {
      // Auto-determine winner for non-voting awards
      const topNominee = nominees[0];
      if (topNominee) {
        const coach = teamByUser.get(topNominee.userId);
        await supabase.from("rec_awards").update({
          status: "commissioner_review",
          updated_at: nowIso()
        }).eq("id", award.id);
      }
    }

    // Fetch nominees with discord IDs for bot embed building — use same label as DB rows
    const nomineeOptions: Array<{ userId: string; discordId: string | null; displayLabel: string; performanceScore: number; statLine?: string; voteCount: number; liveScore: number }> = [];
    for (const nominee of nominees) {
      const coach = teamByUser.get(nominee.userId);
      if (!coach) continue;
      const playerDetail = awardDetailMap?.get(nominee.userId) ?? null;
      const playerInfo = positionPlayerMap?.get(coach.teamId) ?? null;
      const performanceScore = Math.round((normalizedScores.get(nominee.userId) ?? 0) * 100) / 100;
      const displayLabel = playerDetail?.displayLabel
        ?? (playerInfo ? `${playerInfo.playerName} (${playerInfo.position}) · ${coach.teamName}` : `${coach.teamName} (${coach.displayName})`);
      nomineeOptions.push({ userId: nominee.userId, discordId: coach.discordId, displayLabel, performanceScore, statLine: playerDetail?.statLine, voteCount: 0, liveScore: performanceScore });
    }

    generatedAwards.push({
      awardId: award.id,
      key: def.key,
      name: def.name,
      description: def.description,
      nomineeCount: nominees.length,
      status: def.requiresVoting ? "voting" : "commissioner_review",
      nomineeOptions
    });
  }

  const diagnostics = {
    leagueId,
    seasonNumber,
    generatedAwards: generatedAwards.length,
    activeCoaches: coaches.length,
    playerAwardCandidates: playerAwardCandidates.length,
    awardDefinitions: AWARD_DEFINITIONS.length,
    rawScoreMaps: Object.fromEntries(
      Object.entries(rawScores).map(([key, value]) => [
        key,
        {
          entries: value.size,
          top: [...value.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([userId, rawScore]) => ({
              userId,
              rawScore,
              teamName: teamByUser.get(userId)?.teamName ?? null,
            })),
        },
      ]),
    ),
    generatedAwardSummaries: generatedAwards.map((award: any) => ({
      key: award.key,
      name: award.name,
      status: award.status,
      nomineeCount: award.nomineeCount,
      nomineeOptionsCount: Array.isArray(award.nomineeOptions) ? award.nomineeOptions.length : null,
    })),
    statSourceCounts: {
      allTeamStats: allTeamStats.size,
      passingStats: passingStats.size,
      rushingStats: rushingStats.size,
      receivingStats: receivingStats.size,
      defenseStats: defStats.size,
      kickingStats: kickingStats.size,
      seasonRecords: seasonRecords.size,
      olTeamRatings: olTeamRatings.size,
    },
  };

  return {
    generated: generatedAwards.length,
    awards: generatedAwards,
    diagnostics,
    leagueId,
    seasonNumber,
    announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
  };
}


export async function getAwardVotingSummary(input: { guildId: string; awardId: string }) {
  const { leagueId, league } = await getLeagueContext(input.guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: award } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,requires_voting,status,voting_closes_at,payout_amount")
    .eq("id", input.awardId)
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .maybeSingle();

  if (!award) return null;

  const { data: nominees } = await supabase
    .from("rec_award_nominees")
    .select("id,user_id,team_name,display_label,player_name,performance_score,vote_count,final_score,raw_stats")
    .eq("award_id", input.awardId);

  const { data: votes } = await supabase
    .from("rec_award_votes")
    .select("nominee_user_id")
    .eq("award_id", input.awardId);

  const voteTally = new Map<string, number>();
  for (const vote of votes ?? []) {
    const uid = String((vote as any).nominee_user_id ?? "");
    if (!uid) continue;
    voteTally.set(uid, (voteTally.get(uid) ?? 0) + 1);
  }
  const maxVotes = Math.max(...[...voteTally.values(), 0]);

  const rankedNominees = (nominees ?? []).map((nominee: any) => {
    const userId = String(nominee.user_id ?? "");
    const performanceScore = asNum(nominee.performance_score);
    const voteCount = voteTally.get(userId) ?? 0;
    const voteScore = maxVotes > 0 ? (voteCount / maxVotes) * 100 : 0;
    const liveScore = award.requires_voting ? performanceScore * 0.75 + voteScore * 0.25 : performanceScore;
    const rawStats = nominee.raw_stats ?? {};
    return {
      nomineeId: nominee.id,
      userId,
      teamName: nominee.team_name ?? null,
      displayLabel: nominee.display_label ?? nominee.team_name ?? userId,
      playerName: nominee.player_name ?? rawStats?.playerName ?? null,
      position: rawStats?.position ?? null,
      performanceScore: Math.round(performanceScore * 100) / 100,
      voteCount,
      voteScore: Math.round(voteScore * 100) / 100,
      liveScore: Math.round(liveScore * 100) / 100,
      statLine: rawStats?.statLine ?? null,
      rawStats
    };
  }).sort((a: any, b: any) => b.liveScore - a.liveScore || b.performanceScore - a.performanceScore || b.voteCount - a.voteCount);

  if (rankedNominees.length > 0) {
    const updates = rankedNominees.map((nominee: any) => ({
      id: nominee.nomineeId,
      vote_count: nominee.voteCount,
      final_score: nominee.liveScore,
      updated_at: nowIso()
    }));
    await supabase.from("rec_award_nominees").upsert(updates, { onConflict: "id", ignoreDuplicates: false });
  }

  return {
    awardId: String((award as any).id),
    key: (award as any).award_key,
    name: (award as any).award_name,
    category: (award as any).award_category,
    status: (award as any).status,
    requiresVoting: Boolean((award as any).requires_voting),
    closesAt: (award as any).voting_closes_at ?? null,
    totalVotes: (votes ?? []).length,
    nominees: rankedNominees
  };
}

export async function castAwardVote(input: { guildId: string; voterDiscordId: string; awardId: string; nomineeUserId: string }) {
  const { data: server } = await supabase.from("rec_discord_servers").select("id").eq("guild_id", input.guildId).maybeSingle();
  if (!server?.id) return { recorded: false, reason: "Server not found." };

  const { data: link } = await supabase.from("rec_server_league_links").select("league_id").eq("server_id", server.id).eq("is_primary", true).maybeSingle();
  if (!link?.league_id) return { recorded: false, reason: "No league found." };

  const { data: voterDiscord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.voterDiscordId).maybeSingle();
  if (!voterDiscord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC profile." };

  const nomineeUserId = input.nomineeUserId;
  if (!nomineeUserId) return { recorded: false, reason: "Nominee not found." };

  // Must be a linked coach
  const { data: voterAssignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", link.league_id).eq("user_id", voterDiscord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!voterAssignment) return { recorded: false, reason: "Only linked coaches in this league can vote." };

  // Check no self-voting
  if (String(voterDiscord.user_id) === String(nomineeUserId)) {
    return { recorded: false, reason: "You cannot vote for yourself." };
  }

  // Check award is open for voting
  const { data: award } = await supabase.from("rec_awards").select("id,status,voting_closes_at,award_name").eq("id", input.awardId).maybeSingle();
  if (!award) return { recorded: false, reason: "Award not found." };
  if (award.status !== "voting") return { recorded: false, reason: "Voting for this award is not currently open." };
  if (award.voting_closes_at && new Date(award.voting_closes_at).getTime() < Date.now()) {
    await supabase.from("rec_awards").update({ status: "voting_closed", updated_at: nowIso() }).eq("id", award.id);
    return { recorded: false, reason: "Voting for this award has closed (24h window expired)." };
  }

  // Verify nominee is in this award
  const { data: nominee } = await supabase.from("rec_award_nominees").select("id").eq("award_id", input.awardId).eq("user_id", nomineeUserId).maybeSingle();
  if (!nominee) return { recorded: false, reason: "That user is not a nominee for this award." };

  const { error } = await supabase.from("rec_award_votes").upsert({
    award_id: input.awardId,
    voter_user_id: String(voterDiscord.user_id),
    nominee_user_id: String(nomineeUserId),
    updated_at: nowIso()
  }, { onConflict: "award_id,voter_user_id" });

  if (error) return { recorded: false, reason: "Failed to record vote." };
  const liveAward = await getAwardVotingSummary({ guildId: input.guildId, awardId: input.awardId });
  return { recorded: true, awardName: award.award_name, award: liveAward };
}

export async function closeAwardVoting(guildId: string) {
  const { leagueId, league } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,requires_voting,payout_amount")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("status", ["voting", "commissioner_review"]);

  if (!awards?.length) return { closed: 0, results: [] };

  const results: any[] = [];

  for (const award of awards) {
    const { data: nominees } = await supabase
      .from("rec_award_nominees")
      .select("id,user_id,team_name,display_label,performance_score")
      .eq("award_id", award.id);

    const { data: votes } = await supabase
      .from("rec_award_votes")
      .select("nominee_user_id")
      .eq("award_id", award.id);

    // Tally votes
    const voteTally = new Map<string, number>();
    for (const v of votes ?? []) {
      voteTally.set(v.nominee_user_id, (voteTally.get(v.nominee_user_id) ?? 0) + 1);
    }
    const maxVotes = Math.max(...[...voteTally.values(), 0]);

    // Calculate final scores and collect batch updates
    let winnerNominee: any = null;
    let bestFinalScore = -Infinity;
    const nomineeUpdates: any[] = [];

    for (const nom of nominees ?? []) {
      const perfScore = asNum(nom.performance_score);
      const voteCount = voteTally.get(String(nom.user_id)) ?? 0;
      const voteScore = maxVotes > 0 ? (voteCount / maxVotes) * 100 : 0;
      const finalScore = award.requires_voting
        ? perfScore * 0.75 + voteScore * 0.25
        : perfScore;

      nomineeUpdates.push({ id: nom.id, vote_count: voteCount, final_score: Math.round(finalScore * 100) / 100, updated_at: nowIso() });

      if (finalScore > bestFinalScore) {
        bestFinalScore = finalScore;
        winnerNominee = { ...nom, voteCount, finalScore };
      }
    }

    // Single batch upsert instead of N individual updates
    if (nomineeUpdates.length > 0) {
      await supabase.from("rec_award_nominees").upsert(nomineeUpdates, { onConflict: "id", ignoreDuplicates: false });
    }

    await supabase.from("rec_awards").update({
      status: "commissioner_review",
      updated_at: nowIso()
    }).eq("id", award.id);

    results.push({
      awardId: award.id,
      awardKey: award.award_key,
      awardName: award.award_name,
      winner: winnerNominee,
      totalVotes: (votes ?? []).length
    });
  }

  return { closed: awards.length, results };
}

export async function approveAwardWinner(input: { guildId: string; awardId: string; approvedByDiscordId: string }) {
  const { leagueId, league } = await getLeagueContext(input.guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: award } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,payout_amount,status")
    .eq("id", input.awardId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!award) throw new Error("Award not found.");
  if (!["commissioner_review", "voting_closed"].includes(award.status)) throw new Error("Award is not pending commissioner review.");

  // Find winner (highest final_score)
  const { data: nominees } = await supabase
    .from("rec_award_nominees")
    .select("user_id,team_name,display_label,performance_score,vote_count,final_score")
    .eq("award_id", award.id)
    .order("final_score", { ascending: false })
    .limit(1);

  const winner = nominees?.[0];
  if (!winner?.user_id) throw new Error("No nominee found for this award.");

  const { data: discordAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", winner.user_id).maybeSingle();
  const winnerDiscordId = discordAcc?.discord_id ?? null;

  // Issue payout
  let payoutLedgerId: string | null = null;
  try {
    const credit = await creditUserWallet({
      userId: String(winner.user_id),
      leagueId,
      seasonNumber,
      amount: asNum(award.payout_amount),
      transactionType: "credit",
      description: `${award.award_name} — Season ${seasonNumber} award winner`,
      sourceReference: { type: "rec_award", awardId: award.id, idempotencyKey: `award_${award.id}` }
    });
    payoutLedgerId = credit.ledger?.id ?? null;
  } catch (err) {
    console.error("[approveAwardWinner] Payout failed:", err);
  }

  // Record winner permanently
  await supabase.from("rec_award_winners").upsert({
    league_id: leagueId,
    season_number: seasonNumber,
    award_key: award.award_key,
    award_name: award.award_name,
    winner_user_id: String(winner.user_id),
    winner_team_name: winner.team_name ?? null,
    winner_discord_id: winnerDiscordId,
    performance_score: asNum(winner.performance_score),
    vote_count: asNum(winner.vote_count),
    final_score: asNum(winner.final_score),
    payout_amount: asNum(award.payout_amount),
    payout_issued: true,
    payout_ledger_id: payoutLedgerId
  }, { onConflict: "league_id,season_number,award_key" });

  // Mark award completed
  await supabase.from("rec_awards").update({
    status: "completed",
    updated_at: nowIso()
  }).eq("id", award.id);

  return {
    awardId: award.id,
    awardKey: award.award_key,
    awardName: award.award_name,
    winner: {
      userId: String(winner.user_id),
      discordId: winnerDiscordId,
      teamName: winner.team_name,
      displayLabel: winner.display_label,
      performanceScore: asNum(winner.performance_score),
      voteCount: asNum(winner.vote_count),
      finalScore: asNum(winner.final_score),
      payoutAmount: asNum(award.payout_amount),
      payoutIssued: true
    }
  };
}

export async function getAwardStatus(guildId: string) {
  const { leagueId, league } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,status,voting_closes_at,requires_voting")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("award_category")
    .order("award_key");

  return { awards: awards ?? [], leagueId, seasonNumber };
}

export async function getPendingAwardApprovals(guildId: string) {
  const { leagueId, league, routes } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);
  const pendingPayoutsChannelId = (routes as any)?.pending_payouts_channel_id ?? null;

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,payout_amount")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "commissioner_review");

  if (!awards?.length) return { awards: [], pendingPayoutsChannelId };

  const results = [];
  for (const award of awards) {
    const { data: nominees } = await supabase
      .from("rec_award_nominees")
      .select("user_id,team_name,display_label,performance_score,vote_count,final_score")
      .eq("award_id", award.id)
      .order("final_score", { ascending: false })
      .limit(5);
    results.push({ ...award, nominees: nominees ?? [] });
  }

  return { awards: results, pendingPayoutsChannelId };
}
