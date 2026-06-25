import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { OFFICIAL_RESULT_SOURCES } from "../official-records/official-records.service.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES, type BadgeDef } from "../box-score-intelligence/badge-rules.js";
import {
  formatTeamDisplayName,
  loadCareerBoxScoreStats,
  loadSeasonBoxScoreStats,
  loadUserFinancialSummary,
  resolveTeamNick,
} from "./user-profile-stats.service.js";

const BADGE_LABELS = new Map<string, string>(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((badge: BadgeDef<any>) => [badge.key, badge.label]),
);

function mapOwnedBadge(row: any) {
  const badgeKey = row.badge_key ?? row.badge_name ?? "badge";
  return {
    ...row,
    badge_name: badgeKey,
    badge_label: BADGE_LABELS.get(badgeKey) ?? badgeKey,
    earned_value: row.earned_count ?? row.current_streak ?? 1,
    earned_at: row.updated_at ?? row.created_at ?? null,
    league_id: row.league_id ?? null,
    season_number: row.season ?? null,
  };
}

export async function getUserBaselineByDiscordId(discordId: string) {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id, discord_id, username, global_name")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (account.error) throw new ApiError(500, "Failed to load Discord account", account.error);
  if (!account.data) throw new ApiError(404, "Discord account not found in REC Core");

  const [user, globalRecord, wallet, legacyBaseline] = await Promise.all([
    supabase.from("rec_users").select("*").eq("id", account.data.user_id).single(),
    supabase.from("rec_global_user_records").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_wallets").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_legacy_user_baselines").select("*").eq("user_id", account.data.user_id).maybeSingle()
  ]);

  if (user.error) throw new ApiError(500, "Failed to load REC user", user.error);
  if (globalRecord.error) throw new ApiError(500, "Failed to load global record", globalRecord.error);
  if (wallet.error) throw new ApiError(500, "Failed to load wallet", wallet.error);
  if (legacyBaseline.error) throw new ApiError(500, "Failed to load legacy baseline", legacyBaseline.error);

  return {
    user: user.data,
    discord: account.data,
    globalRecord: globalRecord.data,
    wallet: wallet.data,
    legacyBaseline: legacyBaseline.data
  };
}

export async function getWalletByDiscordId(discordId: string, guildId?: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);

  let leagueId: string | null = null;
  if (guildId) {
    const context = await findCurrentLeagueContext(guildId);
    leagueId = context?.leagueId ?? null;
  }

  // When scoped to a guild, show only 10 transactions for that league.
  // Without a guild context, show 25 across all leagues.
  const limit = guildId ? 10 : 25;
  const transactions = await getRecentTransactionsByUserId(baseline.user.id, limit, leagueId ?? undefined);

  return {
    user: baseline.user,
    discord: baseline.discord,
    wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 },
    transactions,
    leagueId
  };
}

// Transfer funds between a user's wallet and savings.
// direction "to_savings": moves money from wallet → savings.
// direction "from_savings": moves money from savings → wallet.
export async function transferSavings(discordId: string, amount: number, direction: "to_savings" | "from_savings") {
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "Amount must be a positive number.");

  const baseline = await getUserBaselineByDiscordId(discordId);
  const walletRow = baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const wallet = Number(walletRow.wallet_balance ?? 0);
  const savings = Number(walletRow.savings_balance ?? 0);

  if (direction === "to_savings") {
    if (wallet < amount) throw new ApiError(400, `Insufficient wallet balance. You have $${wallet}.`);
    const { error } = await supabase
      .from("rec_wallets")
      .upsert({ user_id: baseline.user.id, wallet_balance: wallet - amount, savings_balance: savings + amount, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new ApiError(500, "Transfer failed", error);
  } else {
    if (savings < amount) throw new ApiError(400, `Insufficient savings balance. You have $${savings}.`);
    const { error } = await supabase
      .from("rec_wallets")
      .upsert({ user_id: baseline.user.id, wallet_balance: wallet + amount, savings_balance: savings - amount, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new ApiError(500, "Transfer failed", error);
  }

  const updated = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", baseline.user.id).single();
  return {
    transferred: amount,
    direction,
    wallet_balance: updated.data?.wallet_balance ?? 0,
    savings_balance: updated.data?.savings_balance ?? 0
  };
}

export async function getRecentTransactionsByUserId(userId: string, limit = 25, leagueId?: string) {
  let query = supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,source,source_reference,created_at,league_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (leagueId) query = query.eq("league_id", leagueId);

  const ledger = await query;
  if (ledger.error) {
    throw new ApiError(500, "Failed to load wallet transactions", ledger.error);
  }

  return ledger.data ?? [];
}

// Returns all data needed for the User Snapshots paginated viewer in /menu > Rosters.
// Aggregates season records, global records, badges, power ranking, SOS, GOTW records,
// GOTW competition history, and awards won in the given guild.
export async function getUserSnapshot(targetDiscordId: string, guildId: string) {
  const baseline = await getUserBaselineByDiscordId(targetDiscordId);
  const userId = baseline.user.id;

  const context = await findCurrentLeagueContext(guildId);
  const leagueId = context?.leagueId ?? null;

  const assignmentResult = leagueId
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,rec_teams(name,abbreviation,display_city,display_nick,is_relocated)")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .maybeSingle()
    : { data: null };
  const teamId = (assignmentResult.data as any)?.team_id ?? null;
  const teamRow = (assignmentResult.data as any)?.rec_teams ?? null;

  const leagueInfoResult = leagueId
    ? await supabase.from("rec_leagues").select("name,game,season_number,display_season_number,current_week,season_stage").eq("id", leagueId).maybeSingle()
    : { data: null };
  const leagueInfo = leagueInfoResult.data;
  const seasonNumber = leagueInfo?.season_number ?? leagueInfo?.display_season_number ?? 1;
  const leagueGame = String(leagueInfo?.game ?? "madden_26");

  const [
    seasonRecord,
    seasonBadges,
    globalBadges,
    gotwGuessRecord,
    powerRankingRow,
    gotwCompetition,
    globalAwardWinners,
    eosPollWins,
    seasonStats,
    careerStats,
    financialSummary,
    globalRecordRow,
    gameGlobalRecordRow,
  ] = await Promise.all([
    leagueId
      ? supabase
          .from("rec_season_user_records")
          .select("wins,losses,ties,games_played,point_differential,points_for,points_against")
          .eq("league_id", leagueId)
          .eq("season_number", seasonNumber)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    leagueId
      ? supabase
          .from("rec_badge_ownership")
          .select("badge_key,badge_scope,tier,earned_count,current_streak,best_streak,last_earned_week,created_at,updated_at,league_id,season,week")
          .eq("league_id", leagueId)
          .eq("season", seasonNumber)
          .eq("user_id", userId)
          .in("badge_scope", ["weekly", "season"])
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    leagueId
      ? supabase
        .from("rec_badge_ownership")
        .select("badge_key,badge_scope,tier,earned_count,current_streak,best_streak,last_earned_week,created_at,updated_at,league_id,season,week")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .eq("badge_scope", "global")
        .is("season", null)
        .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("rec_global_gotw_guessing_records").select("correct_guesses,wrong_guesses").eq("user_id", userId).maybeSingle(),
    leagueId && teamId
      ? supabase
          .from("rec_power_rankings")
          .select("rank,score,sos_score")
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("season_number", seasonNumber)
          .order("week_number", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    leagueId
      ? supabase
          .from("rec_game_of_week_polls")
          .select("home_team_id,away_team_id,winning_team_id,status,week_number")
          .eq("league_id", leagueId)
          .not("status", "eq", "open")
          .order("week_number", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    supabase
      .from("rec_award_winners")
      .select("award_key,award_name,season_number,league_id")
      .eq("winner_user_id", userId)
      .order("season_number", { ascending: false }),
    supabase
      .from("rec_eos_award_polls")
      .select("category_key,category_label,season_number,league_id")
      .eq("winner_user_id", userId)
      .not("winner_user_id", "is", null),
    leagueId ? loadSeasonBoxScoreStats(userId, leagueId, seasonNumber) : Promise.resolve(null),
    loadCareerBoxScoreStats(userId),
    loadUserFinancialSummary(userId, leagueId),
    supabase.from("rec_global_user_records").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("rec_global_user_game_records").select("*").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
  ]);

  const teamName = formatTeamDisplayName(teamRow);
  const globalRecord = (globalRecordRow as any)?.data ?? baseline.globalRecord ?? {};
  const gameGlobalRecord = buildGameRecordForDisplay(
    (gameGlobalRecordRow as any)?.data ?? null,
    leagueGame,
    baseline.legacyBaseline?.global_record as Record<string, unknown> | null | undefined,
  );

  let gotwWins = 0;
  let gotwLosses = 0;
  const gotwPolls = (gotwCompetition as any)?.data ?? [];
  for (const poll of gotwPolls) {
    if (!teamId) break;
    const isParticipant = String(poll.home_team_id) === String(teamId) || String(poll.away_team_id) === String(teamId);
    if (!isParticipant || poll.status !== "settled" || !poll.winning_team_id) continue;
    if (String(poll.winning_team_id) === String(teamId)) gotwWins += 1;
    else gotwLosses += 1;
  }

  const seasonRecordData = (seasonRecord as any)?.data ?? {};
  const gotwGuess = (gotwGuessRecord as any)?.data;
  const gotwCorrect = gotwGuess?.correct_guesses ?? 0;
  const gotwWrong = gotwGuess?.wrong_guesses ?? 0;
  const gotwTotal = gotwCorrect + gotwWrong;
  const rankRow = (powerRankingRow as any)?.data;

  const globalAwardCounts = new Map<string, number>();
  for (const award of (globalAwardWinners as any)?.data ?? []) {
    const label = award.award_name ?? award.award_key ?? "Award";
    globalAwardCounts.set(label, (globalAwardCounts.get(label) ?? 0) + 1);
  }
  for (const poll of (eosPollWins as any)?.data ?? []) {
    const label = poll.category_label ?? poll.category_key ?? "EOS Poll";
    globalAwardCounts.set(label, (globalAwardCounts.get(label) ?? 0) + 1);
  }

  return {
    user: baseline.user,
    discord: baseline.discord,
    teamName,
    leagueName: leagueInfo?.name ?? null,
    seasonNumber,
    currentWeek: leagueInfo?.current_week ?? null,
    seasonStage: leagueInfo?.season_stage ?? null,
    seasonRecord: {
      wins: seasonRecordData.wins ?? 0,
      losses: seasonRecordData.losses ?? 0,
      ties: seasonRecordData.ties ?? 0,
      pointDifferential: seasonRecordData.point_differential ?? 0,
      pointsFor: seasonRecordData.points_for ?? 0,
      pointsAgainst: seasonRecordData.points_against ?? 0,
      text: recordText(seasonRecordData),
      boxScoresUploaded: seasonStats?.boxScoresUploaded ?? 0,
      activeStreak: seasonStats?.activeStreak ?? "—",
    },
    globalRecord: {
      wins: globalRecord.wins ?? 0,
      losses: globalRecord.losses ?? 0,
      ties: globalRecord.ties ?? 0,
      pointDifferential: globalRecord.point_differential ?? 0,
      playoffWins: globalRecord.playoff_wins ?? 0,
      playoffLosses: globalRecord.playoff_losses ?? 0,
      superbowlWins: globalRecord.superbowl_wins ?? 0,
      superbowlLosses: globalRecord.superbowl_losses ?? 0,
      text: recordText(globalRecord),
      playoffText: playoffText(globalRecord),
      superbowlText: superbowlText(globalRecord),
      activeStreak: careerStats?.activeStreak ?? "—",
    },
    gameGlobalRecord: leagueId ? buildGameGlobalRecordDisplay(gameGlobalRecord, leagueGame) : null,
    powerRank: rankRow ? { rank: rankRow.rank, score: rankRow.score, sosScore: rankRow.sos_score } : null,
    gotwGuessing: gotwTotal > 0 ? { correct: gotwCorrect, total: gotwTotal, accuracy: Math.round((gotwCorrect / gotwTotal) * 100) } : null,
    gotwCompetition: gotwWins + gotwLosses > 0 ? { wins: gotwWins, losses: gotwLosses } : null,
    seasonStats,
    careerStats,
    seasonBadges: ((seasonBadges as any)?.data ?? []).map(mapOwnedBadge),
    globalBadges: ((globalBadges as any)?.data ?? []).map(mapOwnedBadge),
    globalAwards: [...globalAwardCounts.entries()].map(([awardName, count]) => ({ awardName, count })).sort((a, b) => a.awardName.localeCompare(b.awardName)),
    financialSummary,
  };
}

function schedulePhaseOrder(phase?: string | null) {
  const normalized = String(phase ?? "regular_season");
  const order: Record<string, number> = {
    regular_season: 0,
    wild_card: 1,
    divisional: 2,
    conference_championship: 3,
    super_bowl: 4
  };
  return order[normalized] ?? 9;
}

function teamName(row: any, side: "home" | "away") {
  const team = side === "home" ? row.home_team : row.away_team;
  return team?.name ?? team?.abbreviation ?? (side === "home" ? "Home" : "Away");
}

function matchupKey(row: any) {
  return `match:${row.season_number ?? ""}:${row.week_number ?? ""}:${row.home_team_id ?? ""}:${row.away_team_id ?? ""}`;
}

export async function getUserScheduleByDiscordId(discordId: string, guildId: string) {
  const context = await findCurrentLeagueContext(guildId);
  const league: any = context?.rec_leagues ?? null;
  if (!context?.leagueId || !league?.id) {
    return { isLinked: false, hasLoggedSchedule: false, league: null, team: null, games: [] };
  }

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,username,global_name")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account", account.error);
  if (!account.data?.user_id) {
    return { isLinked: false, hasLoggedSchedule: false, league, team: null, games: [] };
  }

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id,team:rec_teams(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load linked team", assignment.error);
  const teamId = (assignment.data as any)?.team_id;
  if (!teamId) {
    return { isLinked: false, hasLoggedSchedule: false, league, team: null, games: [] };
  }

  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const seasonId = await resolveSeasonId(league.id, seasonNumber);
  const { data: scheduledGames, error: gamesError } = await supabase
    .from("rec_games")
    .select("id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("season_id", seasonId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .lte("week_number", 18);
  if (gamesError) throw new ApiError(500, "Failed to load schedule", gamesError);

  const hasLoggedSchedule = (scheduledGames ?? []).length > 0;

  const { data: gameResults, error: resultsError } = await supabase
    .from("rec_game_results")
    .select("week_number,season_number,home_team_id,away_team_id,home_score,away_score,winning_user_id")
    .eq("league_id", league.id)
    .eq("season_number", seasonNumber)
    .lte("week_number", 18)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  if (resultsError) throw new ApiError(500, "Failed to load schedule results", resultsError);
  const resultsByMatchup = new Map(
    (gameResults ?? []).map((result: any) => [
      matchupKey({
        season_number: result.season_number,
        week_number: result.week_number,
        home_team_id: result.home_team_id,
        away_team_id: result.away_team_id,
      }),
      result,
    ]),
  );

  const scheduledTeamIds = [...new Set((scheduledGames ?? []).flatMap((game: any) => [game.home_team_id, game.away_team_id]).filter(Boolean))];
  const teamAssignments = scheduledTeamIds.length
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,user_id")
        .eq("league_id", league.id)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .in("team_id", scheduledTeamIds)
    : { data: [], error: null };
  if (teamAssignments.error) throw new ApiError(500, "Failed to load team assignments for schedule", teamAssignments.error);
  const userByTeamId = new Map((teamAssignments.data ?? []).map((row) => [row.team_id, row.user_id]));

  const opponentUserIds = [...new Set((scheduledGames ?? []).flatMap((game: any) => {
    const isHome = game.home_team_id === teamId;
    const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
    const opponentUserId = (isHome ? game.away_user_id : game.home_user_id) ?? userByTeamId.get(opponentTeamId);
    return opponentUserId ? [opponentUserId] : [];
  }))];
  // Include linked users for every scheduled team so H2H mentions resolve even when rec_games user ids are stale.
  for (const userId of userByTeamId.values()) {
    if (userId) opponentUserIds.push(userId);
  }
  const uniqueUserIds = [...new Set(opponentUserIds)];
  const opponentAccounts = uniqueUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", uniqueUserIds)
    : { data: [], error: null };
  if (opponentAccounts.error) throw new ApiError(500, "Failed to load opponent Discord accounts", opponentAccounts.error);
  const discordByUserId = new Map((opponentAccounts.data ?? []).map((row) => [row.user_id, row.discord_id]));

  const gamesByWeek = new Map<number, any>();
  for (const game of scheduledGames ?? []) {
    const weekNumber = Number(game.week_number ?? 0);
    if (weekNumber >= 1 && weekNumber <= 18) gamesByWeek.set(weekNumber, game);
  }

  function resolveGameUserId(game: any, side: "home" | "away") {
    const teamKey = side === "home" ? "home_team_id" : "away_team_id";
    const userKey = side === "home" ? "home_user_id" : "away_user_id";
    return game[userKey] ?? userByTeamId.get(game[teamKey]) ?? null;
  }

  function opponentLabel(game: any, isHome: boolean) {
    const opponentTeam = isHome ? game.away_team : game.home_team;
    const opponentUserId = isHome
      ? resolveGameUserId(game, "away")
      : resolveGameUserId(game, "home");
    if (opponentUserId) {
      const discordId = discordByUserId.get(opponentUserId);
      if (discordId) return `<@${discordId}>`;
    }
    return resolveTeamNick(opponentTeam);
  }

  // A team's display label: the linked user's @mention (renders as their nickname,
  // and doesn't ping inside an embed) for a user team, otherwise the team name.
  function sideLabel(game: any, side: "home" | "away") {
    const userId = resolveGameUserId(game, side);
    if (userId) {
      const discordId = discordByUserId.get(userId);
      if (discordId) return `<@${discordId}>`;
    }
    return resolveTeamNick(side === "home" ? game.home_team : game.away_team);
  }

  const games = [];
  for (let week = 1; week <= 18; week += 1) {
    const game = gamesByWeek.get(week);
    if (!game) {
      games.push({
        weekNumber: week,
        phase: "regular_season",
        isBye: true,
      });
      continue;
    }

    const isHome = game.home_team_id === teamId;
    const displayLabel = opponentLabel(game, isHome);
    const homeUserId = resolveGameUserId(game, "home");
    const awayUserId = resolveGameUserId(game, "away");
    const result = resultsByMatchup.get(matchupKey({
      season_number: seasonNumber,
      week_number: game.week_number,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
    }));
    games.push({
      weekNumber: week,
      phase: game.phase ?? "regular_season",
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamName: formatTeamDisplayName(game.home_team) ?? teamName(game, "home"),
      awayTeamName: formatTeamDisplayName(game.away_team) ?? teamName(game, "away"),
      homeLabel: sideLabel(game, "home"),
      awayLabel: sideLabel(game, "away"),
      homeScore: result?.home_score ?? null,
      awayScore: result?.away_score ?? null,
      isCompleted: result?.home_score != null && result?.away_score != null,
      isHome,
      isH2h: Boolean(homeUserId && awayUserId),
      opponentLabel: displayLabel,
    });
  }

  const teamRow = (assignment.data as any)?.team ?? null;
  return {
    isLinked: true,
    hasLoggedSchedule,
    league: {
      ...league,
      currentWeek: league.current_week ?? null,
      seasonStage: league.season_stage ?? league.current_phase ?? null,
    },
    team: teamRow ? { ...teamRow, name: formatTeamDisplayName(teamRow) ?? teamRow.name } : null,
    games,
  };
}

function recordText(record: any) {
  return `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`;
}

export function formatLeagueGameLabel(game?: string | null) {
  switch (String(game ?? "madden_26")) {
    case "madden_27": return "Madden NFL 27";
    case "cfb_27": return "College Football 27";
    default: return "Madden NFL 26";
  }
}

function recordTotalGames(record: Record<string, unknown> | null | undefined) {
  return Number(record?.games_played ?? record?.gamesPlayed ?? 0)
    || Number(record?.wins ?? 0) + Number(record?.losses ?? 0) + Number(record?.ties ?? 0);
}

function addRecordFields(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) {
  return {
    wins: Number(a?.wins ?? 0) + Number(b?.wins ?? 0),
    losses: Number(a?.losses ?? 0) + Number(b?.losses ?? 0),
    ties: Number(a?.ties ?? 0) + Number(b?.ties ?? 0),
    playoff_wins: Number(a?.playoff_wins ?? 0) + Number(b?.playoff_wins ?? 0),
    playoff_losses: Number(a?.playoff_losses ?? 0) + Number(b?.playoff_losses ?? 0),
    superbowl_wins: Number(a?.superbowl_wins ?? 0) + Number(b?.superbowl_wins ?? 0),
    superbowl_losses: Number(a?.superbowl_losses ?? 0) + Number(b?.superbowl_losses ?? 0),
    point_differential: Number(a?.point_differential ?? 0) + Number(b?.point_differential ?? 0),
    games_played: recordTotalGames(a) + recordTotalGames(b),
  };
}

function buildGameRecordForDisplay(
  gameRecord: Record<string, unknown> | null | undefined,
  leagueGame: string,
  legacyBaselineRecord: Record<string, unknown> | null | undefined,
) {
  if (leagueGame !== "madden_26") return gameRecord ?? null;
  const baselineGames = recordTotalGames(legacyBaselineRecord);
  if (baselineGames <= 0) return gameRecord ?? null;
  const gameGames = recordTotalGames(gameRecord);

  // Some existing madden_26 rows were created from box scores only. The legacy
  // all-games baseline is Madden 26 history until newer game families exist.
  if (!gameRecord || gameGames < baselineGames) return addRecordFields(legacyBaselineRecord, gameRecord);
  return gameRecord;
}

function buildGameGlobalRecordDisplay(row: Record<string, unknown> | null | undefined, leagueGame: string) {
  const record = row ?? {};
  return {
    game: leagueGame,
    label: formatLeagueGameLabel(leagueGame),
    wins: Number(record.wins ?? 0),
    losses: Number(record.losses ?? 0),
    ties: Number(record.ties ?? 0),
    pointDifferential: Number(record.point_differential ?? 0),
    playoffWins: Number(record.playoff_wins ?? 0),
    playoffLosses: Number(record.playoff_losses ?? 0),
    superbowlWins: Number(record.superbowl_wins ?? 0),
    superbowlLosses: Number(record.superbowl_losses ?? 0),
    text: recordText(record),
    playoffText: playoffText(record),
    superbowlText: superbowlText(record),
  };
}

function playoffText(record: any) {
  return `${record?.playoff_wins ?? 0}-${record?.playoff_losses ?? 0}`;
}

function superbowlText(record: any) {
  return `${record?.superbowl_wins ?? 0}-${record?.superbowl_losses ?? 0}`;
}

function stageDisplay(stage?: string | null) {
  return String(stage ?? "regular_season").replaceAll("_", " ");
}

async function loadUserBadges(userId: string, leagueId: string) {
  try {
    const result = await supabase
      .from("rec_badge_ownership")
      .select("badge_key,badge_scope,tier,earned_count,current_streak,best_streak,last_earned_week,created_at,updated_at,league_id,season,week")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (result.error) return [];
    return (result.data ?? []).map(mapOwnedBadge);
  } catch {
    // Some environments may not have the badge table yet. Do not break /menu.
    return [];
  }
}

// Current win/loss/tie streak for a user, derived from completed game results (most recent first).
function streakFromGames(games: any[], userId: string): string {
  const completed = games
    .filter((g) => (Number(g.home_score) || 0) > 0 || (Number(g.away_score) || 0) > 0)
    .sort((a, b) => (a.season_number - b.season_number) || (a.week_number - b.week_number));
  let streak = 0;
  let type: "W" | "L" | "T" | null = null;
  for (let i = completed.length - 1; i >= 0; i--) {
    const g = completed[i];
    const isHome = g.home_user_id === userId;
    const mine = Number(isHome ? g.home_score : g.away_score) || 0;
    const opp = Number(isHome ? g.away_score : g.home_score) || 0;
    const res: "W" | "L" | "T" = mine > opp ? "W" : mine < opp ? "L" : "T";
    if (type === null) { type = res; streak = 1; }
    else if (res === type) streak += 1;
    else break;
  }
  return type && streak > 0 ? `${type}${streak}` : "—";
}

// Projected savings interest on the next advance (matches advance-time SAVINGS_INTEREST_RATE of 3.5%, floored).
const SAVINGS_INTEREST_RATE = 0.035;

export async function getUserMenuProfileByDiscordId(discordId: string, guildId: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);
  const userId = baseline.user.id;

  const context = await findCurrentLeagueContext(guildId);
  const server: any = context?.rec_discord_servers ?? null;
  const league: any = context?.rec_leagues ?? null;

  let assignment: any = null;
  let membership: any = null;
  let seasonRecord: any = null;
  let displayRecord: any = null;
  let currentMatchup = "None";
  let currentGame: any = null;
  let gotwStatus = "No";
  let badges: any[] = [];
  let youAre = "BYE WEEK";
  let matchupType = "NONE";
  let opponentUserId: string | null = null;
  let opponentName: string | null = null;

  if (league?.id) {
    const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
    const currentWeek = league.current_week ?? 1;
    const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
    const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(stage);

    const [assignmentResult, membershipResult, seasonRecordResult, displayRecordResult] = await Promise.all([
      supabase
        .from("rec_team_assignments")
        .select("team_id,assignment_status,team:rec_teams(id,name,abbreviation)")
        .eq("league_id", league.id)
        .eq("user_id", userId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .maybeSingle(),
      supabase
        .from("rec_league_memberships")
        .select("role,status")
        .eq("league_id", league.id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("rec_season_user_records")
        .select("*")
        .eq("league_id", league.id)
        .eq("season_number", seasonNumber)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("rec_season_user_display_records")
        .select("wins,losses,ties,point_differential")
        .eq("league_id", league.id)
        .eq("season_number", seasonNumber)
        .eq("user_id", userId)
        .maybeSingle()
    ]);

    if (assignmentResult.error) throw new ApiError(500, "Failed to load linked team", assignmentResult.error);
    if (membershipResult.error) throw new ApiError(500, "Failed to load league role", membershipResult.error);
    if (seasonRecordResult.error) throw new ApiError(500, "Failed to load season record", seasonRecordResult.error);

    assignment = assignmentResult.data;
    membership = membershipResult.data;
    seasonRecord = seasonRecordResult.data;
    displayRecord = displayRecordResult.data ?? null;
    badges = await loadUserBadges(userId, league.id);

    if (assignment?.team_id) {
      const games = await supabase
        .from("rec_games")
        .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation), away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation)")
        .eq("league_id", league.id)
        .eq("week_number", currentWeek)
        .or(`home_team_id.eq.${assignment.team_id},away_team_id.eq.${assignment.team_id}`)
        .limit(1)
        .maybeSingle();

      if (!games.error && games.data) {
        const game: any = games.data;
        const isHome = game.home_team_id === assignment.team_id;
        const opponent = isHome ? game.away_team : game.home_team;
        const opponentUser = isHome ? game.away_user_id : game.home_user_id;

        currentGame = game;
        currentMatchup = `${opponent?.name ?? "Opponent"} (${opponentUser ? "User H2H" : "CPU"}, ${isHome ? "Home" : "Away"})`;
        youAre = isHome ? "Home" : "Away";
        matchupType = opponentUser ? "H2H" : "CPU";
        opponentUserId = opponentUser ?? null;
        opponentName = opponent?.name ?? null;

        const gotw = await supabase
          .from("rec_game_of_week_candidates")
          .select("id,is_selected,selection_source,strength_rating")
          .eq("league_id", league.id)
          .eq("season_number", seasonNumber)
          .eq("week_number", currentWeek)
          .eq("game_id", game.id)
          .eq("is_selected", true)
          .maybeSingle();

        if (!gotw.error && gotw.data) {
          gotwStatus = `Yes${gotw.data.strength_rating ? ` (${Number(gotw.data.strength_rating).toFixed(1)} rating)` : ""}`;
        } else if (isPostseason) {
          gotwStatus = "Yes - Playoff GOTW";
        }
      } else if (isPostseason) {
        currentMatchup = "Season Concluded";
      } else if (!["regular_season", "preseason_training_camp", "preseason"].includes(stage)) {
        currentMatchup = stageDisplay(stage);
      } else {
        currentMatchup = "BYE WEEK";
      }
    } else {
      currentMatchup = "None";
    }
  }

  const leagueGame = String(league?.game ?? "madden_26");
  const [globalRecordResult, gameGlobalRecordResult] = await Promise.all([
    supabase.from("rec_global_user_records").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("rec_global_user_game_records").select("*").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
  ]);
  const globalRecord = globalRecordResult.data ?? baseline.globalRecord ?? {};
  const gameGlobalRecord = buildGameRecordForDisplay(
    gameGlobalRecordResult.data ?? null,
    leagueGame,
    baseline.legacyBaseline?.global_record as Record<string, unknown> | null | undefined,
  );

  // GOTW voting record — read from the settled aggregate table (populated by settleGotwVotes
  // during advance). The raw rec_game_of_week_votes table can have null user_id when the
  // Discord→user lookup fails at vote-cast time, so the aggregate is more reliable.
  let gotwVotingRecord = null;
  const { data: gotwRecord } = await supabase
    .from("rec_global_gotw_guessing_records")
    .select("correct_guesses,wrong_guesses")
    .eq("user_id", userId)
    .maybeSingle();

  if (gotwRecord) {
    const correct = gotwRecord.correct_guesses ?? 0;
    const wrong = gotwRecord.wrong_guesses ?? 0;
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    gotwVotingRecord = { correct, total, accuracy };
  }

  // Projected next-advance savings interest (3.5% of savings, floored).
  const savingsBalance = baseline.wallet?.savings_balance ?? 0;
  const projectedInterest = Math.floor(savingsBalance * SAVINGS_INTEREST_RATE);

  // User/opponent current streaks and opponent season record.
  let userStreakText = "—";
  let opponentRecordText = "—";
  let opponentPointDifferential = 0;
  let opponentStreakText = "—";
  if (league?.id) {
    const profileSeason = league.season_number ?? league.display_season_number ?? 1;
    const { data: userGames } = await supabase
      .from("rec_game_results")
      .select("home_user_id,away_user_id,home_score,away_score,season_number,week_number,source")
      .eq("league_id", league.id)
      .eq("season_number", profileSeason)
      .in("source", [...OFFICIAL_RESULT_SOURCES])
      .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`);
    userStreakText = streakFromGames(userGames ?? [], userId);

    if (opponentUserId) {
      const [oppRecordResult, oppGamesResult] = await Promise.all([
        supabase.from("rec_season_user_records").select("*").eq("league_id", league.id).eq("season_number", profileSeason).eq("user_id", opponentUserId).maybeSingle(),
        supabase.from("rec_game_results").select("home_user_id,away_user_id,home_score,away_score,season_number,week_number,source").eq("league_id", league.id).eq("season_number", profileSeason).in("source", [...OFFICIAL_RESULT_SOURCES]).or(`home_user_id.eq.${opponentUserId},away_user_id.eq.${opponentUserId}`)
      ]);
      opponentRecordText = recordText(oppRecordResult.data ?? {});
      opponentPointDifferential = oppRecordResult.data?.point_differential ?? 0;
      opponentStreakText = streakFromGames(oppGamesResult.data ?? [], opponentUserId);
    }
  }

  // All-time GOTW head-to-head record (populated during advance once GOTW games are settled).
  let gotwH2hRecordText = "No GOTW games yet";
  const { data: gotwH2h } = await supabase
    .from("rec_global_gotw_h2h_records")
    .select("wins,losses,ties")
    .eq("user_id", userId)
    .maybeSingle();
  if (gotwH2h) {
    const w = gotwH2h.wins ?? 0, l = gotwH2h.losses ?? 0, t = gotwH2h.ties ?? 0;
    if (w + l + t > 0) gotwH2hRecordText = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
  }

  return {
    user: baseline.user,
    discord: baseline.discord,
    wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 },
    server,
    league,
    team: assignment?.team ?? null,
    role: membership?.role ?? null,
    seasonRecord,
    currentMatchup,
    currentGame,
    globalRecord,
    gameGlobalRecord,
    badges,
    gotwVotingRecord,
    display: {
      discordUsername: baseline.discord.global_name ?? baseline.discord.username ?? baseline.user.display_name,
      teamName: assignment?.team?.name ?? null,
      highestRole: membership?.role ?? null,
      wallet: baseline.wallet?.wallet_balance ?? 0,
      savings: baseline.wallet?.savings_balance ?? 0,
      leagueName: league?.name ?? "Current League",
      seasonNumber: league?.season_number ?? league?.display_season_number ?? 1,
      currentWeek: league?.current_week ?? 1,
      seasonStage: league?.season_stage ?? league?.current_phase ?? "regular_season",
      leagueTeamRecordText: recordText(displayRecord),
      leagueUserRecordText: recordText(seasonRecord),
      leagueSeasonRecordText: recordText(seasonRecord),
      leagueSeasonPointDifferential: seasonRecord?.point_differential ?? 0,
      currentMatchupText: currentMatchup,
      gotwStatus,
      gotwVotingRecordText: gotwVotingRecord ? `${gotwVotingRecord.correct}-${gotwVotingRecord.total - gotwVotingRecord.correct} (${gotwVotingRecord.accuracy}%)` : "No votes yet",
      globalRecordText: recordText(globalRecord),
      globalPlayoffText: playoffText(globalRecord),
      globalSuperbowlText: superbowlText(globalRecord),
      globalPointDifferential: globalRecord?.point_differential ?? 0,
      gameGlobalRecord: league?.id
        ? buildGameGlobalRecordDisplay(gameGlobalRecord, leagueGame)
        : null,
      gameGlobalRecordText: league?.id ? recordText(gameGlobalRecord ?? {}) : null,
      gameGlobalPlayoffText: league?.id ? playoffText(gameGlobalRecord ?? {}) : null,
      gameGlobalSuperbowlText: league?.id ? superbowlText(gameGlobalRecord ?? {}) : null,
      gameGlobalPointDifferential: gameGlobalRecord?.point_differential ?? 0,
      gameGlobalLabel: league?.id ? formatLeagueGameLabel(leagueGame) : null,
      projectedInterest,
      youAreText: youAre,
      matchupType,
      opponentName,
      opponentRecordText,
      opponentPointDifferential,
      opponentStreakText,
      userStreakText,
      gotwH2hRecordText,
      badges
    }
  };
}
