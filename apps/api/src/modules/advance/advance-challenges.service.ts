import { REC_WEEKLY_CHALLENGE_PAYOUTS, readStat } from "@rec/shared";
import { supabase, asNumber, nowIso, getLeagueContext, sumTeamStatFromCommitted, creditUserWallet } from "./advance-shared.js";

interface ChallengeTemplate {
  key: string;
  side: "offense" | "defense";
  eval_type: string;
  stat_columns: string[];
  s_threshold: number;
  a_threshold: number;
  s_threshold2?: number;
  a_threshold2?: number;
  s_tier_goal: string;
  a_tier_goal: string;
  b_tier_goal: string;
}

interface TeamSeasonProfile {
  teamId: string;
  avgPassYdsPerGame: number;
  avgRushYdsPerGame: number;
  avgPointsPerGame: number;
  avgPointsAllowedPerGame: number;
  avgTurnoversPerGame: number;
  avgDefSacksPerGame: number;
  topPasserName: string | null;
  topRusherName: string | null;
  weeksPlayed: number;
}

const OFFENSIVE_CHALLENGE_POOL: ChallengeTemplate[] = [
  { key: "pass_yards_350", side: "offense", eval_type: "team_stat_min", stat_columns: ["pass_yards"], s_threshold: 350, a_threshold: 250, s_tier_goal: "Throw for 350+ passing yards and win", a_tier_goal: "Throw for 250+ passing yards and win", b_tier_goal: "Win the game" },
  { key: "pass_yards_400", side: "offense", eval_type: "team_stat_min", stat_columns: ["pass_yards"], s_threshold: 400, a_threshold: 300, s_tier_goal: "Throw for 400+ passing yards and win", a_tier_goal: "Throw for 300+ passing yards and win", b_tier_goal: "Win the game" },
  { key: "rush_yards_150", side: "offense", eval_type: "team_stat_min", stat_columns: ["rush_yards"], s_threshold: 150, a_threshold: 100, s_tier_goal: "Rush for 150+ yards and win", a_tier_goal: "Rush for 100+ yards and win", b_tier_goal: "Win the game" },
  { key: "rush_yards_200", side: "offense", eval_type: "team_stat_min", stat_columns: ["rush_yards"], s_threshold: 200, a_threshold: 130, s_tier_goal: "Rush for 200+ yards and win", a_tier_goal: "Rush for 130+ yards and win", b_tier_goal: "Win the game" },
  { key: "total_yards_450", side: "offense", eval_type: "total_yards", stat_columns: ["pass_yards", "rush_yards"], s_threshold: 450, a_threshold: 350, s_tier_goal: "Gain 450+ total yards and win", a_tier_goal: "Gain 350+ total yards and win", b_tier_goal: "Win the game" },
  { key: "total_yards_500", side: "offense", eval_type: "total_yards", stat_columns: ["pass_yards", "rush_yards"], s_threshold: 500, a_threshold: 400, s_tier_goal: "Gain 500+ total yards and win", a_tier_goal: "Gain 400+ total yards and win", b_tier_goal: "Win the game" },
  { key: "pass_tds_3", side: "offense", eval_type: "team_stat_min", stat_columns: ["pass_tds"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Throw 3+ passing TDs and win", a_tier_goal: "Throw 2+ passing TDs and win", b_tier_goal: "Win the game" },
  { key: "pass_tds_4", side: "offense", eval_type: "team_stat_min", stat_columns: ["pass_tds"], s_threshold: 4, a_threshold: 3, s_tier_goal: "Throw 4+ passing TDs and win", a_tier_goal: "Throw 3+ passing TDs and win", b_tier_goal: "Win the game" },
  { key: "blowout_win_21", side: "offense", eval_type: "score_margin", stat_columns: [], s_threshold: 21, a_threshold: 14, s_tier_goal: "Win by 21+ points", a_tier_goal: "Win by 14+ points", b_tier_goal: "Win the game" },
  { key: "blowout_win_28", side: "offense", eval_type: "score_margin", stat_columns: [], s_threshold: 28, a_threshold: 21, s_tier_goal: "Win by 28+ points", a_tier_goal: "Win by 21+ points", b_tier_goal: "Win the game" },
  { key: "no_int_win", side: "offense", eval_type: "team_stat_max", stat_columns: ["interceptions_thrown"], s_threshold: 0, a_threshold: 1, s_tier_goal: "Win with 0 passing interceptions", a_tier_goal: "Win with 1 or fewer interceptions", b_tier_goal: "Win the game" },
  { key: "efficient_passer_75", side: "offense", eval_type: "completion_pct", stat_columns: ["pass_completions", "pass_attempts"], s_threshold: 0.75, a_threshold: 0.65, s_tier_goal: "Complete 75%+ of pass attempts and win", a_tier_goal: "Complete 65%+ of pass attempts and win", b_tier_goal: "Win the game" },
  { key: "balanced_attack", side: "offense", eval_type: "balanced_attack", stat_columns: ["pass_yards", "rush_yards"], s_threshold: 250, a_threshold: 200, s_threshold2: 150, a_threshold2: 100, s_tier_goal: "Throw for 250+ yards AND rush for 150+ yards and win", a_tier_goal: "Throw for 200+ yards AND rush for 100+ yards and win", b_tier_goal: "Win the game" },
  { key: "first_downs_25", side: "offense", eval_type: "team_stat_min", stat_columns: ["first_downs"], s_threshold: 25, a_threshold: 15, s_tier_goal: "Pick up 25+ first downs and win", a_tier_goal: "Pick up 15+ first downs and win", b_tier_goal: "Win the game" },
  { key: "high_scoring_35", side: "offense", eval_type: "user_score_min", stat_columns: [], s_threshold: 35, a_threshold: 28, s_tier_goal: "Score 35+ points and win", a_tier_goal: "Score 28+ points and win", b_tier_goal: "Win the game" }
];

const DEFENSIVE_CHALLENGE_POOL: ChallengeTemplate[] = [
  { key: "hold_qb_225", side: "defense", eval_type: "opp_stat_max", stat_columns: ["pass_yards"], s_threshold: 225, a_threshold: 275, s_tier_goal: "Hold opponent under 225 passing yards and win", a_tier_goal: "Hold opponent under 275 passing yards and win", b_tier_goal: "Win the game" },
  { key: "hold_qb_200", side: "defense", eval_type: "opp_stat_max", stat_columns: ["pass_yards"], s_threshold: 200, a_threshold: 250, s_tier_goal: "Hold opponent under 200 passing yards and win", a_tier_goal: "Hold opponent under 250 passing yards and win", b_tier_goal: "Win the game" },
  { key: "hold_rush_75", side: "defense", eval_type: "opp_stat_max", stat_columns: ["rush_yards"], s_threshold: 75, a_threshold: 125, s_tier_goal: "Hold opponent rushing attack under 75 yards and win", a_tier_goal: "Hold opponent rushing attack under 125 yards and win", b_tier_goal: "Win the game" },
  { key: "hold_rush_100", side: "defense", eval_type: "opp_stat_max", stat_columns: ["rush_yards"], s_threshold: 100, a_threshold: 150, s_tier_goal: "Hold opponent rushing attack under 100 yards and win", a_tier_goal: "Hold opponent rushing attack under 150 yards and win", b_tier_goal: "Win the game" },
  { key: "opp_score_10", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 10, a_threshold: 20, s_tier_goal: "Hold opponent to 10 points or fewer and win", a_tier_goal: "Hold opponent to 20 points or fewer and win", b_tier_goal: "Win the game" },
  { key: "opp_score_14", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 14, a_threshold: 24, s_tier_goal: "Hold opponent to 14 points or fewer and win", a_tier_goal: "Hold opponent to 24 points or fewer and win", b_tier_goal: "Win the game" },
  { key: "shutout", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 0, a_threshold: 7, s_tier_goal: "Shut out the opponent and win", a_tier_goal: "Hold opponent to 7 or fewer points and win", b_tier_goal: "Win the game" },
  { key: "force_sacks_2", side: "defense", eval_type: "own_def_stat", stat_columns: ["sacks"], s_threshold: 2, a_threshold: 1, s_tier_goal: "Record 2+ sacks and win", a_tier_goal: "Record 1+ sack and win", b_tier_goal: "Win the game" },
  { key: "force_sacks_3", side: "defense", eval_type: "own_def_stat", stat_columns: ["sacks"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Record 3+ sacks and win", a_tier_goal: "Record 2+ sacks and win", b_tier_goal: "Win the game" },
  { key: "sack_party_5", side: "defense", eval_type: "own_def_stat", stat_columns: ["sacks"], s_threshold: 5, a_threshold: 3, s_tier_goal: "Record 5+ sacks and win", a_tier_goal: "Record 3+ sacks and win", b_tier_goal: "Win the game" },
  { key: "force_turnovers_2", side: "defense", eval_type: "turnovers", stat_columns: ["interceptions", "forced_fumbles"], s_threshold: 2, a_threshold: 1, s_tier_goal: "Force 2+ turnovers and win", a_tier_goal: "Force 1+ turnover and win", b_tier_goal: "Win the game" },
  { key: "force_turnovers_3", side: "defense", eval_type: "turnovers", stat_columns: ["interceptions", "forced_fumbles"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Force 3+ turnovers and win", a_tier_goal: "Force 2+ turnovers and win", b_tier_goal: "Win the game" },
  { key: "ball_hawk_3", side: "defense", eval_type: "own_def_stat", stat_columns: ["interceptions"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Intercept 3+ passes and win", a_tier_goal: "Intercept 2+ passes and win", b_tier_goal: "Win the game" },
  { key: "lockdown_secondary", side: "defense", eval_type: "opp_completion_pct", stat_columns: ["pass_completions", "pass_attempts"], s_threshold: 0.50, a_threshold: 0.60, s_tier_goal: "Hold opponent QB completion rate under 50% and win", a_tier_goal: "Hold opponent QB completion rate under 60% and win", b_tier_goal: "Win the game" },
  { key: "redzone_lockdown", side: "defense", eval_type: "opp_team_stat_max", stat_columns: ["red_zone_tds"], s_threshold: 0, a_threshold: 1, s_tier_goal: "Allow 0 red zone TDs and win", a_tier_goal: "Allow 1 or fewer red zone TDs and win", b_tier_goal: "Win the game" },
  { key: "bend_not_break", side: "defense", eval_type: "bend_not_break", stat_columns: [], s_threshold: 17, a_threshold: 24, s_tier_goal: "Allow 350+ yards but hold opponent under 17 points and win", a_tier_goal: "Allow 350+ yards but hold opponent under 24 points and win", b_tier_goal: "Win the game" }
];

const CHALLENGE_TEMPLATE_MAP = new Map<string, ChallengeTemplate>([
  ...(OFFENSIVE_CHALLENGE_POOL.map((t) => [t.key, t] as [string, ChallengeTemplate])),
  ...(DEFENSIVE_CHALLENGE_POOL.map((t) => [t.key, t] as [string, ChallengeTemplate])),
  ["fallback_pass_yards", OFFENSIVE_CHALLENGE_POOL[0]],
  ["fallback_hold_qb", DEFENSIVE_CHALLENGE_POOL[0]]
]);

async function getWeekGames(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (error) throw error;
  return (data ?? []) as any[];
}

function pickFromPool(pool: ChallengeTemplate[], excludedKeys?: Set<string> | null): ChallengeTemplate {
  const filtered = excludedKeys?.size ? pool.filter((t) => !excludedKeys.has(t.key)) : pool;
  const source = filtered.length > 0 ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

async function readTeamWeeklyStat(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string | null, canonicalKey: string): Promise<{ value: number; hasData: boolean }> {
  if (!teamId) return { value: 0, hasData: false };
  const { data } = await supabase.from("rec_team_weekly_stats").select("stats").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("team_id", teamId).eq("stat_category", "team").limit(1);
  const row = data?.[0];
  if (!row) return { value: 0, hasData: false };
  return { value: readStat(row.stats as Record<string, unknown>, canonicalKey), hasData: true };
}

async function getTeamCompletionPct(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string): Promise<{ pct: number; hasData: boolean }> {
  const { data } = await supabase.from("rec_player_weekly_stats").select("stats").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("team_id", teamId).eq("stat_category", "passing");
  if (!data?.length) return { pct: 0, hasData: false };
  let totalComp = 0, totalAtt = 0;
  for (const row of data as any[]) {
    const s = (row.stats ?? {}) as Record<string, unknown>;
    totalComp += readStat(s, "pass_completions");
    totalAtt += readStat(s, "pass_attempts");
  }
  if (totalAtt === 0) return { pct: 0, hasData: false };
  return { pct: totalComp / totalAtt, hasData: true };
}

async function buildTeamSeasonProfile(leagueId: string, seasonNumber: number, throughWeek: number, teamId: string): Promise<TeamSeasonProfile> {
  const [{ data: passingRows }, { data: rushingRows }, { data: defenseRows }, gameResults] = await Promise.all([
    supabase.from("rec_player_weekly_stats").select("stats,player_name,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "passing").lt("week_number", throughWeek).order("week_number", { ascending: false }),
    supabase.from("rec_player_weekly_stats").select("stats,player_name,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "rushing").lt("week_number", throughWeek).order("week_number", { ascending: false }),
    supabase.from("rec_player_weekly_stats").select("stats,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "defense").lt("week_number", throughWeek),
    supabase.from("rec_game_results").select("home_team_id,away_team_id,home_score,away_score").eq("league_id", leagueId).eq("season_number", seasonNumber).lt("week_number", throughWeek).or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
  ]);

  const latestPassWeek = (passingRows ?? [])[0]?.week_number ?? 0;
  const latestRushWeek = (rushingRows ?? [])[0]?.week_number ?? 0;
  const latestPassRows = (passingRows ?? []).filter((r: any) => r.week_number === latestPassWeek);
  const latestRushRows = (rushingRows ?? []).filter((r: any) => r.week_number === latestRushWeek);

  let topPasserName: string | null = null, topPassYds = 0, avgPassYdsPerGame = 0;
  for (const row of latestPassRows) {
    const s = (row.stats ?? {}) as Record<string, any>;
    const yds = readStat(s, "pass_yards");
    if (yds > topPassYds) { topPassYds = yds; topPasserName = (s.fullName as string) ?? row.player_name ?? null; }
    const ypg = asNumber(s.passYdsPerGame);
    if (ypg > avgPassYdsPerGame) avgPassYdsPerGame = ypg;
  }
  let topRusherName: string | null = null, topRushYds = 0, avgRushYdsPerGame = 0;
  for (const row of latestRushRows) {
    const s = (row.stats ?? {}) as Record<string, any>;
    const yds = readStat(s, "rush_yards");
    if (yds > topRushYds) { topRushYds = yds; topRusherName = (s.fullName as string) ?? row.player_name ?? null; }
    const ypg = asNumber(s.rushYdsPerGame);
    if (ypg > avgRushYdsPerGame) avgRushYdsPerGame = ypg;
  }

  let totalPoints = 0, totalAllowed = 0, gamesPlayed = 0;
  for (const g of gameResults.data ?? []) {
    const isHome = g.home_team_id === teamId;
    totalPoints += isHome ? asNumber(g.home_score) : asNumber(g.away_score);
    totalAllowed += isHome ? asNumber(g.away_score) : asNumber(g.home_score);
    gamesPlayed++;
  }

  let totalSacks = 0, totalInts = 0, totalFumbles = 0;
  const defWeeks = new Set<number>();
  for (const row of defenseRows ?? []) {
    const s = (row.stats ?? {}) as Record<string, any>;
    totalSacks += readStat(s, "sacks");
    totalInts += readStat(s, "interceptions");
    totalFumbles += readStat(s, "forced_fumbles");
    defWeeks.add(row.week_number);
  }
  const defGames = defWeeks.size || 1;

  return {
    teamId,
    avgPassYdsPerGame,
    avgRushYdsPerGame,
    avgPointsPerGame: gamesPlayed > 0 ? totalPoints / gamesPlayed : 0,
    avgPointsAllowedPerGame: gamesPlayed > 0 ? totalAllowed / gamesPlayed : 0,
    avgTurnoversPerGame: (totalInts + totalFumbles) / defGames,
    avgDefSacksPerGame: totalSacks / defGames,
    topPasserName,
    topRusherName,
    weeksPlayed: Math.max(latestPassWeek, latestRushWeek)
  };
}

function pickStylePool(pool: ChallengeTemplate[], keys: string[], excludedKeys?: Set<string> | null): ChallengeTemplate | null {
  const stylePool = pool.filter((t) => keys.some((k) => t.key.startsWith(k)));
  const available = excludedKeys?.size ? stylePool.filter((t) => !excludedKeys.has(t.key)) : stylePool;
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function selectDefensiveChallenge(opp: TeamSeasonProfile, excludedKeys?: Set<string> | null): { template: ChallengeTemplate; targetPlayerName: string | null } {
  if (opp.weeksPlayed > 0) {
    if (opp.avgPassYdsPerGame > 250) {
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, ["hold_qb_", "lockdown_secondary", "force_sacks_", "sack_party_"], excludedKeys);
      if (t) return { template: t, targetPlayerName: opp.topPasserName };
    }
    if (opp.avgRushYdsPerGame > 130) {
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, ["hold_rush_"], excludedKeys);
      if (t) return { template: t, targetPlayerName: opp.topRusherName };
    }
    if (opp.avgPointsPerGame > 28) {
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, ["opp_score_", "shutout", "force_turnovers_", "ball_hawk_", "redzone_lockdown"], excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
    if (opp.avgPointsPerGame < 18 && opp.weeksPlayed >= 3) {
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, ["bend_not_break"], excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
  }
  return { template: pickFromPool(DEFENSIVE_CHALLENGE_POOL, excludedKeys), targetPlayerName: null };
}

function selectOffensiveChallenge(user: TeamSeasonProfile, excludedKeys?: Set<string> | null): { template: ChallengeTemplate; targetPlayerName: string | null } {
  if (user.weeksPlayed > 0 && (user.avgPassYdsPerGame > 0 || user.avgRushYdsPerGame > 0)) {
    const passHeavy = user.avgRushYdsPerGame > 0 && user.avgPassYdsPerGame > user.avgRushYdsPerGame * 2;
    const runHeavy = user.avgPassYdsPerGame > 0 && user.avgRushYdsPerGame > user.avgPassYdsPerGame * 1.5;
    const balanced = !passHeavy && !runHeavy && user.avgPassYdsPerGame > 150 && user.avgRushYdsPerGame > 80;
    if (passHeavy) { const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, ["pass_yards_", "pass_tds_", "efficient_passer_", "high_scoring_"], excludedKeys); if (t) return { template: t, targetPlayerName: user.topPasserName }; }
    if (runHeavy) { const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, ["rush_yards_", "total_yards_", "high_scoring_"], excludedKeys); if (t) return { template: t, targetPlayerName: user.topRusherName }; }
    if (balanced) { const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, ["balanced_attack", "total_yards_", "first_downs_"], excludedKeys); if (t) return { template: t, targetPlayerName: null }; }
    if (user.avgPointsPerGame > 28) { const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, ["blowout_win_", "high_scoring_", "pass_tds_"], excludedKeys); if (t) return { template: t, targetPlayerName: null }; }
  }
  return { template: pickFromPool(OFFENSIVE_CHALLENGE_POOL, excludedKeys), targetPlayerName: null };
}

async function getCompletedResultForChallenge(challenge: any) {
  if (challenge.game_id) {
    const byTeams = await supabase.from("rec_game_results").select("*").eq("league_id", challenge.league_id).eq("season_number", challenge.season_number).eq("week_number", challenge.week_number).or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`).limit(1).maybeSingle();
    if (byTeams.data) return byTeams.data as any;
  }
  const result = await supabase.from("rec_game_results").select("*").eq("league_id", challenge.league_id).eq("season_number", challenge.season_number).eq("week_number", challenge.week_number).or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`).limit(1).maybeSingle();
  return result.data as any;
}

function userTeamSide(game: any, userId: string) {
  if (game.home_user_id === userId) return { teamId: game.home_team_id, opponentTeamId: game.away_team_id, score: asNumber(game.home_score), oppScore: asNumber(game.away_score), location: "Home" };
  if (game.away_user_id === userId) return { teamId: game.away_team_id, opponentTeamId: game.home_team_id, score: asNumber(game.away_score), oppScore: asNumber(game.home_score), location: "Away" };
  return null;
}

export async function generateWeeklyChallenges(input: { guildId: string; regenerate?: boolean }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;

  if (input.regenerate) {
    await supabase.from("rec_weekly_challenges").update({ status: "voided", updated_at: new Date().toISOString() }).eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  }

  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const lookbackWeeks = 3;
  const firstLookback = Math.max(1, weekNumber - lookbackWeeks);
  const prevKeyMap = new Map<string, Set<string>>();
  if (firstLookback < weekNumber) {
    const { data: prevChallenges } = await supabase.from("rec_weekly_challenges").select("user_id,challenge_side,challenge_key").eq("league_id", context.league_id).eq("season_number", seasonNumber).gte("week_number", firstLookback).lt("week_number", weekNumber);
    for (const c of prevChallenges ?? []) {
      const mapKey = `${c.user_id}|${c.challenge_side}`;
      if (!prevKeyMap.has(mapKey)) prevKeyMap.set(mapKey, new Set());
      prevKeyMap.get(mapKey)!.add(c.challenge_key);
    }
  }

  const allTeamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id].filter(Boolean) as string[]))];
  const emptyProfile = (teamId: string): TeamSeasonProfile => ({ teamId, avgPassYdsPerGame: 0, avgRushYdsPerGame: 0, avgPointsPerGame: 0, avgPointsAllowedPerGame: 0, avgTurnoversPerGame: 0, avgDefSacksPerGame: 0, topPasserName: null, topRusherName: null, weeksPlayed: 0 });
  const profileEntries = await Promise.all(allTeamIds.map(async (teamId) => [teamId, await buildTeamSeasonProfile(context.league_id, seasonNumber, weekNumber, teamId).catch(() => emptyProfile(teamId))] as const));
  const profileMap = new Map<string, TeamSeasonProfile>(profileEntries);

  const rows: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id, opponentUserId: game.away_user_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id, opponentUserId: game.home_user_id }
    ].filter((side) => side.userId && side.teamId);
    for (const side of sides) {
      const userProfile = profileMap.get(side.teamId) ?? emptyProfile(side.teamId);
      const oppProfile = side.opponentTeamId ? (profileMap.get(side.opponentTeamId) ?? emptyProfile(side.opponentTeamId)) : emptyProfile("");
      const { template: offTemplate, targetPlayerName: offPlayer } = selectOffensiveChallenge(userProfile, prevKeyMap.get(`${side.userId}|offense`));
      const { template: defTemplate, targetPlayerName: defPlayer } = selectDefensiveChallenge(oppProfile, prevKeyMap.get(`${side.userId}|defense`));
      const base = { league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, target_type: "team" };
      const isPlayerDefChallenge = defPlayer && (defTemplate.key.includes("hold_qb") || defTemplate.key.includes("hold_rush"));
      rows.push({ ...base, challenge_side: "offense", challenge_key: offTemplate.key, s_tier_goal: offTemplate.s_tier_goal, a_tier_goal: offTemplate.a_tier_goal, b_tier_goal: offTemplate.b_tier_goal, target_player_name: offPlayer ?? null });
      rows.push({ ...base, challenge_side: "defense", challenge_key: defTemplate.key, s_tier_goal: isPlayerDefChallenge ? `${defTemplate.s_tier_goal} (key threat: ${defPlayer})` : defTemplate.s_tier_goal, a_tier_goal: isPlayerDefChallenge ? `${defTemplate.a_tier_goal} (key threat: ${defPlayer})` : defTemplate.a_tier_goal, b_tier_goal: defTemplate.b_tier_goal, target_player_name: defPlayer ?? null });
    }
  }

  let generated = 0;
  if (rows.length) {
    const existing = await supabase.from("rec_weekly_challenges").select("user_id,challenge_side").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
    if (existing.error) throw existing.error;
    const existingKeys = new Set((existing.data ?? []).map((c: any) => `${c.user_id}|${c.challenge_side}`));
    const toInsert = rows.filter((row) => !existingKeys.has(`${row.user_id}|${row.challenge_side}`));
    if (toInsert.length) { const { error } = await supabase.from("rec_weekly_challenges").insert(toInsert); if (error) throw error; }
    generated = toInsert.length;
  }
  return { generated, weekNumber, seasonNumber };
}

export async function getChallengeAudit(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const weekNumber = league.current_week ?? 1;
  const { data, error } = await supabase.from("rec_weekly_challenges").select("*, rec_users(display_name), rec_teams(name,abbreviation)").eq("league_id", context.league_id).gte("week_number", Math.max(1, weekNumber - 2)).order("week_number", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return { challenges: data ?? [] };
}

export async function evaluateWeeklyChallenges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);

  const { data: challenges, error } = await supabase.from("rec_weekly_challenges").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", completedWeek).eq("status", "active");
  if (error) throw error;

  let evaluated = 0, paid = 0;

  for (const challenge of challenges ?? []) {
    const game = await getCompletedResultForChallenge(challenge);
    if (!game || typeof game.home_score !== "number" || typeof game.away_score !== "number") continue;
    const side = userTeamSide(game, challenge.user_id);
    if (!side) continue;
    const didWin = side.score > side.oppScore;
    let earnedTier: "S" | "A" | "B" | null = didWin ? "B" : null;
    const details: Record<string, unknown> = { didWin, score: side.score, opponentScore: side.oppScore };

    if (didWin) {
      const template = CHALLENGE_TEMPLATE_MAP.get(challenge.challenge_key);
      if (template) {
        const leagueId = context.league_id;
        const evalType = template.eval_type;
        if (evalType === "score_margin") {
          const margin = side.score - side.oppScore;
          details.margin = margin;
          if (margin >= template.s_threshold) earnedTier = "S"; else if (margin >= template.a_threshold) earnedTier = "A";
        } else if (evalType === "opp_score_max") {
          details.opponentScore = side.oppScore;
          if (side.oppScore <= template.s_threshold) earnedTier = "S"; else if (side.oppScore <= template.a_threshold) earnedTier = "A";
        } else if (evalType === "team_stat_min") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total; details.hasData = hasData;
          if (hasData) { if (total >= template.s_threshold) earnedTier = "S"; else if (total >= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "team_stat_max") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total; details.hasData = hasData;
          if (hasData) { if (total <= template.s_threshold) earnedTier = "S"; else if (total <= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "total_yards") {
          const [passResult, rushResult] = await Promise.all([sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["pass_yards"]), sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rush_yards"])]);
          const totalYards = passResult.total + rushResult.total;
          details.passYards = passResult.total; details.rushYards = rushResult.total; details.totalYards = totalYards; details.hasData = passResult.hasData || rushResult.hasData;
          if (details.hasData) { if (totalYards >= template.s_threshold) earnedTier = "S"; else if (totalYards >= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "opp_stat_max") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, template.stat_columns);
          details[`opp_${template.stat_columns[0]}`] = total; details.hasData = hasData;
          if (hasData) { if (total <= template.s_threshold) earnedTier = "S"; else if (total <= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "opp_team_stat_max") {
          const { value, hasData } = await readTeamWeeklyStat(leagueId, seasonNumber, completedWeek, side.opponentTeamId, template.stat_columns[0]);
          details[`opp_${template.stat_columns[0]}`] = value; details.hasData = hasData;
          if (hasData) { if (value <= template.s_threshold) earnedTier = "S"; else if (value <= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "own_def_stat") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total; details.hasData = hasData;
          if (hasData) { if (total >= template.s_threshold) earnedTier = "S"; else if (total >= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "turnovers") {
          const [intResult, fumResult] = await Promise.all([sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["interceptions"]), sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["forced_fumbles"])]);
          const turnovers = intResult.total + fumResult.total;
          details.defInterceptions = intResult.total; details.forcedFumbles = fumResult.total; details.turnovers = turnovers; details.hasData = intResult.hasData || fumResult.hasData;
          if (details.hasData) { if (turnovers >= template.s_threshold) earnedTier = "S"; else if (turnovers >= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "completion_pct") {
          const { pct, hasData } = await getTeamCompletionPct(leagueId, seasonNumber, completedWeek, side.teamId);
          details.completionPct = pct; details.hasData = hasData;
          if (hasData) { if (pct >= template.s_threshold) earnedTier = "S"; else if (pct >= template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "opp_completion_pct") {
          const { pct, hasData } = await getTeamCompletionPct(leagueId, seasonNumber, completedWeek, side.opponentTeamId);
          details.oppCompletionPct = pct; details.hasData = hasData;
          if (hasData) { if (pct < template.s_threshold) earnedTier = "S"; else if (pct < template.a_threshold) earnedTier = "A"; }
        } else if (evalType === "balanced_attack") {
          const [passResult, rushResult] = await Promise.all([sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["pass_yards"]), sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rush_yards"])]);
          details.passYards = passResult.total; details.rushYards = rushResult.total; details.hasData = passResult.hasData || rushResult.hasData;
          if (details.hasData) {
            if (passResult.total >= template.s_threshold && rushResult.total >= (template.s_threshold2 ?? 0)) earnedTier = "S";
            else if (passResult.total >= template.a_threshold && rushResult.total >= (template.a_threshold2 ?? 0)) earnedTier = "A";
          }
        } else if (evalType === "user_score_min") {
          details.userScore = side.score; details.hasData = true;
          if (side.score >= template.s_threshold) earnedTier = "S"; else if (side.score >= template.a_threshold) earnedTier = "A";
        } else if (evalType === "bend_not_break") {
          const [oppPassResult, oppRushResult] = await Promise.all([sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["pass_yards"]), sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["rush_yards"])]);
          const oppTotalYards = oppPassResult.total + oppRushResult.total;
          details.oppTotalYards = oppTotalYards; details.oppScore = side.oppScore; details.hasData = oppPassResult.hasData || oppRushResult.hasData;
          if (details.hasData && oppTotalYards >= 350) { if (side.oppScore <= template.s_threshold) earnedTier = "S"; else if (side.oppScore <= template.a_threshold) earnedTier = "A"; }
        }
      }
    }

    const amount = earnedTier ? REC_WEEKLY_CHALLENGE_PAYOUTS[earnedTier] : 0;
    let ledgerId: string | null = null;
    if (amount > 0) {
      const credit = await creditUserWallet({ userId: challenge.user_id, leagueId: context.league_id, seasonNumber, amount, transactionType: "weekly_challenge", description: `${challenge.challenge_side === "offense" ? "Offensive" : "Defensive"} Weekly Challenge - ${earnedTier} Tier`, sourceReference: { idempotencyKey: `weekly_challenge:${challenge.id}:${earnedTier}`, type: "weekly_challenge", challengeId: challenge.id, tier: earnedTier, weekNumber: completedWeek } });
      ledgerId = credit.ledger?.id ?? null;
      if (credit.created) paid += amount;
    }

    const { error: updateError } = await supabase.from("rec_weekly_challenges").update({ status: "evaluated", earned_tier: earnedTier, earned_amount: amount, evaluation_details: details, evaluated_at: nowIso(), paid_ledger_id: ledgerId, updated_at: nowIso() }).eq("id", challenge.id);
    if (updateError) throw updateError;
    evaluated += 1;
  }

  return { evaluated, paid, weekNumber: completedWeek, seasonNumber };
}
