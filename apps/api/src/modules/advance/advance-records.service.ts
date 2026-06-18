import { supabase, asNumber, getLeagueContext } from "./advance-shared.js";

function getScorePair(game: any) {
  const home = asNumber(game.home_score);
  const away = asNumber(game.away_score);
  return { home, away };
}

function isCompletedGame(game: any) {
  const { home, away } = getScorePair(game);
  // Every real Madden game has at least one non-zero score; 0-0 means unplayed/phantom import.
  // Don't use is_tie as a completion signal — phantom imports set is_tie=true on 0-0 games.
  return home > 0 || away > 0 || game.winning_user_id || game.losing_user_id;
}

function gameApplyKey(game: any) {
  return [game.league_id, game.season_number, game.week_number, game.external_game_id ?? game.id].join(":");
}

const logIncrementFailure = (table: string) => (error: unknown) =>
  console.error(`[RECORDS] increment ${table} failed:`, error instanceof Error ? error.message : error);

async function incrementRecord(table: string, match: Record<string, any>, patch: Record<string, any>) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  if (existing) {
    const gamesPlayed = asNumber(existing.games_played) + asNumber(patch.games_played);
    const pointDifferential = asNumber(existing.point_differential) + asNumber(patch.point_differential);
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) update[key] = asNumber(existing[key]) + asNumber(value);
    if ("games_played" in patch) update.avg_point_differential = gamesPlayed ? pointDifferential / gamesPlayed : 0;
    await supabase.from(table).update(update).match(match);
  } else {
    const gamesPlayed = asNumber(patch.games_played);
    const pointDifferential = asNumber(patch.point_differential);
    await supabase.from(table).insert({ ...match, ...patch, avg_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0 });
  }
}

async function incrementH2h(table: string, match: Record<string, any>, userAResult: { wins: number; losses: number; ties: number; pointDifferential: number }) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  const gamesPlayed = asNumber(existing?.games_played) + 1;
  const pointDifferential = asNumber(existing?.user_a_point_differential) + userAResult.pointDifferential;
  const row = {
    ...match,
    user_a_wins: asNumber(existing?.user_a_wins) + userAResult.wins,
    user_a_losses: asNumber(existing?.user_a_losses) + userAResult.losses,
    user_a_ties: asNumber(existing?.user_a_ties) + userAResult.ties,
    user_a_point_differential: pointDifferential,
    games_played: gamesPlayed,
    avg_user_a_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0,
    last_played_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing) await supabase.from(table).update(row).match(match);
  else await supabase.from(table).insert(row);
}

// All-time per-user Game-of-the-Week head-to-head record. Idempotent via the caller's
// per-game records_applied_at guard (each game is processed exactly once).
async function incrementGotwH2h(userId: string, result: "win" | "loss" | "tie") {
  const { data: existing } = await supabase.from("rec_global_gotw_h2h_records").select("*").eq("user_id", userId).maybeSingle();
  const row = {
    user_id: userId,
    wins: asNumber(existing?.wins) + (result === "win" ? 1 : 0),
    losses: asNumber(existing?.losses) + (result === "loss" ? 1 : 0),
    ties: asNumber(existing?.ties) + (result === "tie" ? 1 : 0),
    games_played: asNumber(existing?.games_played) + 1,
    last_result_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing) await supabase.from("rec_global_gotw_h2h_records").update(row).eq("user_id", userId);
  else await supabase.from("rec_global_gotw_h2h_records").insert(row);
}

export async function applyAdvanceRecords(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const { data: games, error } = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .is("records_applied_at", null);
  if (error) throw error;

  // Selected Game-of-the-Week matchups for this season, keyed by week + sorted team pair,
  // so we can also track GOTW head-to-head records as each GOTW game is applied.
  const { data: gotwSelected } = await supabase
    .from("rec_game_of_week_candidates")
    .select("week_number, home_team_id, away_team_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("is_selected", true);
  const gotwKeys = new Set(
    (gotwSelected ?? []).map((c: any) => `${c.week_number}:${[c.home_team_id, c.away_team_id].sort().join("-")}`)
  );

  let applied = 0;
  for (const game of games ?? []) {
    if (!isCompletedGame(game)) continue;
    const applyKey = gameApplyKey(game);
    const { home, away } = getScorePair(game);
    const participants = [
      { userId: game.home_user_id, teamId: game.home_team_id, score: home, oppScore: away },
      { userId: game.away_user_id, teamId: game.away_team_id, score: away, oppScore: home }
    ].filter((p) => p.userId);
    const isH2H = Boolean(game.home_user_id && game.away_user_id);
    for (const p of participants) {
      const win = p.score > p.oppScore ? 1 : 0;
      const loss = p.score < p.oppScore ? 1 : 0;
      const tie = p.score === p.oppScore ? 1 : 0;
      const delta = p.score - p.oppScore;
      const closeGame = win && Math.abs(delta) <= 7 ? 1 : 0;
      const blowoutWin = delta >= 22 ? 1 : 0;
      const blowoutLoss = delta <= -22 ? 1 : 0;
      const patch = {
        wins: win, losses: loss, ties: tie, games_played: 1,
        point_differential: delta,
        points_for: p.score, points_against: p.oppScore,
        close_games_within_7: closeGame,
        blowout_wins_by_22_plus: blowoutWin,
        blowout_losses_by_22_plus: blowoutLoss
      };
      // Global = the user's career total across every league (all games, including CPU), mirroring
      // the per-league season/league records. Head-to-head matchup records (user-vs-user only) are
      // tracked separately in rec_user_h2h_global_records below. Log failures rather than swallowing
      // them — a silently-swallowed missing-column error is exactly what kept these tables at 0.
      await incrementRecord("rec_global_user_records", { user_id: p.userId }, patch).catch(logIncrementFailure("rec_global_user_records"));
      await incrementRecord("rec_league_user_records", { league_id: context.league_id, user_id: p.userId }, patch).catch(logIncrementFailure("rec_league_user_records"));
      await incrementRecord("rec_season_user_records", { league_id: context.league_id, season_number: seasonNumber, user_id: p.userId }, patch).catch(logIncrementFailure("rec_season_user_records"));
    }
    if (isH2H) {
      const ids = [game.home_user_id, game.away_user_id].sort();
      const userAIsHome = ids[0] === game.home_user_id;
      const userAPd = userAIsHome ? home - away : away - home;
      const userAResult = { wins: userAPd > 0 ? 1 : 0, losses: userAPd < 0 ? 1 : 0, ties: userAPd === 0 ? 1 : 0, pointDifferential: userAPd };
      await incrementH2h("rec_user_h2h_global_records", { user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
      await incrementH2h("rec_user_h2h_league_records", { league_id: context.league_id, user_a_id: ids[0], user_b_id: ids[1] }, userAResult);

      // GOTW head-to-head: only count games that were the selected Game of the Week.
      const gotwKey = `${game.week_number}:${[game.home_team_id, game.away_team_id].sort().join("-")}`;
      if (gotwKeys.has(gotwKey)) {
        const homeRes = home > away ? "win" : home < away ? "loss" : "tie";
        const awayRes = away > home ? "win" : away < home ? "loss" : "tie";
        await incrementGotwH2h(game.home_user_id, homeRes).catch(() => undefined);
        await incrementGotwH2h(game.away_user_id, awayRes).catch(() => undefined);
      }
    }
    await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: applyKey, updated_at: new Date().toISOString() }).eq("id", game.id);
    applied += 1;
  }
  return { applied };
}

export async function auditAndRepairRecords(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: seasonGames } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,is_tie,season_number,records_applied_at,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  const { data: allLeagueGames } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,is_tie,season_number,week_number")
    .eq("league_id", leagueId);

  const completed = (games: any[]) => games.filter(isCompletedGame);

  type UserStats = {
    wins: number; losses: number; ties: number; games_played: number;
    point_differential: number; points_for: number; points_against: number;
    close_games_within_7: number; blowout_wins_by_22_plus: number; blowout_losses_by_22_plus: number;
  };

  function freshStats(): UserStats {
    return { wins: 0, losses: 0, ties: 0, games_played: 0, point_differential: 0, points_for: 0, points_against: 0, close_games_within_7: 0, blowout_wins_by_22_plus: 0, blowout_losses_by_22_plus: 0 };
  }

  function accumulate(acc: UserStats, score: number, oppScore: number) {
    const delta = score - oppScore;
    acc.games_played += 1;
    acc.points_for += score;
    acc.points_against += oppScore;
    acc.point_differential += delta;
    if (delta > 0) { acc.wins += 1; if (delta >= 22) acc.blowout_wins_by_22_plus += 1; if (delta <= 7) acc.close_games_within_7 += 1; }
    else if (delta < 0) { acc.losses += 1; if (delta <= -22) acc.blowout_losses_by_22_plus += 1; }
    else acc.ties += 1;
  }

  const seasonTotals = new Map<string, UserStats>();
  for (const g of completed(seasonGames ?? [])) {
    const { home, away } = getScorePair(g);
    if (g.home_user_id) { if (!seasonTotals.has(g.home_user_id)) seasonTotals.set(g.home_user_id, freshStats()); accumulate(seasonTotals.get(g.home_user_id)!, home, away); }
    if (g.away_user_id) { if (!seasonTotals.has(g.away_user_id)) seasonTotals.set(g.away_user_id, freshStats()); accumulate(seasonTotals.get(g.away_user_id)!, away, home); }
  }

  const leagueTotals = new Map<string, UserStats>();
  for (const g of completed(allLeagueGames ?? [])) {
    const { home, away } = getScorePair(g);
    if (g.home_user_id) { if (!leagueTotals.has(g.home_user_id)) leagueTotals.set(g.home_user_id, freshStats()); accumulate(leagueTotals.get(g.home_user_id)!, home, away); }
    if (g.away_user_id) { if (!leagueTotals.has(g.away_user_id)) leagueTotals.set(g.away_user_id, freshStats()); accumulate(leagueTotals.get(g.away_user_id)!, away, home); }
  }

  for (const [userId, stats] of seasonTotals) {
    try {
      const gp = stats.games_played;
      await supabase.from("rec_season_user_records").upsert(
        { ...stats, user_id: userId, league_id: leagueId, season_number: seasonNumber, avg_point_differential: gp ? stats.point_differential / gp : 0, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id,season_number" }
      );
    } catch { /* non-fatal */ }
  }

  for (const [userId, stats] of leagueTotals) {
    try {
      const gp = stats.games_played;
      await supabase.from("rec_league_user_records").upsert(
        { ...stats, user_id: userId, league_id: leagueId, avg_point_differential: gp ? stats.point_differential / gp : 0, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id" }
      );
    } catch { /* non-fatal */ }
  }

  type H2HStats = { wins: number; losses: number; ties: number; games_played: number; point_differential: number };
  const h2hTotals = new Map<string, H2HStats>();
  const h2hKey = (a: string, b: string) => [a, b].sort().join(":::");

  for (const g of completed(allLeagueGames ?? [])) {
    if (!g.home_user_id || !g.away_user_id) continue;
    const { home, away } = getScorePair(g);
    const ids = [g.home_user_id, g.away_user_id].sort() as [string, string];
    const key = h2hKey(ids[0], ids[1]);
    if (!h2hTotals.has(key)) h2hTotals.set(key, { wins: 0, losses: 0, ties: 0, games_played: 0, point_differential: 0 });
    const rec = h2hTotals.get(key)!;
    const userAIsHome = ids[0] === g.home_user_id;
    const userAPd = userAIsHome ? home - away : away - home;
    rec.games_played += 1;
    rec.point_differential += userAPd;
    if (userAPd > 0) rec.wins += 1;
    else if (userAPd < 0) rec.losses += 1;
    else rec.ties += 1;
  }

  for (const [key, stats] of h2hTotals) {
    const [userAId, userBId] = key.split(":::");
    try {
      const gp = stats.games_played;
      await supabase.from("rec_user_h2h_league_records").upsert(
        {
          user_a_wins: stats.wins, user_a_losses: stats.losses, user_a_ties: stats.ties,
          user_a_point_differential: stats.point_differential, games_played: gp,
          avg_user_a_point_differential: gp ? stats.point_differential / gp : 0,
          user_a_id: userAId, user_b_id: userBId, league_id: leagueId, updated_at: new Date().toISOString()
        },
        { onConflict: "user_a_id,user_b_id,league_id" }
      );
    } catch { /* non-fatal */ }
  }

  // Global = each user's legacy career baseline plus ALL of their live REC games across every league
  // (not just head-to-head). Recompute the absolute value so the repair is idempotent and self-
  // correcting. Head-to-head matchup records (rec_user_h2h_global_records) still count only
  // user-vs-user games.
  const playerUserIds = new Set<string>();
  for (const g of completed(allLeagueGames ?? [])) {
    if (g.home_user_id) playerUserIds.add(g.home_user_id);
    if (g.away_user_id) playerUserIds.add(g.away_user_id);
  }

  let globalUsersRepaired = 0;
  let globalH2hPairsRepaired = 0;
  if (playerUserIds.size > 0) {
    const userIdArray = [...playerUserIds];
    const orFilter = userIdArray.map((id) => `home_user_id.eq.${id}`).concat(userIdArray.map((id) => `away_user_id.eq.${id}`)).join(",");
    // Every game these users played across all leagues (career total), not league-scoped.
    const { data: allUserGames } = await supabase
      .from("rec_game_results")
      .select("home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,is_tie")
      .or(orFilter);

    const globalTotals = new Map<string, UserStats>();
    const h2hGlobalTotals = new Map<string, H2HStats>();
    for (const g of completed(allUserGames ?? [])) {
      const { home, away } = getScorePair(g);
      if (g.home_user_id && playerUserIds.has(g.home_user_id)) { if (!globalTotals.has(g.home_user_id)) globalTotals.set(g.home_user_id, freshStats()); accumulate(globalTotals.get(g.home_user_id)!, home, away); }
      if (g.away_user_id && playerUserIds.has(g.away_user_id)) { if (!globalTotals.has(g.away_user_id)) globalTotals.set(g.away_user_id, freshStats()); accumulate(globalTotals.get(g.away_user_id)!, away, home); }
      // Head-to-head matchup records only count user-vs-user games.
      if (g.home_user_id && g.away_user_id) {
        const ids = [g.home_user_id, g.away_user_id].sort() as [string, string];
        const key = h2hKey(ids[0], ids[1]);
        if (!h2hGlobalTotals.has(key)) h2hGlobalTotals.set(key, { wins: 0, losses: 0, ties: 0, games_played: 0, point_differential: 0 });
        const rec = h2hGlobalTotals.get(key)!;
        const userAIsHome = ids[0] === g.home_user_id;
        const userAPd = userAIsHome ? home - away : away - home;
        rec.games_played += 1;
        rec.point_differential += userAPd;
        if (userAPd > 0) rec.wins += 1;
        else if (userAPd < 0) rec.losses += 1;
        else rec.ties += 1;
      }
    }

    // Pre-REC career history lives in rec_legacy_user_baselines.global_record and is added on top.
    const { data: baselines } = await supabase
      .from("rec_legacy_user_baselines")
      .select("user_id, global_record")
      .in("user_id", [...globalTotals.keys()]);
    const legacyByUser = new Map<string, any>();
    for (const b of baselines ?? []) legacyByUser.set(String(b.user_id), (b as any).global_record ?? {});

    for (const [userId, stats] of globalTotals) {
      try {
        const legacy = legacyByUser.get(userId) ?? {};
        const legacyGames = asNumber(legacy.wins) + asNumber(legacy.losses) + asNumber(legacy.ties);
        const wins = stats.wins + asNumber(legacy.wins);
        const losses = stats.losses + asNumber(legacy.losses);
        const ties = stats.ties + asNumber(legacy.ties);
        const pointDifferential = stats.point_differential + asNumber(legacy.point_differential);
        const gamesPlayed = stats.games_played + legacyGames;
        await supabase.from("rec_global_user_records").upsert(
          {
            user_id: userId,
            wins, losses, ties,
            games_played: gamesPlayed,
            point_differential: pointDifferential,
            points_for: stats.points_for,
            points_against: stats.points_against,
            close_games_within_7: stats.close_games_within_7,
            blowout_wins_by_22_plus: stats.blowout_wins_by_22_plus,
            blowout_losses_by_22_plus: stats.blowout_losses_by_22_plus,
            playoff_wins: asNumber(legacy.playoff_wins),
            playoff_losses: asNumber(legacy.playoff_losses),
            superbowl_wins: asNumber(legacy.superbowl_wins),
            superbowl_losses: asNumber(legacy.superbowl_losses),
            avg_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0,
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_id" }
        );
        globalUsersRepaired += 1;
      } catch { /* non-fatal */ }
    }

    for (const [key, stats] of h2hGlobalTotals) {
      const [userAId, userBId] = key.split(":::");
      try {
        const gp = stats.games_played;
        await supabase.from("rec_user_h2h_global_records").upsert(
          {
            user_a_wins: stats.wins, user_a_losses: stats.losses, user_a_ties: stats.ties,
            user_a_point_differential: stats.point_differential, games_played: gp,
            avg_user_a_point_differential: gp ? stats.point_differential / gp : 0,
            user_a_id: userAId, user_b_id: userBId, updated_at: new Date().toISOString()
          },
          { onConflict: "user_a_id,user_b_id" }
        );
        globalH2hPairsRepaired += 1;
      } catch { /* non-fatal */ }
    }
  }

  const unapplied = (seasonGames ?? []).filter((g) => isCompletedGame(g) && !g.records_applied_at);
  for (const g of unapplied) {
    try {
      await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: gameApplyKey(g), updated_at: new Date().toISOString() }).eq("id", g.id);
    } catch { /* non-fatal */ }
  }

  return {
    seasonRecordsRepaired: seasonTotals.size,
    leagueRecordsRepaired: leagueTotals.size,
    h2hPairsRepaired: h2hTotals.size,
    globalUsersRepaired,
    globalH2hPairsRepaired,
    gamesMarkedApplied: unapplied.length
  };
}
