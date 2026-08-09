import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { addRosterPlayer } from "./roster.service.js";

const QUEUE_TYPE = "roster_add_request";

async function userIdForDiscord(discordId: string) {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

async function ownTeamId(leagueId: string, userId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("team_id,team:rec_teams(name)")
    .eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(404, "You are not linked to a team in this league.");
  const team = assignment.data.team as any;
  return { teamId: assignment.data.team_id as string, teamName: team?.name ?? null };
}

/** The "Edit Roster" / "Add Player to Roster" quick action — adds the player straight to the
 * caller's own team, no commissioner approval needed (a user can only add to their own
 * roster, so there's nothing here for a commissioner to gatekeep). listRosterAddRequests/
 * approveRosterAddRequest/denyRosterAddRequest below are kept for any already-queued rows
 * from before this changed, but nothing new is ever queued into that flow now. */
export async function submitRosterAddRequest(input: {
  guildId: string;
  discordId: string;
  firstName: string;
  lastName: string;
  position: string;
  heightInches?: number | null;
  weightLbs?: number | null;
  overallRating?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const { teamId } = await ownTeamId(context.leagueId, userId);

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ApiError(400, "First and last name are required.");
  const position = input.position.trim().toUpperCase();
  if (!position) throw new ApiError(400, "Position is required.");

  const player = await addRosterPlayer({
    guildId: input.guildId, discordId: input.discordId, teamId,
    firstName, lastName, position,
    heightInches: input.heightInches, weightLbs: input.weightLbs, overallRating: input.overallRating,
  });
  return { status: "approved" as const, player };
}

export async function listRosterAddRequests(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_commissioners_inbox").select("id,header,summary,payload,requester_discord_id,created_at")
    .eq("league_id", context.leagueId).eq("queue_type", QUEUE_TYPE).eq("status", "pending").order("created_at", { ascending: true });
  if (rows.error) throw new ApiError(500, "Failed to load pending roster additions.", rows.error);
  return { requests: rows.data ?? [] };
}

export async function approveRosterAddRequest(input: { guildId: string; discordId: string; requestId: string }) {
  await assertGuildPermission(input.guildId, input.discordId, "co_commissioner");
  const context = await getCurrentLeagueContext(input.guildId);
  const row = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId)
    .eq("league_id", context.leagueId).eq("queue_type", QUEUE_TYPE).eq("status", "pending").maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load the request.", row.error);
  if (!row.data) throw new ApiError(404, "Roster addition request not found or already resolved.");
  const payload = row.data.payload as any;

  const player = await addRosterPlayer({
    guildId: input.guildId, discordId: input.discordId, teamId: payload.teamId,
    firstName: payload.firstName, lastName: payload.lastName, position: payload.position,
    heightInches: payload.heightInches, weightLbs: payload.weightLbs, overallRating: payload.overallRating,
  });

  await supabase.from("rec_commissioners_inbox").delete().eq("id", input.requestId);

  if (row.data.requester_user_id) {
    await createSiteNotification({
      userId: row.data.requester_user_id, leagueId: context.leagueId, kind: "roster_add_approved",
      title: `${payload.firstName} ${payload.lastName} was added to your roster`,
      body: "Your roster addition request was approved by a commissioner.",
      href: "/app",
    }).catch((error) => console.error("[WARN] Failed to notify roster-add requester of approval:", error));
  }

  return { player };
}

export async function denyRosterAddRequest(input: { guildId: string; discordId: string; requestId: string; reason: string }) {
  await assertGuildPermission(input.guildId, input.discordId, "co_commissioner");
  if (!input.reason.trim()) throw new ApiError(400, "A denial reason is required.");
  const context = await getCurrentLeagueContext(input.guildId);
  const row = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId)
    .eq("league_id", context.leagueId).eq("queue_type", QUEUE_TYPE).eq("status", "pending").maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load the request.", row.error);
  if (!row.data) throw new ApiError(404, "Roster addition request not found or already resolved.");
  const payload = row.data.payload as any;

  await supabase.from("rec_commissioners_inbox").delete().eq("id", input.requestId);

  if (row.data.requester_user_id) {
    await createSiteNotification({
      userId: row.data.requester_user_id, leagueId: context.leagueId, kind: "roster_add_denied",
      title: `Roster addition denied: ${payload.firstName} ${payload.lastName}`,
      body: input.reason.trim(),
      href: "/app",
    }).catch((error) => console.error("[WARN] Failed to notify roster-add requester of denial:", error));
  }

  return { ok: true as const };
}
