import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getEffectiveAvailability } from "./availability.service.js";
import { intersectIntervals, scoreOverlapWindows, suggestedKickoffsWithinWindow } from "./overlap.service.js";
import { logSchedulingEvent, userIdFromDiscordId } from "./shared.js";
import { submitMatchupHelpRequest } from "../matchup-help/matchup-help.service.js";
import { postGameChatSystemMessage } from "../game-chat/game-chat.service.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, siteOnlyGuildId } from "../league-context/league-context.service.js";

const HORIZON_HOURS_NO_ADVANCE = 48;
export type UserFacingStatus =
  | "not_scheduled" | "waiting_on_you" | "waiting_on_opponent" | "finding_a_time" | "time_proposed"
  | "confirmed" | "reschedule_requested" | "no_shared_availability" | "needs_commissioner_help" | "completed";

type Game = { id: string; league_id: string; home_user_id: string | null; away_user_id: string | null; status: string };

async function loadGame(gameId: string): Promise<Game> {
  const row = await supabase.from("rec_games").select("id,league_id,home_user_id,away_user_id,status").eq("id", gameId).maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load game.", row.error);
  if (!row.data) throw new ApiError(404, "Game not found.");
  return row.data as Game;
}

export async function ensureScheduling(gameId: string) {
  const existing = await supabase.from("rec_game_scheduling").select("*").eq("game_id", gameId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load scheduling state.", existing.error);
  if (existing.data) return existing.data;
  const game = await loadGame(gameId);
  const insert = await supabase.from("rec_game_scheduling").insert({ game_id: gameId, league_id: game.league_id }).select("*").single();
  if (insert.error) throw new ApiError(500, "Failed to initialize scheduling for this game.", insert.error);
  return insert.data;
}

// Called once, at game-channel creation — opens the response window both coaches' 4h/8h/12h
// contact reminders count down from.
export async function startResponseClock(gameId: string) {
  const row = await ensureScheduling(gameId);
  if (row.response_started_at) return row;
  const updated = await supabase.from("rec_game_scheduling").update({ response_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("game_id", gameId).select("*").single();
  if (updated.error) throw new ApiError(500, "Failed to start the response clock.", updated.error);
  await logSchedulingEvent({ gameId, eventType: "response_clock_started" });
  return updated.data;
}

// Any of: message in game channel, adjust availability, propose a time, accept/counter, use
// scheduling help. Idempotent per side.
export async function markResponded(gameId: string, userId: string) {
  const game = await loadGame(gameId);
  const row = await ensureScheduling(gameId);
  const isHome = game.home_user_id === userId;
  const isAway = game.away_user_id === userId;
  if (!isHome && !isAway) return row;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (isHome && !row.home_responded_at) patch.home_responded_at = new Date().toISOString();
  if (isAway && !row.away_responded_at) patch.away_responded_at = new Date().toISOString();
  if (Object.keys(patch).length === 1) return row;
  const updated = await supabase.from("rec_game_scheduling").update(patch).eq("game_id", gameId).select("*").single();
  if (updated.error) throw new ApiError(500, "Failed to record your response.", updated.error);
  return updated.data;
}

async function getDeadlineUtc(leagueId: string): Promise<string> {
  const league = await supabase.from("rec_leagues").select("next_advance_at").eq("id", leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to load the league's next advance time.", league.error);
  if (league.data?.next_advance_at) return league.data.next_advance_at;
  return new Date(Date.now() + HORIZON_HOURS_NO_ADVANCE * 60 * 60 * 1000).toISOString();
}

export async function getSchedulingSuggestions(gameId: string) {
  const game = await loadGame(gameId);
  if (!game.home_user_id || !game.away_user_id) throw new ApiError(400, "This game doesn't have two human coaches to schedule.");
  const nowUtc = new Date().toISOString();
  const deadlineUtc = await getDeadlineUtc(game.league_id);

  const [home, away] = await Promise.all([
    getEffectiveAvailability({ userId: game.home_user_id, leagueId: game.league_id, gameId, fromUtc: nowUtc, toUtc: deadlineUtc }),
    getEffectiveAvailability({ userId: game.away_user_id, leagueId: game.league_id, gameId, fromUtc: nowUtc, toUtc: deadlineUtc }),
  ]);
  const shared = intersectIntervals(home.intervals, away.intervals);
  const scored = scoreOverlapWindows({ windows: shared, deadlineUtc, nowUtc, homeTimezone: home.timezone ?? "America/Chicago", awayTimezone: away.timezone ?? "America/Chicago" });
  const best = scored[0] ?? null;
  const bestKickoffOptions = best ? suggestedKickoffsWithinWindow(shared.find((w) => w.startUtc === best.kickoffUtc) ?? shared[0]) : [];

  if (!shared.length) {
    await supabase.from("rec_game_scheduling").update({ status: "no_shared_availability", attention_required: true, updated_at: new Date().toISOString() }).eq("game_id", gameId);
  }

  return {
    deadlineUtc, homeTimezone: home.timezone, awayTimezone: away.timezone,
    homeAvailability: home.intervals, awayAvailability: away.intervals, sharedWindows: shared,
    bestWindow: best, bestKickoffOptions,
  };
}

export async function proposeTime(input: { gameId: string; discordId: string; proposedForUtc: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can propose a time.");
  await ensureScheduling(input.gameId);

  const insert = await supabase.from("rec_game_time_proposals").insert({ game_id: input.gameId, proposed_by_user_id: userId, proposed_for: input.proposedForUtc, status: "pending" }).select("*").single();
  if (insert.error) throw new ApiError(500, "Failed to save your proposed time.", insert.error);

  await supabase.from("rec_game_scheduling").update({ status: "proposed", proposed_by_user_id: userId, updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await markResponded(input.gameId, userId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_created", payload: { proposedForUtc: input.proposedForUtc } });
  await notifyOpponent(input.gameId, game, userId, `proposed **${formatIsoShort(input.proposedForUtc)}**`);
  return insert.data;
}

export async function respondToProposal(input: { gameId: string; discordId: string; proposalId: string; action: "accept" | "counter" | "withdraw"; counterForUtc?: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can respond.");

  const proposal = await supabase.from("rec_game_time_proposals").select("*").eq("id", input.proposalId).eq("game_id", input.gameId).maybeSingle();
  if (proposal.error) throw new ApiError(500, "Failed to load that proposal.", proposal.error);
  if (!proposal.data) throw new ApiError(404, "Proposal not found.");
  if (proposal.data.status !== "pending") throw new ApiError(409, "That proposal has already been resolved.");

  if (input.action === "withdraw") {
    if (proposal.data.proposed_by_user_id !== userId) throw new ApiError(403, "Only the proposer can withdraw it.");
    await supabase.from("rec_game_time_proposals").update({ status: "withdrawn", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    await supabase.from("rec_game_scheduling").update({ status: "not_scheduled", updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_withdrawn" });
    return { status: "withdrawn" };
  }

  if (proposal.data.proposed_by_user_id === userId) throw new ApiError(403, "You can't accept or counter your own proposal.");

  if (input.action === "accept") {
    await supabase.from("rec_game_time_proposals").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    await supabase.from("rec_game_scheduling").update({
      status: "confirmed", scheduled_for: proposal.data.proposed_for, confirmed_at: new Date().toISOString(),
      accepted_by_user_id: userId, updated_at: new Date().toISOString(),
    }).eq("game_id", input.gameId);
    await markResponded(input.gameId, userId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_accepted", payload: { proposedFor: proposal.data.proposed_for } });
    await notifyOpponent(input.gameId, game, userId, `accepted **${formatIsoShort(proposal.data.proposed_for)}** — game confirmed.`);
    return { status: "confirmed", scheduledFor: proposal.data.proposed_for };
  }

  // Counter.
  if (!input.counterForUtc) throw new ApiError(400, "A counter needs a proposed time.");
  await supabase.from("rec_game_time_proposals").update({ status: "countered", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
  const counter = await supabase.from("rec_game_time_proposals").insert({
    game_id: input.gameId, proposed_by_user_id: userId, proposed_for: input.counterForUtc, status: "pending", counter_to_id: input.proposalId,
  }).select("*").single();
  if (counter.error) throw new ApiError(500, "Failed to save your counter.", counter.error);
  await supabase.from("rec_game_scheduling").update({ status: "proposed", proposed_by_user_id: userId, updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await markResponded(input.gameId, userId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_countered", payload: { proposedForUtc: input.counterForUtc } });
  await notifyOpponent(input.gameId, game, userId, `countered with **${formatIsoShort(input.counterForUtc)}**`);
  return counter.data;
}

export async function requestReschedule(input: { gameId: string; discordId: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can request a reschedule.");
  await supabase.from("rec_game_scheduling").update({
    status: "reschedule_requested", reschedule_requested_at: new Date().toISOString(),
    scheduled_for: null, confirmed_at: null, updated_at: new Date().toISOString(),
  }).eq("game_id", input.gameId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "reschedule_requested" });
  await notifyOpponent(input.gameId, game, userId, "requested to reschedule the confirmed time.");
  return { status: "reschedule_requested" };
}

export async function checkIn(input: { gameId: string; discordId: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can check in.");
  const insert = await supabase.from("rec_game_kickoff_checkins").upsert({ game_id: input.gameId, user_id: userId, checked_in_at: new Date().toISOString() }, { onConflict: "game_id,user_id" }).select("*").single();
  if (insert.error) throw new ApiError(500, "Failed to check you in.", insert.error);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "checked_in" });
  return insert.data;
}

export async function markStreamStarted(gameId: string) {
  const row = await ensureScheduling(gameId);
  if (row.stream_started_at) return row;
  const updated = await supabase.from("rec_game_scheduling").update({ stream_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("game_id", gameId).select("*").single();
  if (updated.error) throw new ApiError(500, "Failed to mark the game started.", updated.error);
  await logSchedulingEvent({ gameId, eventType: "stream_started" });
  return updated.data;
}

// FW is a manual-apply LABEL only (no code path here actually forces a win) -- files a
// Request Help ticket the commissioner can act on, posts public evidence in the game channel,
// and flags rec_game_scheduling.fw_flagged so Advance Readiness can badge the matchup.
export async function requestForceWin(input: { gameId: string; discordId: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only a checked-in coach in this matchup can request a Force Win.");
  const opponentId = userId === game.home_user_id ? game.away_user_id : game.home_user_id;
  if (!opponentId) throw new ApiError(400, "This game has no opponent to request a Force Win against.");

  const checkins = await supabase.from("rec_game_kickoff_checkins").select("user_id").eq("game_id", input.gameId);
  if (checkins.error) throw new ApiError(500, "Failed to verify check-in status.", checkins.error);
  const checkedInIds = new Set((checkins.data ?? []).map((r: any) => r.user_id));
  if (!checkedInIds.has(userId)) throw new ApiError(403, "Check in for kickoff before requesting a Force Win.");
  if (checkedInIds.has(opponentId)) throw new ApiError(409, "Your opponent already checked in — no Force Win to request.");

  const scheduling = await supabase.from("rec_game_scheduling").select("*").eq("game_id", input.gameId).maybeSingle();
  await supabase.from("rec_game_scheduling").update({
    fw_flagged: true, fw_flagged_for_user_id: userId, fw_flagged_at: new Date().toISOString(),
    attention_required: true, updated_at: new Date().toISOString(),
  }).eq("game_id", input.gameId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "fw_requested" });

  const routes = await findServerRoutesForLeague(game.league_id);
  await submitMatchupHelpRequest({
    guildId: routes?.guildId ?? siteOnlyGuildId(game.league_id),
    discordId: input.discordId,
    gameId: input.gameId,
    kind: "force_win",
    message: `Opponent missed the confirmed kickoff (${scheduling.data?.scheduled_for ? formatIsoShort(scheduling.data.scheduled_for) : "scheduled time"}). Checked-in coach is requesting a Force Win.`,
  }).catch((err) => console.error("[ERROR] Failed to file the Force Win Request Help ticket (non-fatal):", err));

  const channel = await getGameChannelByGameId(input.gameId);
  if (channel?.discord_channel_id) {
    const commissionerRoleId = String((routes?.routes as any)?.commissioner_role_id ?? "");
    const roleMention = commissionerRoleId ? `<@&${commissionerRoleId}> ` : "";
    await postDiscordChannelMessage(channel.discord_channel_id, {
      content: `⚠️ **Force Win requested.** ${roleMention}A coach checked in for the confirmed kickoff and their opponent did not — this has been flagged in Advance Readiness for review.`,
      allowed_mentions: commissionerRoleId ? { roles: [commissionerRoleId] } : { parse: [] },
    }).catch(() => undefined);
  }
  return { flagged: true };
}

async function notifyOpponent(gameId: string, game: Game, actingUserId: string, text: string) {
  const channel = await getGameChannelByGameId(gameId);
  if (!channel) return;
  await postGameChatSystemMessage({ gameChannelId: channel.id, leagueId: game.league_id, gameId, body: `Scheduling: ${text}` }).catch(() => undefined);
}

function formatIsoShort(iso: string): string {
  return new Date(iso).toUTCString().replace(" GMT", " UTC");
}

export async function computeUserFacingStatus(gameId: string): Promise<UserFacingStatus> {
  const row = await supabase.from("rec_game_scheduling").select("*").eq("game_id", gameId).maybeSingle();
  if (row.error || !row.data) return "not_scheduled";
  const s = row.data;
  if (s.status === "confirmed" || s.status === "completed" || s.status === "reschedule_requested" || s.status === "no_shared_availability" || s.status === "needs_commissioner_help") {
    return s.status as UserFacingStatus;
  }
  if (s.status === "proposed") return "time_proposed";
  if (s.response_started_at && (!s.home_responded_at || !s.away_responded_at)) return "waiting_on_opponent";
  return "not_scheduled";
}
