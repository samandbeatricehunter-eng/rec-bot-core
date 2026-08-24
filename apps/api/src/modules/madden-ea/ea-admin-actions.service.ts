// Write-side EA Blaze admin actions -- the counterpart to the read-only import pipeline in
// ea-connections.service.ts / ea-direct-writer.ts. Each function here triggers one in-game
// commissioner action (advance, clear cap penalties, boot/admin a user, force a result, toggle
// autopilot) and is called either directly from a Tools-menu button (source "tool") or as a
// side effect of an action REC already performs (source "auto" -- Discord leave, co-commish
// change, Force Win/Fair Sim grant, autopilot grant).
//
// Command names, componentId/commandId, and payload field names throughout this file are
// confirmed by decompiling the official Companion App's own JS bundle (Angular/Cordova,
// unobfuscated since Madden 24) -- not guesses.

import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { withEaAdminSession } from "./ea-connections.service.js";
import type { EaClient } from "./ea-client.js";

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

type TeamRow = { id: string; ea_owner_user_id: string | null; name: string | null };

async function loadTeam(leagueId: string, teamId: string): Promise<TeamRow> {
  const result = await getPgPool().query<TeamRow>(
    `select id, ea_owner_user_id, name from rec_teams where id=$1 and league_id=$2`,
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

/** Parses rec_games.ea_season_game_key -- required to target Force Win/Force Away Win/Clear
 *  Forced Result at a specific game via the Blaze API (the Companion App itself uses this single
 *  key, not a scheduleId/stageIndex/weekIndex triple). */
async function requireSeasonGameKey(leagueId: string, gameId: string): Promise<string> {
  const result = await getPgPool().query<{ ea_season_game_key: string | null }>(
    `select ea_season_game_key from rec_games where id=$1 and league_id=$2`,
    [gameId, leagueId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "Matchup not found in this league.");
  if (!row.ea_season_game_key) {
    throw new ApiError(409, "This matchup wasn't imported from EA (or was imported before this feature was added), so its in-game result can't be forced. Re-import the league and try again.");
  }
  return row.ea_season_game_key;
}

export type ForceableMatch = { gameId: string; weekNumber: number; awayTeamName: string; homeTeamName: string };

/** Games this league has actually imported from EA for the CURRENT week only -- the only ones
 *  Force Win/Clear Result can target, and a past week's result can't be force-changed. Scoped
 *  separately from the hub's matchup schedule (which shows every scheduled game across every
 *  week regardless of import status) so the Tools-menu picker can't offer a matchup that's
 *  guaranteed to 409 or belongs to a week that's already over. */
export async function listForceableMatches(leagueId: string): Promise<ForceableMatch[]> {
  const result = await getPgPool().query<{ id: string; week_number: number; away_name: string | null; home_name: string | null }>(
    `select g.id, g.week_number,
            coalesce(at.display_city || ' ' || at.display_nick, at.name) as away_name,
            coalesce(ht.display_city || ' ' || ht.display_nick, ht.name) as home_name
       from rec_games g
       left join rec_teams at on at.id = g.away_team_id
       left join rec_teams ht on ht.id = g.home_team_id
       inner join rec_leagues l on l.id = g.league_id
      where g.league_id=$1 and g.ea_season_game_key is not null and g.week_number = l.current_week
      order by away_name asc`,
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
  const clearedUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_ClearCapPenalties", team.name, { clearedUserId }, ctx,
    (client, eaLeagueId) => client.clearCapPenalties(eaLeagueId, clearedUserId));
}

export async function eaBootUser(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const bootedUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_BootUser", team.name, { bootedUserId }, ctx,
    (client, eaLeagueId) => client.bootUser(eaLeagueId, bootedUserId));
}

export async function eaAddAdmin(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const newAdminUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_AddAdmin", team.name, { newAdminUserId }, ctx,
    (client, eaLeagueId) => client.addAdmin(eaLeagueId, newAdminUserId));
}

export async function eaRemoveAdmin(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const newAdminUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_RemoveAdmin", team.name, { newAdminUserId }, ctx,
    (client, eaLeagueId) => client.removeAdmin(eaLeagueId, newAdminUserId));
}

export async function eaTransferAdmin(leagueId: string, teamId: string, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const newAdminUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_TransferAdmin", team.name, { newAdminUserId }, ctx,
    (client, eaLeagueId) => client.transferAdmin(eaLeagueId, newAdminUserId));
}

export async function eaForceHomeWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const seasonGameKey = await requireSeasonGameKey(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceHomeWin", gameId, { seasonGameKey }, ctx,
    (client, eaLeagueId) => client.forceHomeWin(eaLeagueId, seasonGameKey));
}

export async function eaForceAwayWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const seasonGameKey = await requireSeasonGameKey(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceAwayWin", gameId, { seasonGameKey }, ctx,
    (client, eaLeagueId) => client.forceAwayWin(eaLeagueId, seasonGameKey));
}

export async function eaForceNoWin(leagueId: string, gameId: string, ctx: AuditContext) {
  const seasonGameKey = await requireSeasonGameKey(leagueId, gameId);
  return runEaAdminCommand(leagueId, "Mobile_GameSchedule_ForceNoWin", gameId, { seasonGameKey }, ctx,
    (client, eaLeagueId) => client.forceNoWin(eaLeagueId, seasonGameKey));
}

export async function eaToggleAutoPilot(leagueId: string, teamId: string, weeks: number, ctx: AuditContext) {
  const team = await loadTeam(leagueId, teamId);
  const toggleAutoPilotUserId = requireOwnerUserId(team);
  return runEaAdminCommand(leagueId, "Mobile_UserAdmin_ToggleAutoPilot", team.name, { toggleAutoPilotUserId, actionTimeout: weeks }, ctx,
    (client, eaLeagueId) => client.toggleAutoPilot(eaLeagueId, toggleAutoPilotUserId, weeks));
}
