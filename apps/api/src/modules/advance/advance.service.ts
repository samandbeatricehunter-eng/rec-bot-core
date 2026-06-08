import { REC_POTW_PAYOUT_AMOUNT, calculateDefensivePotwScore, calculateOffensivePotwScore } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const TIME_ZONES = [
  ["EST", "America/New_York"],
  ["CST", "America/Chicago"],
  ["PST", "America/Los_Angeles"],
  ["AKST", "America/Anchorage"]
] as const;

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickStat(stats: any, keys: string[]) {
  for (const key of keys) {
    if (stats?.[key] !== undefined && stats?.[key] !== null) return asNumber(stats[key]);
  }
  return 0;
}

export function formatAdvanceTimes(nextAdvanceAt?: string | null) {
  if (!nextAdvanceAt) return [];
  const date = new Date(nextAdvanceAt);
  if (Number.isNaN(date.getTime())) return [];
  return TIME_ZONES.map(([label, timeZone]) => ({
    label,
    value: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short"
    }).format(date)
  }));
}

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "game";
}

async function getLeagueContext(guildId: string) {
  const { data, error } = await supabase
    .from("rec_server_league_links")
    .select("server_id, league_id, rec_discord_servers(name,guild_id), rec_leagues(*)")
    .eq("rec_discord_servers.guild_id", guildId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No league linked to this Discord server.");
  return data as any;
}

async function getRoutes(serverId: string) {
  const { data, error } = await supabase.from("rec_server_routes").select("*").eq("server_id", serverId).maybeSingle();
  if (error) throw error;
  return data as any;
}


function nowIso() {
  return new Date().toISOString();
}

function deadlineDisplay(date: Date) {
  return Object.fromEntries(formatAdvanceTimes(date.toISOString()).map((time) => [time.label, time.value]));
}

async function getDiscordIdForUserId(userId?: string | null) {
  if (!userId) return null;
  const { data } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  return data?.discord_id ?? null;
}

async function getLinkedActiveTeamUsers(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id,rec_teams(id,name,abbreviation,conference,division)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function viewLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { league: context.rec_leagues, server: context.rec_discord_servers };
}

async function getLeagueFeatureSettings(leagueId: string) {
  const { data, error } = await supabase.from("rec_league_feature_settings").select("*").eq("league_id", leagueId).maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function setLeagueWeek(input: { guildId: string; seasonNumber?: number; weekNumber: number; seasonStage: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    current_phase: input.seasonStage === "regular_season" ? "regular_season" : input.seasonStage === "offseason" ? "offseason" : "playoffs",
    updated_at: new Date().toISOString()
  };
  if (input.seasonNumber) patch.season_number = input.seasonNumber;
  const { data, error } = await supabase.from("rec_leagues").update(patch).eq("id", context.league_id).select("*").single();
  if (error) throw error;
  const features = await getLeagueFeatureSettings(context.league_id);
  const economyEnabled = Boolean(features?.coin_economy_enabled);
  const warning = economyEnabled
    ? "Economy is active. Setting the week manually does not trigger payouts for previous weeks. To catch up prior weeks, import and advance each week using catch-up mode."
    : null;
  return { league: data, warning, economyEnabled };
}

export async function viewEconomyConfig(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { routes: await getRoutes(context.server_id), league: context.rec_leagues };
}

export async function setEconomyConfig(input: { guildId: string; pendingEconomyChannelId?: string; gameChannelsCategoryId?: string; commissionerOfficeChannelId?: string; streamsChannelId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = { server_id: context.server_id, updated_at: new Date().toISOString() };
  if (input.pendingEconomyChannelId !== undefined) patch.pending_economy_channel_id = input.pendingEconomyChannelId;
  if (input.gameChannelsCategoryId !== undefined) patch.game_channels_category_id = input.gameChannelsCategoryId;
  if (input.commissionerOfficeChannelId !== undefined) patch.commissioner_office_channel_id = input.commissionerOfficeChannelId;
  if (input.streamsChannelId !== undefined) patch.streams_channel_id = input.streamsChannelId;
  const existing = await getRoutes(context.server_id);
  const query = existing
    ? supabase.from("rec_server_routes").update(patch).eq("server_id", context.server_id)
    : supabase.from("rec_server_routes").insert(patch);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return { routes: data };
}

export async function clearPendingEosBatch(input: { guildId: string; clearReason: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: batch, error } = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.league_id)
    .in("status", ["draft", "posted", "partially_approved", "approved", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!batch) return { cleared: false, reason: "No pending EOS batch found." };
  await supabase.from("rec_eos_payout_items").update({ status: "voided", updated_at: new Date().toISOString() }).eq("batch_id", batch.id).eq("status", "pending");
  const { data: updated, error: updateError } = await supabase
    .from("rec_eos_payout_batches")
    .update({ status: "cleared", clear_reason: input.clearReason, cleared_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return { cleared: true, batch: updated };
}

async function getWeekGames(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (error) throw error;
  return (data ?? []) as any[];
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
  const rows: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id, opponentUserId: game.away_user_id, location: "home" },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id, opponentUserId: game.home_user_id, location: "away" }
    ].filter((side) => side.userId && side.teamId);
    for (const side of sides) {
      rows.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, challenge_side: "offense", challenge_key: "fallback_pass_yards", target_type: "team", s_tier_goal: "Throw for 350+ yards and win", a_tier_goal: "Throw for 250+ yards and win", b_tier_goal: "Win the game" });
      rows.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, challenge_side: "defense", challenge_key: "fallback_hold_qb", target_type: "player", target_player_name: "Opponent QB", target_player_position: "QB", s_tier_goal: "Hold opponent QB under 225 passing yards and win", a_tier_goal: "Hold opponent QB under 275 passing yards and win", b_tier_goal: "Win the game" });
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("rec_weekly_challenges").upsert(rows, { onConflict: "league_id,season_number,week_number,user_id,challenge_side", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { generated: rows.length, weekNumber, seasonNumber };
}

export async function getChallengeAudit(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const weekNumber = league.current_week ?? 1;
  const { data, error } = await supabase
    .from("rec_weekly_challenges")
    .select("*, rec_users(display_name), rec_teams(name,abbreviation)")
    .eq("league_id", context.league_id)
    .gte("week_number", Math.max(1, weekNumber - 2))
    .order("week_number", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { challenges: data ?? [] };
}

export async function getGameChannelPlans(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const advanceTimes = formatAdvanceTimes(league.next_advance_at);
  const plans = games.filter((g) => g.home_user_id && g.away_user_id).map((game) => ({
    leagueId: context.league_id,
    seasonNumber,
    weekNumber,
    gameId: game.id,
    channelName: slug(`${game.away_team?.name ?? "away"}-vs-${game.home_team?.name ?? "home"}`),
    awayTeamId: game.away_team_id,
    homeTeamId: game.home_team_id,
    awayTeamName: game.away_team?.name ?? "Away Team",
    homeTeamName: game.home_team?.name ?? "Home Team",
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    categoryId: routes?.game_channels_category_id ?? null,
    nextAdvanceTimes: advanceTimes,
    streamingRequired: false,
    streamingRequirement: "Based on league settings",
    fourthDownRules: "Use league settings.",
    schedulingRules: "Scheduling, Activity & Sportsmanship rules apply."
  }));
  return { plans, routes, league, server: context.rec_discord_servers };
}

export async function getActiveGameChannels(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("status", "active");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannel(input: any) {
  const { data, error } = await supabase.from("rec_game_channels").upsert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    game_id: input.gameId,
    discord_channel_id: input.discordChannelId,
    away_team_id: input.awayTeamId,
    home_team_id: input.homeTeamId,
    away_user_id: input.awayUserId,
    home_user_id: input.homeUserId,
    status: "active",
    updated_at: new Date().toISOString()
  }, { onConflict: "discord_channel_id" }).select("*").single();
  if (error) throw error;
  return { channel: data };
}

export async function markGameChannelDeleted(input: { discordChannelId: string }) {
  const { data, error } = await supabase.from("rec_game_channels").update({ status: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("discord_channel_id", input.discordChannelId).select("*");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannelCheckin(input: { discordChannelId: string; discordUserId: string }) {
  const { data: channel, error } = await supabase.from("rec_game_channels").select("*").eq("discord_channel_id", input.discordChannelId).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!channel) return { recorded: false };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordUserId).maybeSingle();
  const existing = await supabase.from("rec_game_channel_checkins").select("*").eq("game_channel_id", channel.id).eq("discord_user_id", input.discordUserId).maybeSingle();
  if (existing.data) {
    await supabase.from("rec_game_channel_checkins").update({ last_message_at: new Date().toISOString(), message_count: (existing.data.message_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
  } else {
    await supabase.from("rec_game_channel_checkins").insert({ game_channel_id: channel.id, league_id: channel.league_id, season_number: channel.season_number, week_number: channel.week_number, discord_channel_id: input.discordChannelId, discord_user_id: input.discordUserId, user_id: discord?.user_id ?? null });
  }
  return { recorded: true };
}

export async function getReminderState(guildId: string) {
  const active = await getActiveGameChannels(guildId);
  const ids = active.channels.map((c: any) => c.id);
  if (!ids.length) return { channels: [] };
  const { data: checkins } = await supabase.from("rec_game_channel_checkins").select("*").in("game_channel_id", ids);
  const { data: reminders } = await supabase.from("rec_game_channel_reminders").select("*").in("game_channel_id", ids);
  return { channels: active.channels, checkins: checkins ?? [], reminders: reminders ?? [] };
}

export async function recordReminder(input: { gameChannelId: string; reminderType: string; targetUserId?: string | null; status?: string; details?: any }) {
  const { data, error } = await supabase.from("rec_game_channel_reminders").upsert({ game_channel_id: input.gameChannelId, reminder_type: input.reminderType, target_user_id: input.targetUserId ?? null, status: input.status ?? "sent", details: input.details ?? {} }, { onConflict: "game_channel_id,reminder_type,target_user_id" }).select("*").single();
  if (error) throw error;

  if (input.reminderType === "twelve_hour" && input.details?.missingUserIds?.length) {
    const { data: channel } = await supabase.from("rec_game_channels").select("*").eq("id", input.gameChannelId).maybeSingle();
    if (channel) {
      const rows = input.details.missingUserIds.map((userId: string) => ({
        league_id: channel.league_id,
        season_number: channel.season_number,
        week_number: channel.week_number,
        game_channel_id: input.gameChannelId,
        game_id: channel.game_id,
        user_id: userId,
        penalty_type: "no_12_hour_checkin",
        details: input.details ?? {},
        created_at: nowIso()
      }));
      if (rows.length) await supabase.from("rec_game_channel_activity_penalties").insert(rows);
    }
  }

  return { reminder: data };
}


function getScorePair(game: any) {
  const home = asNumber(game.home_score);
  const away = asNumber(game.away_score);
  return { home, away };
}

function isCompletedGame(game: any) {
  const { home, away } = getScorePair(game);
  return game.status === "final" || game.status === "completed" || home > 0 || away > 0 || game.is_tie || game.winning_user_id || game.losing_user_id;
}

function gameApplyKey(game: any) {
  return [game.league_id, game.season_number, game.week_number, game.external_game_id ?? game.id].join(":");
}

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
  let applied = 0;
  for (const game of games ?? []) {
    if (!isCompletedGame(game)) continue;
    const applyKey = gameApplyKey(game);
    const { home, away } = getScorePair(game);
    const participants = [
      { userId: game.home_user_id, teamId: game.home_team_id, score: home, oppScore: away },
      { userId: game.away_user_id, teamId: game.away_team_id, score: away, oppScore: home }
    ].filter((p) => p.userId);
    for (const p of participants) {
      const win = p.score > p.oppScore ? 1 : 0;
      const loss = p.score < p.oppScore ? 1 : 0;
      const tie = p.score === p.oppScore ? 1 : 0;
      const delta = p.score - p.oppScore;
      const patch = { wins: win, losses: loss, ties: tie, games_played: 1, point_differential: delta };
      await incrementRecord("rec_global_user_records", { user_id: p.userId }, patch).catch(() => undefined);
      await incrementRecord("rec_league_user_records", { league_id: context.league_id, user_id: p.userId }, patch).catch(() => undefined);
      await incrementRecord("rec_season_user_records", { league_id: context.league_id, season_number: seasonNumber, user_id: p.userId }, patch).catch(() => undefined);
    }
    if (game.home_user_id && game.away_user_id) {
      const ids = [game.home_user_id, game.away_user_id].sort();
      const userAIsHome = ids[0] === game.home_user_id;
      const userAPd = userAIsHome ? home - away : away - home;
      const userAResult = { wins: userAPd > 0 ? 1 : 0, losses: userAPd < 0 ? 1 : 0, ties: userAPd === 0 ? 1 : 0, pointDifferential: userAPd };
      await incrementH2h("rec_user_h2h_global_records", { user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
      await incrementH2h("rec_user_h2h_league_records", { league_id: context.league_id, user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
    }
    await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: applyKey, updated_at: new Date().toISOString() }).eq("id", game.id);
    applied += 1;
  }
  return { applied };
}

export async function calculateRecPotw(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: assignments, error: assignmentError } = await supabase.from("rec_team_assignments").select("team_id,user_id,rec_teams(conference)").eq("league_id", context.league_id).eq("assignment_status", "active").is("ended_at", null);
  if (assignmentError) throw assignmentError;
  const eligible = new Map((assignments ?? []).map((a: any) => [a.team_id, a]));
  const { data: statsRows, error } = await supabase.from("rec_import_staging_player_stats").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber);
  if (error) throw error;
  const candidates: any[] = [];
  for (const row of statsRows ?? []) {
    const stats = row.stats ?? row.raw_payload ?? {};
    const teamExternal = String(stats.teamId ?? row.team_external_id ?? "");
    const assignment = [...eligible.values()].find((a: any) => String(a.team_id) === String(row.team_id) || String(a.team_id) === teamExternal);
    if (!assignment) continue;
    const conference = assignment.rec_teams?.conference ?? "Unknown";
    const position = row.position ?? stats.position ?? null;
    const offensiveScore = calculateOffensivePotwScore({ position, passYds: pickStat(stats, ["passYds"]), passTDs: pickStat(stats, ["passTDs"]), passInts: pickStat(stats, ["passInts"]), rushYds: pickStat(stats, ["rushYds"]), rushTDs: pickStat(stats, ["rushTDs"]), recYds: pickStat(stats, ["recYds", "receivingYds"]), recTDs: pickStat(stats, ["recTDs", "receivingTDs"]), receptions: pickStat(stats, ["receptions", "recCatches"]) });
    const defensiveScore = calculateDefensivePotwScore({ sacks: pickStat(stats, ["defSacks", "sacks"]), ints: pickStat(stats, ["defInts", "ints"]), defensiveTDs: pickStat(stats, ["defTDs", "defensiveTDs"]), forcedFumbles: pickStat(stats, ["forcedFumbles", "ffum"]), tackles: pickStat(stats, ["tackles", "defTotalTackles"]), tacklesForLoss: pickStat(stats, ["tacklesForLoss", "tfl"]) });
    candidates.push({ row, assignment, conference, position, offensiveScore, defensiveScore });
  }
  const awards: any[] = [];
  for (const conference of [...new Set(candidates.map((c) => c.conference))]) {
    const group = candidates.filter((c) => c.conference === conference);
    const offense = group.sort((a, b) => b.offensiveScore - a.offensiveScore)[0];
    const defense = group.sort((a, b) => b.defensiveScore - a.defensiveScore)[0];
    for (const [side, winner, score] of [["offense", offense, offense?.offensiveScore], ["defense", defense, defense?.defensiveScore]] as const) {
      if (!winner || !score || score <= 0) continue;
      awards.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, conference, award_side: side, award_source: "rec_calculated", player_external_id: String(winner.row.player_external_id ?? winner.row.external_player_id ?? winner.row.rosterId ?? ""), player_name: winner.row.player_name ?? winner.row.player_display_name ?? winner.row.raw_payload?.fullName ?? "Unknown Player", position: winner.position, team_id: winner.assignment.team_id, user_id: winner.assignment.user_id, score, payout_amount: REC_POTW_PAYOUT_AMOUNT, raw_payload: winner.row.raw_payload ?? {} });
    }
  }
  if (awards.length) await supabase.from("rec_weekly_player_awards").upsert(awards, { onConflict: "league_id,season_number,week_number,conference,award_side,award_source" });
  return { awards };
}

export async function buildAdvanceDmPayloads(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const { data: challenges } = await supabase.from("rec_weekly_challenges").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const { data: channels } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const { data: awards } = await supabase.from("rec_weekly_player_awards").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", Math.max(1, weekNumber - 1));
  const { data: discordAccounts } = await supabase.from("rec_discord_accounts").select("user_id,discord_id");
  const discordByUser = new Map((discordAccounts ?? []).map((d: any) => [d.user_id, d.discord_id]));
  const payloads: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeam: game.away_team?.name ?? "Opponent", location: "Home", opponentUserId: game.away_user_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeam: game.home_team?.name ?? "Opponent", location: "Away", opponentUserId: game.home_user_id }
    ].filter((s) => s.userId);
    for (const side of sides) {
      const gameChannel = (channels ?? []).find((c: any) => c.game_id === game.id);
      payloads.push({
        userId: side.userId,
        discordId: discordByUser.get(side.userId),
        leagueName: league.name,
        serverName: context.rec_discord_servers?.name ?? "",
        seasonNumber,
        weekNumber,
        seasonStage: league.season_stage,
        nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at),
        matchup: { opponent: side.opponentTeam, location: side.location, gameType: side.opponentUserId ? "User H2H" : "CPU", gameChannelId: gameChannel?.discord_channel_id ?? null },
        streaming: { required: false, requirement: "Based on league settings" },
        challenges: (challenges ?? []).filter((c: any) => c.user_id === side.userId),
        payouts: [],
        potwAwards: (awards ?? []).filter((a: any) => a.user_id === side.userId).map((a: any) => ({ label: `${a.conference} ${a.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW`, playerName: a.player_name, amount: a.payout_amount ?? REC_POTW_PAYOUT_AMOUNT })),
        gotw: { isParticipant: false, message: "Go to /menu to vote for the H2H GOTW winner. Correct guesses may earn a payout." },
        deadlines: []
      });
    }
  }
  return { payloads };
}

export async function runPostAdvanceAutomation(input: string | { guildId: string; mode?: "normal" | "catch_up" }) {
  const guildId = typeof input === "string" ? input : input.guildId;
  const mode = typeof input === "string" ? "normal" : input.mode ?? "normal";
  await applyAdvanceRecords(guildId);
  await settleGotwVotes(guildId);
  await calculateRecPotw(guildId);
  await generateWeeklyChallenges({ guildId, regenerate: false });

  if (mode === "catch_up") {
    return {
      ok: true,
      mode,
      gameChannels: { plans: [] },
      dmPayloads: { payloads: [] },
      skipped: ["advance_dms", "gotw_scheduling", "game_channel_recreation"]
    };
  }

  const gameChannels = await getGameChannelPlans(guildId);
  const dmPayloads = await buildAdvanceDmPayloads(guildId);
  return { ok: true, mode, gameChannels, dmPayloads };
}

export async function getGotwCandidates(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = league.season_stage ?? league.current_phase ?? "regular_season";
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const h2hGames = games.filter((game) => game.home_user_id && game.away_user_id);
  const previousWeek = Math.max(1, weekNumber - 1);
  const { data: previousGotw } = await supabase
    .from("rec_game_of_week_candidates")
    .select("away_user_id,home_user_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", previousWeek)
    .eq("is_selected", true);
  const previousUsers = new Set((previousGotw ?? []).flatMap((row: any) => [row.away_user_id, row.home_user_id]).filter(Boolean));
  const rows = h2hGames.map((game) => {
    const previousGotwUserFlag = previousUsers.has(game.away_user_id) || previousUsers.has(game.home_user_id);
    const isDivisionGame = Boolean(game.away_team?.division && game.home_team?.division && game.away_team.division === game.home_team.division);
    const impactModifier = (isDivisionGame ? 3 : 0) + (previousGotwUserFlag ? -3 : 0);
    const strengthRating = 50 + impactModifier;
    return {
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: game.id,
      stage,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      matchup_title: `${game.away_team?.name ?? "Away Team"} vs ${game.home_team?.name ?? "Home Team"}`,
      strength_rating: strengthRating,
      rating_breakdown: { isDivisionGame, previousGotwUserFlag, note: "Initial GOTW formula. SOS/power-ranking modifiers can be layered in once available." },
      previous_gotw_user_flag: previousGotwUserFlag,
      impact_modifier: impactModifier,
      is_selected: false,
      selection_source: "admin_select"
    };
  });
  if (rows.length) {
    const { error } = await supabase.from("rec_game_of_week_candidates").upsert(rows, { onConflict: "league_id,season_number,week_number,game_id" });
    if (error) throw error;
  }
  const { data, error } = await supabase
    .from("rec_game_of_week_candidates")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .order("strength_rating", { ascending: false });
  if (error) throw error;
  return { candidates: data ?? [], league, stage, seasonNumber, weekNumber };
}

function gotwQuestion(stage: string, weekNumber: number) {
  if (stage === "wild_card") return "Who will win their Wild Card matchup?";
  if (stage === "divisional") return "Who will win their Divisional matchup?";
  if (stage === "conference_championship") return "Who will win their Conference matchup?";
  if (stage === "super_bowl") return "Who will win this year's Super Bowl?";
  return `Who will win Week ${weekNumber}'s GOTW?`;
}

export async function selectGotwCandidate(input: { guildId: string; candidateId: string; selectedByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: candidate, error } = await supabase.from("rec_game_of_week_candidates").select("*").eq("id", input.candidateId).single();
  if (error) throw error;
  await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq("league_id", candidate.league_id)
    .eq("season_number", candidate.season_number)
    .eq("week_number", candidate.week_number);
  const { data: selected, error: updateError } = await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: true, selected_by_discord_id: input.selectedByDiscordId, selected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.candidateId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  const question = gotwQuestion(selected.stage, selected.week_number);
  const { data: poll, error: pollError } = await supabase.from("rec_game_of_week_polls").upsert({
    league_id: selected.league_id,
    season_number: selected.season_number,
    week_number: selected.week_number,
    stage: selected.stage,
    game_id: selected.game_id,
    candidate_id: selected.id,
    question,
    away_team_id: selected.away_team_id,
    home_team_id: selected.home_team_id,
    away_team_name: selected.away_team_name,
    home_team_name: selected.home_team_name,
    status: "open",
    poll_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    away_user_id: selected.away_user_id,
    home_user_id: selected.home_user_id,
    vote_deadline_display: Object.fromEntries(formatAdvanceTimes(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()).map((t) => [t.label, t.value])),
    updated_at: new Date().toISOString()
  }, { onConflict: "league_id,season_number,week_number,game_id" }).select("*").single();
  if (pollError) throw pollError;
  const routes = await getRoutes(context.server_id);
  return { candidate: selected, poll, routes, channelId: routes?.announcements_channel_id ?? null };
}

export async function recordGotwPollMessage(input: { pollId: string; discordChannelId: string; discordMessageId?: string | null; discordThreadId?: string | null }) {
  const { data, error } = await supabase.from("rec_game_of_week_polls").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId ?? null, discord_thread_id: input.discordThreadId ?? null, updated_at: new Date().toISOString() }).eq("id", input.pollId).select("*").single();
  if (error) throw error;
  return { poll: data };
}

export async function recordGotwVote(input: { pollId: string; discordId: string; selectedTeamId: string }) {
  const { data: poll, error } = await supabase.from("rec_game_of_week_polls").select("*").eq("id", input.pollId).single();
  if (error) throw error;
  if (poll.status !== "open") return { recorded: false, reason: "Poll is closed.", poll };
  if (poll.poll_expires_at && new Date(poll.poll_expires_at).getTime() < Date.now()) return { recorded: false, reason: "Poll has expired.", poll };
  const selectedTeamName = String(input.selectedTeamId) === String(poll.away_team_id) ? poll.away_team_name : poll.home_team_name;
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const { data: vote, error: voteError } = await supabase.from("rec_game_of_week_votes").upsert({
    poll_id: input.pollId,
    league_id: poll.league_id,
    season_number: poll.season_number,
    week_number: poll.week_number,
    user_id: discord?.user_id ?? null,
    discord_id: input.discordId,
    selected_team_id: input.selectedTeamId,
    selected_team_name: selectedTeamName,
    voted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "poll_id,discord_id" }).select("*").single();
  if (voteError) throw voteError;
  const votes = await getGotwVotes(input.pollId);
  return { recorded: true, poll, vote, votes };
}

export async function getGotwVotes(pollId: string) {
  const { data: votes, error } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", pollId).order("voted_at", { ascending: true });
  if (error) throw error;
  return { votes: votes ?? [] };
}


export async function createActiveCheck(input: { guildId: string; createdByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("rec_active_check_events").insert({
    league_id: context.league_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    status: "open",
    discord_channel_id: routes?.announcements_channel_id ?? null,
    created_by_discord_id: input.createdByDiscordId,
    closes_at: closesAt,
    created_at: nowIso(),
    updated_at: nowIso()
  }).select("*").single();
  if (error) throw error;
  return { event: data, channelId: routes?.announcements_channel_id ?? null, deadlineDisplay: deadlineDisplay(new Date(closesAt)) };
}

export async function recordActiveCheckMessage(input: { eventId: string; discordChannelId: string; discordMessageId: string }) {
  const { data, error } = await supabase.from("rec_active_check_events").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId, updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (error) throw error;
  return { event: data };
}

export async function recordActiveCheckResponse(input: { eventId: string; discordId: string }) {
  const { data: event, error: eventError } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (eventError) throw eventError;
  if (event.status !== "open") return { recorded: false, reason: "Active Check is closed.", event };
  if (event.closes_at && new Date(event.closes_at).getTime() < Date.now()) return { recorded: false, reason: "Active Check has expired.", event };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC user profile.", event };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", event.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "You are not linked to an active team in this league.", event };
  const { data: response, error } = await supabase.from("rec_active_check_responses").upsert({
    event_id: input.eventId,
    league_id: event.league_id,
    user_id: discord.user_id,
    discord_id: input.discordId,
    team_id: assignment.team_id,
    responded_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  }, { onConflict: "event_id,user_id" }).select("*").single();
  if (error) throw error;
  return { recorded: true, event, response };
}

export async function getActiveCheckStatus(eventId: string) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", eventId).single();
  if (error) throw error;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("*").eq("event_id", eventId).order("responded_at", { ascending: true });
  if (responseError) throw responseError;
  return { event, responses: responses ?? [] };
}

export async function closeActiveCheck(input: { eventId: string }) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (error) throw error;
  if (event.status !== "open") return { closed: false, event, missing: [] };
  const { data: linkedUsers, error: linkedError } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,rec_users(display_name),rec_discord_accounts(discord_id)")
    .eq("league_id", event.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (linkedError) throw linkedError;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("user_id").eq("event_id", input.eventId);
  if (responseError) throw responseError;
  const responded = new Set((responses ?? []).map((row: any) => row.user_id));
  const missing = (linkedUsers ?? []).filter((row: any) => !responded.has(row.user_id));
  if (missing.length) {
    await supabase.from("rec_active_check_misses").insert(missing.map((row: any) => ({
      event_id: input.eventId,
      league_id: event.league_id,
      user_id: row.user_id,
      team_id: row.team_id,
      missed_at: nowIso(),
      created_at: nowIso()
    })));
  }
  const { data: updated, error: updateError } = await supabase.from("rec_active_check_events").update({ status: "closed", closed_at: nowIso(), updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (updateError) throw updateError;
  const context = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", event.league_id).maybeSingle();
  const routes = context.data?.server_id ? await getRoutes(context.data.server_id) : null;
  const discordRows = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", missing.map((m: any) => m.user_id));
  const discordByUser = new Map((discordRows.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  return { closed: true, event: updated, missing: missing.map((row: any) => ({ ...row, discord_id: discordByUser.get(row.user_id) ?? null })), commissionerOfficeChannelId: routes?.commissioner_office_channel_id ?? routes?.admin_import_log_channel_id ?? null };
}

export async function getOpenActiveChecks(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_active_check_events").select("*").eq("league_id", context.league_id).eq("status", "open");
  if (error) throw error;
  return { events: data ?? [] };
}

export async function recordStreamPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.streams_channel_id || routes.streams_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_streams_channel" };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const row = {
    league_id: context.league_id,
    season_number: league.season_number ?? league.display_season_number ?? 1,
    week_number: league.current_week ?? 1,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? null,
    posted_at: nowIso(),
    status: "posted",
    details: {},
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const { data, error } = await supabase.from("rec_stream_compliance_logs").insert(row).select("*").single();
  if (error) throw error;
  return { recorded: true, log: data };
}

export async function settleGotwVotes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const currentWeek = league.current_week ?? 1;
  const { data: polls, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .lt("week_number", currentWeek)
    .in("status", ["open", "closed"]);
  if (error) throw error;
  const settled: any[] = [];
  for (const poll of polls ?? []) {
    const { data: game } = await supabase.from("rec_game_results").select("*").eq("league_id", poll.league_id).eq("season_number", poll.season_number).eq("week_number", poll.week_number).or(`external_game_id.eq.${poll.game_id},id.eq.${poll.game_id}`).maybeSingle();
    const winningTeamId = game?.winning_team_id ?? (asNumber(game?.home_score) > asNumber(game?.away_score) ? game?.home_team_id : asNumber(game?.away_score) > asNumber(game?.home_score) ? game?.away_team_id : null);
    if (!winningTeamId) continue;
    const { data: votes } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", poll.id);
    for (const vote of votes ?? []) {
      const isCorrect = String(vote.selected_team_id) === String(winningTeamId);
      let ledgerId = vote.paid_ledger_id;
      if (isCorrect && vote.user_id && !vote.paid_ledger_id) {
        const { data: ledger } = await supabase.from("rec_dollar_ledger").insert({
          user_id: vote.user_id,
          league_id: poll.league_id,
          amount: 10,
          transaction_type: "credit",
          description: `Correct GOTW pick - Week ${poll.week_number}`,
          source: "system_award",
          source_reference: { type: "gotw_correct_guess", pollId: poll.id, voteId: vote.id },
          created_at: nowIso()
        }).select("id").single();
        ledgerId = ledger?.id ?? null;
      }
      await supabase.from("rec_game_of_week_votes").update({ is_correct: isCorrect, payout_amount: isCorrect ? 10 : 0, paid_ledger_id: ledgerId ?? null, settled_at: nowIso(), updated_at: nowIso() }).eq("id", vote.id);
      if (vote.user_id) {
        const { data: existing } = await supabase.from("rec_global_gotw_guessing_records").select("*").eq("user_id", vote.user_id).maybeSingle();
        const patch = {
          user_id: vote.user_id,
          correct_guesses: asNumber(existing?.correct_guesses) + (isCorrect ? 1 : 0),
          wrong_guesses: asNumber(existing?.wrong_guesses) + (isCorrect ? 0 : 1),
          last_result_at: nowIso(),
          updated_at: nowIso()
        };
        if (existing) await supabase.from("rec_global_gotw_guessing_records").update(patch).eq("user_id", vote.user_id);
        else await supabase.from("rec_global_gotw_guessing_records").insert({ ...patch, created_at: nowIso() });
      }
    }
    await supabase.from("rec_game_of_week_polls").update({ status: "settled", winning_team_id: winningTeamId, settled_at: nowIso(), updated_at: nowIso() }).eq("id", poll.id);
    settled.push({ pollId: poll.id, winningTeamId, votes: votes?.length ?? 0 });
  }
  return { settled };
}
