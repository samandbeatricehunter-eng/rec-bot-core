import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getEffectiveAvailability } from "./availability.service.js";
import { intersectIntervals, scoreOverlapWindows, suggestedKickoffsWithinWindow } from "./overlap.service.js";
import { logSchedulingEvent, userIdFromDiscordId } from "./shared.js";
import { submitMatchupHelpRequest } from "../matchup-help/matchup-help.service.js";
import { postGameChatSystemMessage } from "../game-chat/game-chat.service.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { postDiscordChannelMessage, editDiscordMessage, sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, siteOnlyGuildId } from "../league-context/league-context.service.js";
import { postOrUpdateGameAnnouncement } from "./game-announcement.service.js";
import { formatInstantInZone } from "../../lib/timezone.js";

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

  // This is a read path (called on every site page load and panel refresh) with a side effect
  // that used to fire unconditionally -- it clobbered "proposed"/"confirmed" rows the instant
  // someone merely viewed the matchup with no shared availability computed yet, silently erasing
  // pending offers and confirmed kickoffs. Only downgrade from states that don't already
  // represent a real decision in flight.
  if (!shared.length) {
    const current = await supabase.from("rec_game_scheduling").select("status").eq("game_id", gameId).maybeSingle();
    const downgradable = !current.data || current.data.status === "not_scheduled" || current.data.status === "no_shared_availability";
    if (downgradable) {
      await supabase.from("rec_game_scheduling").update({ status: "no_shared_availability", attention_required: true, updated_at: new Date().toISOString() }).eq("game_id", gameId);
    }
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

  // A new offer supersedes any earlier pending offer, including one from the other coach.
  // This keeps old Discord buttons from confirming a stale time after either coach has
  // proposed a replacement.
  const now = new Date().toISOString();
  const withdrawn = await supabase.from("rec_game_time_proposals")
    .update({ status: "withdrawn", responded_at: now })
    .eq("game_id", input.gameId)
    .eq("status", "pending");
  if (withdrawn.error) throw new ApiError(500, "Failed to replace the pending proposed time.", withdrawn.error);

  const insert = await supabase.from("rec_game_time_proposals").insert({ game_id: input.gameId, proposed_by_user_id: userId, proposed_for: input.proposedForUtc, status: "pending" }).select("*").single();
  if (insert.error) throw new ApiError(500, "Failed to save your proposed time.", insert.error);

  await supabase.from("rec_game_scheduling").update({ status: "proposed", proposed_by_user_id: userId, updated_at: now }).eq("game_id", input.gameId);
  await markResponded(input.gameId, userId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_created", payload: { proposedForUtc: input.proposedForUtc } });
  await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} proposed to play at **${formatInstantInZone(input.proposedForUtc, ctx.tz)}** — waiting on response from ${ctx.opponentMention}`, insert.data.id);
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  return insert.data;
}

export async function respondToProposal(input: { gameId: string; discordId: string; proposalId: string; action: "accept" | "counter" | "withdraw" | "reject"; counterForUtc?: string }) {
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
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
    return { status: "withdrawn" };
  }

  if (proposal.data.proposed_by_user_id === userId) throw new ApiError(403, "You can't respond to your own proposal.");

  if (input.action === "reject") {
    await supabase.from("rec_game_time_proposals").update({ status: "rejected", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    await supabase.from("rec_game_scheduling").update({ status: "not_scheduled", updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
    await markResponded(input.gameId, userId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_rejected", payload: { proposedFor: proposal.data.proposed_for } });
    await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} declined the proposed **${formatInstantInZone(proposal.data.proposed_for, ctx.tz)}** — propose a new time. ${ctx.opponentMention}`);
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
    return { status: "rejected" };
  }

  if (input.action === "accept") {
    await supabase.from("rec_game_time_proposals").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    await supabase.from("rec_game_scheduling").update({
      status: "confirmed", scheduled_for: proposal.data.proposed_for, confirmed_at: new Date().toISOString(),
      accepted_by_user_id: userId, updated_at: new Date().toISOString(),
    }).eq("game_id", input.gameId);
    await markResponded(input.gameId, userId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_accepted", payload: { proposedFor: proposal.data.proposed_for } });
    await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.opponentMention} — your proposed time was accepted by ${ctx.actingMention}: **${formatInstantInZone(proposal.data.proposed_for, ctx.tz)}**. Game confirmed!`);
    await postOrUpdateGameAnnouncement(input.gameId, { announceNow: true }).catch((error) => console.error("[ERROR] Failed to post game announcement (non-fatal):", error));
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
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
  await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} countered with **${formatInstantInZone(input.counterForUtc!, ctx.tz)}** — waiting on response from ${ctx.opponentMention}`, counter.data.id);
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
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
  await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} requested to reschedule the confirmed time. ${ctx.opponentMention}`);
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
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
  await postOrUpdateGameAnnouncement(gameId, { announceNow: false }).catch((error) => console.error("[ERROR] Failed to update game announcement with stream link (non-fatal):", error));
  await updateSchedulingPanel(gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
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
  const league = await supabase.from("rec_leagues").select("owner_user_id").eq("id", game.league_id).maybeSingle();
  const ticketTz = await resolveDisplayTimezone(league.data?.owner_user_id ?? null, scheduling.data?.proposed_by_user_id ?? userId);
  await submitMatchupHelpRequest({
    guildId: routes?.guildId ?? siteOnlyGuildId(game.league_id),
    discordId: input.discordId,
    gameId: input.gameId,
    kind: "force_win",
    message: `Opponent missed the confirmed kickoff (${scheduling.data?.scheduled_for ? formatInstantInZone(scheduling.data.scheduled_for, ticketTz) : "scheduled time"}). Checked-in coach is requesting a Force Win.`,
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
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  return { flagged: true };
}

// Resolves which zone to *display* a time in for the opponent: their own set timezone if
// they've picked one, else the acting user's (the proposer's) timezone, else the system default.
// Never UTC -- nobody reads UTC.
async function resolveDisplayTimezone(opponentId: string | null, actingUserId: string): Promise<string> {
  const [opponentProfile, actingProfile] = await Promise.all([
    opponentId ? supabase.from("rec_user_availability_profiles").select("timezone").eq("user_id", opponentId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("rec_user_availability_profiles").select("timezone").eq("user_id", actingUserId).maybeSingle(),
  ]);
  return (opponentProfile as any).data?.timezone ?? (actingProfile as any).data?.timezone ?? "America/Chicago";
}

// Direct, personal notification (site bell + push + Discord DM) to the coach who needs to
// know/act -- separate from the shared game-channel post, which the other coach also sees but
// won't necessarily check promptly. Best-effort: a failure here never blocks the scheduling
// action that triggered it.
async function notifyCoachDirectly(input: { userId: string; gameId: string; leagueId: string; title: string; message: string }) {
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.userId).maybeSingle();
  const discordId = account.data?.discord_id ? String(account.data.discord_id) : null;
  const plainMessage = input.message.replace(/<@!?(\d+)>/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const href = `/matchups/${input.gameId}`;
  const { createSiteNotification } = await import("../site-notifications/site-notifications.service.js");
  const { sendPushToUsers } = await import("../push/push.service.js");
  await Promise.all([
    createSiteNotification({ userId: input.userId, leagueId: input.leagueId, kind: "scheduling", title: input.title, body: plainMessage, href })
      .catch((error) => console.error("[ERROR] notifyCoachDirectly: failed to create site notification (non-fatal):", error)),
    sendPushToUsers([input.userId], { title: input.title, body: plainMessage, url: href })
      .catch((error) => console.error("[ERROR] notifyCoachDirectly: failed to send push notification (non-fatal):", error)),
    discordId
      ? sendDiscordDirectMessage(discordId, plainMessage).catch((error) => console.error("[ERROR] notifyCoachDirectly: failed to send Discord DM (non-fatal):", error))
      : Promise.resolve(),
  ]);
}

type MentionCtx = { tz: string; actingMention: string; opponentMention: string };

// Posts one shared message in the game channel tagging BOTH coaches (previously this only
// tagged the recipient, leaving the proposer's own action unattributed in the ping), plus a
// direct site notification/push/DM to whichever coach needs to know or act next.
async function notifyOpponent(gameId: string, game: Game, actingUserId: string, buildText: (ctx: MentionCtx) => string, proposalId?: string) {
  const channel = await getGameChannelByGameId(gameId);
  if (!channel) { console.error(`[ERROR] notifyOpponent: no tracked game channel for game ${gameId} -- opponent not tagged.`); return; }

  const opponentId = actingUserId === game.home_user_id ? game.away_user_id : game.home_user_id;
  const displayTz = await resolveDisplayTimezone(opponentId, actingUserId);

  const [actingAccount, opponentAccount] = await Promise.all([
    supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", actingUserId).maybeSingle(),
    opponentId ? supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", opponentId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const actingDiscordId = actingAccount.data?.discord_id ? String(actingAccount.data.discord_id) : null;
  const opponentDiscordId = opponentAccount.data?.discord_id ? String(opponentAccount.data.discord_id) : null;
  if (!opponentDiscordId) console.error(`[WARN] notifyOpponent: opponent ${opponentId} has no linked Discord account -- posting without a tag.`);

  const actingMention = actingDiscordId ? `<@${actingDiscordId}>` : "A coach";
  const opponentMention = opponentDiscordId ? `<@${opponentDiscordId}>` : "the other coach";
  const resolvedText = buildText({ tz: displayTz, actingMention, opponentMention });

  await postGameChatSystemMessage({ gameChannelId: channel.id, leagueId: game.league_id, gameId, body: `Scheduling: ${resolvedText}` }).catch((error) => console.error("[ERROR] notifyOpponent: failed to post game-chat system message (non-fatal):", error));

  if (channel.discord_channel_id) {
    const mentionIds = [actingDiscordId, opponentDiscordId].filter((id): id is string => Boolean(id));
    const posted = await postDiscordChannelMessage(channel.discord_channel_id, {
      content: resolvedText,
      components: proposalId ? [{
        type: 1,
        components: [
          // Discord exposes components to everyone who can see a message. Include the invited
          // coach's snowflake so the bot can reject clicks by anybody else while staying under
          // Discord's 100-character custom_id limit.
          { type: 2, style: 3, custom_id: `r:s:a:${gameId}:${proposalId}:${opponentDiscordId}`, label: "Accept" },
          { type: 2, style: 2, custom_id: `r:s:c:${gameId}:${proposalId}:${opponentDiscordId}`, label: "Counter" },
        ],
      }] : undefined,
      allowed_mentions: mentionIds.length ? { users: mentionIds } : { parse: [] },
    }).catch((error) => { console.error(`[ERROR] notifyOpponent: postDiscordChannelMessage threw for channel ${channel.discord_channel_id}:`, error); return null; });
    if (!posted) console.error(`[ERROR] notifyOpponent: postDiscordChannelMessage returned null for channel ${channel.discord_channel_id} (see prior [WARN] log from discord-guild.ts for Discord's rejection reason).`);
  } else {
    console.error(`[ERROR] notifyOpponent: tracked game channel ${channel.id} has no discord_channel_id -- opponent not tagged.`);
  }

  if (opponentId) {
    const title = proposalId ? "Scheduling: a time needs your response" : "Scheduling update";
    await notifyCoachDirectly({ userId: opponentId, gameId, leagueId: game.league_id, title, message: resolvedText })
      .catch((error) => console.error("[ERROR] notifyOpponent: failed to send direct notification (non-fatal):", error));
  }
}

function formatIsoShort(iso: string): string {
  return new Date(iso).toUTCString().replace(" GMT", " UTC");
}

// "Can't Make Game" -- a user who knows ahead of time their availability doesn't cover any
// window before the deadline flags it. Posts an embed tagging the opponent with two choices
// (handled by resolveCantMakeIt below); doesn't touch scheduling status itself, since nothing
// is decided until the opponent responds.
export async function markCantMakeGame(input: { gameId: string; discordId: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can use Can't Make Game.");
  const opponentId = userId === game.home_user_id ? game.away_user_id : game.home_user_id;
  if (!opponentId) throw new ApiError(400, "This game has no opponent.");

  await ensureScheduling(input.gameId);
  await supabase.from("rec_game_scheduling").update({ status: "needs_commissioner_help", attention_required: true, updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "cant_make_game" });

  const opponentAccount = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", opponentId).maybeSingle();
  const opponentDiscordId = opponentAccount.data?.discord_id ? String(opponentAccount.data.discord_id) : null;
  const channel = await getGameChannelByGameId(input.gameId);
  if (channel?.discord_channel_id) {
    const mention = opponentDiscordId ? `<@${opponentDiscordId}> ` : "";
    await postDiscordChannelMessage(channel.discord_channel_id, {
      content: `${mention}Your opponent can't make this game before the deadline. Choose how to proceed:`,
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, custom_id: `rec:gamesched:cantmake:accept_fs:${input.gameId}`, label: "Accept Fair Sim" },
          { type: 2, style: 2, custom_id: `rec:gamesched:cantmake:autopilot:${input.gameId}`, label: "Request AutoPilot" },
        ],
      }],
      allowed_mentions: opponentDiscordId ? { users: [opponentDiscordId] } : { parse: [] },
    }).catch(() => undefined);
  }
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  return { flagged: true, opponentId, opponentDiscordId };
}

// The opponent's response to markCantMakeGame -- either choice just notifies commissioners and
// records what was chosen; neither one applies an FS or AutoPilot outcome itself (FS is already
// the automatic default when nothing gets scheduled, and AutoPilot is commissioner-applied like
// every other Request Help kind).
export async function resolveCantMakeGame(input: { gameId: string; discordId: string; choice: "accept_fs" | "request_autopilot" }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can respond.");
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "cant_make_game_resolved", payload: { choice: input.choice } });

  if (input.choice === "request_autopilot") {
    const routes = await findServerRoutesForLeague(game.league_id);
    await submitMatchupHelpRequest({
      guildId: routes?.guildId ?? siteOnlyGuildId(game.league_id),
      discordId: input.discordId,
      gameId: input.gameId,
      kind: "autopilot",
      message: "Opponent can't make the game before the deadline; requesting AutoPilot instead of a Fair Sim.",
    }).catch((err) => console.error("[ERROR] Failed to file the AutoPilot Request Help ticket (non-fatal):", err));
  }

  const channel = await getGameChannelByGameId(input.gameId);
  if (channel?.discord_channel_id) {
    const text = input.choice === "accept_fs" ? "accepted a Fair Sim for this game." : "requested AutoPilot instead of a Fair Sim — a commissioner has been notified.";
    await postDiscordChannelMessage(channel.discord_channel_id, { content: `Scheduling: opponent ${text}` }).catch(() => undefined);
  }
  return { choice: input.choice };
}

// Commissioner-only escape hatch: wipes this game's scheduling state entirely (status, proposed
// time, FW flag, pending proposals, kickoff check-ins) so both coaches can restart scheduling
// from scratch -- e.g. a "Can't Make Game" that later turns out to have been premature.
async function resetSchedulingInternal(gameId: string, userId: string | null, eventType: string, channelMessage: string) {
  await Promise.all([
    supabase.from("rec_game_scheduling").update({
      status: "not_scheduled", response_started_at: new Date().toISOString(), home_responded_at: null, away_responded_at: null,
      scheduled_for: null, confirmed_at: null, proposed_by_user_id: null, accepted_by_user_id: null,
      reschedule_requested_at: null, stream_started_at: null, fw_flagged: false, fw_flagged_for_user_id: null,
      fw_flagged_at: null, attention_required: false, updated_at: new Date().toISOString(),
    }).eq("game_id", gameId),
    supabase.from("rec_game_time_proposals").update({ status: "withdrawn", responded_at: new Date().toISOString() }).eq("game_id", gameId).eq("status", "pending"),
    supabase.from("rec_game_kickoff_checkins").delete().eq("game_id", gameId),
  ]);
  await logSchedulingEvent({ gameId, userId, eventType });

  const channel = await getGameChannelByGameId(gameId);
  if (channel?.discord_channel_id) {
    await postDiscordChannelMessage(channel.discord_channel_id, { content: channelMessage }).catch(() => undefined);
  }
  await updateSchedulingPanel(gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  return { reset: true };
}

export async function resetScheduling(input: { gameId: string; discordId: string }) {
  const userId = await userIdFromDiscordId(input.discordId).catch(() => null);
  return resetSchedulingInternal(input.gameId, userId, "commissioner_reset", "🔄 A commissioner reset scheduling for this game — you can propose a new time.");
}

// System-triggered variant: neither coach checked in within 2h of the confirmed kickoff. Falls
// back to Fair Sim (the unflagged default) and restarts scheduling so they can still play it out
// before the deadline if they get in touch.
export async function autoResetSchedulingAfterMissedKickoff(gameId: string) {
  return resetSchedulingInternal(
    gameId, null, "auto_reset_missed_kickoff",
    "⏰ Neither coach checked in within 2 hours of the confirmed kickoff. This game defaults to a **Fair Sim** unless you schedule a new time before the deadline — scheduling has restarted.",
  );
}

// Posted once per game channel right after the intro embed -- raw Discord REST JSON (this is
// apps/api, not the bot's discord.js instance) using the exact custom_id scheme the bot's
// apps/bot/src/flows/game-scheduling-panel.ts listens for.
function schedulingPanelComponents(gameId: string) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `rec:gamesched:panel:availability:${gameId}`, label: "Adjust Availability" },
        { type: 2, style: 1, custom_id: `rec:gamesched:panel:propose:${gameId}`, label: "Propose Time" },
        { type: 2, style: 4, custom_id: `rec:gamesched:panel:cantmake:${gameId}`, label: "Can't Make Game" },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `rec:gamesched:panel:reset:${gameId}`, label: "Reset (Commissioner)" },
      ],
    },
  ];
}

async function schedulingPanelDescription(gameId: string): Promise<string> {
  const status = await computeUserFacingStatus(gameId);
  if (status === "confirmed" || status === "completed" || status === "reschedule_requested") {
    const scheduling = await supabase.from("rec_game_scheduling").select("scheduled_for").eq("game_id", gameId).maybeSingle();
    if (scheduling.data?.scheduled_for) {
      const unix = Math.floor(new Date(scheduling.data.scheduled_for).getTime() / 1000);
      return `✅ Confirmed — <t:${unix}:F> (<t:${unix}:R>)`;
    }
  }
  // A pending offer must show as its own state -- otherwise this fell through to the generic
  // "Not Scheduled" copy below even while a coach was actively waiting on a response, which read
  // as if nothing had happened yet.
  if (status === "time_proposed") {
    const proposal = await supabase.from("rec_game_time_proposals").select("proposed_for").eq("game_id", gameId).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (proposal.data?.proposed_for) {
      const unix = Math.floor(new Date(proposal.data.proposed_for).getTime() / 1000);
      return `🟠 Time Proposed — <t:${unix}:F> (<t:${unix}:R>). Waiting on a response — use the buttons below to Accept or Counter.`;
    }
  }
  if (status === "no_shared_availability") {
    return "🔴 No Shared Availability found before the deadline — adjust your availability or use Can't Make Game for commissioner help.";
  }
  if (status === "needs_commissioner_help") {
    return "🆘 Needs Commissioner Help — a request has been filed and a commissioner has been notified.";
  }
  try {
    const suggestions = await getSchedulingSuggestions(gameId);
    if (suggestions.bestWindow) {
      const unix = Math.floor(new Date(suggestions.bestWindow.kickoffUtc).getTime() / 1000);
      return `🟡 Not Scheduled — best shared availability: <t:${unix}:F> (<t:${unix}:R>). Use the buttons below to line up a kickoff time before advance.`;
    }
  } catch {
    // Suggestions need both coaches' availability set -- fall through to the generic copy.
  }
  return "🟡 Not Scheduled — use the buttons below to line up a kickoff time before advance.";
}

export async function postSchedulingPanel(channelId: string, gameId: string) {
  const description = await schedulingPanelDescription(gameId);
  const posted = await postDiscordChannelMessage(channelId, {
    embeds: [{ title: "Scheduling", color: 0xd9a521, description }],
    components: schedulingPanelComponents(gameId),
  }).catch((error) => { console.error("[ERROR] Failed to post scheduling panel (non-fatal):", error); return null; });
  if (posted?.id) {
    await supabase.from("rec_game_scheduling").update({ panel_channel_id: channelId, panel_message_id: posted.id }).eq("game_id", gameId);
  }
}

// Refreshes the persistent game-channel panel in place (live status + best-overlap suggestion)
// -- called whenever either coach's availability changes, so the panel never goes stale between
// scheduling actions.
export async function updateSchedulingPanel(gameId: string) {
  const row = await supabase.from("rec_game_scheduling").select("panel_channel_id,panel_message_id").eq("game_id", gameId).maybeSingle();
  if (!row.data?.panel_channel_id || !row.data?.panel_message_id) return;
  const description = await schedulingPanelDescription(gameId);
  await editDiscordMessage(row.data.panel_channel_id, row.data.panel_message_id, {
    embeds: [{ title: "Scheduling", color: 0xd9a521, description }],
    components: schedulingPanelComponents(gameId),
  }).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
}

// Called after a coach updates their availability/timezone/overrides -- refreshes the panel for
// every non-completed game they're currently a participant in (in practice at most one, since a
// coach has one active H2H game per week).
export async function refreshSchedulingPanelsForUser(userId: string) {
  const games = await supabase.from("rec_games").select("id").or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`);
  if (games.error || !games.data?.length) return;
  const gameIds = games.data.map((g: any) => String(g.id));
  const scheduling = await supabase.from("rec_game_scheduling").select("game_id").in("game_id", gameIds).neq("status", "completed").not("panel_message_id", "is", null);
  for (const row of scheduling.data ?? []) {
    await updateSchedulingPanel(String((row as any).game_id));
  }
}

// Commissioner "Week Scheduling" dashboard: every current-week H2H game's scheduling status
// in one call, so a commissioner doesn't have to open each game channel to see who's stuck.
export async function listWeekSchedulingStatuses(guildId: string) {
  const { getAdvanceWeekGames } = await import("../league-week/advance-results.service.js");
  const week = await getAdvanceWeekGames(guildId);
  const h2hGames = (week.games as any[]).filter((g) => g.isH2h);
  if (!h2hGames.length) return { weekNumber: week.currentWeek, games: [] as Array<never> };

  const gameIds = h2hGames.map((g) => g.gameId);
  const rows = await supabase.from("rec_game_scheduling").select("game_id,status,scheduled_for,fw_flagged,response_started_at,home_responded_at,away_responded_at").in("game_id", gameIds);
  const byGameId = new Map<string, any>((rows.data ?? []).map((r: any) => [String(r.game_id), r]));

  const games = h2hGames.map((g) => {
    const s = byGameId.get(g.gameId);
    let status: UserFacingStatus = "not_scheduled";
    if (s) {
      if (["confirmed", "completed", "reschedule_requested", "no_shared_availability", "needs_commissioner_help"].includes(s.status)) status = s.status as UserFacingStatus;
      else if (s.status === "proposed") status = "time_proposed";
      else if (s.response_started_at && (!s.home_responded_at || !s.away_responded_at)) status = "waiting_on_opponent";
    }
    return {
      gameId: g.gameId, awayTeamName: g.awayTeamName, homeTeamName: g.homeTeamName,
      status, scheduledFor: s?.scheduled_for ?? null, fwFlagged: Boolean(s?.fw_flagged),
    };
  });
  return { weekNumber: week.currentWeek, games };
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

// Site matchup-page snapshot: status plus the confirmed time and/or the current pending
// proposal (if any), so the UI can render Accept/Counter without a separate lookup.
export async function getMatchupSchedulingSnapshot(gameId: string, viewerUserId?: string | null) {
  const [status, scheduling, proposal] = await Promise.all([
    computeUserFacingStatus(gameId),
    supabase.from("rec_game_scheduling").select("scheduled_for,fw_flagged").eq("game_id", gameId).maybeSingle(),
    supabase.from("rec_game_time_proposals").select("id,proposed_by_user_id,proposed_for").eq("game_id", gameId).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    status,
    scheduledFor: scheduling.data?.scheduled_for ?? null,
    fwFlagged: Boolean(scheduling.data?.fw_flagged),
    pendingProposal: proposal.data
      ? { id: proposal.data.id, proposedByUserId: proposal.data.proposed_by_user_id, proposedFor: proposal.data.proposed_for, proposedByMe: viewerUserId != null && proposal.data.proposed_by_user_id === viewerUserId }
      : null,
  };
}
