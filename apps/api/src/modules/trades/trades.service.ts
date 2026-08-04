import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext, findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

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

// Best-effort — a trade/listing must never fail because the commissioner hasn't set up a
// trade-block channel, or because Discord is briefly unreachable.
async function postToTradeBlockChannel(leagueId: string, payload: Record<string, unknown>) {
  try {
    const linked = await findServerRoutesForLeague(leagueId);
    const channelId = linked?.routes?.trade_block_channel_id as string | null | undefined;
    if (!channelId) return;
    await postDiscordChannelMessage(channelId, payload);
  } catch (err) {
    console.error("[ERROR] Failed to post to trade block channel (non-fatal):", err);
  }
}

async function teamLabel(leagueId: string, teamId: string) {
  const team = await supabase.from("rec_teams").select("name,display_abbr,abbreviation").eq("league_id", leagueId).eq("id", teamId).maybeSingle();
  return team.data?.name ?? team.data?.display_abbr ?? team.data?.abbreviation ?? "A team";
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

  {
    const [proposingName, receivingName] = await Promise.all([teamLabel(context.leagueId, proposingTeamId), teamLabel(context.leagueId, input.receivingTeamId)]);
    void postToTradeBlockChannel(context.leagueId, {
      embeds: [{
        title: "Trade Proposed",
        color: 0x2f8fdb,
        description: `**${proposingName}** proposed a trade with **${receivingName}**${receivingUserId ? "" : " (CPU)"}.`,
      }],
    });
  }

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

// Fires once, at the moment a trade actually moves players/picks — not on propose/accept —
// so the league only hears about deals that are actually final. Best-effort: a failure here
// must never undo an already-applied trade.
async function announceAppliedTrade(guildId: string, leagueId: string, tradeId: string) {
  try {
    const trade = await supabase.from("rec_trades").select("proposing_team_id,receiving_team_id").eq("id", tradeId).maybeSingle();
    if (!trade.data) return;
    const legs = await supabase.from("rec_trade_legs").select("leg_type,player_id,draft_pick_id,from_team_id,to_team_id").eq("trade_id", tradeId);
    const [proposingName, receivingName] = await Promise.all([
      teamLabel(leagueId, trade.data.proposing_team_id),
      teamLabel(leagueId, trade.data.receiving_team_id),
    ]);
    const playerIds = (legs.data ?? []).filter((l: any) => l.leg_type === "player").map((l: any) => l.player_id);
    const players = playerIds.length ? await supabase.from("rec_players").select("id,full_name").in("id", playerIds) : { data: [] as any[] };
    const nameByPlayer = new Map((players.data ?? []).map((p: any) => [p.id, p.full_name]));
    const toLine = (l: any) => {
      const label = l.leg_type === "player" ? (nameByPlayer.get(l.player_id) ?? "a player") : "a draft pick";
      return `${label} (${l.from_team_id === trade.data!.proposing_team_id ? proposingName : receivingName} → ${l.to_team_id === trade.data!.proposing_team_id ? proposingName : receivingName})`;
    };
    const lines = (legs.data ?? []).map(toLine);
    const body = lines.length ? `Trade confirmed between **${proposingName}** and **${receivingName}**:\n\n${lines.map((l) => `- ${l}`).join("\n")}` : `Trade confirmed between **${proposingName}** and **${receivingName}**.`;
    await publishTransitionStory({ guildId, headline: `${proposingName} and ${receivingName} agree to a trade`, body, primaryAngle: "trade" });
    void postToTradeBlockChannel(leagueId, { embeds: [{ title: "Trade Confirmed", color: 0x2fb86a, description: body.slice(0, 4096) }] });
  } catch (err) {
    console.error("[ERROR] Failed to announce applied trade (non-fatal):", err);
  }
}

async function finalizeAcceptedTrade(tradeId: string, approvalPolicy: string, guildId: string, leagueId: string) {
  const now = new Date().toISOString();
  if (approvalPolicy === "no_approval_required") {
    await supabase.from("rec_trades").update({ status: "accepted", accepted_at: now, updated_at: now }).eq("id", tradeId);
    const applied = await supabase.rpc("apply_trade", { p_trade_id: tradeId, p_reviewer_discord_id: null, p_review_note: "Auto-applied — no approval required" });
    if (applied.error) throw new ApiError(500, "Trade was accepted but could not be applied.", applied.error);
    void announceAppliedTrade(guildId, leagueId, tradeId);
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
  void announceAppliedTrade(input.guildId, context.leagueId, trade.data.id);
  return { status: "applied" };
}

export async function listTradeBlockPlayers(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const players = await supabase.from("rec_players").select("id,full_name,position,overall_rating,team_id,trade_block_note,trade_block_listed_at")
    .eq("league_id", context.leagueId).eq("on_trade_block", true).order("trade_block_listed_at", { ascending: false });
  if (players.error) throw new ApiError(500, "Failed to load the trade block.", players.error);
  const teamIds = [...new Set((players.data ?? []).map((p: any) => p.team_id).filter(Boolean))] as string[];
  const names = teamIds.length ? await teamNames(context.leagueId, teamIds) : new Map<string, string>();
  return (players.data ?? []).map((p: any) => ({
    id: p.id, fullName: p.full_name, position: p.position, overallRating: p.overall_rating,
    teamId: p.team_id, teamName: names.get(p.team_id) ?? "Unassigned",
    note: p.trade_block_note, listedAt: p.trade_block_listed_at,
  }));
}

async function teamNames(leagueId: string, teamIds: string[]) {
  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", leagueId).in("id", teamIds);
  return new Map((teams.data ?? []).map((t: any) => [t.id, t.name ?? t.display_abbr ?? t.abbreviation]));
}

export async function setPlayerTradeBlock(input: { guildId: string; discordId: string; playerId: string; listed: boolean; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const player = await supabase.from("rec_players").select("id,team_id,full_name,roster_status").eq("id", input.playerId).eq("league_id", context.leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data || player.data.roster_status !== "active") throw new ApiError(404, "Player not found on an active roster.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");
  const myTeamId = await teamForUser(context.leagueId, userId ?? "");
  if (player.data.team_id !== myTeamId) throw new ApiError(403, "Only that player's own coach can manage their trade-block listing.");

  const now = new Date().toISOString();
  const updated = await supabase.from("rec_players").update({
    on_trade_block: input.listed,
    trade_block_note: input.listed ? (input.note?.trim() || null) : null,
    trade_block_listed_at: input.listed ? now : null,
  }).eq("id", input.playerId).select("id,full_name").single();
  if (updated.error) throw new ApiError(500, "Failed to update trade-block listing.", updated.error);

  if (input.listed) {
    const label = await teamLabel(context.leagueId, player.data.team_id);
    void postToTradeBlockChannel(context.leagueId, {
      embeds: [{
        title: "Player Added to Trade Block",
        color: 0xd9a521,
        description: `**${player.data.full_name}** (${label})${input.note ? ` — ${input.note}` : ""}`,
      }],
    });
  }
  return updated.data;
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
