// Fantasy/off-season draft turn-order coordinator. REC does NOT track which player each team
// picks anymore -- that proved too tedious/time-consuming in practice, and leagues no longer
// seed a baseline roster to draft from anyway (rosters populate from the first EA import
// instead). This is purely a pick-clock companion to the real in-Madden draft: whose turn it
// is, an optional per-pick timer (with a 15-second-remaining Discord warning before an
// auto-skip), and five commissioner-only controls (Start/End Draft, Set Pick Order, Skip to
// Next Pick, Skip to a Specific Pick). Every state change broadcasts a
// `fantasy_draft:{leagueId}` realtime refresh event over the websocket transport kept for this
// purpose (apps/api/src/modules/chat/chat-realtime.ts).
import { supabase } from "../../lib/supabase.js";
import { bestEffort, bestEffortVoid } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { sendPushToUsers } from "../push/push.service.js";
import {
  getCurrentLeagueContext,
  isSiteOnlyDiscordId,
  recUserIdFromSiteOnlyDiscordId,
} from "../league-context/league-context.service.js";

export type FantasyDraftStatus = "not_started" | "live" | "concluded";
export type FantasyDraftOrderMode = "standard" | "snake";
export type FantasyDraftType = "fantasy" | "offseason";

// Offseason drafts are fixed-length (rosters just need a top-up, not a full rebuild);
// fantasy drafts have no fixed length -- the commissioner ends it manually with End Draft.
const OFFSEASON_TOTAL_ROUNDS = 7;
const WARNING_THRESHOLD_MS = 15_000;
const ON_THE_CLOCK_COLOR = 0xd9a521;

type SessionRow = {
  id: string;
  league_id: string;
  status: FantasyDraftStatus;
  draft_type: FantasyDraftType;
  order_mode: FantasyDraftOrderMode | null;
  current_round: number;
  current_pick_in_round: number;
  total_rounds: number | null;
  pick_timer_seconds: number | null;
  turn_started_at: string | null;
  warning_sent: boolean;
  commenced_by_user_id: string | null;
  commenced_at: string | null;
  concluded_at: string | null;
  on_clock_message_channel_id: string | null;
  on_clock_message_id: string | null;
  created_at: string;
  updated_at: string;
};

type Team = { id: string; name: string; displayName: string; abbreviation: string | null };
type PickOrderEntry = { pickInRound: number; teamId: string };

async function resolveRecUserId(discordId: string): Promise<string | null> {
  if (isSiteOnlyDiscordId(discordId)) return recUserIdFromSiteOnlyDiscordId(discordId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't load your REC account. Please try again.", account.error);
  return account.data?.user_id ?? null;
}

async function getActiveSession(leagueId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from("rec_fantasy_draft_sessions")
    .select("*")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load the draft session right now. Please try again.", error);
  return (data as SessionRow | null) ?? null;
}

async function requireActiveSession(leagueId: string): Promise<SessionRow> {
  const session = await getActiveSession(leagueId);
  if (!session) throw new ApiError(404, "This league has no draft session yet.");
  return session;
}

function requireSessionStatus(session: SessionRow, allowed: FantasyDraftStatus[]) {
  if (!allowed.includes(session.status)) {
    throw new ApiError(409, `This action requires the draft to be ${allowed.join(" or ")}, but it is ${session.status}.`);
  }
}

function serializeSession(row: SessionRow) {
  return {
    id: row.id,
    leagueId: row.league_id,
    status: row.status,
    draftType: row.draft_type,
    orderMode: row.order_mode,
    currentRound: row.current_round,
    currentPickInRound: row.current_pick_in_round,
    totalRounds: row.total_rounds,
    pickTimerSeconds: row.pick_timer_seconds,
    turnStartedAt: row.turn_started_at,
    commencedByUserId: row.commenced_by_user_id,
    commencedAt: row.commenced_at,
    concludedAt: row.concluded_at,
  };
}

async function listTeams(leagueId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from("rec_teams")
    .select("id,name,display_nick,display_abbr,abbreviation")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load league teams right now. Please try again.", error);
  return (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    displayName: t.display_nick ?? t.display_abbr ?? t.name,
    abbreviation: t.abbreviation ?? null,
  }));
}

async function listPickOrder(sessionId: string): Promise<PickOrderEntry[]> {
  const { data, error } = await supabase
    .from("rec_fantasy_draft_pick_order")
    .select("*")
    .eq("session_id", sessionId)
    .order("pick_in_round", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load the pick order right now. Please try again.", error);
  return (data ?? []).map((row: any) => ({ pickInRound: row.pick_in_round, teamId: row.team_id }));
}

/** Snake reverses the round-1 order on even rounds; standard repeats the same order every round. */
function teamOnTheClock(session: Pick<SessionRow, "order_mode" | "current_round" | "current_pick_in_round">, pickOrder: PickOrderEntry[]): string | null {
  if (!pickOrder.length) return null;
  const index = session.current_pick_in_round - 1;
  if (session.order_mode === "snake" && session.current_round % 2 === 0) {
    return pickOrder[pickOrder.length - 1 - index]?.teamId ?? null;
  }
  return pickOrder[index]?.teamId ?? null;
}

async function resolveTeamOwnerUserId(leagueId: string, teamId: string): Promise<string | null> {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load the team owner. Please try again.", assignment.error);
  return assignment.data?.user_id ?? null;
}

async function resolveTeamOwnerDiscordId(leagueId: string, teamId: string): Promise<string | null> {
  const ownerUserId = await resolveTeamOwnerUserId(leagueId, teamId);
  if (!ownerUserId) return null;
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", ownerUserId).maybeSingle();
  if (account.error) return null;
  return account.data?.discord_id ?? null;
}

async function setLeagueFantasyDraftStatus(leagueId: string, status: string) {
  const { error } = await supabase.from("rec_leagues").update({ fantasy_draft_status: status }).eq("id", leagueId);
  if (error) throw new ApiError(500, "We couldn't update the fantasy draft status. Please try again.", error);
}

async function announcementsChannelIdForLeague(leagueId: string): Promise<string | null> {
  const context = await bestEffort("fantasy_draft.load_league_context", () => getCurrentLeagueContext(leagueId), { leagueId }) ?? null;
  return (context?.routes as any)?.announcements_channel_id ?? null;
}

function formatTimeRemaining(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

/** Posts a brand-new "you're on the clock" announcement (never edits in place -- a turn
 * beginning is a fresh event the on-the-clock coach needs to actually notice, not a silent
 * edit to a message they may have already scrolled past). Silent no-op with no announcements
 * channel configured. */
async function postOnTheClockAnnouncement(leagueId: string, teams: Team[], session: SessionRow, pickOrder: PickOrderEntry[]): Promise<void> {
  const announcementsChannelId = await announcementsChannelIdForLeague(leagueId);
  if (!announcementsChannelId) return;
  const onTheClockTeamId = teamOnTheClock(session, pickOrder);
  const onTheClockTeam = teams.find((t) => t.id === onTheClockTeamId) ?? null;
  if (!onTheClockTeam) return;
  const ownerDiscordId = await resolveTeamOwnerDiscordId(leagueId, onTheClockTeam.id);
  const content = ownerDiscordId ? `<@${ownerDiscordId}>` : undefined;
  const timerLine = session.pick_timer_seconds
    ? `\nYou have **${formatTimeRemaining(session.pick_timer_seconds)}** to make your pick before it's skipped.`
    : "";
  const posted = await bestEffort("discord.post_on_clock_announcement", () => postDiscordChannelMessage(announcementsChannelId, {
    content,
    embeds: [{
      title: "On The Clock",
      color: ON_THE_CLOCK_COLOR,
      description: `**${onTheClockTeam.displayName}**, you're on the clock! (Round ${session.current_round}, Pick ${session.current_pick_in_round})${timerLine}`,
    }],
    allowed_mentions: ownerDiscordId ? { users: [ownerDiscordId] } : undefined,
  }), { leagueId, entityId: session.id }) ?? null;
  if (posted?.id) {
    await supabase.from("rec_fantasy_draft_sessions").update({
      on_clock_message_channel_id: announcementsChannelId,
      on_clock_message_id: posted.id,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id).then(() => undefined, () => undefined);
  }
  if (ownerDiscordId) {
    const ownerUserId = await resolveTeamOwnerUserId(leagueId, onTheClockTeam.id);
    if (ownerUserId) {
      bestEffortVoid("push.fantasy_draft_on_clock", sendPushToUsers([ownerUserId], {
        title: "You're on the clock",
        body: `Round ${session.current_round}, Pick ${session.current_pick_in_round} (${onTheClockTeam.displayName}).`,
      }), { leagueId, userId: ownerUserId });
    }
  }
}

async function postFifteenSecondWarning(leagueId: string, teams: Team[], session: SessionRow, pickOrder: PickOrderEntry[]): Promise<void> {
  const announcementsChannelId = await announcementsChannelIdForLeague(leagueId);
  if (!announcementsChannelId) return;
  const onTheClockTeamId = teamOnTheClock(session, pickOrder);
  const onTheClockTeam = teams.find((t) => t.id === onTheClockTeamId) ?? null;
  if (!onTheClockTeam) return;
  const ownerDiscordId = await resolveTeamOwnerDiscordId(leagueId, onTheClockTeam.id);
  const content = ownerDiscordId ? `<@${ownerDiscordId}>` : undefined;
  await bestEffort("discord.post_fifteen_second_warning", () => postDiscordChannelMessage(announcementsChannelId, {
    content,
    embeds: [{
      title: "⚠️ 15 Seconds Left",
      color: 0xdc3545,
      description: `**${onTheClockTeam.displayName}**, you have **15 seconds** left before your pick is skipped!`,
    }],
    allowed_mentions: ownerDiscordId ? { users: [ownerDiscordId] } : undefined,
  }), { leagueId, entityId: session.id });
}

/** Pure round/pick advance -- one slot forward, wrapping into the next round at the end of
 * the pick order. Returns null if the draft has just run out of rounds (offseason only; a
 * fantasy draft's total_rounds is null, so it never runs out -- the commissioner ends it). */
function advancePick(session: SessionRow, pickOrderLength: number): { round: number; pickInRound: number } | null {
  let round = session.current_round;
  let pickInRound = session.current_pick_in_round + 1;
  if (pickInRound > pickOrderLength) {
    round += 1;
    pickInRound = 1;
  }
  if (session.total_rounds != null && round > session.total_rounds) return null;
  return { round, pickInRound };
}

/** Shared tail of every "the clock moves forward" action (manual skip-next, skip-to-specific,
 * and the timer sweep's auto-skip): persists the new round/pick, resets the per-pick timer
 * bookkeeping, and announces the new team on the clock. */
async function advanceAndAnnounce(leagueId: string, session: SessionRow, next: { round: number; pickInRound: number }): Promise<void> {
  const turnStartedAt = session.pick_timer_seconds ? new Date().toISOString() : null;
  await supabase.from("rec_fantasy_draft_sessions").update({
    current_round: next.round,
    current_pick_in_round: next.pickInRound,
    turn_started_at: turnStartedAt,
    warning_sent: false,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  const nextSession: SessionRow = { ...session, current_round: next.round, current_pick_in_round: next.pickInRound, turn_started_at: turnStartedAt, warning_sent: false };
  const [teams, pickOrder] = await Promise.all([listTeams(leagueId), listPickOrder(session.id)]);
  await bestEffort("discord.draft_on_clock_after_advance", () => postOnTheClockAnnouncement(leagueId, teams, nextSession, pickOrder), { leagueId, entityId: session.id });
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
}

export async function getFantasyDraftState(guildId: string, discordId: string, isCommissioner: boolean) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const [session, teams, userId] = await Promise.all([
    getActiveSession(leagueId),
    listTeams(leagueId),
    resolveRecUserId(discordId),
  ]);
  const pickOrder = session ? await listPickOrder(session.id) : [];

  let myTeamId: string | null = null;
  if (userId) {
    const assignment = await supabase
      .from("rec_team_assignments")
      .select("team_id")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .eq("assignment_status", "active")
      .is("ended_at", null)
      .maybeSingle();
    if (assignment.error) throw new ApiError(500, "We couldn't load your team. Please try again.", assignment.error);
    myTeamId = assignment.data?.team_id ?? null;
  }

  const onTheClockTeamId = session && session.status === "live" ? teamOnTheClock(session, pickOrder) : null;
  // The dropdown for "Skip to a Specific Pick" -- remaining slots this round, plus next
  // round's slots if another round is actually coming (unbounded for fantasy, capped at
  // total_rounds for offseason).
  const skipChoices: Array<{ round: number; pickInRound: number; teamId: string; teamName: string }> = [];
  if (session && session.status === "live" && pickOrder.length) {
    const teamById = new Map(teams.map((t) => [t.id, t.displayName]));
    let round = session.current_round;
    let pickInRound = session.current_pick_in_round;
    const roundsToShow = new Set([round, round + 1]);
    while (session.total_rounds == null || round <= session.total_rounds) {
      if (!roundsToShow.has(round)) break;
      const teamId = teamOnTheClock({ order_mode: session.order_mode, current_round: round, current_pick_in_round: pickInRound }, pickOrder);
      if (teamId) skipChoices.push({ round, pickInRound, teamId, teamName: teamById.get(teamId) ?? "Unknown" });
      pickInRound += 1;
      if (pickInRound > pickOrder.length) { pickInRound = 1; round += 1; }
    }
  }

  return {
    session: session ? serializeSession(session) : null,
    teams,
    pickOrder,
    onTheClockTeamId,
    skipChoices,
    caller: { isCommissioner, myTeamId },
  };
}

/** Creates a not_started session for a newly created league. Called from setup.service.ts
 * right after the league is created. Idempotent -- safe to call again if one already exists. */
export async function ensureFantasyDraftSession(leagueId: string): Promise<void> {
  const existing = await supabase.from("rec_fantasy_draft_sessions").select("id").eq("league_id", leagueId).limit(1).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't check for an existing draft session. Please try again.", existing.error);
  if (existing.data) return;
  const { error } = await supabase.from("rec_fantasy_draft_sessions").insert({
    league_id: leagueId,
    status: "not_started",
  });
  if (error) throw new ApiError(500, "We couldn't create the draft session. Please try again.", error);
}

export async function startFantasyDraft(guildId: string, discordId: string, input: { draftType: FantasyDraftType; pickTimerSeconds: number | null }) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const userId = await resolveRecUserId(discordId);
  let session = await getActiveSession(leagueId);
  const totalRounds = input.draftType === "offseason" ? OFFSEASON_TOTAL_ROUNDS : null;

  if (!session || session.status === "concluded") {
    const { data, error } = await supabase.from("rec_fantasy_draft_sessions").insert({
      league_id: leagueId,
      status: "live",
      draft_type: input.draftType,
      total_rounds: totalRounds,
      pick_timer_seconds: input.pickTimerSeconds,
      current_round: 1,
      current_pick_in_round: 1,
      commenced_by_user_id: userId,
      commenced_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw new ApiError(500, "We couldn't start the draft. Please try again.", error);
    session = data as SessionRow;
  } else {
    requireSessionStatus(session, ["not_started"]);
    const { data, error } = await supabase.from("rec_fantasy_draft_sessions").update({
      status: "live",
      draft_type: input.draftType,
      total_rounds: totalRounds,
      pick_timer_seconds: input.pickTimerSeconds,
      current_round: 1,
      current_pick_in_round: 1,
      warning_sent: false,
      commenced_by_user_id: userId,
      commenced_at: new Date().toISOString(),
      concluded_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id).select("*").single();
    if (error) throw new ApiError(500, "We couldn't start the draft. Please try again.", error);
    session = data as SessionRow;
  }

  const pickOrder = await listPickOrder(session.id);
  if (pickOrder.length) {
    const turnStartedAt = session.pick_timer_seconds ? new Date().toISOString() : null;
    await supabase.from("rec_fantasy_draft_sessions").update({ turn_started_at: turnStartedAt, updated_at: new Date().toISOString() }).eq("id", session.id);
    session.turn_started_at = turnStartedAt;
  }

  await setLeagueFantasyDraftStatus(leagueId, "live");

  const announcementsChannelId = await announcementsChannelIdForLeague(leagueId);
  const draftLabel = input.draftType === "offseason" ? "OFFSEASON DRAFT" : "FANTASY DRAFT";
  if (announcementsChannelId) {
    await bestEffort("discord.draft_start_announcement", () => postDiscordChannelMessage(announcementsChannelId, {
      content: "@everyone",
      embeds: [{
        title: `${draftLabel} IS LIVE`,
        color: ON_THE_CLOCK_COLOR,
        description: input.draftType === "offseason"
          ? "The offseason draft has started -- 7 rounds, standard order."
          : "The fantasy draft has started. Follow along in the league hub.",
      }],
      allowed_mentions: { parse: ["everyone"] },
    }), { leagueId, entityId: session.id });
  }
  const members = await supabase.from("rec_league_memberships").select("user_id").eq("league_id", leagueId);
  const userIds = [...new Set((members.data ?? []).map((m: any) => m.user_id).filter(Boolean))] as string[];
  if (userIds.length) {
    bestEffortVoid("push.fantasy_draft_live", sendPushToUsers(userIds, { title: `${draftLabel} is live!`, body: "The draft has started." }), { leagueId });
  }
  if (pickOrder.length) {
    const teams = await listTeams(leagueId);
    await bestEffort("discord.draft_on_clock_after_start", () => postOnTheClockAnnouncement(leagueId, teams, session as SessionRow, pickOrder), { leagueId, entityId: session.id });
  }

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

export async function endFantasyDraft(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live"]);

  await supabase.from("rec_fantasy_draft_sessions").update({
    status: "concluded",
    concluded_at: new Date().toISOString(),
    turn_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  await setLeagueFantasyDraftStatus(leagueId, "concluded");

  const announcementsChannelId = await announcementsChannelIdForLeague(leagueId);
  if (announcementsChannelId) {
    await bestEffort("discord.draft_end_announcement", () => postDiscordChannelMessage(announcementsChannelId, {
      content: "@everyone",
      embeds: [{ title: "DRAFT COMPLETE", color: ON_THE_CLOCK_COLOR, description: "The draft has concluded." }],
      allowed_mentions: { parse: ["everyone"] },
    }), { leagueId, entityId: session.id });
  }

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

export async function setFantasyDraftPickOrder(guildId: string, orderMode: FantasyDraftOrderMode, picks: PickOrderEntry[]) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["not_started", "live"]);
  if (session.draft_type === "offseason" && orderMode !== "standard") {
    throw new ApiError(400, "Offseason drafts always use standard order -- snake isn't available.");
  }

  const teams = await listTeams(leagueId);
  const teamCount = teams.length;
  if (picks.length !== teamCount) throw new ApiError(400, `Pick order must assign exactly ${teamCount} teams.`);
  const pickInRounds = picks.map((p) => p.pickInRound);
  if (new Set(pickInRounds).size !== teamCount || Math.min(...pickInRounds) < 1 || Math.max(...pickInRounds) > teamCount) {
    throw new ApiError(400, `Pick order must cover slots 1-${teamCount} exactly once.`);
  }
  const teamIds = picks.map((p) => p.teamId);
  if (new Set(teamIds).size !== teamCount) throw new ApiError(400, "Each team can occupy only one pick slot.");
  const leagueTeamIds = new Set(teams.map((t) => t.id));
  if (!teamIds.every((id) => leagueTeamIds.has(id))) throw new ApiError(400, "Every pick-order team must belong to this league.");

  const { error: deleteError } = await supabase.from("rec_fantasy_draft_pick_order").delete().eq("session_id", session.id);
  if (deleteError) throw new ApiError(500, "We couldn't replace the pick order. Please try again.", deleteError);
  const { error } = await supabase.from("rec_fantasy_draft_pick_order").insert(
    picks.map((p) => ({ session_id: session.id, pick_in_round: p.pickInRound, team_id: p.teamId })),
  );
  if (error) throw new ApiError(500, "We couldn't save the pick order. Please try again.", error);

  const wasFirstTimeSet = session.turn_started_at == null && session.status === "live" && session.pick_timer_seconds != null;
  const turnStartedAt = session.status === "live" && session.pick_timer_seconds ? new Date().toISOString() : session.turn_started_at;
  const { error: updateError } = await supabase.from("rec_fantasy_draft_sessions").update({
    order_mode: orderMode,
    turn_started_at: turnStartedAt,
    warning_sent: false,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (updateError) throw new ApiError(500, "We couldn't save the pick-order mode. Please try again.", updateError);

  if (session.status === "live") {
    const updatedSession: SessionRow = { ...session, order_mode: orderMode, turn_started_at: turnStartedAt };
    const pickOrder = picks;
    await bestEffort("discord.draft_on_clock_after_order_set", () => postOnTheClockAnnouncement(leagueId, teams, updatedSession, pickOrder), { leagueId, entityId: session.id });
  }
  void wasFirstTimeSet;

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, orderMode, count: teamCount };
}

export async function setFantasyDraftTimer(guildId: string, pickTimerSeconds: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["not_started", "live"]);

  const turnStartedAt = session.status === "live" && pickTimerSeconds ? new Date().toISOString() : null;
  const { error } = await supabase.from("rec_fantasy_draft_sessions").update({
    pick_timer_seconds: pickTimerSeconds,
    turn_started_at: turnStartedAt,
    warning_sent: false,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (error) throw new ApiError(500, "We couldn't update the pick timer. Please try again.", error);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, pickTimerSeconds };
}

export async function skipFantasyDraftPick(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live"]);
  const pickOrder = await listPickOrder(session.id);
  if (!pickOrder.length) throw new ApiError(409, "Set the pick order before skipping picks.");

  const next = advancePick(session, pickOrder.length);
  if (!next) {
    throw new ApiError(409, "This is the last pick of the draft -- use End Draft to finish it.");
  }
  await advanceAndAnnounce(leagueId, session, next);
  return { ok: true as const, round: next.round, pickInRound: next.pickInRound };
}

export async function skipFantasyDraftToSpecificPick(guildId: string, targetRound: number, targetPickInRound: number) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live"]);
  const pickOrder = await listPickOrder(session.id);
  if (!pickOrder.length) throw new ApiError(409, "Set the pick order before skipping picks.");
  if (!Number.isInteger(targetRound) || !Number.isInteger(targetPickInRound) || targetPickInRound < 1 || targetPickInRound > pickOrder.length) {
    throw new ApiError(400, "Choose a valid draft pick.");
  }
  if (session.total_rounds != null && targetRound > session.total_rounds) {
    throw new ApiError(400, `This draft only has ${session.total_rounds} rounds.`);
  }
  const currentOverall = (session.current_round - 1) * pickOrder.length + session.current_pick_in_round;
  const targetOverall = (targetRound - 1) * pickOrder.length + targetPickInRound;
  if (targetOverall <= currentOverall) throw new ApiError(400, "Choose a pick later than the current one.");

  await advanceAndAnnounce(leagueId, session, { round: targetRound, pickInRound: targetPickInRound });
  return { ok: true as const, round: targetRound, pickInRound: targetPickInRound };
}

/** Polled every few seconds from apps/api/src/index.ts while any league has a live draft with
 * a timer set. Cheap when idle (a single indexed filter query) -- only fantasy/offseason
 * drafts that are both live and timed even show up in the query. */
export async function sweepFantasyDraftTimers(): Promise<void> {
  const { data, error } = await supabase
    .from("rec_fantasy_draft_sessions")
    .select("*")
    .eq("status", "live")
    .not("pick_timer_seconds", "is", null)
    .not("turn_started_at", "is", null);
  if (error || !data?.length) return;

  for (const row of data as SessionRow[]) {
    const session = row;
    const elapsedMs = Date.now() - new Date(session.turn_started_at as string).getTime();
    const timerMs = (session.pick_timer_seconds as number) * 1000;
    const remainingMs = timerMs - elapsedMs;
    try {
      if (remainingMs <= 0) {
        const pickOrder = await listPickOrder(session.id);
        if (!pickOrder.length) continue;
        const next = advancePick(session, pickOrder.length);
        if (!next) continue; // out of rounds (offseason) -- commissioner must End Draft manually
        await advanceAndAnnounce(session.league_id, session, next);
      } else if (remainingMs <= WARNING_THRESHOLD_MS && !session.warning_sent) {
        const marked = await supabase.from("rec_fantasy_draft_sessions").update({ warning_sent: true, updated_at: new Date().toISOString() })
          .eq("id", session.id).eq("warning_sent", false).select("id").maybeSingle();
        if (!marked.data) continue; // another tick already claimed this warning
        const [teams, pickOrder] = await Promise.all([listTeams(session.league_id), listPickOrder(session.id)]);
        await postFifteenSecondWarning(session.league_id, teams, session, pickOrder);
      }
    } catch (sweepError) {
      console.error(`[ERROR] Fantasy draft timer sweep failed for session ${session.id} (non-fatal):`, sweepError);
    }
  }
}
