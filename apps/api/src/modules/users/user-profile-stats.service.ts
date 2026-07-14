import { supabase } from "../../lib/supabase.js";

export type ProfileBoxScoreStats = {
  gamesLogged: number;
  boxScoresUploaded: number;
  totalYards: number;
  totalYardsAvg: number;
  offensiveYards: number;
  offensiveYardsAvg: number;
  passingYards: number;
  passingYardsAvg: number;
  rushingYards: number;
  rushingYardsAvg: number;
  firstDowns: number;
  firstDownsAvg: number;
  fourthDownConversions: number;
  fourthDownConversionsAvg: number;
  twoPointConversions: number;
  twoPointConversionsAvg: number;
  returnYards: number;
  returnYardsAvg: number;
  pointsFor: number;
  pointsForAvg: number;
  pointsAgainst: number;
  pointsAgainstAvg: number;
  yardsAllowed: number;
  yardsAllowedAvg: number;
  firstDownsAllowed: number;
  firstDownsAllowedAvg: number;
  turnoversGenerated: number;
  turnoversGeneratedAvg: number;
  turnoversCommitted: number;
  turnoversCommittedAvg: number;
  turnoverDifferential: number;
  turnoverDifferentialAvg: number;
  closeGames: number;
  closeGameRate: number;
  highScoringGames: number;
  highScoringRate: number;
  lowScoringAllowedGames: number;
  lowScoringAllowedRate: number;
  wins: number;
  losses: number;
  ties: number;
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

function jsonNum(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object") return 0;
  return num((raw as Record<string, unknown>)[key]);
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
  let offensiveYards = 0;
  let passingYards = 0;
  let rushingYards = 0;
  let firstDowns = 0;
  let fourthDownConversions = 0;
  let twoPointConversions = 0;
  let returnYards = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let yardsAllowed = 0;
  let firstDownsAllowed = 0;
  let turnoversGenerated = 0;
  let turnoversCommitted = 0;
  let closeGames = 0;
  let highScoringGames = 0;
  let lowScoringAllowedGames = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let redZoneOffSum = 0;
  let redZoneOffGames = 0;
  let redZoneDefSum = 0;
  let redZoneDefGames = 0;

  for (const row of rows) {
    totalYards += num(row.total_yards_gained);
    offensiveYards += num(row.off_yards_gained);
    passingYards += num(row.off_pass_yards);
    rushingYards += num(row.off_rush_yards);
    firstDowns += num(row.off_first_down);
    fourthDownConversions += jsonNum(row.offensive_stats, "fourth_down_conversions");
    twoPointConversions += jsonNum(row.offensive_stats, "two_point_conversions");
    returnYards += num(row.punt_return_yards) + num(row.kick_return_yards);
    pointsFor += num(row.points_for);
    pointsAgainst += num(row.points_against);
    yardsAllowed += num(row.yards_allowed);
    firstDownsAllowed += num(row.first_downs_allowed);
    turnoversGenerated += num(row.generated_turnovers);
    turnoversCommitted += num(row.turnovers_committed);
    const margin = Math.abs(num(row.points_for) - num(row.points_against));
    if (margin <= 7) closeGames += 1;
    if (num(row.points_for) >= 35 || num(row.points_for) + num(row.points_against) >= 70) highScoringGames += 1;
    if (num(row.points_against) <= 17) lowScoringAllowedGames += 1;
    if (row.result === "win") wins += 1;
    else if (row.result === "loss") losses += 1;
    else if (row.result === "tie") ties += 1;
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
    offensiveYards,
    offensiveYardsAvg: perGameAvg(offensiveYards, gamesLogged),
    passingYards,
    passingYardsAvg: perGameAvg(passingYards, gamesLogged),
    rushingYards,
    rushingYardsAvg: perGameAvg(rushingYards, gamesLogged),
    firstDowns,
    firstDownsAvg: perGameAvg(firstDowns, gamesLogged),
    fourthDownConversions,
    fourthDownConversionsAvg: perGameAvg(fourthDownConversions, gamesLogged),
    twoPointConversions,
    twoPointConversionsAvg: perGameAvg(twoPointConversions, gamesLogged),
    returnYards,
    returnYardsAvg: perGameAvg(returnYards, gamesLogged),
    pointsFor,
    pointsForAvg: perGameAvg(pointsFor, gamesLogged),
    pointsAgainst,
    pointsAgainstAvg: perGameAvg(pointsAgainst, gamesLogged),
    yardsAllowed,
    yardsAllowedAvg: perGameAvg(yardsAllowed, gamesLogged),
    firstDownsAllowed,
    firstDownsAllowedAvg: perGameAvg(firstDownsAllowed, gamesLogged),
    turnoversGenerated,
    turnoversGeneratedAvg: perGameAvg(turnoversGenerated, gamesLogged),
    turnoversCommitted,
    turnoversCommittedAvg: perGameAvg(turnoversCommitted, gamesLogged),
    turnoverDifferential,
    turnoverDifferentialAvg: perGameAvg(turnoverDifferential, gamesLogged),
    closeGames,
    closeGameRate: perGameAvg(closeGames * 100, gamesLogged),
    highScoringGames,
    highScoringRate: perGameAvg(highScoringGames * 100, gamesLogged),
    lowScoringAllowedGames,
    lowScoringAllowedRate: perGameAvg(lowScoringAllowedGames * 100, gamesLogged),
    wins,
    losses,
    ties,
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
  game_id?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_user_id?: string | null;
  away_user_id?: string | null;
}) {
  // Only stats from a PRIOR submission for the SAME game are superseded by this
  // approval — never other teams' games in the same week. Scope by game_id when
  // matched, otherwise by this submission's two team ids.
  let query = supabase
    .from("rec_team_game_stats")
    .delete()
    .eq("league_id", sub.league_id)
    .eq("season_number", sub.season_number)
    .eq("week_number", sub.week_number)
    .neq("submission_id", sub.id);

  if (sub.game_id) {
    query = query.eq("game_id", sub.game_id);
  } else {
    const teamIds = [sub.home_team_id, sub.away_team_id].filter(Boolean) as string[];
    if (!teamIds.length) return []; // nothing to scope to — never delete league-wide
    query = query.in("team_id", teamIds);
  }

  const { error } = await query;
  if (error) throw error;
  return [];
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

/**
 * School/university name only — never the mascot. Derived by stripping the known
 * mascot (display_nick, populated for every CFB team at seed time, not just relocated
 * ones — see team-ownership.service.ts) off the end of the full display name, rather
 * than guessing a word boundary. Returns null when there's no reliable distinct value
 * (Madden teams, or any team missing display_nick) — callers should fall back to
 * hiding the school line rather than showing a duplicate of the team name.
 */
export function resolveTeamSchool(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined): string | null {
  if (!team) return null;
  if (team.is_relocated && team.display_city && team.display_city.trim() && team.display_city.trim() !== team.name?.trim()) {
    return team.display_city.trim();
  }
  const name = team.name?.trim();
  const nick = team.display_nick?.trim();
  if (name && nick && name.length > nick.length && name.toLowerCase().endsWith(nick.toLowerCase())) {
    return name.slice(0, name.length - nick.length).trim();
  }
  return null;
}

/** Schedule/nickname label: team nick only — never the city. */
export function resolveTeamNick(team: {
  name?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined) {
  if (!team) return "CPU";
  if (team.is_relocated && team.display_nick?.trim()) {
    return team.display_nick.trim();
  }
  const name = String(team.name ?? team.display_nick ?? "CPU").trim();
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1]! : name;
}
