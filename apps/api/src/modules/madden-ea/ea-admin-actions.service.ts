// Write-side EA Blaze admin actions -- the counterpart to the read-only import pipeline in
// ea-connections.service.ts / ea-direct-writer.ts. Each function here triggers one in-game
// commissioner action (advance, clear cap penalties, boot/admin a user, force a result, toggle
// autopilot) and is called either directly from a Tools-menu button (source "tool") or as a
// side effect of an action REC already performs (source "auto" -- Discord leave, co-commish
// change, Force Win/Fair Sim grant, autopilot grant).

import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { withEaAdminSession } from "./ea-connections.service.js";
import type { EaClient } from "./ea-client.js";
import type { EaStage } from "./ea-weeks.js";

export type EaAdminActionSource = "tool" | "auto";

type AuditContext = {
  source: EaAdminActionSource;
  actingUserId?: string | null;
  actingDiscordId?: string | null;
};

async function recordAudit(
  leagueId: string,
  commandName: string,
  targetDescription: string | null,
  requestPayload: Record<string, unknown>,
  ctx: AuditContext,
  outcome: { status: "success"; response: unknown } | { status: "error"; error: string },
) {
  await getPgPool().query(
    `insert into rec_ea_admin_actions
       (league_id, command_name, target_description, request_payload, trigger_source,
        triggered_by_user_id, triggered_by_discord_id, status, response_payload, error_message)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10)`,
    [
      leagueId, commandName, targetDescription, JSON.stringify(requestPayload), ctx.source,
      ctx.actingUserId ?? null, ctx.actingDiscordId ?? null, outcome.status,
      outcome.status === "success" ? JSON.stringify(outcome.response ?? null) : null,
      outcome.status === "error" ? outcome.error : null,
    ],
  ).catch((error) => console.error("[EA admin] Failed to write audit row (non-fatal):", error));
}

/**
 * Runs one Blaze admin command against a league's EA connection, auditing the outcome either
 * way. `tool`-sourced calls with no EA connection throw (the button should tell the commish);
 * `auto`-sourced calls with no connection are a silent no-op -- Discord leaves, role changes,
 * etc. must never fail just because a league hasn't connected EA.
 */
async function runEaAdminCommand(
  leagueId: string,
  commandName: string,
  targetDescription: string | null,
  requestPayload: Record<string, unknown>,
  ctx: AuditContext,
  call: (client: EaClient, eaLeagueId: number) => Promise<unknown>,
): Promise<unknown> {
  try {
    const result = await withEaAdminSession(leagueId, call);
    if (result === null) {
      if (ctx.source === "tool") throw new ApiError(409, "This league isn't connected to EA yet.");
      return null;
    }
    await recordAudit(leagueId, commandName, targetDescription, requestPayload, ctx, { status: "success", response: result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAudit(leagueId, commandName, targetDescription, requestPayload, ctx, { status: "error", error: message });
    if (ctx.source === "tool") throw error instanceof ApiError ? error : new ApiError(502, `EA rejected this action: ${message}`);
    console.error(`[EA admin] ${commandName} failed for league ${leagueId} (non-fatal, source=auto):`, message);
    return null;
  }
}

type TeamRow = { id: string; madden_team_id: string | null; ea_owner_user_id: string | null; name: string | null };

async function loadTeam(leagueId: string, teamId: string): Promise<TeamRow> {
  const result = await getPgPool().query<TeamRow>(
    `select id, madden_team_id, ea_owner_user_id, name from rec_teams where id=$1 and league_id=$2`,
    [teamId, leagueId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "Team not found in this league.");
  return row;
}

function requireOwnerUserId(team: TeamRow): string {
  if (!team.ea_owner_user_id) {
    throw new ApiError(409, `${team.name ?? "This team"} has no EA owner on file yet -- re-import the league from EA and try again.`);
  }
  return team.ea_owner_user_id;
}

function requireMaddenTeamId(team: TeamRow): number {
  const id = Number(team.madden_team_id);
  if (!team.madden_team_id || Number.isNaN(id)) {
    throw new ApiError(409, `${team.name ?? "This team"} has no EA team id on file yet -- re-import the league from EA and try again.`);
  }
  return id;
}

type GameEaRef = { scheduleId: number; stageIndex: EaStage; weekIndex: number };

/** Parses rec_games.external_game_id ("ea:w{displayWeek}:{scheduleId}", written by
 *  ea-weeks.ts's eaScheduleExternalId) plus phase/week_number back into EA's own coordinates. */
async function loadGameEaRef(leagueId: string, gameId: string): Promise<GameEaRef> {
  const result = await getPgPool().query<{ external_game_id: string | null; phase: string | null; week_number: number | null }>(
    `select external_game_id, phase, week_number from rec_games where id=$1 and league_id=$2`,
    [gameId, leagueId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "Matchup not found in this league.");
  const match = /^ea:w(\d+):(\d+)$/.exec(row.external_game_id ?? "");
  if (!match || row.week_number == null) {
    throw new ApiError(409, "This matchup wasn't imported from EA, so its in-game result can't be forced.");
  }
  return {
    scheduleId: Number(match[2]),
    stageIndex: row.phase === "preseason" ? 0 : 1,
    weekIndex: row.week_number - 1,
  };
}

export type ForceableMatch = { gameId: string; weekNumber: number; awayTeamName: string; homeTeamName: string };

/** Games this league has actually imported from EA -- the only ones Force Win/Clear Result can
 *  target, since loadGameEaRef needs an EA scheduleId parsed out of external_game_id. Scoped
 *  separately from the hub's matchup schedule (which shows every scheduled game regardless of
 *  import status) so the Tools-menu picker can't offer a matchup that's guaranteed to 409. */
export async function listForceableMatches(leagueId: string): Promise<ForceableMatch[]> {
  const result = await getPgPool().query<{ id: string; week_number: number; away_name: string | null; home_name: string | null }>(
    `select g.id, g.week_number,
            coalesce(at.display_city || ' ' || at.display_nick, at.name) as away_name,
            coalesce(ht.display_city || ' ' || ht.display_nick, ht.name) as home_name
       from rec_games g
       left join rec_teams at on at.id = g.away_team_id
       left join rec_teams ht on ht.id = g.home_team_id
      where g.league_id=$1 and g.external_game_id like 'ea:%'
      order by g.week_number desc, away_name asc`,
    [leagueId],
  );
  return result.rows.map((row) => ({
    gameId: row.id,
    weekNumber: Number(row.week_number),
    awayTeamName: row.away_name ?? "TBD",
    homeTeamName: row.home_name ?? "TBD",
  }));
}

// ── Public actions ──

export async function eaSubmitCareerResponse(leagueId: string, ctx: AuditContext) {
  return runEaAdminCommand(leagueId, "Mobile_Career_SubmitResponse", null, {}, ctx,
    (client, eaLeagueId) => client.submitCareerResponse(eaLeagueId));
}

export async function eaClearCapPenalties(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const maddenTeamId = requireMaddenTeamId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_ClearCapPenalties", team.name, { teamId: maddenTeamId }, ctx,
    (client, eaLeagueId) => client.clearCapPenalties(eaLeagueId, maddenTeamId));
}

export async function eaBootUser(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const ownerUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_BootUser", team.name, { userId: ownerUserId }, ctx,
    (client, eaLeagueId) => client.bootUser(eaLeagueId, ownerUserId));
}

export async function eaAddAdmin(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const ownerUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_AddAdmin", team.name, { userId: ownerUserId }, ctx,
    (client, eaLeagueId) => client.addAdmin(eaLeagueId, ownerUserId));
}

export async function eaRemoveAdmin(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const ownerUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_RemoveAdmin", team.name, { userId: ownerUserId }, ctx,
    (client, eaLeagueId) => client.removeAdmin(eaLeagueId, ownerUserId));
}

export async function eaForceHomeWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const ref = await loadGameEaRef(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceHomeWin", gameId,
    { scheduleId: ref.scheduleId, stageIndex: ref.stageIndex, weekIndex: ref.weekIndex }, ctx,
    (client, eaLeagueId) => client.forceHomeWin(eaLeagueId, ref.scheduleId, ref.stageIndex, ref.weekIndex));
}

export async function eaForceAwayWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const ref = await loadGameEaRef(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceAwayWin", gameId,
    { scheduleId: ref.scheduleId, stageIndex: ref.stageIndex, weekIndex: ref.weekIndex }, ctx,
    (client, eaLeagueId) => client.forceAwayWin(eaLeagueId, ref.scheduleId, ref.stageIndex, ref.weekIndex));
}

export async function eaForceNoWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const ref = await loadGameEaRef(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceNoWin", gameId,
    { scheduleId: ref.scheduleId, stageIndex: ref.stageIndex, weekIndex: ref.weekIndex }, ctx,
    (client, eaLeagueId) => client.forceNoWin(eaLeagueId, ref.scheduleId, ref.stageIndex, ref.weekIndex));
}

export async function eaToggleAutoPilot(leagueId: string, teamId: string, weeks: number, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const ownerUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_ToggleAutoPilot", team.name, { userId: ownerUserId, weeks }, ctx,
    (client, eaLeagueId) => client.toggleAutoPilot(eaLeagueId, ownerUserId, weeks));
}
