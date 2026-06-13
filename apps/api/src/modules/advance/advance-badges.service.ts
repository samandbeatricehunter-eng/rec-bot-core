import { supabase, asNumber, nowIso, getLeagueContext, getLeagueFeatureSettings, creditUserWallet, sumTeamStatFromCommitted } from "./advance-shared.js";

const BADGE_QUALIFIERS: Record<string, string> = {
  comeback_artist: "winning after a 3+ game losing streak",
  record_breaker_wins: "breaking the league's all-time wins record",
  record_breaker_point_differential: "breaking the league's all-time point differential record",
  record_breaker_points_for: "breaking the league's all-time points scored record",
  record_holder_wins: "permanently holding the league's all-time wins record",
  record_holder_point_differential: "permanently holding the league's all-time point differential record",
  record_holder_points_for: "permanently holding the league's all-time points scored record",
  undefeated: "going 17-0 through an undefeated regular season",
  dominant: "finishing the regular season with an 80%+ win rate",
  winning_season: "finishing the regular season with more wins than losses",
  scoring_leader: "leading the league in total points scored",
  high_octane: "averaging 40+ points per game",
  blowout_master: "winning 50%+ of games by 21+ points",
  shutout_king: "holding opponents scoreless 3+ times",
  closer: "winning 50%+ of games by 7 or fewer points",
  defensive_powerhouse: "allowing the fewest points in the league",
  h2h_dominator: "going undefeated in all head-to-head matchups",
  h2h_specialist: "maintaining an 85%+ win rate in H2H matchups",
  road_warrior: "going undefeated on the road this season",
  home_fortress: "going undefeated at home this season",
  cardiac_cats: "winning 6+ games by one score or fewer",
  offensive_juggernaut: "finishing in the top 3 in scoring offense",
  defensive_anchor: "finishing in the top 3 in scoring defense",
  playoff_qualifier: "qualifying for the playoffs",
  wild_card_survivor: "winning the Wild Card round",
  conference_champion: "winning the Conference Championship",
  playoff_warrior: "earning 3+ playoff wins in a single postseason",
  perfect_playoff_run: "winning the Super Bowl without a single playoff loss",
  sb_champion: "winning the Super Bowl",
  sb_runner_up: "finishing as Super Bowl runner-up",
  air_raid: "throwing for 400+ yards with 4+ TDs in a win",
  ground_assault: "rushing for 200+ yards in a win",
  balanced_offense_week: "throwing for 250+ and rushing for 150+ yards in a win",
  turnover_machine: "forcing 3+ turnovers in a win",
  sack_artist: "recording 5+ sacks in a win",
  lockdown_week: "holding the opponent to 150 or fewer passing yards in a win"
};

function getPrestigeTier(totalEarned: number): string {
  if (totalEarned >= 50) return "diamond";
  if (totalEarned >= 30) return "platinum";
  if (totalEarned >= 15) return "gold";
  if (totalEarned >= 5) return "silver";
  return "bronze";
}

async function incrementBadgePrestige(userId: string, badgeName: string) {
  try {
    const { data: existing } = await supabase
      .from("rec_user_badge_prestige")
      .select("total_earned")
      .eq("user_id", userId)
      .eq("badge_name", badgeName)
      .maybeSingle();
    const newTotal = (existing?.total_earned ?? 0) + 1;
    const tier = getPrestigeTier(newTotal);
    const now = nowIso();
    if (existing) {
      await supabase.from("rec_user_badge_prestige")
        .update({ total_earned: newTotal, prestige_tier: tier, last_earned_at: now, updated_at: now })
        .eq("user_id", userId).eq("badge_name", badgeName);
    } else {
      await supabase.from("rec_user_badge_prestige").insert({
        user_id: userId, badge_name: badgeName, total_earned: 1,
        prestige_tier: "bronze", first_earned_at: now, last_earned_at: now,
        created_at: now, updated_at: now
      });
    }
  } catch {
    // Non-fatal
  }
}

async function issueBadgeBonuses(
  earnedBadges: Array<{ user_id: string; badge_name: string }>,
  leagueId: string,
  seasonNumber: number
) {
  if (earnedBadges.length === 0) return;
  const features = await getLeagueFeatureSettings(leagueId).catch(() => null);
  if (!features?.coin_economy_enabled) return;
  for (const badge of earnedBadges) {
    await creditUserWallet({
      userId: badge.user_id,
      leagueId,
      seasonNumber,
      amount: 5,
      transactionType: "badge_bonus",
      description: `Badge bonus: ${badge.badge_name.replace(/_/g, " ")}`,
      sourceReference: { idempotencyKey: `badge_bonus_${badge.user_id}_${leagueId}_${badge.badge_name}` }
    }).catch(() => undefined);
    await incrementBadgePrestige(badge.user_id, badge.badge_name);
  }
}

async function assignRecordBreakerBadges(leagueId: string, seasonNumber: number) {
  const { data: allRecords } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,point_differential,points_for,games_played")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  if (!allRecords || allRecords.length === 0) return { assigned: 0, earned: [], removed: [] };

  const badgesToAssign: any[] = [];
  const removedBadges: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];
  const recordsToUpdate: any[] = [];

  const records = [
    { metric: "wins", label: "Wins", getter: (r: any) => r.wins },
    { metric: "point_differential", label: "Point Differential", getter: (r: any) => r.point_differential },
    { metric: "points_for", label: "Points Scored", getter: (r: any) => r.points_for ?? 0 }
  ];

  for (const recordType of records) {
    const { data: existingRecord } = await supabase
      .from("rec_league_records")
      .select("*")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("record_name", recordType.label)
      .maybeSingle();

    const recordHolder = existingRecord?.record_holder_id;
    const currentBestValue = existingRecord?.record_value ?? 0;
    let bestUser: string | null = null;
    let bestValue = currentBestValue;

    for (const record of allRecords) {
      const value = recordType.getter(record);
      if (value > bestValue) { bestValue = value; bestUser = record.user_id; }
    }

    if (bestUser && bestValue !== currentBestValue) {
      if (recordHolder && recordHolder !== bestUser) {
        try {
          await supabase.from("rec_user_badges").delete()
            .eq("user_id", recordHolder).eq("league_id", leagueId)
            .eq("badge_name", `record_breaker_${recordType.metric}`).eq("season_number", seasonNumber);
          removedBadges.push({ user_id: recordHolder, badge_name: `record_breaker_${recordType.metric}`, badge_label: `Record Breaker - ${recordType.label}` });
        } catch { /* Non-fatal */ }
      }
      badgesToAssign.push({ user_id: bestUser, league_id: leagueId, season_number: seasonNumber, badge_name: `record_breaker_${recordType.metric}`, badge_label: `Record Breaker - ${recordType.label}`, earned_value: bestValue, earned_at: nowIso() });
      recordsToUpdate.push({ league_id: leagueId, season_number: seasonNumber, record_name: recordType.label, record_value: bestValue, record_holder_id: bestUser, previous_holder_id: recordHolder, previous_value: currentBestValue, updated_at: nowIso() });
    }
  }

  const newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase.from("rec_user_badges").select("user_id,badge_name").eq("league_id", leagueId).eq("season_number", seasonNumber).in("badge_name", badgesToAssign.map((b) => b.badge_name));
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    for (const b of badgesToAssign) { if (!existingSet.has(`${b.user_id}:${b.badge_name}`)) newBadges.push(b); }
    try { await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" }); } catch { /* Non-fatal */ }
  }
  if (recordsToUpdate.length > 0) {
    try { await supabase.from("rec_league_records").upsert(recordsToUpdate, { onConflict: "league_id,season_number,record_name" }); } catch { /* Non-fatal */ }
  }
  await issueBadgeBonuses(newBadges, leagueId, seasonNumber);
  return { assigned: badgesToAssign.length, earned: newBadges, removed: removedBadges };
}

async function assignCombackArtistBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: allUsers } = await supabase.from("rec_league_user_records").select("user_id").eq("league_id", context.league_id).eq("season_number", seasonNumber);
  if (!allUsers) return { assigned: 0 };

  const badgesToAssign: any[] = [];

  for (const user of allUsers) {
    const { data: existingBadge } = await supabase.from("rec_user_badges").select("id").eq("user_id", user.user_id).eq("league_id", context.league_id).eq("badge_name", "comeback_artist").eq("season_number", seasonNumber).maybeSingle();
    if (existingBadge) continue;

    const { data: games } = await supabase.from("rec_game_results").select("id,home_user_id,away_user_id,winning_user_id,losing_user_id,played_at").eq("league_id", context.league_id).eq("season_number", seasonNumber).order("played_at", { ascending: true });
    if (!games) continue;

    let lossStreak = 0;
    let hasComebackArtist = false;
    for (const game of games) {
      const isLoss = game.losing_user_id === user.user_id;
      const isWin = game.winning_user_id === user.user_id;
      if (isLoss) { lossStreak++; }
      else if (isWin && lossStreak >= 3) { hasComebackArtist = true; break; }
      else if (isWin) { lossStreak = 0; }
    }

    if (hasComebackArtist) {
      badgesToAssign.push({ user_id: user.user_id, league_id: context.league_id, season_number: seasonNumber, badge_name: "comeback_artist", badge_label: "Comeback Artist", earned_at: nowIso() });
    }
  }

  if (badgesToAssign.length > 0) {
    try { await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" }); } catch { /* Non-fatal */ }
    await issueBadgeBonuses(badgesToAssign, context.league_id, seasonNumber);
  }
  return { assigned: badgesToAssign.length, earned: badgesToAssign };
}

async function assignWeeklyPerformanceBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);

  const { data: games } = await supabase.from("rec_game_results").select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,winning_user_id").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", completedWeek);
  if (!games?.length) return { assigned: 0, earned: [] };

  const leagueId = context.league_id;
  const badgesToAssign: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];

  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id }
    ].filter((s) => s.userId && s.teamId);

    for (const side of sides) {
      const didWin = game.winning_user_id === side.userId;
      if (!didWin) continue;

      const [passR, rushR, sacksR, intsR, fumR, passTdR] = await Promise.all([
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["pass_yards"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rush_yards"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["sacks"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["interceptions"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["forced_fumbles"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["pass_tds"])
      ]);
      const oppPassR = side.opponentTeamId ? await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["pass_yards"]) : { total: 999, hasData: false };

      if (passR.hasData && passR.total >= 400 && passTdR.total >= 4) badgesToAssign.push({ user_id: side.userId, badge_name: "air_raid", badge_label: "Air Raid" });
      if (rushR.hasData && rushR.total >= 200) badgesToAssign.push({ user_id: side.userId, badge_name: "ground_assault", badge_label: "Ground Assault" });
      if (passR.hasData && rushR.hasData && passR.total >= 250 && rushR.total >= 150) badgesToAssign.push({ user_id: side.userId, badge_name: "balanced_offense_week", badge_label: "Balanced Offense" });
      if (intsR.hasData && (intsR.total + fumR.total) >= 3) badgesToAssign.push({ user_id: side.userId, badge_name: "turnover_machine", badge_label: "Turnover Machine" });
      if (sacksR.hasData && sacksR.total >= 5) badgesToAssign.push({ user_id: side.userId, badge_name: "sack_artist", badge_label: "Sack Artist" });
      if (oppPassR.hasData && oppPassR.total <= 150) badgesToAssign.push({ user_id: side.userId, badge_name: "lockdown_week", badge_label: "Lockdown" });
    }
  }

  if (badgesToAssign.length === 0) return { assigned: 0, earned: [] };
  await issueBadgeBonuses(badgesToAssign, leagueId, seasonNumber);
  return { assigned: badgesToAssign.length, earned: badgesToAssign };
}

export async function assignWeeklyBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const [comebackResult, recordResult, perfResult] = await Promise.all([
    assignCombackArtistBadges(guildId),
    assignRecordBreakerBadges(context.league_id, seasonNumber),
    assignWeeklyPerformanceBadges(guildId)
  ]);

  const earned = [...(comebackResult.earned ?? []), ...(recordResult.earned ?? []), ...(perfResult.earned ?? [])];
  const removed = [...(recordResult.removed ?? [])];
  return { assigned: comebackResult.assigned + recordResult.assigned + perfResult.assigned, earned, removed };
}

export async function assignSeasonEndBadges(leagueId: string, seasonNumber: number) {
  const badgesToAssign: any[] = [];

  const { data: seasonRecords } = await supabase.from("rec_season_user_records").select("user_id,wins,losses,ties,games_played,point_differential,points_for,points_against").eq("league_id", leagueId).eq("season_number", seasonNumber);
  if (!seasonRecords || seasonRecords.length === 0) return { assigned: 0 };

  const { data: allGames } = await supabase.from("rec_game_results").select("home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,point_differential").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("is_playoff", false);
  const { data: h2hRecords } = await supabase.from("rec_user_h2h_global_records").select("user_a_id,user_b_id,wins,losses,ties").in("user_a_id", seasonRecords.map((r: any) => r.user_id)).or(`user_b_id.in.(${seasonRecords.map((r: any) => r.user_id).join(",")})`);

  const gamesByUser = new Map<string, any[]>();
  for (const game of allGames ?? []) {
    if (game.home_user_id) { if (!gamesByUser.has(game.home_user_id)) gamesByUser.set(game.home_user_id, []); gamesByUser.get(game.home_user_id)?.push(game); }
    if (game.away_user_id) { if (!gamesByUser.has(game.away_user_id)) gamesByUser.set(game.away_user_id, []); gamesByUser.get(game.away_user_id)?.push(game); }
  }

  const push = (userId: string, badge_name: string, badge_label: string, extras: Record<string, any> = {}) =>
    badgesToAssign.push({ user_id: userId, league_id: leagueId, season_number: seasonNumber, badge_name, badge_label, earned_at: nowIso(), ...extras });

  for (const record of seasonRecords) {
    const userId = record.user_id;
    const userGames = gamesByUser.get(userId) ?? [];
    const winPct = record.games_played > 0 ? record.wins / record.games_played : 0;

    if (record.wins === 17 && record.losses === 0) push(userId, "undefeated", "Undefeated");
    if (winPct >= 0.80) push(userId, "dominant", "Dominant");
    if (record.wins > record.losses) push(userId, "winning_season", "Winning Season");

    const blowoutWins = userGames.filter((g: any) => { const isHome = g.home_user_id === userId; return (isHome ? g.home_score : g.away_score) - (isHome ? g.away_score : g.home_score) >= 21 && (isHome ? g.home_score : g.away_score) > (isHome ? g.away_score : g.home_score); }).length;
    if (record.wins > 0 && (blowoutWins / record.wins) >= 0.5) push(userId, "blowout_master", "Blowout Master");

    const ppg = record.games_played > 0 ? (record.points_for ?? 0) / record.games_played : 0;
    if (ppg >= 40) push(userId, "high_octane", "High Octane", { earned_value: Number(ppg.toFixed(1)) });

    const shutouts = userGames.filter((g: any) => (g.home_user_id === userId ? g.away_score : g.home_score) === 0).length;
    if (shutouts >= 3) push(userId, "shutout_king", "Shutout King");

    const closeWins = userGames.filter((g: any) => { const isHome = g.home_user_id === userId; const margin = (isHome ? g.home_score : g.away_score) - (isHome ? g.away_score : g.home_score); return margin >= 1 && margin <= 7; }).length;
    if (record.wins >= 10 && (closeWins / record.wins) >= 0.5) push(userId, "closer", "Closer");

    const awayGames = userGames.filter((g: any) => g.away_user_id === userId);
    if (awayGames.length >= 3 && awayGames.filter((g: any) => g.winning_user_id && g.winning_user_id !== userId).length === 0) push(userId, "road_warrior", "Road Warrior");

    const homeGames = userGames.filter((g: any) => g.home_user_id === userId);
    if (homeGames.length >= 3 && homeGames.filter((g: any) => g.winning_user_id && g.winning_user_id !== userId).length === 0) push(userId, "home_fortress", "Home Fortress");

    const oneScoreWins = userGames.filter((g: any) => { const isHome = g.home_user_id === userId; const m = (isHome ? g.home_score : g.away_score) - (isHome ? g.away_score : g.home_score); return m >= 1 && m <= 7; }).length;
    if (oneScoreWins >= 6) push(userId, "cardiac_cats", "Cardiac Cats");
  }

  const withGames = seasonRecords.filter((r: any) => (r.games_played ?? 0) > 0);
  const sortedByPf = [...seasonRecords].sort((a: any, b: any) => (b.points_for ?? 0) - (a.points_for ?? 0));
  if (sortedByPf[0] && (sortedByPf[0].points_for ?? 0) > 0) push(sortedByPf[0].user_id, "scoring_leader", "Scoring Leader", { earned_value: sortedByPf[0].points_for });
  const sortedByPa = [...withGames].sort((a: any, b: any) => (a.points_against ?? 0) - (b.points_against ?? 0));
  if (sortedByPa[0] && (sortedByPa[0].points_against ?? 0) > 0) push(sortedByPa[0].user_id, "defensive_powerhouse", "Defensive Powerhouse", { earned_value: sortedByPa[0].points_against });
  for (const r of sortedByPf.slice(0, 3)) { if ((r.points_for ?? 0) > 0) push(r.user_id, "offensive_juggernaut", "Offensive Juggernaut", { earned_value: r.points_for }); }
  for (const r of sortedByPa.slice(0, 3)) { if ((r.points_against ?? 0) > 0) push(r.user_id, "defensive_anchor", "Defensive Anchor", { earned_value: r.points_against }); }

  for (const record of seasonRecords) {
    const userId = record.user_id;
    let h2hWins = 0, h2hLosses = 0, h2hTies = 0;
    for (const h2h of h2hRecords ?? []) {
      if (h2h.user_a_id === userId) { h2hWins += h2h.wins ?? 0; h2hLosses += h2h.losses ?? 0; h2hTies += h2h.ties ?? 0; }
      else if (h2h.user_b_id === userId) { h2hWins += h2h.losses ?? 0; h2hLosses += h2h.wins ?? 0; h2hTies += h2h.ties ?? 0; }
    }
    const h2hTotal = h2hWins + h2hLosses + h2hTies;
    if (h2hTotal >= 8) {
      if (h2hLosses === 0) push(userId, "h2h_dominator", "H2H Dominator");
      if (h2hWins / h2hTotal >= 0.85) push(userId, "h2h_specialist", "H2H Specialist");
    }
  }

  let newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase.from("rec_user_badges").select("user_id,badge_name").eq("league_id", leagueId).eq("season_number", seasonNumber).in("badge_name", [...new Set(badgesToAssign.map((b) => b.badge_name))]);
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    newBadges = badgesToAssign.filter((b) => !existingSet.has(`${b.user_id}:${b.badge_name}`));
    try { await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" }); } catch { /* Non-fatal */ }
    await issueBadgeBonuses(newBadges, leagueId, seasonNumber);
  }
  return { assigned: badgesToAssign.length, earned: newBadges };
}

export async function assignPlayoffBadges(leagueId: string, seasonNumber: number) {
  const badgesToAssign: any[] = [];
  const badgesToRemove: any[] = [];

  const { data: seasonResults } = await supabase.from("rec_league_season_results").select("*").eq("league_id", leagueId).eq("season_number", seasonNumber).maybeSingle();

  if (seasonResults) {
    if (seasonResults.sb_winner) badgesToAssign.push({ user_id: seasonResults.sb_winner, league_id: leagueId, season_number: seasonNumber, badge_name: "sb_champion", badge_label: "🏆 Super Bowl Champion", earned_at: nowIso() });
    if (seasonResults.sb_loser) badgesToAssign.push({ user_id: seasonResults.sb_loser, league_id: leagueId, season_number: seasonNumber, badge_name: "sb_runner_up", badge_label: "🥈 Super Bowl Runner-Up", earned_at: nowIso() });
  }

  const { data: standings } = await supabase.from("rec_league_user_records").select("user_id").eq("league_id", leagueId).eq("season_number", seasonNumber).order("wins", { ascending: false }).limit(8);
  for (const record of standings ?? []) badgesToAssign.push({ user_id: record.user_id, league_id: leagueId, season_number: seasonNumber, badge_name: "playoff_qualifier", badge_label: "Playoff Qualifier", earned_at: nowIso() });

  const { data: playoffGames } = await supabase.from("rec_game_results").select("home_user_id,away_user_id,winning_user_id,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("is_playoff", true).order("week_number");
  const playoffWinsByUser = new Map<string, number>();
  const playoffLossesByUser = new Map<string, number>();
  const wildCardWinners = new Set<string>();
  const confChampWinners = new Set<string>();

  for (const g of playoffGames ?? []) {
    const winner = g.winning_user_id;
    const loser = [g.home_user_id, g.away_user_id].find((id) => id && id !== winner);
    if (winner) { playoffWinsByUser.set(winner, (playoffWinsByUser.get(winner) ?? 0) + 1); if (g.week_number === 19) wildCardWinners.add(winner); if (g.week_number === 21) confChampWinners.add(winner); }
    if (loser) playoffLossesByUser.set(loser, (playoffLossesByUser.get(loser) ?? 0) + 1);
  }

  for (const userId of wildCardWinners) badgesToAssign.push({ user_id: userId, league_id: leagueId, season_number: seasonNumber, badge_name: "wild_card_survivor", badge_label: "Wild Card Survivor", earned_at: nowIso() });
  for (const userId of confChampWinners) badgesToAssign.push({ user_id: userId, league_id: leagueId, season_number: seasonNumber, badge_name: "conference_champion", badge_label: "Conference Champion", earned_at: nowIso() });
  for (const [userId, wins] of playoffWinsByUser) { if (wins >= 3) badgesToAssign.push({ user_id: userId, league_id: leagueId, season_number: seasonNumber, badge_name: "playoff_warrior", badge_label: "Playoff Warrior", earned_value: wins, earned_at: nowIso() }); }

  if (seasonResults?.sb_winner) {
    const sbWinnerId = seasonResults.sb_winner as string;
    if ((playoffLossesByUser.get(sbWinnerId) ?? 0) === 0 && (playoffWinsByUser.get(sbWinnerId) ?? 0) >= 2) {
      badgesToAssign.push({ user_id: sbWinnerId, league_id: leagueId, season_number: seasonNumber, badge_name: "perfect_run", badge_label: "Perfect Run", earned_at: nowIso() });
    }
  }

  const { data: recordBreakers } = await supabase.from("rec_user_badges").select("*").eq("league_id", leagueId).eq("season_number", seasonNumber).like("badge_name", "record_breaker_%");
  for (const breaker of recordBreakers ?? []) {
    badgesToAssign.push({ user_id: breaker.user_id, league_id: leagueId, season_number: seasonNumber, badge_name: breaker.badge_name.replace("record_breaker_", "record_holder_"), badge_label: breaker.badge_label?.replace("Record Breaker", "Record Holder") ?? "Record Holder", earned_value: breaker.earned_value, earned_at: nowIso() });
    badgesToRemove.push({ user_id: breaker.user_id, league_id: leagueId, season_number: seasonNumber, badge_name: breaker.badge_name });
  }

  const { data: comebackArtists } = await supabase.from("rec_user_badges").select("user_id").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("badge_name", "comeback_artist");
  for (const user of comebackArtists ?? []) badgesToRemove.push({ user_id: user.user_id, league_id: leagueId, season_number: seasonNumber, badge_name: "comeback_artist" });

  let newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase.from("rec_user_badges").select("user_id,badge_name").eq("league_id", leagueId).eq("season_number", seasonNumber).in("badge_name", [...new Set(badgesToAssign.map((b) => b.badge_name))]);
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    newBadges = badgesToAssign.filter((b) => !existingSet.has(`${b.user_id}:${b.badge_name}`));
    try { await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" }); } catch { /* Non-fatal */ }
    await issueBadgeBonuses(newBadges, leagueId, seasonNumber);
  }
  if (badgesToRemove.length > 0) {
    try { for (const badge of badgesToRemove) { await supabase.from("rec_user_badges").delete().eq("user_id", badge.user_id).eq("league_id", badge.league_id).eq("season_number", badge.season_number).eq("badge_name", badge.badge_name); } } catch { /* Non-fatal */ }
  }
  return { assigned: badgesToAssign.length, earned: newBadges, removed: badgesToRemove };
}
