import { supabase } from "../../lib/supabase.js";

export type ProfileBoxScoreStats = {
  gamesLogged: number;
  boxScoresUploaded: number;
  totalYards: number;
  totalYardsAvg: number;
  passingYards: number;
  passingYardsAvg: number;
  rushingYards: number;
  rushingYardsAvg: number;
  firstDowns: number;
  firstDownsAvg: number;
  turnoversGenerated: number;
  turnoversGeneratedAvg: number;
  turnoversCommitted: number;
  turnoversCommittedAvg: number;
  turnoverDifferential: number;
  turnoverDifferentialAvg: number;
  redZoneOffPct: number;
  redZoneOffPctAvg: number;
  redZoneDefPct: number;
  redZoneDefPctAvg: number;
  activeStreak: string;
};

function num(value: unknown) {
  return Number(value) || 0;
}

function perGameAvg(total: number, games: number) {
  return games > 0 ? Math.round((total / games) * 10) / 10 : 0;
}

function pctAvg(sum: number, games: number) {
  return games > 0 ? Math.round(sum / games) : 0;
}

function streakFromGameStats(rows: Array<{ result?: string | null; week_number?: number | null }>) {
  const sorted = [...rows]
    .filter((row) => row.result)
    .sort((a, b) => Number(a.week_number ?? 0) - Number(b.week_number ?? 0));

  let streak = 0;
  let type: "W" | "L" | "T" | null = null;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const result = sorted[index].result === "win" ? "W" : sorted[index].result === "loss" ? "L" : "T";
    if (type === null) {
      type = result;
      streak = 1;
    } else if (result === type) {
      streak += 1;
    } else {
      break;
    }
  }

  return type && streak > 0 ? `${type}${streak}` : "—";
}

export function aggregateBoxScoreStats(rows: any[]): ProfileBoxScoreStats {
  const gamesLogged = rows.length;
  const boxScoresUploaded = new Set(rows.map((row) => row.week_number)).size;
  let totalYards = 0;
  let passingYards = 0;
  let rushingYards = 0;
  let firstDowns = 0;
  let turnoversGenerated = 0;
  let turnoversCommitted = 0;
  let redZoneOffSum = 0;
  let redZoneOffGames = 0;
  let redZoneDefSum = 0;
  let redZoneDefGames = 0;

  for (const row of rows) {
    totalYards += num(row.total_yards_gained);
    passingYards += num(row.off_pass_yards);
    rushingYards += num(row.off_rush_yards);
    firstDowns += num(row.off_first_down);
    turnoversGenerated += num(row.generated_turnovers);
    turnoversCommitted += num(row.turnovers_committed);
    if (row.red_zone_off_percentage != null) {
      redZoneOffSum += num(row.red_zone_off_percentage);
      redZoneOffGames += 1;
    }
    if (row.red_zone_def_percentage != null) {
      redZoneDefSum += num(row.red_zone_def_percentage);
      redZoneDefGames += 1;
    }
  }

  const turnoverDifferential = turnoversGenerated - turnoversCommitted;

  return {
    gamesLogged,
    boxScoresUploaded,
    totalYards,
    totalYardsAvg: perGameAvg(totalYards, gamesLogged),
    passingYards,
    passingYardsAvg: perGameAvg(passingYards, gamesLogged),
    rushingYards,
    rushingYardsAvg: perGameAvg(rushingYards, gamesLogged),
    firstDowns,
    firstDownsAvg: perGameAvg(firstDowns, gamesLogged),
    turnoversGenerated,
    turnoversGeneratedAvg: perGameAvg(turnoversGenerated, gamesLogged),
    turnoversCommitted,
    turnoversCommittedAvg: perGameAvg(turnoversCommitted, gamesLogged),
    turnoverDifferential,
    turnoverDifferentialAvg: perGameAvg(turnoverDifferential, gamesLogged),
    redZoneOffPct: pctAvg(redZoneOffSum, redZoneOffGames),
    redZoneOffPctAvg: pctAvg(redZoneOffSum, redZoneOffGames),
    redZoneDefPct: pctAvg(redZoneDefSum, redZoneDefGames),
    redZoneDefPctAvg: pctAvg(redZoneDefSum, redZoneDefGames),
    activeStreak: streakFromGameStats(rows),
  };
}

export async function loadSeasonBoxScoreStats(userId: string, leagueId: string, seasonNumber: number) {
  const { data, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("week_number", { ascending: true });

  if (error) throw error;
  return aggregateBoxScoreStats(data ?? []);
}

export async function loadCareerBoxScoreStats(userId: string) {
  const { data, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("user_id", userId)
    .order("season_number", { ascending: true })
    .order("week_number", { ascending: true });

  if (error) throw error;
  return aggregateBoxScoreStats(data ?? []);
}

export async function countDistinctWeeksLogged(userId: string, leagueId?: string | null) {
  let query = supabase.from("rec_team_game_stats").select("week_number,season_number").eq("user_id", userId);
  if (leagueId) query = query.eq("league_id", leagueId);
  const { data, error } = await query;
  if (error) throw error;
  return new Set((data ?? []).map((row) => `${row.season_number}:${row.week_number}`)).size;
}

export async function removeSupersededWeekGameStats(sub: {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  home_user_id?: string | null;
  away_user_id?: string | null;
}) {
  const { data: existing, error: existingError } = await supabase
    .from("rec_team_game_stats")
    .select("user_id")
    .eq("league_id", sub.league_id)
    .eq("season_number", sub.season_number)
    .eq("week_number", sub.week_number)
    .neq("submission_id", sub.id);

  if (existingError) throw existingError;

  const userIds = new Set<string>();
  for (const row of existing ?? []) {
    if (row.user_id) userIds.add(row.user_id);
  }
  if (sub.home_user_id) userIds.add(sub.home_user_id);
  if (sub.away_user_id) userIds.add(sub.away_user_id);

  const { error: deleteError } = await supabase
    .from("rec_team_game_stats")
    .delete()
    .eq("league_id", sub.league_id)
    .eq("season_number", sub.season_number)
    .eq("week_number", sub.week_number)
    .neq("submission_id", sub.id);

  if (deleteError) throw deleteError;
  return [...userIds];
}

export async function syncUsersAfterBoxScoreApproval(sub: {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  home_user_id?: string | null;
  away_user_id?: string | null;
}) {
  return removeSupersededWeekGameStats(sub);
}

export type PurchaseCounts = {
  legends: number;
  customPlayers: number;
  coreAttributes: number;
  nonCoreAttributes: number;
  ageResets: number;
  devUps: number;
  contracts: number;
};

export type FinancialSummaryScope = {
  totalEarned: number;
  totalSpent: number;
  profitDeficit: number;
  avgEarnedPerWeek: number;
  avgSpentPerWeek: number;
  weeksLogged: number;
  purchases: PurchaseCounts;
};

function emptyPurchaseCounts(): PurchaseCounts {
  return {
    legends: 0,
    customPlayers: 0,
    coreAttributes: 0,
    nonCoreAttributes: 0,
    ageResets: 0,
    devUps: 0,
    contracts: 0,
  };
}

function summarizePurchaseRows(rows: any[] | null | undefined): PurchaseCounts {
  const counts = emptyPurchaseCounts();
  for (const row of rows ?? []) {
    const purchaseType = String(row.purchase_type ?? "").toLowerCase();
    if (purchaseType.includes("legend")) counts.legends += 1;
    else if (purchaseType.includes("custom")) counts.customPlayers += 1;
    else if (purchaseType.includes("core") && purchaseType.includes("attribute")) counts.coreAttributes += 1;
    else if (purchaseType.includes("attribute") || purchaseType.includes("trait")) counts.nonCoreAttributes += 1;
    else if (purchaseType.includes("age")) counts.ageResets += 1;
    else if (purchaseType.includes("dev")) counts.devUps += 1;
    else if (purchaseType.includes("contract")) counts.contracts += 1;
  }
  return counts;
}

function summarizeLedgerRows(rows: any[] | null | undefined, weeksLogged: number): Omit<FinancialSummaryScope, "purchases"> {
  let totalEarned = 0;
  let totalSpent = 0;
  for (const row of rows ?? []) {
    const amount = num(row.amount);
    if (amount > 0) totalEarned += amount;
    else totalSpent += Math.abs(amount);
  }

  return {
    totalEarned,
    totalSpent,
    profitDeficit: totalEarned - totalSpent,
    avgEarnedPerWeek: weeksLogged > 0 ? Math.floor(totalEarned / weeksLogged) : 0,
    avgSpentPerWeek: weeksLogged > 0 ? Math.floor(totalSpent / weeksLogged) : 0,
    weeksLogged,
  };
}

export async function loadUserFinancialSummary(userId: string, leagueId: string | null) {
  const [globalLedgerResult, leagueLedgerResult, globalPurchaseResult, leaguePurchaseResult, leagueWeeks, globalWeeks] = await Promise.all([
    supabase.from("rec_dollar_ledger").select("amount,transaction_type,league_id").eq("user_id", userId),
    leagueId
      ? supabase.from("rec_dollar_ledger").select("amount,transaction_type").eq("user_id", userId).eq("league_id", leagueId)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("rec_purchases").select("purchase_type,status").eq("user_id", userId).in("status", ["approved", "fulfilled"]),
    leagueId
      ? supabase.from("rec_purchases").select("purchase_type,status").eq("user_id", userId).eq("league_id", leagueId).in("status", ["approved", "fulfilled"])
      : Promise.resolve({ data: [], error: null }),
    leagueId ? countDistinctWeeksLogged(userId, leagueId) : Promise.resolve(0),
    countDistinctWeeksLogged(userId),
  ]);

  if (globalLedgerResult.error) throw globalLedgerResult.error;
  if (leagueLedgerResult.error) throw leagueLedgerResult.error;
  if (globalPurchaseResult.error) throw globalPurchaseResult.error;
  if (leaguePurchaseResult.error) throw leaguePurchaseResult.error;

  const league: FinancialSummaryScope = {
    ...summarizeLedgerRows(leagueLedgerResult.data, leagueWeeks),
    purchases: summarizePurchaseRows(leaguePurchaseResult.data),
  };
  const global: FinancialSummaryScope = {
    ...summarizeLedgerRows(globalLedgerResult.data, globalWeeks),
    purchases: summarizePurchaseRows(globalPurchaseResult.data),
  };

  return { league, global };
}

export function formatTeamDisplayName(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined) {
  if (!team) return null;
  if (team.is_relocated && team.display_city && team.display_nick) {
    return `${team.display_city} ${team.display_nick}`;
  }
  return team.name ?? team.display_nick ?? null;
}
