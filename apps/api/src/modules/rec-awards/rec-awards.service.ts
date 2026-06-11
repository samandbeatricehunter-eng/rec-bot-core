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

// Normalize an array of raw scores to 0-100
function normalizeScores(rawMap: Map<string, number>): Map<string, number> {
  const values = [...rawMap.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const result = new Map<string, number>();
  for (const [uid, raw] of rawMap) {
    result.set(uid, range > 0 ? ((raw - min) / range) * 100 : 50);
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
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, team_id, rec_teams(name, abbreviation, ovr_rating)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  const userIds = (assignments ?? []).map((a: any) => String(a.user_id)).filter(Boolean);
  const { data: discordAccounts } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,global_name,username")
    .in("user_id", userIds);

  const discordMap = new Map<string, { discordId: string; displayName: string }>();
  for (const d of discordAccounts ?? []) {
    if (d.user_id && d.discord_id) {
      discordMap.set(String(d.user_id), {
        discordId: String(d.discord_id),
        displayName: d.global_name ?? d.username ?? "Coach"
      });
    }
  }

  return (assignments ?? []).map((a: any) => ({
    userId: String(a.user_id),
    teamId: String(a.team_id),
    teamName: (a.rec_teams as any)?.name ?? (a.rec_teams as any)?.abbreviation ?? "Unknown",
    teamOvr: asNum((a.rec_teams as any)?.ovr_rating),
    discordId: discordMap.get(String(a.user_id))?.discordId ?? null,
    displayName: discordMap.get(String(a.user_id))?.displayName ?? "Coach"
  }));
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
  const { data } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, stat_category, stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season");

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
  const { data } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season")
    .eq("stat_category", category);

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
    .eq("season_stage", "regular_season")
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
    .eq("season_stage", "regular_season")
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

// Score calculators — all return a raw score (higher = better)
function scorePassingStats(s: Record<string, number>, winPct: number): number {
  const passYds = s.passYds ?? 0;
  const passTDs = s.passTDs ?? 0;
  const passAtt = s.passAtt ?? 1;
  const passComp = s.passComp ?? 0;
  const compPct = passAtt > 0 ? passComp / passAtt : 0;
  // Best QB formula: 35% TDs, 30% yards, 15% comp%, 10% rating (approx), 10% wins
  const rawRating = (passTDs * 4 + (compPct - 0.3) * 5 + passYds * 0.04 + Math.max(0, 2.375 - ((passAtt - passComp) / passAtt) * 25)) / 6 * 100;
  return passTDs * 0.35 + passYds * 0.0001 * 0.30 + compPct * 100 * 0.15 + Math.min(rawRating, 100) * 0.10 + winPct * 100 * 0.10;
}

function scoreRushingStats(s: Record<string, number>, winPct: number): number {
  const rushYds = s.rushYds ?? 0;
  const rushTDs = s.rushTDs ?? 0;
  const rushAtt = s.rushAtt ?? 1;
  const ypc = rushAtt > 0 ? rushYds / rushAtt : 0;
  // Best RB formula: 40% rush yds, 30% TDs, 15% YPC, 15% wins
  return rushYds * 0.001 * 40 + rushTDs * 0.30 + ypc * 0.15 + winPct * 100 * 0.15;
}

function scoreReceivingStats(s: Record<string, number>, winPct: number): number {
  const recYds = s.recYds ?? 0;
  const recTDs = s.recTDs ?? 0;
  const receptions = s.recCatches ?? s.receptions ?? 0;
  // Best WR formula: 40% rec yds, 30% TDs, 15% receptions, 15% wins
  return recYds * 0.001 * 40 + recTDs * 0.30 + receptions * 0.005 * 0.15 + winPct * 100 * 0.15;
}

function scoreDefensiveStats(s: Record<string, number>): number {
  // DPOY: 40% sacks, 30% INTs, 20% forced fumbles, 10% tackles
  // Madden has no TFL or QB hits stat — defTotalTackles is the correct key
  const sacks = s.defSacks ?? 0;
  const ints = s.defInts ?? 0;
  const ff = s.defForcedFum ?? 0;
  const tackles = s.defTotalTackles ?? s.defTackles ?? 0;
  return sacks * 0.40 + ints * 0.30 + ff * 0.20 + tackles * 0.001 * 0.10;
}

function scoreOLStats(s: Record<string, number>): number {
  // Best OL (team award): 60% inverse sacks allowed, 40% avg OL OVR
  // passSacks = QB sacks taken (summed across all QBs on the team = sacks allowed)
  // avgOlOvr = average overall rating of LT/LG/C/RG/RT, injected from getOLTeamRatings
  const passSacks = s.passSacks ?? 0;
  const avgOlOvr = s.avgOlOvr ?? 0;
  const sackScore = Math.max(0, 50 - passSacks * 1.5);
  return sackScore * 0.60 + (avgOlOvr / 99) * 100 * 0.40;
}

function scoreDLStats(s: Record<string, number>): number {
  // Madden has no TFL or QB hits stat — sacks are the primary DL metric
  const sacks = s.defSacks ?? 0;
  const ff = s.defForcedFum ?? 0;
  const tackles = s.defTotalTackles ?? s.defTackles ?? 0;
  return sacks * 0.65 + ff * 0.25 + tackles * 0.001 * 0.10;
}

function scoreLBStats(s: Record<string, number>): number {
  const tackles = s.defTotalTackles ?? s.defTackles ?? 0;
  const sacks = s.defSacks ?? 0;
  const ints = s.defInts ?? 0;
  return tackles * 0.50 + sacks * 0.30 + ints * 0.20;
}

function scoreDBStats(s: Record<string, number>): number {
  const ints = s.defInts ?? 0;
  const pd = s.defDeflections ?? 0; // Madden key is defDeflections
  const tackles = s.defTotalTackles ?? s.defTackles ?? 0;
  const defTDs = s.defTDs ?? 0;
  return ints * 0.45 + pd * 0.25 + tackles * 0.20 + defTDs * 0.10;
}

function scoreKickerStats(s: Record<string, number>): number {
  // Madden kicking keys: fGMade, fGAtt, xPMade, xPAtt, fGLongest
  const fgMade = s.fGMade ?? s.fgMade ?? 0;
  const fgAtt = s.fGAtt ?? s.fgAtt ?? 0;
  const xpMade = s.xPMade ?? s.xpMade ?? 0;
  const xpAtt = s.xPAtt ?? s.xpAtt ?? 0;
  const longFG = s.fGLongest ?? s.fgLong ?? 0;
  const totalAttempts = fgAtt + xpAtt;
  if (totalAttempts < 50) return 0; // Minimum 50 combined FG+XP attempts across season
  const fgPct = fgAtt > 0 ? fgMade / fgAtt : 0;
  const xpPct = xpAtt > 0 ? xpMade / xpAtt : 0;
  return fgPct * 100 * 0.55 + xpPct * 100 * 0.30 + (longFG / 60) * 100 * 0.15;
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

  const coaches = await getActiveCoaches(leagueId);
  if (!coaches.length) return { generated: 0, awards: [] };

  const userIds = coaches.map((c) => c.userId);
  const teamByUser = new Map(coaches.map((c) => [c.userId, c]));

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

  const [upsetWins, sosMap, streamCounts, challengeCounts, badgeCounts] = await Promise.all([
    getUpsetWins(leagueId, seasonNumber, new Map(coaches.map((c) => [c.userId, { wins: seasonRecords.get(c.userId)?.wins ?? 0, games: seasonRecords.get(c.userId)?.games ?? 0 }]))),
    getStrengthOfSchedule(leagueId, seasonNumber, new Map(coaches.map((c) => [c.userId, { wins: seasonRecords.get(c.userId)?.wins ?? 0, games: seasonRecords.get(c.userId)?.games ?? 0 }]))),
    getStreamCounts(leagueId, seasonNumber, userIds),
    getChallengeCounts(leagueId, seasonNumber, userIds),
    getBadgeCounts(leagueId, userIds)
  ]);

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
    const totalOffYds = asNum(teamAllStats.passYds) + asNum(teamAllStats.rushYds);

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

    // OPOY: weighted offensive production
    const opoyScore = Math.max(
      scorePassingStats(teamPassStats, winPct),
      scoreRushingStats(teamRushStats, winPct),
      scoreReceivingStats(teamRecStats, winPct)
    );
    if (!rawScores.opoy) rawScores.opoy = new Map();
    rawScores.opoy.set(userId, opoyScore);

    // DPOY
    const dpoyScore = scoreDefensiveStats(teamDefStats);
    if (!rawScores.dpoy) rawScores.dpoy = new Map();
    rawScores.dpoy.set(userId, dpoyScore);

    // Rookie awards — same formulas but we'll filter later
    if (!rawScores.offensive_rookie) rawScores.offensive_rookie = new Map();
    rawScores.offensive_rookie.set(userId, opoyScore);
    if (!rawScores.defensive_rookie) rawScores.defensive_rookie = new Map();
    rawScores.defensive_rookie.set(userId, dpoyScore);

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

  const votingClosesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const generatedAwards: any[] = [];

  for (const def of AWARD_DEFINITIONS) {
    const scoreMap = rawScores[def.key];
    if (!scoreMap?.size) {
      // Create award record with no_nominees status
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

    const nominees = topN(scoreMap, def.nomineeCount);
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

    const nomineeRows = nominees
      .map((nominee) => {
        const coach = teamByUser.get(nominee.userId);
        if (!coach) return null;
        return {
          award_id: award.id,
          user_id: nominee.userId,
          team_name: coach.teamName,
          performance_score: Math.round((normalizedScores.get(nominee.userId) ?? 0) * 100) / 100,
          display_label: `${coach.teamName} (${coach.displayName})`,
          raw_stats: rawStatsPerUser[nominee.userId] ?? null,
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

    // Fetch nominees with discord IDs for bot embed building
    const nomineeOptions: Array<{ userId: string; discordId: string | null; displayLabel: string }> = [];
    for (const nominee of nominees) {
      const coach = teamByUser.get(nominee.userId);
      if (!coach) continue;
      nomineeOptions.push({
        userId: nominee.userId,
        discordId: coach.discordId,
        displayLabel: `${coach.teamName} (${coach.displayName})`
      });
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

  return {
    generated: generatedAwards.length,
    awards: generatedAwards,
    leagueId,
    seasonNumber,
    announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
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
  return { recorded: true, awardName: award.award_name };
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
  const { leagueId, league } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,payout_amount")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "commissioner_review");

  if (!awards?.length) return { awards: [] };

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

  return { awards: results };
}
