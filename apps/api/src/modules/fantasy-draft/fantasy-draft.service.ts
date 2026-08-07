// Fantasy draft tracker (docs/madden-fantasy-draft-plan.md §4). Commissioner-run companion
// to Madden's in-game fantasy draft: a session tracks round/pick-on-the-clock, a fixed
// round-1 pick order (with optional snake reversal on even rounds), and a derived pool
// (every rec_players row for the league — team_id null in fantasy-draft leagues). "Drafted"
// is derived from rec_fantasy_draft_picks, not stored on rec_players; on pick the player's
// team_id/is_free_agent are updated so the roster surfaces the assignment, and undo reverts
// it. All state mutations broadcast a `fantasy_draft:{leagueId}` realtime refresh event.
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { sendPushToUsers } from "../push/push.service.js";
import {
  getCurrentLeagueContext,
  isSiteOnlyDiscordId,
  recUserIdFromSiteOnlyDiscordId,
} from "../league-context/league-context.service.js";

export type FantasyDraftStatus = "not_scheduled" | "scheduled" | "live" | "wrap_up" | "concluded";
export type FantasyDraftOrderMode = "standard" | "snake";

type SessionRow = {
  id: string;
  league_id: string;
  status: FantasyDraftStatus;
  order_mode: FantasyDraftOrderMode | null;
  scheduled_at: string | null;
  current_round: number;
  current_pick_in_round: number;
  commenced_by_user_id: string | null;
  commenced_at: string | null;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
};

type PickRow = {
  id: string;
  session_id: string;
  round: number;
  pick_in_round: number;
  overall_pick_number: number;
  team_id: string;
  player_id: string;
  is_wrapup_pick: boolean;
  logged_by_user_id: string;
  logged_at: string;
};

// §7 (position minimums) was dropped from scope, but conclude still reports under-strength
// teams so the frontend can warn affected owners. A fantasy-draft league has ~2,700 pool
// players across 32 teams (~83/team if fully drafted); 22 is a sane floor to flag teams that
// stopped way short.
const MIN_DRAFTED_ROSTER_SIZE = 22;

async function resolveRecUserId(discordId: string): Promise<string | null> {
  if (isSiteOnlyDiscordId(discordId)) return recUserIdFromSiteOnlyDiscordId(discordId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to resolve your REC account.", account.error);
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
  if (error) throw new ApiError(500, "Failed to load the fantasy draft session.", error);
  return (data as SessionRow | null) ?? null;
}

async function requireActiveSession(leagueId: string): Promise<SessionRow> {
  const session = await getActiveSession(leagueId);
  if (!session) throw new ApiError(404, "This league has no fantasy draft session yet.");
  return session;
}

async function requireSessionStatus(session: SessionRow, allowed: FantasyDraftStatus[]) {
  if (!allowed.includes(session.status)) {
    throw new ApiError(409, `This action requires the draft to be ${allowed.join(" or ")}, but it is ${session.status}.`);
  }
}

async function setLeagueFantasyDraftStatus(leagueId: string, status: string) {
  const { error } = await supabase.from("rec_leagues").update({ fantasy_draft_status: status }).eq("id", leagueId);
  if (error) throw new ApiError(500, "Failed to update the league fantasy-draft status.", error);
}

function serializeSession(row: SessionRow) {
  return {
    id: row.id,
    leagueId: row.league_id,
    status: row.status,
    orderMode: row.order_mode,
    scheduledAt: row.scheduled_at,
    currentRound: row.current_round,
    currentPickInRound: row.current_pick_in_round,
    commencedByUserId: row.commenced_by_user_id,
    commencedAt: row.commenced_at,
    concludedAt: row.concluded_at,
  };
}

async function listTeams(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_teams")
    .select("id,name,display_nick,display_abbr,abbreviation")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load league teams.", error);
  return (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    displayName: t.display_nick ?? t.display_abbr ?? t.name,
    abbreviation: t.abbreviation ?? null,
  }));
}

async function listPickOrder(sessionId: string) {
  const { data, error } = await supabase
    .from("rec_fantasy_draft_pick_order")
    .select("*")
    .eq("session_id", sessionId)
    .order("pick_in_round", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load the pick order.", error);
  return (data ?? []).map((row: any) => ({ pickInRound: row.pick_in_round, teamId: row.team_id }));
}

async function listPicks(sessionId: string) {
  const { data, error } = await supabase
    .from("rec_fantasy_draft_picks")
    .select("*")
    .eq("session_id", sessionId)
    .order("overall_pick_number", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load the pick history.", error);
  return (data ?? []) as PickRow[];
}

function teamOnTheClock(session: SessionRow, pickOrder: Array<{ pickInRound: number; teamId: string }>): string | null {
  if (!pickOrder.length) return null;
  const index = session.current_pick_in_round - 1;
  // Snake: even rounds reverse the round-1 order.
  if (session.order_mode === "snake" && session.current_round % 2 === 0) {
    return pickOrder[pickOrder.length - 1 - index]?.teamId ?? null;
  }
  return pickOrder[index]?.teamId ?? null;
}

export async function getFantasyDraftState(guildId: string, discordId: string, isCommissioner: boolean) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const [session, teams, userId] = await Promise.all([
    getActiveSession(leagueId),
    listTeams(leagueId),
    resolveRecUserId(discordId),
  ]);

  const [pickOrder, picks, pool] = await Promise.all([
    session ? listPickOrder(session.id) : Promise.resolve<Array<{ pickInRound: number; teamId: string }>>([]),
    session ? listPicks(session.id) : Promise.resolve<PickRow[]>([]),
    supabase.from("rec_players").select("id,full_name,first_name,last_name,position,overall_rating,jersey_number,archetype,team_id,is_free_agent,photo_url,madden_player_id,player_source")
      .eq("league_id", leagueId)
      .order("overall_rating", { ascending: false }),
  ]);
  if (pool.error) throw new ApiError(500, "Failed to load the draft pool.", pool.error);

  const draftedTeamByPlayer = new Map<string, string>();
  for (const pick of picks) draftedTeamByPlayer.set(pick.player_id, pick.team_id);
  const draftedIds = new Set(draftedTeamByPlayer.keys());

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
    if (assignment.error) throw new ApiError(500, "Failed to resolve your team.", assignment.error);
    myTeamId = assignment.data?.team_id ?? null;
  }

  // Personal ranked board — ordered player ids, draft status derived from picks so a
  // freshly drafted player (before the delete trigger clears it) never shows as available.
  let myBoard: string[] = [];
  if (userId) {
    const board = await supabase
      .from("rec_fantasy_draft_board_entries")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .order("rank", { ascending: true });
    if (board.error) throw new ApiError(500, "Failed to load your draft board.", board.error);
    myBoard = (board.data ?? [])
      .map((entry: any) => entry.player_id as string)
      .filter((playerId) => !draftedIds.has(playerId));
  }

  const teamById = new Map(teams.map((t) => [t.id, t.displayName]));
  const onTheClockTeamId = session ? teamOnTheClock(session, pickOrder) : null;

  return {
    session: session ? serializeSession(session) : null,
    teams,
    pickOrder,
    onTheClockTeamId,
    pool: (pool.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.full_name,
      position: p.position,
      overallRating: p.overall_rating,
      jerseyNumber: p.jersey_number,
      archetype: p.archetype,
      photoUrl: p.photo_url ?? null,
      teamId: p.team_id,
      isDrafted: draftedIds.has(p.id),
      draftedByTeamId: draftedTeamByPlayer.get(p.id) ?? null,
      isDefaultPlayer: Boolean(p.is_default_player),
    })),
    picks: picks.map((pick) => ({
      id: pick.id,
      round: pick.round,
      pickInRound: pick.pick_in_round,
      overallPickNumber: pick.overall_pick_number,
      teamId: pick.team_id,
      teamName: teamById.get(pick.team_id) ?? "Unknown",
      playerId: pick.player_id,
      isWrapupPick: pick.is_wrapup_pick,
      loggedAt: pick.logged_at,
    })),
    myBoard,
    caller: { isCommissioner, myTeamId },
  };
}

/** Replaces the caller's personal ranked board for the league's active draft. Only
 * undrafted pool players may sit on the board; drafted or removed players are dropped
 * silently. Available any time before the draft is concluded. */
export async function saveFantasyDraftBoard(guildId: string, discordId: string, playerIds: string[]) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["not_scheduled", "scheduled", "live", "wrap_up"]);

  const userId = await resolveRecUserId(discordId);
  if (!userId) throw new ApiError(400, "A linked REC account is required to save a draft board.");

  const unique = [...new Set(playerIds)];
  if (unique.length > 500) throw new ApiError(400, "A draft board can hold up to 500 players.");

  let validated: string[] = unique;
  if (unique.length) {
    const players = await supabase
      .from("rec_players")
      .select("id")
      .eq("league_id", leagueId)
      .in("id", unique);
    if (players.error) throw new ApiError(500, "Failed to validate board players.", players.error);
    const validIds = new Set((players.data ?? []).map((p: any) => p.id));
    validated = unique.filter((id) => validIds.has(id));
  }

  const picks = await listPicks(session.id);
  const draftedIds = new Set(picks.map((pick) => pick.player_id));
  const board = validated.filter((id) => !draftedIds.has(id));

  const { error: deleteError } = await supabase
    .from("rec_fantasy_draft_board_entries")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  if (deleteError) throw new ApiError(500, "Failed to replace your draft board.", deleteError);

  if (board.length) {
    const { error } = await supabase.from("rec_fantasy_draft_board_entries").insert(
      board.map((playerId, index) => ({
        league_id: leagueId,
        user_id: userId,
        player_id: playerId,
        rank: index + 1,
      })),
    );
    if (error) throw new ApiError(500, "Failed to save your draft board.", error);
  }

  return { ok: true as const, board };
}

export async function scheduleFantasyDraft(guildId: string, discordId: string, scheduledAt: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const userId = await resolveRecUserId(discordId);
  let session = await getActiveSession(leagueId);

  if (!session) {
    const { data, error } = await supabase.from("rec_fantasy_draft_sessions").insert({
      league_id: leagueId,
      status: "scheduled",
      scheduled_at: scheduledAt,
      commenced_by_user_id: userId,
    }).select("*").single();
    if (error) throw new ApiError(500, "Failed to create the fantasy draft session.", error);
    session = data as SessionRow;
  } else {
    requireSessionStatus(session, ["not_scheduled", "scheduled"]);
    const { error } = await supabase.from("rec_fantasy_draft_sessions").update({
      status: "scheduled",
      scheduled_at: scheduledAt,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    if (error) throw new ApiError(500, "Failed to schedule the fantasy draft.", error);
    session = { ...session, status: "scheduled", scheduled_at: scheduledAt };
  }

  await setLeagueFantasyDraftStatus(leagueId, "scheduled");
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return serializeSession(session);
}

export async function commenceFantasyDraft(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const userId = await resolveRecUserId(discordId);
  let session = await getActiveSession(leagueId);
  if (!session) {
    const { data, error } = await supabase.from("rec_fantasy_draft_sessions").insert({
      league_id: leagueId,
      status: "live",
      commenced_by_user_id: userId,
      commenced_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw new ApiError(500, "Failed to create the fantasy draft session.", error);
    session = data as SessionRow;
  } else {
    // Commencing without a scheduled time is allowed but discouraged (open question 2) —
    // the UI nudges toward scheduling first, but never hard-blocks it.
    requireSessionStatus(session, ["not_scheduled", "scheduled"]);
    const { error } = await supabase.from("rec_fantasy_draft_sessions").update({
      status: "live",
      commenced_by_user_id: userId,
      commenced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    if (error) throw new ApiError(500, "Failed to commence the fantasy draft.", error);
  }

  await setLeagueFantasyDraftStatus(leagueId, "live");

  // Fire-and-forget side effects — never block the response on Discord/push failures.
  const announcementsChannelId = (context.routes as any)?.announcements_channel_id ?? null;
  if (announcementsChannelId) {
    postDiscordChannelMessage(announcementsChannelId, {
      content: "@everyone",
      embeds: [{
        title: "FANTASY DRAFT IS LIVE",
        color: 0xd9a521,
        description: "The fantasy draft has started. Check the draft board in the league hub to follow along.",
        footer: { text: "REC Leagues" },
      }],
      allowed_mentions: { parse: ["everyone"] },
    }).catch((error) => console.error("[ERROR] Fantasy draft commence announcement failed (non-fatal):", error));
  }
  const members = await supabase.from("rec_league_memberships").select("user_id").eq("league_id", leagueId);
  const userIds = [...new Set((members.data ?? []).map((m: any) => m.user_id).filter(Boolean))] as string[];
  if (userIds.length) {
    sendPushToUsers(userIds, { title: "Fantasy draft is live!", body: "The fantasy draft has started — check the draft board." }).catch(() => undefined);
  }

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

export async function setFantasyDraftPickOrder(guildId: string, discordId: string, orderMode: FantasyDraftOrderMode, picks: Array<{ pickInRound: number; teamId: string }>) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["scheduled", "live"]);

  if (picks.length !== 32) throw new ApiError(400, "Pick order must assign exactly 32 teams.");
  const pickInRounds = picks.map((p) => p.pickInRound);
  if (new Set(pickInRounds).size !== 32 || Math.min(...pickInRounds) < 1 || Math.max(...pickInRounds) > 32) {
    throw new ApiError(400, "Pick order must cover slots 1-32 exactly once.");
  }
  const teamIds = picks.map((p) => p.teamId);
  if (new Set(teamIds).size !== 32) throw new ApiError(400, "Each team can occupy only one pick slot.");

  const teams = await supabase.from("rec_teams").select("id").eq("league_id", leagueId).in("id", teamIds);
  if (teams.error) throw new ApiError(500, "Failed to validate pick-order teams.", teams.error);
  if ((teams.data ?? []).length !== 32) throw new ApiError(400, "Every pick-order team must belong to this league.");

  const { error: deleteError } = await supabase.from("rec_fantasy_draft_pick_order").delete().eq("session_id", session.id);
  if (deleteError) throw new ApiError(500, "Failed to replace the pick order.", deleteError);

  const { error } = await supabase.from("rec_fantasy_draft_pick_order").insert(
    picks.map((p) => ({ session_id: session.id, pick_in_round: p.pickInRound, team_id: p.teamId })),
  );
  if (error) throw new ApiError(500, "Failed to save the pick order.", error);

  const { error: updateError } = await supabase.from("rec_fantasy_draft_sessions").update({
    order_mode: orderMode,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (updateError) throw new ApiError(500, "Failed to save the pick-order mode.", updateError);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, orderMode, count: 32 };
}

export async function addFantasyDraftCustomPlayer(guildId: string, discordId: string, input: {
  firstName: string;
  lastName: string;
  position: string;
  jerseyNumber?: number | null;
  archetype?: string | null;
  devTrait?: string | null;
  overallRating?: number | null;
  attributes: Record<string, number>;
}) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["scheduled", "live", "wrap_up"]);

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ApiError(400, "A first and last name are required.");
  if (firstName.length > 40 || lastName.length > 40) throw new ApiError(400, "Player names are limited to 40 characters.");
  const position = input.position.trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(position)) throw new ApiError(400, "Position must be a 2-3 letter code (e.g. QB, WR, MLB).");
  if (input.jerseyNumber != null && (input.jerseyNumber < 0 || input.jerseyNumber > 99)) {
    throw new ApiError(400, "Jersey number must be 0-99.");
  }
  const attributes: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    if (!Number.isInteger(value) || value < 0 || value > 99) {
      throw new ApiError(400, `Attribute ${key} must be an integer from 0 through 99.`);
    }
    attributes[key.trim().toLowerCase()] = value;
  }

  const { data, error } = await supabase.from("rec_players").insert({
    league_id: leagueId,
    team_id: null,
    madden_player_id: null,
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`,
    position,
    jersey_number: input.jerseyNumber ?? null,
    archetype: input.archetype ?? null,
    dev_trait: input.devTrait ?? null,
    overall_rating: input.overallRating ?? null,
    attributes,
    is_free_agent: true,
    is_default_player: false,
    player_source: "custom_player",
    roster_status: "active",
    raw_payload: { fantasyDraft: true },
  }).select("*").single();
  if (error) throw new ApiError(500, "Failed to add the custom player to the draft pool.", error);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return {
    id: data.id,
    name: `${firstName} ${lastName}`,
    position,
    overallRating: data.overall_rating ?? null,
  };
}

export async function removeFantasyDraftPoolPlayer(guildId: string, playerId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["scheduled", "live", "wrap_up"]);

  const player = await supabase.from("rec_players").select("id,team_id,is_free_agent").eq("id", playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load the pool player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league's draft pool.");

  const pick = await supabase.from("rec_fantasy_draft_picks").select("id").eq("session_id", session.id).eq("player_id", playerId).maybeSingle();
  if (pick.error) throw new ApiError(500, "Failed to check whether the player is drafted.", pick.error);
  if (pick.data) throw new ApiError(409, "That player has already been drafted.");
  if (player.data.team_id != null) throw new ApiError(409, "That player is already assigned to a team.");

  const deleted = await supabase.from("rec_players").delete().eq("id", playerId).eq("league_id", leagueId).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to remove the player from the pool.", deleted.error);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { removed: true as const };
}

async function recordPick(input: {
  session: SessionRow;
  leagueId: string;
  playerId: string;
  teamId: string;
  round: number;
  pickInRound: number;
  overallPickNumber: number;
  isWrapupPick: boolean;
  loggedByUserId: string;
}) {
  const { session, leagueId } = input;
  const player = await supabase.from("rec_players").select("id,team_id,is_free_agent").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load the draft player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league's draft pool.");
  if (player.data.team_id != null) throw new ApiError(409, "That player is already on a team.");

  const existing = await supabase.from("rec_fantasy_draft_picks").select("id").eq("session_id", session.id).eq("player_id", input.playerId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check whether the player is drafted.", existing.error);
  if (existing.data) throw new ApiError(409, "That player has already been drafted.");

  const { error } = await supabase.from("rec_fantasy_draft_picks").insert({
    session_id: session.id,
    round: input.round,
    pick_in_round: input.pickInRound,
    overall_pick_number: input.overallPickNumber,
    team_id: input.teamId,
    player_id: input.playerId,
    is_wrapup_pick: input.isWrapupPick,
    logged_by_user_id: input.loggedByUserId,
  });
  if (error) throw new ApiError(500, "Failed to log the draft pick.", error);

  const update = await supabase.from("rec_players").update({ team_id: input.teamId, is_free_agent: false }).eq("id", input.playerId).select("id").maybeSingle();
  if (update.error) throw new ApiError(500, "Failed to assign the drafted player.", update.error);
}

export async function logFantasyDraftPick(guildId: string, discordId: string, playerId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live"]);
  const userId = await resolveRecUserId(discordId);
  if (!userId) throw new ApiError(400, "A linked REC account is required to log picks.");

  const pickOrder = await listPickOrder(session.id);
  if (pickOrder.length !== 32) throw new ApiError(409, "Set the pick order before logging picks.");

  const teamId = teamOnTheClock(session, pickOrder);
  if (!teamId) throw new ApiError(409, "No team is on the clock — is the pick order set?");

  const overallPickNumber = (session.current_round - 1) * 32 + session.current_pick_in_round;
  await recordPick({
    session,
    leagueId,
    playerId,
    teamId,
    round: session.current_round,
    pickInRound: session.current_pick_in_round,
    overallPickNumber,
    isWrapupPick: false,
    loggedByUserId: userId,
  });

  let nextRound = session.current_round;
  let nextPick = session.current_pick_in_round + 1;
  if (nextPick > 32) {
    nextRound += 1;
    nextPick = 1;
  }
  await supabase.from("rec_fantasy_draft_sessions").update({
    current_round: nextRound,
    current_pick_in_round: nextPick,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, round: session.current_round, pickInRound: session.current_pick_in_round, teamId, overallPickNumber };
}

export async function logFantasyDraftWrapupPick(guildId: string, discordId: string, playerId: string, requestedTeamId: string | null, isCommissioner: boolean) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["wrap_up"]);
  const userId = await resolveRecUserId(discordId);
  if (!userId) throw new ApiError(400, "A linked REC account is required to log wrap-up picks.");

  let teamId = requestedTeamId;
  if (isCommissioner) {
    if (!teamId) throw new ApiError(400, "Choose the team to receive this wrap-up pick.");
    const team = await supabase.from("rec_teams").select("id").eq("id", teamId).eq("league_id", leagueId).maybeSingle();
    if (team.error) throw new ApiError(500, "Failed to validate the target team.", team.error);
    if (!team.data) throw new ApiError(400, "The target team does not belong to this league.");
  } else {
    const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
    if (assignment.error) throw new ApiError(500, "Failed to resolve your team.", assignment.error);
    teamId = assignment.data?.team_id ?? null;
    if (!teamId) throw new ApiError(400, "You aren't assigned to a team in this league yet.");
  }

  const picks = await listPicks(session.id);
  const maxOverall = picks.reduce((max, p) => Math.max(max, p.overall_pick_number), 0);
  const overallPickNumber = maxOverall + 1;
  const round = Math.ceil(overallPickNumber / 32);
  const pickInRound = ((overallPickNumber - 1) % 32) + 1;

  await recordPick({
    session,
    leagueId,
    playerId,
    teamId: teamId as string,
    round,
    pickInRound,
    overallPickNumber,
    isWrapupPick: true,
    loggedByUserId: userId,
  });

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, overallPickNumber, teamId };
}

export async function undoFantasyDraftPick(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live", "wrap_up"]);

  const picks = await listPicks(session.id);
  const latest = picks[picks.length - 1];
  if (!latest) throw new ApiError(400, "Nothing to undo — no picks have been logged yet.");

  const deleted = await supabase.from("rec_fantasy_draft_picks").delete().eq("id", latest.id).eq("session_id", session.id).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to undo the pick.", deleted.error);

  const player = await supabase.from("rec_players").update({ team_id: null, is_free_agent: true }).eq("id", latest.player_id).select("id").maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to un-assign the drafted player.", player.error);

  if (!latest.is_wrapup_pick) {
    await supabase.from("rec_fantasy_draft_sessions").update({
      current_round: latest.round,
      current_pick_in_round: latest.pick_in_round,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);
  }

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, undonePlayerId: latest.player_id };
}

export async function skipFantasyDraftToEnd(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["live"]);
  await supabase.from("rec_fantasy_draft_sessions").update({ status: "wrap_up", updated_at: new Date().toISOString() }).eq("id", session.id);
  await setLeagueFantasyDraftStatus(leagueId, "wrap_up");
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

export async function concludeFantasyDraft(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { leagueId } = context;
  const session = await requireActiveSession(leagueId);
  requireSessionStatus(session, ["wrap_up"]);

  await supabase.from("rec_fantasy_draft_sessions").update({
    status: "concluded",
    concluded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  await setLeagueFantasyDraftStatus(leagueId, "concluded");

  // Roster-size report for the "your team might not be fully assigned" modal — informational,
  // never a hard block (position minimums are out of scope, see plan §7).
  const teams = await listTeams(leagueId);
  const countResult = await getPgPool().query(
    `select p.team_id, count(*)::int as drafted_count
     from rec_fantasy_draft_picks p
     where p.session_id = $1
     group by p.team_id`,
    [session.id],
  );
  const countByTeam = new Map<string, number>((countResult.rows ?? []).map((r: any) => [r.team_id, Number(r.drafted_count)]));
  const underStrengthTeams = teams
    .map((team) => ({ teamId: team.id, teamName: team.displayName, draftedCount: countByTeam.get(team.id) ?? 0 }))
    .filter((t) => t.draftedCount < MIN_DRAFTED_ROSTER_SIZE);

  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, underStrengthTeams };
}

/** Creates a not_scheduled session for a newly created fantasy-draft league. Called from
 * setup.service.ts (createLeagueForServer / createUnclaimedLeague) right after the baseline
 * pool is applied. Idempotent — safe to call again if the league somehow has one already. */
export async function ensureFantasyDraftSession(leagueId: string): Promise<void> {
  const existing = await supabase.from("rec_fantasy_draft_sessions").select("id").eq("league_id", leagueId).limit(1).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check for an existing draft session.", existing.error);
  if (existing.data) return;
  const { error } = await supabase.from("rec_fantasy_draft_sessions").insert({
    league_id: leagueId,
    status: "not_scheduled",
  });
  if (error) throw new ApiError(500, "Failed to create the fantasy draft session.", error);
}
