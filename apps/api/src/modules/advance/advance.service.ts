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

function formatAdvanceTimes(nextAdvanceAt?: string | null) {
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

export async function viewLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { league: context.rec_leagues, server: context.rec_discord_servers };
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
  return { league: data };
}

export async function viewEconomyConfig(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { routes: await getRoutes(context.server_id), league: context.rec_leagues };
}

export async function setEconomyConfig(input: { guildId: string; pendingEconomyChannelId?: string; gameChannelsCategoryId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = { server_id: context.server_id, updated_at: new Date().toISOString() };
  if (input.pendingEconomyChannelId !== undefined) patch.pending_economy_channel_id = input.pendingEconomyChannelId;
  if (input.gameChannelsCategoryId !== undefined) patch.game_channels_category_id = input.gameChannelsCategoryId;
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
  return { reminder: data };
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

export async function runPostAdvanceAutomation(guildId: string) {
  await calculateRecPotw(guildId);
  await generateWeeklyChallenges({ guildId, regenerate: false });
  const gameChannels = await getGameChannelPlans(guildId);
  const dmPayloads = await buildAdvanceDmPayloads(guildId);
  return { ok: true, gameChannels, dmPayloads };
}
