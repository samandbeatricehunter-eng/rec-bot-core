import { sanitizeFairSimRuleKeys, sanitizeForceWinRuleKeys } from "@rec/shared";
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
import { refreshMatchupsChannelForGame } from "./matchups-channel.service.js";

const HORIZON_HOURS_NO_ADVANCE = 48;
export type UserFacingStatus =
  | "not_scheduled" | "waiting_on_you" | "waiting_on_opponent" | "finding_a_time" | "time_proposed"
  | "confirmed" | "reschedule_requested" | "no_shared_availability" | "needs_commissioner_help" | "live" | "completed";

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

export async function getSchedulingSuggestions(gameId: string, discordId?: string) {
  const game = await loadGame(gameId);
  if (!game.home_user_id || !game.away_user_id) throw new ApiError(400, "This game doesn't have two human coaches to schedule.");
  if (discordId) {
    const userId = await userIdFromDiscordId(discordId);
    if (userId !== game.home_user_id && userId !== game.away_user_id) {
      throw new ApiError(403, "Only the two coaches in this matchup can use scheduling on this channel.");
    }
  }
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

// Withdraw-old-then-insert-new is a read-then-write pair, not atomic -- two near-simultaneous
// propose calls (double-click, a retried Discord interaction) could both see "nothing pending"
// and both insert, leaving a permanently orphaned duplicate since every read path only ever
// looks at the single newest pending row. rec_game_time_proposals_one_pending_uidx (a partial
// unique index on game_id where status='pending') makes the DB reject the loser's insert
// instead of silently accepting a second pending row; this retries once after re-withdrawing,
// which resolves cleanly once the winner's insert has landed.
async function withdrawPendingAndInsertProposal(gameId: string, userId: string, proposedForUtc: string, counterToId?: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const withdrawn = await supabase.from("rec_game_time_proposals")
      .update({ status: "withdrawn", responded_at: new Date().toISOString() })
      .eq("game_id", gameId)
      .eq("status", "pending");
    if (withdrawn.error) throw new ApiError(500, "Failed to replace the pending proposed time.", withdrawn.error);

    const insert = await supabase.from("rec_game_time_proposals").insert({
      game_id: gameId, proposed_by_user_id: userId, proposed_for: proposedForUtc, status: "pending",
      ...(counterToId ? { counter_to_id: counterToId } : {}),
    }).select("*").single();
    if (!insert.error) return insert.data;
    if (insert.error.code !== "23505" || attempt === 1) throw new ApiError(500, "Failed to save your proposed time.", insert.error);
    // Lost the race -- the other request's proposal is now the pending row; withdraw it and
    // insert ours as the new one instead of leaving the caller with a confusing failure.
  }
  throw new ApiError(500, "Failed to save your proposed time.");
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
  const insert = { data: await withdrawPendingAndInsertProposal(input.gameId, userId, input.proposedForUtc) };

  await supabase.from("rec_game_scheduling").update({ status: "proposed", proposed_by_user_id: userId, updated_at: now }).eq("game_id", input.gameId);
  await markResponded(input.gameId, userId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_created", payload: { proposedForUtc: input.proposedForUtc } });
  await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} proposed to play at **${formatInstantInZone(input.proposedForUtc, ctx.tz)}** — waiting on response from ${ctx.opponentMention}`, insert.data.id);
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  await refreshMatchupsChannelForGame(input.gameId);
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
    await closeOutProposalNotice(proposal.data, "This proposed time was withdrawn.");
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  await refreshMatchupsChannelForGame(input.gameId);
    return { status: "withdrawn" };
  }

  if (proposal.data.proposed_by_user_id === userId) throw new ApiError(403, "You can't respond to your own proposal.");

  if (input.action === "reject") {
    await supabase.from("rec_game_time_proposals").update({ status: "rejected", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    await supabase.from("rec_game_scheduling").update({ status: "not_scheduled", updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
    await markResponded(input.gameId, userId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_rejected", payload: { proposedFor: proposal.data.proposed_for } });
    await closeOutProposalNotice(proposal.data, "❌ Declined — a new time needs to be proposed.");
    await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} declined the proposed **${formatInstantInZone(proposal.data.proposed_for, ctx.tz)}** — propose a new time. ${ctx.opponentMention}`);
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
    await refreshMatchupsChannelForGame(input.gameId);
    return { status: "rejected" };
  }

  if (input.action === "accept") {
    await supabase.from("rec_game_time_proposals").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
    // Guard against a stream auto-triggering markGameStarted (which withdraws pending proposals,
    // but as a separate statement) in the narrow window between this accept reading the proposal
    // as pending and this write landing -- without .neq("status","live") a still-in-flight accept
    // could overwrite a game that's already live with a stale "confirmed" + future kickoff time.
    await supabase.from("rec_game_scheduling").update({
      status: "confirmed", scheduled_for: proposal.data.proposed_for, confirmed_at: new Date().toISOString(),
      accepted_by_user_id: userId, updated_at: new Date().toISOString(),
    }).eq("game_id", input.gameId).neq("status", "live");
    await markResponded(input.gameId, userId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_accepted", payload: { proposedFor: proposal.data.proposed_for } });
    await closeOutProposalNotice(proposal.data, "✅ Accepted — game confirmed!");
    await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.opponentMention} — your proposed time was accepted by ${ctx.actingMention}: **${formatInstantInZone(proposal.data.proposed_for, ctx.tz)}**. Game confirmed!`);
    await postOrUpdateGameAnnouncement(input.gameId, { announceNow: true }).catch((error) => console.error("[ERROR] Failed to post game announcement (non-fatal):", error));
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
    await refreshMatchupsChannelForGame(input.gameId);
    return { status: "confirmed", scheduledFor: proposal.data.proposed_for };
  }

  // Counter.
  if (!input.counterForUtc) throw new ApiError(400, "A counter needs a proposed time.");
  await supabase.from("rec_game_time_proposals").update({ status: "countered", responded_at: new Date().toISOString() }).eq("id", input.proposalId);
  const counter = { data: await withdrawPendingAndInsertProposal(input.gameId, userId, input.counterForUtc, input.proposalId) };
  await supabase.from("rec_game_scheduling").update({ status: "proposed", proposed_by_user_id: userId, updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await markResponded(input.gameId, userId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "proposal_countered", payload: { proposedForUtc: input.counterForUtc } });
  await closeOutProposalNotice(proposal.data, "🔁 Countered — see the new proposed time below.");
  await notifyOpponent(input.gameId, game, userId, (ctx) => `${ctx.actingMention} countered with **${formatInstantInZone(input.counterForUtc!, ctx.tz)}** — waiting on response from ${ctx.opponentMention}`, counter.data.id);
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  await refreshMatchupsChannelForGame(input.gameId);
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
  await refreshMatchupsChannelForGame(input.gameId);
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

// Flips a game live -- triggered automatically the first time either coach posts a stream
// (discordId omitted, system call), or manually via the "Game Started" panel button (discordId
// required, must be one of the two coaches). Idempotent: a second stream from the other coach,
// or a stray click, is a no-op here (the caller still refreshes the announcement separately so
// a later stream's link gets added either way -- see postOrUpdateGameAnnouncement call sites in
// hub.service.ts's shareHubMatchupStream and streams.service.ts's recordStreamPost).
//
// The flip itself is a single conditional UPDATE (.is("game_started_at", null)) rather than a
// read-then-write -- both coaches clicking "Game Started" at once, or a click racing a stream
// auto-trigger, would otherwise both read game_started_at as null and both go on to post a
// duplicate @everyone LIVE announcement. Only the request whose UPDATE actually matches a row
// proceeds past this point; the loser sees zero rows affected and returns quietly.
export async function markGameStarted(input: { gameId: string; discordId?: string | null }) {
  await ensureScheduling(input.gameId);
  if (input.discordId) {
    const game = await loadGame(input.gameId);
    const userId = await userIdFromDiscordId(input.discordId);
    if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can mark the game started.");
  }
  const updated = await supabase.from("rec_game_scheduling").update({
    game_started_at: new Date().toISOString(), status: "live", scheduled_for: null, updated_at: new Date().toISOString(),
  }).eq("game_id", input.gameId).is("game_started_at", null).neq("status", "completed").select("*").maybeSingle();
  if (updated.error) throw new ApiError(500, "Failed to mark the game started.", updated.error);
  if (!updated.data) {
    const existing = await supabase.from("rec_game_scheduling").select("*").eq("game_id", input.gameId).maybeSingle();
    if (existing.data?.status === "completed") throw new ApiError(409, "This game has already been marked over.");
    return existing.data;
  }
  // A live game makes any pending/confirmed kickoff moot -- it's happening right now.
  await supabase.from("rec_game_time_proposals").update({ status: "withdrawn", responded_at: new Date().toISOString() }).eq("game_id", input.gameId).eq("status", "pending");
  await logSchedulingEvent({ gameId: input.gameId, eventType: "game_started" });
  await postOrUpdateGameAnnouncement(input.gameId, { announceNow: true }).catch((error) => console.error("[ERROR] Failed to post live game announcement (non-fatal):", error));
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  await refreshMatchupsChannelForGame(input.gameId);
  return updated.data;
}

const POSTSEASON_STAGE_KEYS = ["wild_card", "divisional", "conference_championship", "super_bowl", "postseason", "playoffs", "national_championship"];

// Shared by requestForceWin and the Can't Make Game flow below -- both need "which FW/FS rule
// keys are active for this league at the CURRENT season stage" rather than the raw regular vs.
// postseason columns.
async function getActiveRuleKeys(leagueId: string): Promise<{ forceWin: ReturnType<typeof sanitizeForceWinRuleKeys>; fairSim: ReturnType<typeof sanitizeFairSimRuleKeys> }> {
  const [leagueStageRow, config] = await Promise.all([
    supabase.from("rec_leagues").select("season_stage").eq("id", leagueId).maybeSingle(),
    supabase.from("rec_league_configuration").select("force_win_rules_regular,force_win_rules_postseason,fair_sim_rules_regular,fair_sim_rules_postseason").eq("league_id", leagueId).maybeSingle(),
  ]);
  const isPostseason = POSTSEASON_STAGE_KEYS.includes(String(leagueStageRow.data?.season_stage ?? ""));
  return {
    forceWin: sanitizeForceWinRuleKeys(isPostseason ? config.data?.force_win_rules_postseason : config.data?.force_win_rules_regular),
    fairSim: sanitizeFairSimRuleKeys(isPostseason ? config.data?.fair_sim_rules_postseason : config.data?.fair_sim_rules_regular),
  };
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

  const activeRules = (await getActiveRuleKeys(game.league_id)).forceWin;
  if (!activeRules.includes("missed_window")) {
    throw new ApiError(403, "Force Win for a missed kickoff window is not enabled for this league.");
  }

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
  await refreshMatchupsChannelForGame(input.gameId);
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
    // Track this message's location on the proposal it belongs to so respondToProposal can find
    // it later and edit the Accept/Counter buttons away once someone actually responds, instead
    // of leaving a resolved offer's buttons clickable forever.
    if (posted?.id && proposalId) {
      await supabase.from("rec_game_time_proposals").update({ notice_channel_id: channel.discord_channel_id, notice_message_id: posted.id }).eq("id", proposalId)
        .then(({ error }) => { if (error) console.error("[ERROR] notifyOpponent: failed to record notice message id (non-fatal):", error); });
    }
  } else {
    console.error(`[ERROR] notifyOpponent: tracked game channel ${channel.id} has no discord_channel_id -- opponent not tagged.`);
  }

  if (opponentId) {
    const title = proposalId ? "Scheduling: a time needs your response" : "Scheduling update";
    await notifyCoachDirectly({ userId: opponentId, gameId, leagueId: game.league_id, title, message: resolvedText })
      .catch((error) => console.error("[ERROR] notifyOpponent: failed to send direct notification (non-fatal):", error));
  }
}

// Once a proposal is accepted/countered/rejected/withdrawn, its original Accept/Counter message
// (posted by notifyOpponent above) is stale -- clicking either button on it would try to respond
// to an already-resolved proposal. Strip the buttons and relabel the message with the outcome
// instead of leaving live-looking buttons on a dead offer.
async function closeOutProposalNotice(proposal: { notice_channel_id?: string | null; notice_message_id?: string | null }, resolutionLine: string) {
  if (!proposal.notice_channel_id || !proposal.notice_message_id) return;
  await editDiscordMessage(proposal.notice_channel_id, proposal.notice_message_id, { content: resolutionLine, components: [] })
    .catch((error) => console.error("[ERROR] closeOutProposalNotice: failed to edit original proposal message (non-fatal):", error));
}

function formatIsoShort(iso: string): string {
  return new Date(iso).toUTCString().replace(" GMT", " UTC");
}

// What options are actually available to a coach who can't make it, given the league's FW/FS
// rule settings for the CURRENT season stage. Fetched by the bot before it renders the initial
// ephemeral choice, so a disabled option is never even shown.
export async function getCantMakeGameOptions(input: { gameId: string; discordId: string }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can use Can't Make Game.");
  const active = await getActiveRuleKeys(game.league_id);
  return {
    canGrantForceWin: active.forceWin.length > 0 && !active.forceWin.includes("never"),
    canRequestFairSim: active.fairSim.length > 0,
    allowAutopilotRequests: active.fairSim.includes("allow_autopilot_requests"),
  };
}

// "Can't Make Game" -- a coach who knows ahead of time their availability doesn't cover any
// window before the deadline flags it, then picks how to proceed:
// - "grant_fw": self-forfeit -- concedes the Force Win to the opponent outright. Public,
//   commish-tagged confirmation; no opponent response needed, nothing left to decide.
// - "request_fs": tags the opponent with Grant Fair Sim / Request AutoPilot choices (handled by
//   resolveCantMakeGame below); doesn't touch scheduling status itself since nothing is decided
//   until the opponent responds.
export async function markCantMakeGame(input: { gameId: string; discordId: string; choice: "grant_fw" | "request_fs" }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can use Can't Make Game.");
  const opponentId = userId === game.home_user_id ? game.away_user_id : game.home_user_id;
  if (!opponentId) throw new ApiError(400, "This game has no opponent.");

  const active = await getActiveRuleKeys(game.league_id);
  await ensureScheduling(input.gameId);

  if (input.choice === "grant_fw") {
    if (!active.forceWin.length || active.forceWin.includes("never")) throw new ApiError(403, "Force Win is not enabled for this league at this stage.");
    await supabase.from("rec_game_scheduling").update({
      status: "needs_commissioner_help", fw_flagged: true, fw_flagged_for_user_id: opponentId, fw_flagged_at: new Date().toISOString(),
      attention_required: true, updated_at: new Date().toISOString(),
    }).eq("game_id", input.gameId);
    await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "cant_make_game_grant_fw" });

    const routes = await findServerRoutesForLeague(game.league_id);
    const channel = await getGameChannelByGameId(input.gameId);
    if (channel?.discord_channel_id) {
      const commissionerRoleId = String((routes?.routes as any)?.commissioner_role_id ?? "");
      const roleMention = commissionerRoleId ? `<@&${commissionerRoleId}> ` : "";
      await postDiscordChannelMessage(channel.discord_channel_id, {
        content: `🏳️ **Force Win conceded.** ${roleMention}A coach can't make this game and has conceded the Force Win to their opponent — flagged in Advance Readiness for review.`,
        allowed_mentions: commissionerRoleId ? { roles: [commissionerRoleId] } : { parse: [] },
      }).catch(() => undefined);
    }
    await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
    await refreshMatchupsChannelForGame(input.gameId);
    return { flagged: true, opponentId };
  }

  if (!active.fairSim.length) throw new ApiError(403, "Fair Sim is not enabled for this league at this stage.");
  await supabase.from("rec_game_scheduling").update({ status: "needs_commissioner_help", attention_required: true, updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "cant_make_game" });

  const opponentAccount = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", opponentId).maybeSingle();
  const opponentDiscordId = opponentAccount.data?.discord_id ? String(opponentAccount.data.discord_id) : null;
  const channel = await getGameChannelByGameId(input.gameId);
  if (channel?.discord_channel_id) {
    const mention = opponentDiscordId ? `<@${opponentDiscordId}> ` : "";
    const buttons = [{ type: 2, style: 3, custom_id: `rec:gamesched:cantmake:accept_fs:${input.gameId}`, label: "Grant Fair Sim" }];
    if (active.fairSim.includes("allow_autopilot_requests")) {
      buttons.push({ type: 2, style: 2, custom_id: `rec:gamesched:cantmake:autopilot:${input.gameId}`, label: "Request AutoPilot" } as any);
    }
    await postDiscordChannelMessage(channel.discord_channel_id, {
      content: `${mention}Your opponent can't make this game before the deadline. Choose how to proceed:`,
      components: [{ type: 1, components: buttons }],
      allowed_mentions: opponentDiscordId ? { users: [opponentDiscordId] } : { parse: [] },
    }).catch(() => undefined);
  }
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  await refreshMatchupsChannelForGame(input.gameId);
  return { flagged: true, opponentId, opponentDiscordId };
}

// The opponent's response to markCantMakeGame's "request_fs" branch. Grant Fair Sim resolves
// it outright (FS is the automatic default once nothing gets scheduled, so there's nothing
// further to apply). Request AutoPilot escalates to the commissioner team with real Grant
// AutoPilot / Enforce FS buttons (resolveAutopilotRequest below) instead of only a ticket.
export async function resolveCantMakeGame(input: { gameId: string; discordId: string; choice: "accept_fs" | "request_autopilot" }) {
  const game = await loadGame(input.gameId);
  const userId = await userIdFromDiscordId(input.discordId);
  if (userId !== game.home_user_id && userId !== game.away_user_id) throw new ApiError(403, "Only the two coaches in this matchup can respond.");
  await logSchedulingEvent({ gameId: input.gameId, userId, eventType: "cant_make_game_resolved", payload: { choice: input.choice } });

  const channel = await getGameChannelByGameId(input.gameId);

  if (input.choice === "request_autopilot") {
    const routes = await findServerRoutesForLeague(game.league_id);
    await submitMatchupHelpRequest({
      guildId: routes?.guildId ?? siteOnlyGuildId(game.league_id),
      discordId: input.discordId,
      gameId: input.gameId,
      kind: "autopilot",
      message: "Opponent can't make the game before the deadline; requesting AutoPilot instead of a Fair Sim.",
    }).catch((err) => console.error("[ERROR] Failed to file the AutoPilot Request Help ticket (non-fatal):", err));

    if (channel?.discord_channel_id) {
      const commissionerRoleId = String((routes?.routes as any)?.commissioner_role_id ?? "");
      const roleMention = commissionerRoleId ? `<@&${commissionerRoleId}> ` : "";
      await postDiscordChannelMessage(channel.discord_channel_id, {
        content: `${roleMention}AutoPilot requested instead of a Fair Sim for this game.`,
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, custom_id: `rec:gamesched:apresolve:grant:${input.gameId}`, label: "Grant AutoPilot" },
            { type: 2, style: 4, custom_id: `rec:gamesched:apresolve:enforcefs:${input.gameId}`, label: "Enforce FS" },
          ],
        }],
        allowed_mentions: commissionerRoleId ? { roles: [commissionerRoleId] } : { parse: [] },
      }).catch(() => undefined);
    }
    return { choice: input.choice };
  }

  if (channel?.discord_channel_id) {
    await postDiscordChannelMessage(channel.discord_channel_id, { content: "Scheduling: opponent granted a Fair Sim for this game." }).catch(() => undefined);
  }
  return { choice: input.choice };
}

// Commissioner resolution of an AutoPilot request (resolveCantMakeGame's request_autopilot
// branch above). AutoPilot itself is advisory/manual today -- there's no mechanical
// "play both sides" toggle anywhere in the codebase -- so this records the decision and posts a
// public confirmation, same scope as every other FW/FS status flag in this file.
export async function resolveAutopilotRequest(input: { gameId: string; discordId: string; decision: "grant_autopilot" | "enforce_fs" }) {
  const game = await loadGame(input.gameId);
  await logSchedulingEvent({ gameId: input.gameId, userId: await userIdFromDiscordId(input.discordId).catch(() => null), eventType: "autopilot_resolved", payload: { decision: input.decision } });

  const channel = await getGameChannelByGameId(input.gameId);
  if (channel?.discord_channel_id) {
    const text = input.decision === "grant_autopilot"
      ? "✅ AutoPilot **granted** by a commissioner — the opponent may play both sides."
      : "Fair Sim **enforced** by a commissioner — AutoPilot was not granted.";
    await postDiscordChannelMessage(channel.discord_channel_id, { content: text }).catch(() => undefined);
  }
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  return { decision: input.decision };
}

// Commissioner-only escape hatch: wipes this game's scheduling state entirely (status, proposed
// time, FW flag, pending proposals, kickoff check-ins) so both coaches can restart scheduling
// from scratch -- e.g. a "Can't Make Game" that later turns out to have been premature.
async function resetSchedulingInternal(gameId: string, userId: string | null, eventType: string, channelMessage: string) {
  await Promise.all([
    supabase.from("rec_game_scheduling").update({
      status: "not_scheduled", response_started_at: new Date().toISOString(), home_responded_at: null, away_responded_at: null,
      scheduled_for: null, confirmed_at: null, proposed_by_user_id: null, accepted_by_user_id: null,
      reschedule_requested_at: null, game_started_at: null, fw_flagged: false, fw_flagged_for_user_id: null,
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
  await refreshMatchupsChannelForGame(gameId);
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
// apps/bot/src/flows/game-scheduling-panel.ts listens for. The second row's first button toggles
// between "Game Started" and "Game Over" depending on whether the game is currently live (and
// disappears once completed, so a finished game can't be re-flipped live from a stale panel) --
// "Game Over" reuses the exact custom_id prefix (rec:gamesched:gameover:) the standalone
// post-stream reminder already posts, so the existing modal handler covers both without any
// bot-side branching.
// Propose Time is context-aware: same button/customId, but its label reflects what clicking
// it will actually do given the current state, so a coach isn't guessing whether it'll propose
// a fresh time or edit/cancel one that already exists.
function proposeButtonLabel(status: UserFacingStatus): string {
  if (status === "time_proposed") return "Edit Proposal";
  if (status === "confirmed" || status === "reschedule_requested") return "Reschedule / Cancel";
  return "Propose Time";
}

function schedulingPanelComponents(gameId: string, status: UserFacingStatus) {
  const lifecycleButton = status === "completed" ? null
    : status === "live" ? { type: 2, style: 3, custom_id: `rec:gamesched:gameover:${gameId}`, label: "Game Over" }
    : { type: 2, style: 1, custom_id: `rec:gamesched:panel:gamestarted:${gameId}`, label: "Game Started" };
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `rec:gamesched:panel:availability:${gameId}`, label: "Adjust Availability" },
        { type: 2, style: 1, custom_id: `rec:gamesched:panel:propose:${gameId}`, label: proposeButtonLabel(status) },
        { type: 2, style: 4, custom_id: `rec:gamesched:panel:cantmake:${gameId}`, label: "Can't Make Game" },
      ],
    },
    {
      type: 1,
      components: [
        ...(lifecycleButton ? [lifecycleButton] : []),
        { type: 2, style: 2, custom_id: `rec:gamesched:panel:reset:${gameId}`, label: "Reset (Commissioner)" },
      ],
    },
  ];
}

async function schedulingPanelDescription(gameId: string, status: UserFacingStatus): Promise<string> {
  if (status === "live") {
    const scheduling = await supabase.from("rec_game_scheduling").select("game_started_at").eq("game_id", gameId).maybeSingle();
    if (scheduling.data?.game_started_at) {
      const unix = Math.floor(new Date(scheduling.data.game_started_at).getTime() / 1000);
      return `🔴 LIVE — started <t:${unix}:R>. Hit Game Over below once it's done.`;
    }
    return "🔴 LIVE — hit Game Over below once it's done.";
  }
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

async function getGameTeamNames(gameId: string): Promise<{ home: string; away: string }> {
  const row = await supabase.from("rec_games").select("home_team_id,away_team_id").eq("id", gameId).maybeSingle();
  const homeId = row.data?.home_team_id ? String(row.data.home_team_id) : null;
  const awayId = row.data?.away_team_id ? String(row.data.away_team_id) : null;
  const ids = [homeId, awayId].filter((v): v is string => Boolean(v));
  if (!ids.length) return { home: "Home", away: "Away" };
  const teams = await supabase.from("rec_teams").select("id,name").in("id", ids);
  const byId = new Map<string, string>((teams.data ?? []).map((t: any): [string, string] => [String(t.id), String(t.name)]));
  return { home: (homeId ? byId.get(homeId) : null) ?? "Home", away: (awayId ? byId.get(awayId) : null) ?? "Away" };
}

// Discord auto-localizes <t:...> markup to each viewer's own client settings, so this reads
// correctly for both coaches and any commissioner glancing at the channel without picking a
// zone to render in server-side.
function formatWindowLines(intervals: Array<{ startUtc: string; endUtc: string }>, max = 8): string {
  if (!intervals.length) return "_No availability set for this window._";
  const lines = intervals.slice(0, max).map((iv) => {
    const startUnix = Math.floor(new Date(iv.startUtc).getTime() / 1000);
    const endUnix = Math.floor(new Date(iv.endUtc).getTime() / 1000);
    return `<t:${startUnix}:F> – <t:${endUnix}:t>`;
  });
  if (intervals.length > max) lines.push(`_+${intervals.length - max} more window(s)_`);
  return lines.join("\n");
}

// Both coaches' free windows between now and the next advance (or the 48h fallback horizon) --
// shown on the panel so a coach doesn't have to open Adjust Availability just to see whether a
// proposed/suggested time actually falls inside the other coach's known-free time.
async function buildAvailabilityFields(gameId: string, game: Game): Promise<Array<{ name: string; value: string }>> {
  if (!game.home_user_id || !game.away_user_id) return [];
  try {
    const nowUtc = new Date().toISOString();
    const deadlineUtc = await getDeadlineUtc(game.league_id);
    const [home, away, names] = await Promise.all([
      getEffectiveAvailability({ userId: game.home_user_id, leagueId: game.league_id, gameId, fromUtc: nowUtc, toUtc: deadlineUtc }),
      getEffectiveAvailability({ userId: game.away_user_id, leagueId: game.league_id, gameId, fromUtc: nowUtc, toUtc: deadlineUtc }),
      getGameTeamNames(gameId),
    ]);
    return [
      { name: `${names.home} — Available Until Next Advance`, value: formatWindowLines(home.intervals) },
      { name: `${names.away} — Available Until Next Advance`, value: formatWindowLines(away.intervals) },
    ];
  } catch (error) {
    console.error("[ERROR] Failed to build availability fields for scheduling panel (non-fatal):", error);
    return [];
  }
}

async function buildSchedulingPanelPayload(gameId: string) {
  const [game, status] = await Promise.all([loadGame(gameId).catch(() => null), computeUserFacingStatus(gameId)]);
  const isLive = status === "live";
  const showAvailability = game && status !== "live" && status !== "completed";
  const [description, fields] = await Promise.all([
    schedulingPanelDescription(gameId, status),
    showAvailability ? buildAvailabilityFields(gameId, game) : Promise.resolve([]),
  ]);
  return {
    embeds: [{ title: "Scheduling", color: isLive ? 0xdc3545 : 0xd9a521, description, fields }],
    components: schedulingPanelComponents(gameId, status),
  };
}

export async function postSchedulingPanel(channelId: string, gameId: string) {
  const payload = await buildSchedulingPanelPayload(gameId);
  const posted = await postDiscordChannelMessage(channelId, payload)
    .catch((error) => { console.error("[ERROR] Failed to post scheduling panel (non-fatal):", error); return null; });
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
  const payload = await buildSchedulingPanelPayload(gameId);
  await editDiscordMessage(row.data.panel_channel_id, row.data.panel_message_id, payload)
    .catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
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
      if (["confirmed", "completed", "reschedule_requested", "no_shared_availability", "needs_commissioner_help", "live"].includes(s.status)) status = s.status as UserFacingStatus;
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
  if (s.status === "confirmed" || s.status === "completed" || s.status === "reschedule_requested" || s.status === "no_shared_availability" || s.status === "needs_commissioner_help" || s.status === "live") {
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
