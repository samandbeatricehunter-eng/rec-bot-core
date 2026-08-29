import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";
import { getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";

type SessionRow = {
  id: string; league_id: string; status: "not_started" | "live" | "concluded";
  season_number: number | null; current_round: number; current_pick_in_round: number;
  total_rounds: number | null; pick_timer_seconds: number | null; turn_started_at: string | null;
  warning_sent: boolean; commenced_by_user_id: string | null; commenced_at: string | null;
  concluded_at: string | null;
};

const TOTAL_ROUNDS = 7;

async function resolveUserId(discordId: string) {
  if (isSiteOnlyDiscordId(discordId)) return recUserIdFromSiteOnlyDiscordId(discordId);
  const row = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (row.error) throw new ApiError(500, "We couldn't load your REC account.", row.error);
  return row.data?.user_id ?? null;
}

async function activeSession(leagueId: string): Promise<SessionRow | null> {
  const row = await supabase.from("rec_fantasy_draft_sessions").select("*")
    .eq("league_id", leagueId).eq("draft_kind", "annual")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (row.error) throw new ApiError(500, "We couldn't load the annual draft.", row.error);
  return row.data as SessionRow | null;
}

async function requireSession(leagueId: string) {
  const session = await activeSession(leagueId);
  if (!session) throw new ApiError(404, "No annual draft session exists yet.");
  return session;
}

async function teams(leagueId: string) {
  const result = await supabase.from("rec_teams").select("id,name,display_nick,display_abbr,abbreviation")
    .eq("league_id", leagueId).order("name");
  if (result.error) throw new ApiError(500, "We couldn't load league teams.", result.error);
  return (result.data ?? []).map((team: any) => ({
    id: team.id, name: team.name,
    displayName: team.display_nick ?? team.display_abbr ?? team.name,
    abbreviation: team.abbreviation ?? null,
  }));
}

async function roundOrder(leagueId: string, seasonNumber: number, round: number) {
  const result = await supabase.from("rec_draft_picks").select("pick_number,current_team_id")
    .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("round", round)
    .not("pick_number", "is", null).order("pick_number");
  if (result.error) throw new ApiError(500, "We couldn't load the annual draft order.", result.error);
  return (result.data ?? []).map((pick: any) => ({ pickInRound: Number(pick.pick_number), teamId: String(pick.current_team_id) }));
}

async function assertCompleteOrder(leagueId: string, seasonNumber: number, teamCount: number) {
  for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
    const order = await roundOrder(leagueId, seasonNumber, round);
    if (order.length !== teamCount || order.some((pick, index) => pick.pickInRound !== index + 1)) {
      throw new ApiError(409, `Season ${seasonNumber}, round ${round} does not have a complete numbered draft order. Generate or repair the draft picks first.`);
    }
  }
}

function serialize(session: SessionRow) {
  return {
    id: session.id, leagueId: session.league_id, status: session.status,
    draftType: "offseason" as const, draftKind: "annual" as const,
    seasonNumber: session.season_number, orderMode: "standard" as const,
    currentRound: session.current_round, currentPickInRound: session.current_pick_in_round,
    totalRounds: TOTAL_ROUNDS, pickTimerSeconds: session.pick_timer_seconds,
    turnStartedAt: session.turn_started_at, commencedByUserId: session.commenced_by_user_id,
    commencedAt: session.commenced_at, concludedAt: session.concluded_at,
  };
}

export async function getAnnualDraftState(guildId: string, discordId: string, isCommissioner: boolean) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const [session, leagueTeams, userId] = await Promise.all([activeSession(leagueId), teams(leagueId), resolveUserId(discordId)]);
  const seasonNumber = session?.season_number ?? null;
  const pickOrder = session && seasonNumber ? await roundOrder(leagueId, seasonNumber, session.current_round) : [];
  const onTheClockTeamId = session?.status === "live" ? pickOrder[session.current_pick_in_round - 1]?.teamId ?? null : null;
  let myTeamId: string | null = null;
  if (userId) {
    const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId)
      .eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
    myTeamId = assignment.data?.team_id ?? null;
  }
  const skipChoices: Array<{ round: number; pickInRound: number; teamId: string; teamName: string }> = [];
  if (session?.status === "live" && seasonNumber) {
    const teamNames = new Map(leagueTeams.map((team) => [team.id, team.displayName]));
    for (const round of [session.current_round, session.current_round + 1].filter((value) => value <= TOTAL_ROUNDS)) {
      for (const pick of await roundOrder(leagueId, seasonNumber, round)) {
        if (round === session.current_round && pick.pickInRound < session.current_pick_in_round) continue;
        skipChoices.push({ round, ...pick, teamName: teamNames.get(pick.teamId) ?? "Unknown team" });
      }
    }
  }
  return { session: session ? serialize(session) : null, teams: leagueTeams, pickOrder, onTheClockTeamId, skipChoices, caller: { isCommissioner, myTeamId } };
}

export async function startAnnualDraft(guildId: string, discordId: string, seasonNumber: number, pickTimerSeconds: number | null) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const leagueTeams = await teams(leagueId);
  await assertCompleteOrder(leagueId, seasonNumber, leagueTeams.length);
  const userId = await resolveUserId(discordId);
  const existing = await activeSession(leagueId);
  const values = {
    league_id: leagueId, draft_kind: "annual", season_number: seasonNumber,
    status: "live", draft_type: "offseason", order_mode: "standard", total_rounds: TOTAL_ROUNDS,
    pick_timer_seconds: pickTimerSeconds, turn_started_at: pickTimerSeconds ? new Date().toISOString() : null,
    warning_sent: false, current_round: 1, current_pick_in_round: 1,
    commenced_by_user_id: userId, commenced_at: new Date().toISOString(), concluded_at: null,
    updated_at: new Date().toISOString(),
  };
  const result = existing && existing.status !== "concluded"
    ? await supabase.from("rec_fantasy_draft_sessions").update(values).eq("id", existing.id)
    : await supabase.from("rec_fantasy_draft_sessions").insert(values);
  if (result.error) throw new ApiError(500, "We couldn't start the annual draft.", result.error);
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

export async function setAnnualDraftTimer(guildId: string, pickTimerSeconds: number | null) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const session = await requireSession(leagueId);
  if (session.status !== "live") throw new ApiError(409, "The annual draft is not live.");
  const result = await supabase.from("rec_fantasy_draft_sessions").update({
    pick_timer_seconds: pickTimerSeconds, turn_started_at: pickTimerSeconds ? new Date().toISOString() : null,
    warning_sent: false, updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (result.error) throw new ApiError(500, "We couldn't update the annual draft timer.", result.error);
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, pickTimerSeconds };
}

async function moveTo(guildId: string, targetRound: number, targetPick: number) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const session = await requireSession(leagueId);
  if (session.status !== "live" || !session.season_number) throw new ApiError(409, "The annual draft is not live.");
  if (targetRound > TOTAL_ROUNDS) throw new ApiError(409, "This is the final pick. End the draft when it is complete.");
  const order = await roundOrder(leagueId, session.season_number, targetRound);
  if (!order.some((pick) => pick.pickInRound === targetPick)) throw new ApiError(400, "Choose a valid annual draft pick.");
  const result = await supabase.from("rec_fantasy_draft_sessions").update({
    current_round: targetRound, current_pick_in_round: targetPick,
    turn_started_at: session.pick_timer_seconds ? new Date().toISOString() : null,
    warning_sent: false, updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (result.error) throw new ApiError(500, "We couldn't advance the annual draft.", result.error);
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const, round: targetRound, pickInRound: targetPick };
}

export async function advanceAnnualDraftPick(guildId: string) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const session = await requireSession(leagueId);
  if (session.status !== "live" || !session.season_number) throw new ApiError(409, "The annual draft is not live.");
  const order = await roundOrder(leagueId, session.season_number, session.current_round);
  const nextPick = session.current_pick_in_round + 1;
  return nextPick <= order.length ? moveTo(guildId, session.current_round, nextPick) : moveTo(guildId, session.current_round + 1, 1);
}

export async function skipAnnualDraftTo(guildId: string, round: number, pickInRound: number) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const session = await requireSession(leagueId);
  const current = (session.current_round - 1) * 100 + session.current_pick_in_round;
  if ((round - 1) * 100 + pickInRound <= current) throw new ApiError(400, "Choose a pick later than the current one.");
  return moveTo(guildId, round, pickInRound);
}

export async function endAnnualDraft(guildId: string) {
  const { leagueId } = await getCurrentLeagueContext(guildId);
  const session = await requireSession(leagueId);
  if (session.status !== "live") throw new ApiError(409, "The annual draft is not live.");
  const result = await supabase.from("rec_fantasy_draft_sessions").update({
    status: "concluded", concluded_at: new Date().toISOString(), turn_started_at: null, updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  if (result.error) throw new ApiError(500, "We couldn't end the annual draft.", result.error);
  broadcastChatEvent("fantasy_draft", leagueId, { kind: "refresh" });
  return { ok: true as const };
}

/** Auto-advances expired annual-draft clocks. The fantasy and annual sessions are independent,
 * so each has its own sweep while sharing the same indexed session table. */
export async function sweepAnnualDraftTimers() {
  const result = await supabase.from("rec_fantasy_draft_sessions").select("*")
    .eq("draft_kind", "annual").eq("status", "live")
    .not("pick_timer_seconds", "is", null).not("turn_started_at", "is", null);
  if (result.error || !result.data?.length) return;
  for (const session of result.data as SessionRow[]) {
    if (!session.season_number || !session.pick_timer_seconds || !session.turn_started_at) continue;
    if (Date.now() - new Date(session.turn_started_at).getTime() < session.pick_timer_seconds * 1000) continue;
    const order = await roundOrder(session.league_id, session.season_number, session.current_round);
    let nextRound = session.current_round;
    let nextPick = session.current_pick_in_round + 1;
    if (nextPick > order.length) { nextRound += 1; nextPick = 1; }
    if (nextRound > TOTAL_ROUNDS) continue;
    const claimed = await supabase.from("rec_fantasy_draft_sessions").update({
      current_round: nextRound, current_pick_in_round: nextPick,
      turn_started_at: new Date().toISOString(), warning_sent: false, updated_at: new Date().toISOString(),
    }).eq("id", session.id).eq("turn_started_at", session.turn_started_at).select("id").maybeSingle();
    if (claimed.data) broadcastChatEvent("fantasy_draft", session.league_id, { kind: "refresh" });
  }
}
