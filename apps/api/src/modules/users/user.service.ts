import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

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

export async function getWalletByDiscordId(discordId: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);
  const transactions = await getRecentTransactionsByUserId(baseline.user.id);

  return {
    user: baseline.user,
    discord: baseline.discord,
    wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 },
    transactions
  };
}

export async function getRecentTransactionsByUserId(userId: string, limit = 25) {
  const ledger = await supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,source,source_reference,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ledger.error) {
    throw new ApiError(500, "Failed to load wallet transactions", ledger.error);
  }

  return ledger.data ?? [];
}

function recordText(record: any) {
  return `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`;
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
      .from("rec_user_badges")
      .select("*")
      .eq("user_id", userId)
      .or(`league_id.is.null,league_id.eq.${leagueId}`);

    if (result.error) return [];
    return result.data ?? [];
  } catch {
    // Some environments may not have the badge table yet. Do not break /menu.
    return [];
  }
}

export async function getUserMenuProfileByDiscordId(discordId: string, guildId: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);
  const userId = baseline.user.id;

  const serverResult = await supabase
    .from("rec_discord_servers")
    .select("id,name,guild_id")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (serverResult.error) throw new ApiError(500, "Failed to load Discord server", serverResult.error);

  const server = serverResult.data;
  let league: any = null;

  if (server?.id) {
    const leagueLinkResult = await supabase
      .from("rec_server_league_links")
      .select("league_id")
      .eq("server_id", server.id)
      .limit(1)
      .maybeSingle();

    if (leagueLinkResult.error) {
      throw new ApiError(500, "Failed to load server league link", leagueLinkResult.error);
    }

    if (leagueLinkResult.data?.league_id) {
      const leagueResult = await supabase
        .from("rec_leagues")
        .select("*")
        .eq("id", leagueLinkResult.data.league_id)
        .maybeSingle();

      if (leagueResult.error) throw new ApiError(500, "Failed to load current league", leagueResult.error);
      league = leagueResult.data;
    }
  }

  let assignment: any = null;
  let membership: any = null;
  let seasonRecord: any = null;
  let currentMatchup = "None";
  let currentGame: any = null;
  let gotwStatus = "No";
  let offensiveChallenge: any = null;
  let defensiveChallenge: any = null;
  let badges: any[] = [];

  if (league?.id) {
    const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
    const currentWeek = league.current_week ?? 1;
    const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
    const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl", "playoffs"].includes(stage);

    const [assignmentResult, membershipResult, seasonRecordResult] = await Promise.all([
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
        .eq("user_id", userId)
        .maybeSingle()
    ]);

    if (assignmentResult.error) throw new ApiError(500, "Failed to load linked team", assignmentResult.error);
    if (membershipResult.error) throw new ApiError(500, "Failed to load league role", membershipResult.error);
    if (seasonRecordResult.error) throw new ApiError(500, "Failed to load season record", seasonRecordResult.error);

    assignment = assignmentResult.data;
    membership = membershipResult.data;
    seasonRecord = seasonRecordResult.data;
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

        const challenges = await supabase
          .from("rec_weekly_challenges")
          .select("challenge_side,s_tier_goal,a_tier_goal,b_tier_goal,status,earned_tier,earned_amount")
          .eq("league_id", league.id)
          .eq("season_number", seasonNumber)
          .eq("week_number", currentWeek)
          .eq("user_id", userId)
          .in("challenge_side", ["offense", "defense"]);

        if (!challenges.error && Array.isArray(challenges.data)) {
          offensiveChallenge = challenges.data.find((challenge: any) => challenge.challenge_side === "offense") ?? null;
          defensiveChallenge = challenges.data.find((challenge: any) => challenge.challenge_side === "defense") ?? null;
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

  const globalRecord = baseline.globalRecord ?? {};

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
    badges,
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
      leagueSeasonRecordText: recordText(seasonRecord),
      leagueSeasonPointDifferential: seasonRecord?.point_differential ?? 0,
      currentMatchupText: currentMatchup,
      gotwStatus,
      offensiveChallenge,
      defensiveChallenge,
      globalRecordText: recordText(globalRecord),
      globalPlayoffText: playoffText(globalRecord),
      globalSuperbowlText: superbowlText(globalRecord),
      globalPointDifferential: globalRecord?.point_differential ?? 0,
      badges
    }
  };
}
