import { supabase } from "../../lib/supabase.js";
import { getTeamByAbbreviation } from "@rec/shared";

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

function computeStreak(rows: Array<{ result: "win" | "loss" | "tie"; sortKey: number }>): string {
  const sorted = [...rows].sort((a, b) => a.sortKey - b.sortKey);
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

// rec_team_game_stats only gets a row when a box score is approved OR a manual entry
// includes per-team stat fields — a plain manual score entry (result only, no stats
// typed in) writes no row there at all, silently dropping that game from the old
// stats-based streak while rec_game_results (used for the W/L record right next to it)
// always gets one. Source the streak from rec_game_results instead so it can't skip games.
async function loadActiveStreak(userId: string, leagueId?: string | null, seasonNumber?: number | null): Promise<string> {
  let query = supabase
    .from("rec_game_results")
    .select("season_number,week_number,is_tie,winning_user_id,home_user_id,away_user_id")
    .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`);
  if (leagueId) query = query.eq("league_id", leagueId);
  if (seasonNumber != null) query = query.eq("season_number", seasonNumber);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((row) => ({
    result: (row.is_tie ? "tie" : row.winning_user_id === userId ? "win" : "loss") as "win" | "loss" | "tie",
    sortKey: Number(row.season_number ?? 0) * 1000 + Number(row.week_number ?? 0),
  }));
  return computeStreak(rows);
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
    // Placeholder — loadSeasonBoxScoreStats/loadCareerBoxScoreStats override this with
    // loadActiveStreak's rec_game_results-sourced value, which can't skip a game the way
    // this stats-rows-only view can (see loadActiveStreak's comment above).
    activeStreak: "—",
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
  const stats = aggregateBoxScoreStats(data ?? []);
  stats.activeStreak = await loadActiveStreak(userId, leagueId, seasonNumber);
  return stats;
}

export async function loadCareerBoxScoreStats(userId: string, leagueId?: string | null) {
  let query = supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("user_id", userId)
    .order("season_number", { ascending: true })
    .order("week_number", { ascending: true });
  if (leagueId) query = query.eq("league_id", leagueId);

  const { data, error } = await query;

  if (error) throw error;
  const stats = aggregateBoxScoreStats(data ?? []);
  stats.activeStreak = await loadActiveStreak(userId, leagueId ?? null, null);
  return stats;
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

export type LedgerEntry = {
  id: string;
  amount: number;
  transactionType: string | null;
  description: string | null;
  createdAt: string;
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

export type Last30DaysLedger = {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  transactions: LedgerEntry[];
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

/** Last-30-days transaction ledger + income/expense/net cash flow, scoped to one league. */
async function loadLast30DaysLedger(userId: string, leagueId: string): Promise<Last30DaysLedger> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,created_at")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;

  let totalIncome = 0;
  let totalExpenses = 0;
  const transactions: LedgerEntry[] = (data ?? []).map((row: any) => {
    const amount = num(row.amount);
    if (amount > 0) totalIncome += amount;
    else totalExpenses += Math.abs(amount);
    return { id: row.id, amount, transactionType: row.transaction_type ?? null, description: row.description ?? null, createdAt: row.created_at };
  });

  return { totalIncome, totalExpenses, netCashFlow: totalIncome - totalExpenses, transactions };
}

export async function loadUserFinancialSummary(userId: string, leagueId: string | null) {
  const [globalLedgerResult, leagueLedgerResult, globalPurchaseResult, leaguePurchaseResult, leagueWeeks, globalWeeks, last30Days, wagerResult] = await Promise.all([
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
    leagueId ? loadLast30DaysLedger(userId, leagueId) : Promise.resolve(null),
    leagueId
      ? supabase.from("rec_wagers").select("wager_kind,stake,potential_payout,status,placed_by_user_id,accepted_by_user_id").eq("league_id", leagueId).or(`placed_by_user_id.eq.${userId},accepted_by_user_id.eq.${userId}`)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (globalLedgerResult.error) throw globalLedgerResult.error;
  if (leagueLedgerResult.error) throw leagueLedgerResult.error;
  if (globalPurchaseResult.error) throw globalPurchaseResult.error;
  if (leaguePurchaseResult.error) throw leaguePurchaseResult.error;
  if (wagerResult.error) throw wagerResult.error;

  const league: FinancialSummaryScope = {
    ...summarizeLedgerRows(leagueLedgerResult.data, leagueWeeks),
    purchases: summarizePurchaseRows(leaguePurchaseResult.data),
  };
  const global: FinancialSummaryScope = {
    ...summarizeLedgerRows(globalLedgerResult.data, globalWeeks),
    purchases: summarizePurchaseRows(globalPurchaseResult.data),
  };

  const settledWagers = (wagerResult.data ?? []).filter((row: any) => ["won", "lost"].includes(row.status));
  const wagering = settledWagers.reduce((acc, row: any) => {
    const stake = Number(row.stake ?? 0);
    const placer = row.placed_by_user_id === userId;
    const won = placer ? row.status === "won" : row.status === "lost";
    const gross = won ? (row.wager_kind === "peer" ? stake * 2 : Number(row.potential_payout ?? 0)) : 0;
    acc.lifetimeWagered += stake;
    acc.grossWon += gross;
    acc.lostStakes += won ? 0 : stake;
    acc.wins += won ? 1 : 0;
    acc.losses += won ? 0 : 1;
    acc.largestStake = Math.max(acc.largestStake, stake);
    acc.largestWin = Math.max(acc.largestWin, gross);
    if (row.wager_kind === "peer") acc.peerWagers += 1; else acc.houseWagers += 1;
    return acc;
  }, { lifetimeWagered: 0, grossWon: 0, lostStakes: 0, wins: 0, losses: 0, largestStake: 0, largestWin: 0, peerWagers: 0, houseWagers: 0 });
  const wagerCount = wagering.wins + wagering.losses;
  return { league, global, last30Days, wagering: { ...wagering, net: wagering.grossWon - wagering.lifetimeWagered, wagerCount, winPercentage: wagerCount ? wagering.wins / wagerCount * 100 : 0, averageStake: wagerCount ? wagering.lifetimeWagered / wagerCount : 0 } };
}

export function formatTeamDisplayName(team: {
  name?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined) {
  if (!team) return null;
  const name = team.name?.trim();
  const nick = team.display_nick?.trim();
  if (team.is_relocated) {
    // Relocated teams store the school/full identity in `name` (CFB: "Hard Knox";
    // Madden: "Las Vegas Raiders"). Prefer it whenever it differs from the mascot so
    // custom teams read like their catalog counterparts. Legacy rows with the mascot
    // in `name` fall back to the "City Nick" combo.
    if (name && (!nick || name.toLowerCase() !== nick.toLowerCase())) return name;
    const combined = `${team.display_city?.trim() ?? ""} ${nick ?? ""}`.trim();
    if (combined) return combined;
  }
  return name || nick || null;
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
  abbreviation?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined): string | null {
  if (!team) return null;
  if (team.display_city && team.display_city.trim() && team.display_city.trim() !== team.display_nick?.trim()) {
    return team.display_city.trim();
  }
  const name = team.name?.trim();
  const nick = team.display_nick?.trim();
  if (name && nick && name.length > nick.length && name.toLowerCase().endsWith(nick.toLowerCase())) {
    return name.slice(0, name.length - nick.length).trim();
  }
  // Standard (non-relocated) Madden teams are seeded with just the mascot in `name`
  // ("Falcons") and no display_city/display_nick at all — nothing above can derive a
  // city for them. Fall back to the static NFL catalog by abbreviation ("ATL" ->
  // "Atlanta Falcons") and strip the known mascot off the end.
  if (!team.is_relocated && team.abbreviation && name) {
    const catalogName = getTeamByAbbreviation(team.abbreviation.toUpperCase())?.name?.trim();
    if (catalogName && catalogName.length > name.length && catalogName.toLowerCase().endsWith(name.toLowerCase())) {
      return catalogName.slice(0, catalogName.length - name.length).trim();
    }
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
  if (team.display_nick?.trim()) {
    return team.display_nick.trim();
  }
  const name = String(team.name ?? "CPU").trim();
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1]! : name;
}

/** Hero / profile primary team label — mascot/nick (Yellow Jackets, Saints). */
export function resolveTeamProgramName(team: {
  name?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
} | null | undefined) {
  return resolveTeamNick(team);
}

const NFL_CITY_STATE: Record<string, string> = {
  Arizona: "AZ",
  Atlanta: "GA",
  Baltimore: "MD",
  Buffalo: "NY",
  Carolina: "NC",
  Chicago: "IL",
  Cincinnati: "OH",
  Cleveland: "OH",
  Dallas: "TX",
  Denver: "CO",
  Detroit: "MI",
  "Green Bay": "WI",
  Houston: "TX",
  Indianapolis: "IN",
  Jacksonville: "FL",
  "Kansas City": "MO",
  "Las Vegas": "NV",
  "Los Angeles": "CA",
  Miami: "FL",
  Minnesota: "MN",
  "New England": "MA",
  "New Orleans": "LA",
  "New York": "NY",
  Philadelphia: "PA",
  Pittsburgh: "PA",
  "San Francisco": "CA",
  Seattle: "WA",
  "Tampa Bay": "FL",
  Tennessee: "TN",
  Washington: "DC",
};

function cityFromTeamName(team: { name?: string | null; display_nick?: string | null }) {
  const name = team.name?.trim();
  if (!name) return null;
  const nick = resolveTeamNick(team);
  if (name.length > nick.length && name.toLowerCase().endsWith(nick.toLowerCase())) {
    return name.slice(0, name.length - nick.length).trim() || null;
  }
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
}

/**
 * Secondary hero line under the team nick:
 * - CFB: school/city only (Hard Knox) — never prefixed with "School:"
 * - Madden: "New Orleans, LA" (no school concept)
 */
export function resolveTeamSubtitle(
  team: {
    name?: string | null;
    display_city?: string | null;
    display_nick?: string | null;
    is_relocated?: boolean | null;
  } | null | undefined,
  game: string | null | undefined,
): string | null {
  if (!team) return null;
  const isCfb = String(game ?? "").startsWith("cfb");
  if (isCfb) {
    return resolveTeamSchool(team) ?? (team.display_city?.trim() || null);
  }
  const city = team.display_city?.trim() || cityFromTeamName(team);
  if (!city) return null;
  const state = NFL_CITY_STATE[city];
  return state ? `${city}, ${state}` : city;
}
