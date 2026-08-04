import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";

const MAX_LEGS_PER_SIDE = 7;

type LegInput = { type: "player"; playerId: string } | { type: "pick"; draftPickId: string };

async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  return account.data?.user_id ?? null;
}

async function teamForUser(leagueId: string, userId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(403, "A linked league team is required to trade.");
  return String(assignment.data.team_id);
}

async function userForTeam(leagueId: string, teamId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("user_id")
    .eq("league_id", leagueId).eq("team_id", teamId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load that team's coach.", assignment.error);
  return assignment.data?.user_id ? String(assignment.data.user_id) : null;
}

async function walletBalance(userId: string) {
  const wallet = await supabase.from("rec_wallets").select("wallet_balance").eq("user_id", userId).maybeSingle();
  return Number(wallet.data?.wallet_balance ?? 0);
}

async function validateLegs(leagueId: string, teamId: string, legs: LegInput[]) {
  if (legs.length > MAX_LEGS_PER_SIDE) throw new ApiError(400, `A trade side can offer at most ${MAX_LEGS_PER_SIDE} players/picks.`);
  const playerIds = legs.filter((l) => l.type === "player").map((l: any) => l.playerId);
  const pickIds = legs.filter((l) => l.type === "pick").map((l: any) => l.draftPickId);
  if (playerIds.length) {
    const players = await supabase.from("rec_players").select("id,team_id,roster_status").eq("league_id", leagueId).in("id", playerIds);
    if (players.error) throw new ApiError(500, "Failed to validate players.", players.error);
    for (const id of playerIds) {
      const row = (players.data ?? []).find((p: any) => p.id === id);
      if (!row || row.team_id !== teamId || row.roster_status !== "active") throw new ApiError(400, "One of the offered players is no longer on that active roster.");
    }
  }
  if (pickIds.length) {
    const picks = await supabase.from("rec_draft_picks").select("id,current_team_id").eq("league_id", leagueId).in("id", pickIds);
    if (picks.error) throw new ApiError(500, "Failed to validate draft picks.", picks.error);
    for (const id of pickIds) {
      const row = (picks.data ?? []).find((p: any) => p.id === id);
      if (!row || row.current_team_id !== teamId) throw new ApiError(400, "One of the offered draft picks is no longer owned by that team.");
    }
  }
}

export async function proposeTrade(input: {
  guildId: string; discordId: string; receivingTeamId: string;
  offeredLegs: LegInput[]; requestedLegs: LegInput[]; offeredCoins: number; requestedCoins: number;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const userId = await userIdFromDiscord(input.discordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const proposingTeamId = await teamForUser(context.leagueId, userId);
  if (proposingTeamId === input.receivingTeamId) throw new ApiError(400, "You can't trade with your own team.");
  if (input.offeredCoins < 0 || input.requestedCoins < 0) throw new ApiError(400, "Coin amounts can't be negative.");

  const config = await supabase.from("rec_league_configuration").select("trade_approval_policy,cpu_trading_policy").eq("league_id", context.leagueId).maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load league trade settings.", config.error);
  const approvalPolicy = config.data?.trade_approval_policy ?? "competition_committee_review";
  const cpuPolicy = config.data?.cpu_trading_policy ?? "allowed";

  const receivingUserId = await userForTeam(context.leagueId, input.receivingTeamId);
  if (!receivingUserId) {
    if (cpuPolicy === "not_allowed") throw new ApiError(400, "This league does not allow trades with CPU-controlled teams.");
  }
  // A CPU-side trade always needs a human to review it even if the league otherwise allows
  // trades to auto-apply — there's no GM on the other side to have agreed to it.
  const effectivePolicy = !receivingUserId && approvalPolicy === "no_approval_required" ? "commissioner_review" : approvalPolicy;

  if (input.offeredCoins > 0 && (await walletBalance(userId)) < input.offeredCoins) {
    throw new ApiError(400, "You don't have enough coins to offer that amount.");
  }
  if (input.requestedCoins > 0 && receivingUserId && (await walletBalance(receivingUserId)) < input.requestedCoins) {
    throw new ApiError(400, "The other team doesn't have enough coins to cover what you're requesting.");
  }

  await validateLegs(context.leagueId, proposingTeamId, input.offeredLegs);
  await validateLegs(context.leagueId, input.receivingTeamId, input.requestedLegs);

  const trade = await supabase.from("rec_trades").insert({
    league_id: context.leagueId,
    season_number: seasonNumber,
    proposing_team_id: proposingTeamId,
    proposing_user_id: userId,
    receiving_team_id: input.receivingTeamId,
    receiving_user_id: receivingUserId ?? userId, // no CPU "user" to bill/credit against; proposer's own id is a harmless placeholder since CPU-side coin legs are blocked below
    proposing_coins: input.offeredCoins,
    receiving_coins: input.requestedCoins,
    approval_policy_snapshot: effectivePolicy,
  }).select("*").single();
  if (trade.error) throw new ApiError(500, "Failed to propose trade.", trade.error);

  if (!receivingUserId && input.requestedCoins > 0) {
    await supabase.from("rec_trades").delete().eq("id", trade.data.id);
    throw new ApiError(400, "Can't request coins from a CPU-controlled team.");
  }

  const legRows = [
    ...input.offeredLegs.map((leg) => legRow(trade.data.id, leg, proposingTeamId, input.receivingTeamId)),
    ...input.requestedLegs.map((leg) => legRow(trade.data.id, leg, input.receivingTeamId, proposingTeamId)),
  ];
  if (legRows.length) {
    const legs = await supabase.from("rec_trade_legs").insert(legRows);
    if (legs.error) { await supabase.from("rec_trades").delete().eq("id", trade.data.id); throw new ApiError(500, "Failed to save trade details.", legs.error); }
  }

  await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "proposed", actor_user_id: userId, actor_discord_id: input.discordId, next_status: "pending_response" });

  // No GM on the other side to respond — a CPU-side proposal skips straight to review/auto-apply.
  if (!receivingUserId) {
    return finalizeAcceptedTrade(trade.data.id, effectivePolicy, input.guildId, context.leagueId);
  }
  return trade.data;
}

function legRow(tradeId: string, leg: LegInput, fromTeamId: string, toTeamId: string) {
  return leg.type === "player"
    ? { trade_id: tradeId, leg_type: "player", player_id: leg.playerId, from_team_id: fromTeamId, to_team_id: toTeamId }
    : { trade_id: tradeId, leg_type: "pick", draft_pick_id: leg.draftPickId, from_team_id: fromTeamId, to_team_id: toTeamId };
}

export async function respondToTrade(input: { guildId: string; discordId: string; tradeId: string; action: "accept" | "decline" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "Failed to load trade.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.receiving_user_id !== userId) throw new ApiError(403, "Only the receiving team's coach can respond to this trade.");
  if (trade.data.status !== "pending_response") throw new ApiError(409, `This trade is no longer pending (status: ${trade.data.status}).`);

  if (input.action === "decline") {
    await supabase.from("rec_trades").update({ status: "declined", declined_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", trade.data.id);
    await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "declined", actor_user_id: userId, actor_discord_id: input.discordId, previous_status: "pending_response", next_status: "declined" });
    return { status: "declined" };
  }

  return finalizeAcceptedTrade(trade.data.id, trade.data.approval_policy_snapshot, input.guildId, context.leagueId);
}

async function finalizeAcceptedTrade(tradeId: string, approvalPolicy: string, guildId: string, leagueId: string) {
  const now = new Date().toISOString();
  if (approvalPolicy === "no_approval_required") {
    await supabase.from("rec_trades").update({ status: "accepted", accepted_at: now, updated_at: now }).eq("id", tradeId);
    const applied = await supabase.rpc("apply_trade", { p_trade_id: tradeId, p_reviewer_discord_id: null, p_review_note: "Auto-applied — no approval required" });
    if (applied.error) throw new ApiError(500, "Trade was accepted but could not be applied.", applied.error);
    return { status: "applied" };
  }
  await supabase.from("rec_trades").update({ status: "pending_review", accepted_at: now, updated_at: now }).eq("id", tradeId);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: tradeId, action: "accepted", previous_status: "pending_response", next_status: "pending_review" });
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildId, league_id: leagueId, queue_type: "trade", status: "pending", priority: 0,
    header: "Trade pending review", summary: "A trade has been accepted by both teams and needs review.",
    source_table: "rec_trades", source_id: tradeId, payload: { tradeId, approvalPolicy },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);
  return { status: "pending_review" };
}

export async function withdrawTrade(input: { guildId: string; discordId: string; tradeId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "Failed to load trade.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.proposing_user_id !== userId) throw new ApiError(403, "Only the proposing coach can withdraw this trade.");
  if (!["pending_response", "accepted"].includes(trade.data.status)) throw new ApiError(409, "This trade can no longer be withdrawn.");
  const now = new Date().toISOString();
  await supabase.from("rec_trades").update({ status: "withdrawn", withdrawn_at: now, updated_at: now }).eq("id", trade.data.id);
  await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "withdrawn", actor_user_id: userId, actor_discord_id: input.discordId, previous_status: trade.data.status, next_status: "withdrawn" });
  return { status: "withdrawn" };
}

export async function reviewTrade(input: { guildId: string; reviewerDiscordId: string; tradeId: string; action: "approve" | "reject"; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", input.tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "Failed to load trade.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  if (trade.data.status !== "pending_review") throw new ApiError(409, `Trade is not pending review (status: ${trade.data.status}).`);

  if (input.action === "reject") {
    const now = new Date().toISOString();
    await supabase.from("rec_trades").update({ status: "rejected", rejected_at: now, updated_at: now, reviewed_by_discord_id: input.reviewerDiscordId, review_note: input.note ?? null }).eq("id", trade.data.id);
    await supabase.from("rec_trade_audit_log").insert({ trade_id: trade.data.id, action: "rejected", actor_discord_id: input.reviewerDiscordId, previous_status: "pending_review", next_status: "rejected", details: { note: input.note ?? null } });
    return { status: "rejected" };
  }
  const applied = await supabase.rpc("apply_trade", { p_trade_id: trade.data.id, p_reviewer_discord_id: input.reviewerDiscordId, p_review_note: input.note ?? null });
  if (applied.error) throw new ApiError(500, "Failed to apply trade.", applied.error);
  return { status: "applied" };
}

export async function listMyTrades(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdFromDiscord(discordId);
  if (!userId) return { trades: [] };
  const trades = await supabase.from("rec_trades").select("*").eq("league_id", context.leagueId)
    .or(`proposing_user_id.eq.${userId},receiving_user_id.eq.${userId}`).order("created_at", { ascending: false }).limit(100);
  if (trades.error) throw new ApiError(500, "Failed to load trades.", trades.error);
  return { trades: trades.data ?? [] };
}

export async function listPendingReviewTrades(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const trades = await supabase.from("rec_trades").select("*").eq("league_id", context.leagueId).eq("status", "pending_review").order("accepted_at", { ascending: true });
  if (trades.error) throw new ApiError(500, "Failed to load trades pending review.", trades.error);
  return { trades: trades.data ?? [] };
}

export async function listTradeableTeams(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", context.leagueId).order("name");
  if (teams.error) throw new ApiError(500, "Failed to load teams.", teams.error);
  const assignments = await supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((a: any) => [a.team_id, a.user_id]));
  return (teams.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    abbreviation: t.display_abbr || t.abbreviation,
    isCpu: !userByTeam.has(t.id),
  }));
}

export async function getTradeDetail(guildId: string, tradeId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const trade = await supabase.from("rec_trades").select("*").eq("id", tradeId).eq("league_id", context.leagueId).maybeSingle();
  if (trade.error) throw new ApiError(500, "Failed to load trade.", trade.error);
  if (!trade.data) throw new ApiError(404, "Trade not found.");
  const legs = await supabase.from("rec_trade_legs").select("*").eq("trade_id", tradeId);
  if (legs.error) throw new ApiError(500, "Failed to load trade legs.", legs.error);
  return { trade: trade.data, legs: legs.data ?? [] };
}
