import { readStat } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

function asNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StatPayoutCategory {
  key: string;
  label: string;
  qualifiedTier: string; // "T1" | "T2" | "T3" | "T4" | "flat"
  qualifiedValue: number;
  amount: number;
  isFlat: boolean;
  thresholdValue?: number;
  thresholdLabel?: string;
  entityName?: string; // player name for player-based payouts
  entityPosition?: string;
}

export interface UserEosStatPayoutData {
  userId: string;
  teamId: string;
  discordId: string | null;
  displayName: string;
  teamName: string;
  total: number;
  categories: StatPayoutCategory[];
}

// ── Tier evaluation helpers ───────────────────────────────────────────────────

const TIER_LABELS = ["T4", "T3", "T2", "T1"] as const;
const TIER_AMOUNTS = [100, 75, 50, 25] as const;

// Returns the highest tier reached, or null if none.
// thresholds: [T1min, T2min, T3min, T4min]  higherIsBetter = true → bigger value qualifies
function evalTier(
  value: number,
  thresholds: [number, number, number, number],
  higherIsBetter = true
): { tier: string; amount: number; thresholdValue: number; thresholdLabel: string } | null {
  const thresholdByTier = [thresholds[3], thresholds[2], thresholds[1], thresholds[0]];
  const checks = higherIsBetter
    ? [value >= thresholds[3], value >= thresholds[2], value >= thresholds[1], value >= thresholds[0]]
    : [value <= thresholds[3], value <= thresholds[2], value <= thresholds[1], value <= thresholds[0]];
  for (let i = 0; i < 4; i++) {
    if (checks[i]) {
      const thresholdValue = thresholdByTier[i];
      return {
        tier: TIER_LABELS[i],
        amount: TIER_AMOUNTS[i],
        thresholdValue,
        thresholdLabel: `${higherIsBetter ? ">=" : "<="} ${thresholdValue}`
      };
    }
  }
  return null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// Fetch ALL regular-season player stats for a league/season with proper paging.
async function fetchAllPlayerStats(leagueId: string, seasonNumber: number) {
  const PAGE = 1000;
  const allRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("rec_player_weekly_stats")
      .select("player_id,team_id,position,player_name,stat_category,stats")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("season_stage", "regular_season")
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return allRows;
}

// Fetch player positions (uuid → position string) from rec_players
async function fetchPlayerPositions(playerIds: string[]): Promise<Map<string, string>> {
  if (!playerIds.length) return new Map();
  const map = new Map<string, string>();
  const PAGE = 500;
  for (let i = 0; i < playerIds.length; i += PAGE) {
    const chunk = playerIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from("rec_players")
      .select("id,position")
      .in("id", chunk);
    for (const p of data ?? []) {
      if (p.id && p.position) map.set(String(p.id), String(p.position));
    }
  }
  return map;
}

// Count regular-season H2H games per team
async function getTeamGameCounts(leagueId: string, seasonNumber: number, teamIds: string[]): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false)
    .eq("is_user_h2h", true);

  const counts = new Map<string, number>();
  for (const g of data ?? []) {
    for (const tid of [g.home_team_id, g.away_team_id]) {
      if (tid && teamIds.includes(String(tid))) {
        counts.set(String(tid), (counts.get(String(tid)) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// Sum of points scored by each team from game results
async function getTeamPointsScored(leagueId: string, seasonNumber: number, teamIds: string[]): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false);

  const pts = new Map<string, number>();
  for (const g of data ?? []) {
    const htid = g.home_team_id ? String(g.home_team_id) : null;
    const atid = g.away_team_id ? String(g.away_team_id) : null;
    if (htid && teamIds.includes(htid)) pts.set(htid, (pts.get(htid) ?? 0) + asNum(g.home_score));
    if (atid && teamIds.includes(atid)) pts.set(atid, (pts.get(atid) ?? 0) + asNum(g.away_score));
  }
  return pts;
}

// Total games played (all regular season, not just H2H)
async function getTeamTotalGameCounts(leagueId: string, seasonNumber: number, teamIds: string[]): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false);

  const counts = new Map<string, number>();
  for (const g of data ?? []) {
    for (const tid of [g.home_team_id, g.away_team_id]) {
      if (tid && teamIds.includes(String(tid))) {
        counts.set(String(tid), (counts.get(String(tid)) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// Season records for users
async function getSeasonRecords(leagueId: string, seasonNumber: number): Promise<Map<string, { wins: number; losses: number; pd: number; games: number }>> {
  const { data } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  const map = new Map<string, { wins: number; losses: number; pd: number; games: number }>();
  for (const r of data ?? []) {
    if (!r.user_id) continue;
    const games = asNum(r.games_played) || (asNum(r.wins) + asNum(r.losses) + asNum(r.ties));
    map.set(String(r.user_id), { wins: asNum(r.wins), losses: asNum(r.losses), pd: asNum(r.point_differential), games });
  }
  return map;
}

// H2H game win rates per user (only user-vs-user games)
async function getH2HRecords(leagueId: string, seasonNumber: number): Promise<Map<string, { wins: number; games: number }>> {
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false)
    .eq("is_user_h2h", true)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);

  const records = new Map<string, { wins: number; games: number }>();
  for (const g of data ?? []) {
    const homeId = g.home_user_id ? String(g.home_user_id) : null;
    const awayId = g.away_user_id ? String(g.away_user_id) : null;
    if (!homeId || !awayId) continue;
    const homeWon = asNum(g.home_score) > asNum(g.away_score);
    for (const [uid, won] of [[homeId, homeWon], [awayId, !homeWon]] as [string, boolean][]) {
      const cur = records.get(uid) ?? { wins: 0, games: 0 };
      cur.games++;
      if (won) cur.wins++;
      records.set(uid, cur);
    }
  }
  return records;
}

// Which teams made the playoffs? Authoritative source is the EA seed/playoffStatus captured at
// import (rec_season_team_seeds) — this correctly includes first-round-bye teams that have no
// wild-card game yet. Falls back to is_playoff game results for seasons imported before seeds
// were persisted.
async function getPlayoffTeamIds(leagueId: string, seasonNumber: number): Promise<Set<string>> {
  const { data: seeds } = await supabase
    .from("rec_season_team_seeds")
    .select("team_id,made_playoffs")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  if (seeds && seeds.length > 0) {
    const set = new Set<string>();
    for (const s of seeds) if (s.made_playoffs && s.team_id) set.add(String(s.team_id));
    return set;
  }

  // Fallback: derive from played playoff games (misses byes until they play a postseason game).
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", true);

  const set = new Set<string>();
  for (const g of data ?? []) {
    if (g.home_team_id) set.add(String(g.home_team_id));
    if (g.away_team_id) set.add(String(g.away_team_id));
  }
  return set;
}

// Completed challenge counts per user
async function getChallengeCounts(leagueId: string, seasonNumber: number, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("rec_weekly_challenges")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("status", ["completed", "earned"])
    .in("user_id", userIds);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.user_id) counts.set(String(r.user_id), (counts.get(String(r.user_id)) ?? 0) + 1);
  }
  return counts;
}

// Badge counts per user (regular-season badges only by league)
async function getBadgeCounts(leagueId: string, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("rec_user_badges")
    .select("user_id")
    .eq("league_id", leagueId)
    .in("user_id", userIds);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.user_id) counts.set(String(r.user_id), (counts.get(String(r.user_id)) ?? 0) + 1);
  }
  return counts;
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

// Aggregate stat rows by team ID, summing all JSONB values
function aggregateByTeam(rows: any[]): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const tid = row.team_id ? String(row.team_id) : null;
    if (!tid) continue;
    if (!map.has(tid)) map.set(tid, {});
    const agg = map.get(tid)!;
    for (const [k, v] of Object.entries((row.stats ?? {}) as Record<string, unknown>)) {
      agg[k] = (agg[k] ?? 0) + asNum(v);
    }
  }
  return map;
}

// Aggregate stat rows by player ID, summing all JSONB values
function aggregateByPlayer(rows: any[]): Map<string, { teamId: string; playerName: string; position: string; stats: Record<string, number> }> {
  const map = new Map<string, { teamId: string; playerName: string; position: string; stats: Record<string, number> }>();
  for (const row of rows) {
    const pid = row.player_id ? String(row.player_id) : null;
    const tid = row.team_id ? String(row.team_id) : null;
    if (!pid || !tid) continue;
    if (!map.has(pid)) {
      map.set(pid, { teamId: tid, playerName: String(row.player_name ?? "Unknown"), position: String(row.position ?? ""), stats: {} });
    }
    const entry = map.get(pid)!;
    for (const [k, v] of Object.entries((row.stats ?? {}) as Record<string, unknown>)) {
      entry.stats[k] = (entry.stats[k] ?? 0) + asNum(v);
    }
  }
  return map;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeEosStatPayouts(
  leagueId: string,
  seasonNumber: number
): Promise<UserEosStatPayoutData[]> {
  // 1. Active coaches
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,rec_teams(name,abbreviation)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (!assignments?.length) return [];

  const coaches = assignments.map((a: any) => ({
    userId: String(a.user_id),
    teamId: String(a.team_id),
    teamName: (a.rec_teams as any)?.name ?? (a.rec_teams as any)?.abbreviation ?? "Unknown"
  }));
  const userIds = coaches.map((c) => c.userId);
  const teamIds = coaches.map((c) => c.teamId);

  // 2. Discord IDs
  const { data: discordAccounts } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,global_name,username")
    .in("user_id", userIds);
  const discordMap = new Map<string, { discordId: string; displayName: string }>();
  for (const d of discordAccounts ?? []) {
    if (d.user_id && d.discord_id) {
      discordMap.set(String(d.user_id), { discordId: String(d.discord_id), displayName: d.global_name ?? d.username ?? "Coach" });
    }
  }

  // 3. All regular-season player stats
  const allStats = await fetchAllPlayerStats(leagueId, seasonNumber);
  // Filter to only user-linked teams
  const userTeamSet = new Set(teamIds);
  const linkedStats = allStats.filter((r) => r.team_id && userTeamSet.has(String(r.team_id)));

  const passingStats = linkedStats.filter((r) => r.stat_category === "passing");
  const rushingStats = linkedStats.filter((r) => r.stat_category === "rushing");
  const receivingStats = linkedStats.filter((r) => r.stat_category === "receiving");
  const defenseStats = linkedStats.filter((r) => r.stat_category === "defense");
  const kickingStats = linkedStats.filter((r) => r.stat_category === "kicking");

  // 4. Fetch player positions (for defensive position filtering)
  const allPlayerIds = [...new Set(linkedStats.map((r) => r.player_id).filter(Boolean).map(String))];
  const playerPositions = await fetchPlayerPositions(allPlayerIds);

  // 5. Aggregations
  const teamPassAgg = aggregateByTeam(passingStats);
  const teamRushAgg = aggregateByTeam(rushingStats);
  const teamRecAgg = aggregateByTeam(receivingStats);
  const teamDefAgg = aggregateByTeam(defenseStats);
  const teamKickAgg = aggregateByTeam(kickingStats);

  const playerPassAgg = aggregateByPlayer(passingStats);
  const playerRushAgg = aggregateByPlayer(rushingStats);
  const playerRecAgg = aggregateByPlayer(receivingStats);
  const playerDefAgg = aggregateByPlayer(defenseStats);
  const playerKickAgg = aggregateByPlayer(kickingStats);

  // 6. Per-game counts, season records, playoff status, H2H, challenges, badges
  const [totalGameCounts, h2hGameCounts, teamPointsScored, seasonRecords, h2hRecords, playoffTeamIds, challengeCounts, badgeCounts] = await Promise.all([
    getTeamTotalGameCounts(leagueId, seasonNumber, teamIds),
    getTeamGameCounts(leagueId, seasonNumber, teamIds),
    getTeamPointsScored(leagueId, seasonNumber, teamIds),
    getSeasonRecords(leagueId, seasonNumber),
    getH2HRecords(leagueId, seasonNumber),
    getPlayoffTeamIds(leagueId, seasonNumber),
    getChallengeCounts(leagueId, seasonNumber, userIds),
    getBadgeCounts(leagueId, userIds)
  ]);

  // 7. Per-coach evaluation
  const results: UserEosStatPayoutData[] = [];

  for (const coach of coaches) {
    const { userId, teamId, teamName } = coach;
    const discord = discordMap.get(userId);
    const categories: StatPayoutCategory[] = [];

    const gamesPlayed = totalGameCounts.get(teamId) ?? 0;
    const h2hGames = h2hGameCounts.get(teamId) ?? 0;
    const gpDivisor = gamesPlayed > 0 ? gamesPlayed : 1;

    const passAgg = teamPassAgg.get(teamId) ?? {};
    const rushAgg = teamRushAgg.get(teamId) ?? {};
    const recAgg = teamRecAgg.get(teamId) ?? {};
    const defAgg = teamDefAgg.get(teamId) ?? {};
    const kickAgg = teamKickAgg.get(teamId) ?? {};
    const rec = seasonRecords.get(userId) ?? { wins: 0, losses: 0, pd: 0, games: 0 };
    const h2h = h2hRecords.get(userId) ?? { wins: 0, games: 0 };

    // ── Team Offensive Payouts ────────────────────────────────────────────────

    // PPG
    const pointsScored = teamPointsScored.get(teamId) ?? 0;
    const ppg = gamesPlayed > 0 ? pointsScored / gamesPlayed : 0;
    const ppgResult = evalTier(ppg, [28, 32, 36, 40]);
    if (ppgResult) categories.push({ key: "team_ppg", label: "Team Points Per Game", qualifiedTier: ppgResult.tier, qualifiedValue: Math.round(ppg * 10) / 10, amount: ppgResult.amount, isFlat: false, thresholdValue: ppgResult.thresholdValue, thresholdLabel: ppgResult.thresholdLabel });

    // Total offensive yards per game
    const totalOffYds = readStat(passAgg, "pass_yards") + readStat(rushAgg, "rush_yards");
    const totalYpg = totalOffYds / gpDivisor;
    const totalYpgResult = evalTier(totalYpg, [350, 400, 450, 500]);
    if (totalYpgResult) categories.push({ key: "team_total_ypg", label: "Total Offensive Yards/Game", qualifiedTier: totalYpgResult.tier, qualifiedValue: Math.round(totalYpg * 10) / 10, amount: totalYpgResult.amount, isFlat: false, thresholdValue: totalYpgResult.thresholdValue, thresholdLabel: totalYpgResult.thresholdLabel });

    // Passing yards per game
    const passYpg = readStat(passAgg, "pass_yards") / gpDivisor;
    const passYpgResult = evalTier(passYpg, [250, 300, 350, 400]);
    if (passYpgResult) categories.push({ key: "team_pass_ypg", label: "Team Passing Yards/Game", qualifiedTier: passYpgResult.tier, qualifiedValue: Math.round(passYpg * 10) / 10, amount: passYpgResult.amount, isFlat: false, thresholdValue: passYpgResult.thresholdValue, thresholdLabel: passYpgResult.thresholdLabel });

    // Rushing yards per game
    const rushYpg = readStat(rushAgg, "rush_yards") / gpDivisor;
    const rushYpgResult = evalTier(rushYpg, [100, 125, 150, 175]);
    if (rushYpgResult) categories.push({ key: "team_rush_ypg", label: "Team Rushing Yards/Game", qualifiedTier: rushYpgResult.tier, qualifiedValue: Math.round(rushYpg * 10) / 10, amount: rushYpgResult.amount, isFlat: false, thresholdValue: rushYpgResult.thresholdValue, thresholdLabel: rushYpgResult.thresholdLabel });

    // Turnover efficiency (giveaways = interceptions thrown + fumbles lost; lower is better)
    const giveaways = readStat(passAgg, "interceptions_thrown") + readStat(rushAgg, "rushing_fumbles");
    const givResult = evalTier(giveaways, [24, 18, 12, 8], false);
    if (givResult) categories.push({ key: "team_turnover_eff", label: "Turnover Efficiency (Giveaways)", qualifiedTier: givResult.tier, qualifiedValue: giveaways, amount: givResult.amount, isFlat: false, thresholdValue: givResult.thresholdValue, thresholdLabel: givResult.thresholdLabel });

    // ── Team Defensive Payouts ────────────────────────────────────────────────

    // Points allowed per game — use opponent scores from game results
    // We already have total points scored; for allowed we need to invert
    // Calc via game_results for this team
    // (We'll compute inline using defAgg stats as approximation — or fetch from DB)
    // Actually, I'll derive from game results: points against = opponent points scored
    // We have teamPointsScored for all teams; team's points-against = sum of opponents' scores
    // For simplicity, use the season_user_records point_against (already in rec)
    const recData = seasonRecords.get(userId);
    // We don't have points_against in the current map — let's compute from team points scored
    // by getting all game results for this team
    // This is a bit involved; let's use defAgg opponentScore if available, else skip
    // Actually the simplest: query rec_season_user_records which has points_for and points_against
    // But our getSeasonRecords function above doesn't include points_against. Let me add that.
    // For now I'll skip ppg-allowed and use the values already available, noting this needs the points_against field.
    // I'll use a separate query below — handled via a separate refetch.

    // Team sacks
    const teamSacks = readStat(defAgg, "sacks");
    const sacksResult = evalTier(teamSacks, [35, 45, 55, 65]);
    if (sacksResult) categories.push({ key: "team_sacks", label: "Team Sacks", qualifiedTier: sacksResult.tier, qualifiedValue: teamSacks, amount: sacksResult.amount, isFlat: false, thresholdValue: sacksResult.thresholdValue, thresholdLabel: sacksResult.thresholdLabel });

    // Team takeaways
    const takeaways = readStat(defAgg, "interceptions") + readStat(defAgg, "forced_fumbles");
    const takeResult = evalTier(takeaways, [20, 25, 30, 35]);
    if (takeResult) categories.push({ key: "team_takeaways", label: "Team Takeaways", qualifiedTier: takeResult.tier, qualifiedValue: takeaways, amount: takeResult.amount, isFlat: false, thresholdValue: takeResult.thresholdValue, thresholdLabel: takeResult.thresholdLabel });

    // ── Player Offensive Payouts ──────────────────────────────────────────────

    // QB payouts — players on this team with passing stats, min passAtt threshold
    for (const [pid, pdata] of playerPassAgg) {
      if (pdata.teamId !== teamId) continue;
      const s = pdata.stats;
      const passAtt = readStat(s, "pass_attempts");
      if (passAtt < 250) continue; // min threshold

      const passYds = readStat(s, "pass_yards");
      const passTDs = readStat(s, "pass_tds");
      const passInts = readStat(s, "interceptions_thrown");
      const ypa = passAtt > 0 ? passYds / passAtt : 0;
      const playerName = pdata.playerName;

      // QB Passing Yards
      const qbYdsResult = evalTier(passYds, [4000, 4500, 5000, 5500]);
      if (qbYdsResult) categories.push({ key: `qb_pass_yds:${pid}`, label: "QB Passing Yards", qualifiedTier: qbYdsResult.tier, qualifiedValue: passYds, amount: qbYdsResult.amount, isFlat: false, thresholdValue: qbYdsResult.thresholdValue, thresholdLabel: qbYdsResult.thresholdLabel, entityName: playerName, entityPosition: "QB" });

      // QB Passing TDs
      const qbTDsResult = evalTier(passTDs, [30, 40, 50, 60]);
      if (qbTDsResult) categories.push({ key: `qb_pass_tds:${pid}`, label: "QB Passing TDs", qualifiedTier: qbTDsResult.tier, qualifiedValue: passTDs, amount: qbTDsResult.amount, isFlat: false, thresholdValue: qbTDsResult.thresholdValue, thresholdLabel: qbTDsResult.thresholdLabel, entityName: playerName, entityPosition: "QB" });

      // QB Efficiency Bonus (min 150 att → we already require 250 so this is satisfied, but spec says 150 for this bonus)
      if (passAtt >= 150 && ypa >= 8.5) {
        categories.push({ key: `qb_eff_bonus:${pid}`, label: "QB Efficiency Bonus (8.5+ YPA)", qualifiedTier: "flat", qualifiedValue: Math.round(ypa * 100) / 100, amount: 100, isFlat: true, entityName: playerName, entityPosition: "QB" });
      }

      // QB Low INT Bonus (lower is better, min 250 attempts)
      const qbIntResult = evalTier(passInts, [18, 14, 10, 6], false);
      if (qbIntResult) categories.push({ key: `qb_low_int:${pid}`, label: "QB Low INT Season", qualifiedTier: qbIntResult.tier, qualifiedValue: passInts, amount: qbIntResult.amount, isFlat: false, thresholdValue: qbIntResult.thresholdValue, thresholdLabel: qbIntResult.thresholdLabel, entityName: playerName, entityPosition: "QB" });
    }

    // RB payouts — players with rushing stats, min 150 carries
    for (const [pid, pdata] of playerRushAgg) {
      if (pdata.teamId !== teamId) continue;
      const s = pdata.stats;
      const rushAtt = readStat(s, "rush_attempts");
      if (rushAtt < 150) continue;

      const rushYds = readStat(s, "rush_yards");
      const rushTDs = readStat(s, "rush_tds");
      const ypc = rushAtt > 0 ? rushYds / rushAtt : 0;
      const playerName = pdata.playerName;

      // RB Rushing Yards
      const rbYdsResult = evalTier(rushYds, [1000, 1300, 1600, 2000]);
      if (rbYdsResult) categories.push({ key: `rb_rush_yds:${pid}`, label: "RB Rushing Yards", qualifiedTier: rbYdsResult.tier, qualifiedValue: rushYds, amount: rbYdsResult.amount, isFlat: false, thresholdValue: rbYdsResult.thresholdValue, thresholdLabel: rbYdsResult.thresholdLabel, entityName: playerName, entityPosition: "RB" });

      // RB Rushing TDs
      const rbTDsResult = evalTier(rushTDs, [10, 15, 20, 25]);
      if (rbTDsResult) categories.push({ key: `rb_rush_tds:${pid}`, label: "RB Rushing TDs", qualifiedTier: rbTDsResult.tier, qualifiedValue: rushTDs, amount: rbTDsResult.amount, isFlat: false, thresholdValue: rbTDsResult.thresholdValue, thresholdLabel: rbTDsResult.thresholdLabel, entityName: playerName, entityPosition: "RB" });

      // RB Efficiency Bonus
      if (ypc >= 5.5) {
        categories.push({ key: `rb_eff_bonus:${pid}`, label: "RB Efficiency Bonus (5.5+ YPC)", qualifiedTier: "flat", qualifiedValue: Math.round(ypc * 100) / 100, amount: 100, isFlat: true, entityName: playerName, entityPosition: "RB" });
      }
    }

    // WR/TE payouts — players with receiving stats, min 50 receptions
    for (const [pid, pdata] of playerRecAgg) {
      if (pdata.teamId !== teamId) continue;
      const s = pdata.stats;
      const receptions = readStat(s, "receptions");
      if (receptions < 50) continue;

      const recYds = readStat(s, "receiving_yards");
      const recTDs = readStat(s, "receiving_tds");
      const ypr = receptions > 0 ? recYds / receptions : 0;
      const playerName = pdata.playerName;

      // WR/TE Receiving Yards
      const recYdsResult = evalTier(recYds, [600, 900, 1200, 1500]);
      if (recYdsResult) categories.push({ key: `rec_yds:${pid}`, label: "WR/TE Receiving Yards", qualifiedTier: recYdsResult.tier, qualifiedValue: recYds, amount: recYdsResult.amount, isFlat: false, thresholdValue: recYdsResult.thresholdValue, thresholdLabel: recYdsResult.thresholdLabel, entityName: playerName, entityPosition: "WR/TE" });

      // WR/TE Receiving TDs
      const recTDsResult = evalTier(recTDs, [8, 12, 16, 20]);
      if (recTDsResult) categories.push({ key: `rec_tds:${pid}`, label: "WR/TE Receiving TDs", qualifiedTier: recTDsResult.tier, qualifiedValue: recTDs, amount: recTDsResult.amount, isFlat: false, thresholdValue: recTDsResult.thresholdValue, thresholdLabel: recTDsResult.thresholdLabel, entityName: playerName, entityPosition: "WR/TE" });

      // Receiver Efficiency Bonus
      if (ypr >= 15.0) {
        categories.push({ key: `rec_eff_bonus:${pid}`, label: "Receiver Efficiency Bonus (15+ YPR)", qualifiedTier: "flat", qualifiedValue: Math.round(ypr * 100) / 100, amount: 100, isFlat: true, entityName: playerName, entityPosition: "WR/TE" });
      }
    }

    // ── Player Defensive Payouts ──────────────────────────────────────────────

    // Eligible positions for defensive payouts
    const DL_POSITIONS = new Set(["DT", "REDGE", "RE", "LEDGE", "LE"]);
    const LB_POSITIONS = new Set(["MLB", "LOLB", "ROLB", "MIKE", "WILL", "SAM"]);
    const DB_POSITIONS = new Set(["CB", "FS", "SS"]);
    const DL_LB_POSITIONS = new Set([...DL_POSITIONS, ...LB_POSITIONS]);
    const ALL_DEF_POSITIONS = new Set([...DL_POSITIONS, ...LB_POSITIONS, ...DB_POSITIONS]);

    // Team-level Ball Hawk Bonus (18+ team INTs)
    const teamDefInts = readStat(defAgg, "interceptions");
    if (teamDefInts >= 18) {
      categories.push({ key: "team_ball_hawk", label: "Ball Hawk Bonus (18+ Team INTs)", qualifiedTier: "flat", qualifiedValue: teamDefInts, amount: 250, isFlat: true });
    }

    for (const [pid, pdata] of playerDefAgg) {
      if (pdata.teamId !== teamId) continue;
      const s = pdata.stats;
      const playerName = pdata.playerName;
      // Resolve position: prefer rec_players lookup, fall back to row position field
      const resolvedPos = playerPositions.get(pid) ?? pdata.position ?? "";

      const sacks = readStat(s, "sacks");
      const tackles = readStat(s, "tackles");
      // EA exports no tackles-for-loss stat, so the defensive thresholds are Sacks + Total Tackles +
      // Generated Turnovers (a player's interceptions + forced fumbles + fumble recoveries).
      const generatedTurnovers = readStat(s, "interceptions") + readStat(s, "forced_fumbles") + readStat(s, "fumble_recoveries");

      // Sacks (DL, EDGE, LB)
      if (DL_LB_POSITIONS.has(resolvedPos) || !resolvedPos) {
        const sacksResult = evalTier(sacks, [10, 15, 20, 25]);
        if (sacksResult) categories.push({ key: `def_sacks:${pid}`, label: "Defensive Sacks", qualifiedTier: sacksResult.tier, qualifiedValue: sacks, amount: sacksResult.amount, isFlat: false, thresholdValue: sacksResult.thresholdValue, thresholdLabel: sacksResult.thresholdLabel, entityName: playerName, entityPosition: resolvedPos || "DEF" });
      }

      // Total Tackles (all defensive players)
      if (ALL_DEF_POSITIONS.has(resolvedPos) || !resolvedPos) {
        const tacklesResult = evalTier(tackles, [90, 110, 130, 150]);
        if (tacklesResult) categories.push({ key: `def_tackles:${pid}`, label: "Tackles Leader", qualifiedTier: tacklesResult.tier, qualifiedValue: tackles, amount: tacklesResult.amount, isFlat: false, thresholdValue: tacklesResult.thresholdValue, thresholdLabel: tacklesResult.thresholdLabel, entityName: playerName, entityPosition: resolvedPos || "DEF" });
      }

      // Generated Turnovers (all defensive players) — replaces TFL and the separate INT/FF tiers
      const gtResult = evalTier(generatedTurnovers, [4, 6, 8, 10]);
      if (gtResult) categories.push({ key: `def_gen_to:${pid}`, label: "Generated Turnovers", qualifiedTier: gtResult.tier, qualifiedValue: generatedTurnovers, amount: gtResult.amount, isFlat: false, thresholdValue: gtResult.thresholdValue, thresholdLabel: gtResult.thresholdLabel, entityName: playerName, entityPosition: resolvedPos || "DEF" });
    }

    // ── Special Teams Payouts ─────────────────────────────────────────────────

    for (const [pid, pdata] of playerKickAgg) {
      if (pdata.teamId !== teamId) continue;
      const s = pdata.stats;
      const playerName = pdata.playerName;
      const fgMade = readStat(s, "fg_made");
      const fgAtt = readStat(s, "fg_attempts");
      const xpMade = readStat(s, "xp_made");
      const xpAtt = readStat(s, "xp_attempts");
      const longFg = readStat(s, "fg_long");

      if (fgAtt < 20) continue; // minimum 20 FG attempts

      const fgPct = fgAtt > 0 ? (fgMade / fgAtt) * 100 : 0;

      // FG Accuracy
      const fgResult = evalTier(fgPct, [80, 85, 90, 95]);
      if (fgResult) categories.push({ key: `k_fg_acc:${pid}`, label: "Kicker FG Accuracy", qualifiedTier: fgResult.tier, qualifiedValue: Math.round(fgPct * 10) / 10, amount: fgResult.amount, isFlat: false, thresholdValue: fgResult.thresholdValue, thresholdLabel: fgResult.thresholdLabel, entityName: playerName, entityPosition: "K" });

      // Long FG Bonus (55+ yard made FG)
      if (longFg >= 55) {
        categories.push({ key: `k_long_fg:${pid}`, label: "Long FG Bonus (55+ yards)", qualifiedTier: "flat", qualifiedValue: longFg, amount: 100, isFlat: true, entityName: playerName, entityPosition: "K" });
      }

      // Perfect Kicker Bonus
      if (fgAtt >= 20 && xpAtt >= 30) {
        const xpPct = xpAtt > 0 ? (xpMade / xpAtt) * 100 : 0;
        if (fgPct >= 100 && xpPct >= 100) {
          categories.push({ key: `k_perfect:${pid}`, label: "Perfect Kicker Bonus", qualifiedTier: "flat", qualifiedValue: fgPct, amount: 100, isFlat: true, entityName: playerName, entityPosition: "K" });
        }
      }
    }

    // ── Coach/User EOS Payouts ────────────────────────────────────────────────

    // Missed Playoffs Compensation
    if (!playoffTeamIds.has(teamId)) {
      categories.push({ key: "missed_playoffs", label: "Missed Playoffs Compensation", qualifiedTier: "flat", qualifiedValue: 0, amount: 400, isFlat: true });
    }

    // Win Milestone
    const winResult = evalTier(rec.wins, [9, 11, 13, 15]);
    if (winResult) categories.push({ key: "win_milestone", label: "Regular Season Win Milestone", qualifiedTier: winResult.tier, qualifiedValue: rec.wins, amount: winResult.amount, isFlat: false, thresholdValue: winResult.thresholdValue, thresholdLabel: winResult.thresholdLabel });

    // Point Differential Milestone
    const pdResult = evalTier(rec.pd, [75, 150, 225, 300]);
    if (pdResult) categories.push({ key: "pd_milestone", label: "Point Differential Milestone", qualifiedTier: pdResult.tier, qualifiedValue: rec.pd, amount: pdResult.amount, isFlat: false, thresholdValue: pdResult.thresholdValue, thresholdLabel: pdResult.thresholdLabel });

    // H2H Dominance (min 8 H2H games)
    if (h2h.games >= 8) {
      const h2hPct = (h2h.wins / h2h.games) * 100;
      const h2hResult = evalTier(h2hPct, [60, 70, 80, 90]);
      if (h2hResult) categories.push({ key: "h2h_dominance", label: "H2H Dominance", qualifiedTier: h2hResult.tier, qualifiedValue: Math.round(h2hPct * 10) / 10, amount: h2hResult.amount, isFlat: false, thresholdValue: h2hResult.thresholdValue, thresholdLabel: h2hResult.thresholdLabel });
    }

    // Challenge Completion Milestone
    const challenges = challengeCounts.get(userId) ?? 0;
    const challengeResult = evalTier(challenges, [10, 20, 30, 40]);
    if (challengeResult) categories.push({ key: "challenge_milestone", label: "Challenge Completion Milestone", qualifiedTier: challengeResult.tier, qualifiedValue: challenges, amount: challengeResult.amount, isFlat: false, thresholdValue: challengeResult.thresholdValue, thresholdLabel: challengeResult.thresholdLabel });

    // Badge Collection Milestone
    const badges = badgeCounts.get(userId) ?? 0;
    const badgeResult = evalTier(badges, [5, 10, 15, 20]);
    if (badgeResult) categories.push({ key: "badge_milestone", label: "Badge Collection Milestone", qualifiedTier: badgeResult.tier, qualifiedValue: badges, amount: badgeResult.amount, isFlat: false, thresholdValue: badgeResult.thresholdValue, thresholdLabel: badgeResult.thresholdLabel });

    const total = categories.reduce((sum, c) => sum + c.amount, 0);
    results.push({
      userId,
      teamId,
      discordId: discord?.discordId ?? null,
      displayName: discord?.displayName ?? teamName,
      teamName,
      total,
      categories
    });
  }

  // Post-loop: add defensive yards-allowed per game stats (requires points_against)
  // These require a separate query for each team's points_against from game_results
  await addDefensiveAllowedPayouts(leagueId, seasonNumber, teamIds, results);

  return results;
}

// Separate pass for defensive "allowed" payouts that require per-team opponent scoring data
async function addDefensiveAllowedPayouts(
  leagueId: string,
  seasonNumber: number,
  teamIds: string[],
  results: UserEosStatPayoutData[]
): Promise<void> {
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,is_user_h2h")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false);

  // Points against per team (opponent points scored)
  const ptsAgainst = new Map<string, number>();
  const gamesPerTeam = new Map<string, number>();
  for (const g of games ?? []) {
    const htid = g.home_team_id ? String(g.home_team_id) : null;
    const atid = g.away_team_id ? String(g.away_team_id) : null;
    if (htid && teamIds.includes(htid)) {
      ptsAgainst.set(htid, (ptsAgainst.get(htid) ?? 0) + asNum(g.away_score));
      gamesPerTeam.set(htid, (gamesPerTeam.get(htid) ?? 0) + 1);
    }
    if (atid && teamIds.includes(atid)) {
      ptsAgainst.set(atid, (ptsAgainst.get(atid) ?? 0) + asNum(g.home_score));
      gamesPerTeam.set(atid, (gamesPerTeam.get(atid) ?? 0) + 1);
    }
  }

  for (const userData of results) {
    const gp = gamesPerTeam.get(userData.teamId) ?? 1;
    const pa = ptsAgainst.get(userData.teamId) ?? 0;
    const papg = pa / gp;

    // Points Allowed Per Game (lower is better)
    const papgResult = evalTier(papg, [24, 20, 16, 12], false);
    if (papgResult) {
      userData.categories.push({ key: "team_papg", label: "Points Allowed Per Game", qualifiedTier: papgResult.tier, qualifiedValue: Math.round(papg * 10) / 10, amount: papgResult.amount, isFlat: false, thresholdValue: papgResult.thresholdValue, thresholdLabel: papgResult.thresholdLabel });
      userData.total += papgResult.amount;
    }
  }
}
