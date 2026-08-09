import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";

export type TeamInviteRequestStatus = "pending" | "sent" | "cannot_send" | "rejected";

async function resolveUserId(discordId: string): Promise<string | null> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  return account.data?.user_id ?? null;
}

// Drives the one-time attention card on the main league page: show it only for a member who
// has a team, is in a Discord-linked league (there'd be nobody to invite them otherwise), and
// has never submitted a request in any state — it should appear once and never come back,
// regardless of how the prior request was resolved.
export async function getGameInviteRequestStatus(guildId: string, discordId: string): Promise<{ show: boolean }> {
  const context = await getCurrentLeagueContext(guildId);
  if (!context.rec_leagues.discord_bot_enabled) return { show: false };
  const leagueId = context.leagueId;

  const userId = await resolveUserId(discordId);
  if (!userId) return { show: false };

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to resolve your team.", assignment.error);
  if (!assignment.data) return { show: false };

  const existing = await supabase
    .from("rec_team_invite_requests")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check invite request history.", existing.error);
  return { show: !existing.data };
}

// A linked member submits their PSN/Gamertag so the commissioner knows who to send an in-game
// invite to — mirrors the team-link-request approval flow: a pending row lands in the
// commissioners inbox, and the outcome comes back to the requester as a site notification.
export async function requestGameInvite(input: { guildId: string; discordId: string; tag: string }) {
  const tag = input.tag.trim();
  if (!tag) throw new ApiError(400, "Enter your PSN ID or Gamertag.");
  if (tag.length > 40) throw new ApiError(400, "That's too long for a PSN ID or Gamertag.");

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const userId = await resolveUserId(input.discordId);
  if (!userId) throw new ApiError(400, "Link your Discord account before requesting an invite.");

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id, team:rec_teams(name, display_nick, is_relocated)")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to resolve your team.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(400, "You aren't assigned to a team in this league yet.");

  const pending = await supabase
    .from("rec_team_invite_requests")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (pending.error) throw new ApiError(500, "Failed to check pending invite requests.", pending.error);
  if (pending.data) throw new ApiError(409, "You already have a pending invite request.");

  const inserted = await supabase
    .from("rec_team_invite_requests")
    .insert({
      league_id: leagueId,
      guild_id: input.guildId,
      team_id: assignment.data.team_id,
      user_id: userId,
      discord_id: input.discordId,
      tag,
      status: "pending",
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to submit invite request.", inserted.error);

  const teamName = formatTeamDisplayName(assignment.data.team as any) ?? "your team";
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: null,
    week_number: null,
    queue_type: "game_invite_request",
    status: "pending",
    priority: 0,
    header: `Game invite request: ${teamName}`,
    summary: `<@${input.discordId}> asked to be invited (PSN/Gamertag: ${tag}).`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: assignment.data.team_id,
    source_table: "rec_team_invite_requests",
    source_id: inserted.data.id,
    payload: { requestId: inserted.data.id, tag },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);

  return { request: inserted.data };
}

export async function resolveGameInviteRequest(input: {
  requestId: string;
  leagueId?: string | null;
  action: "sent" | "cannot_send" | "rejected";
  reviewerDiscordId: string;
}) {
  const request = await supabase.from("rec_team_invite_requests").select("*").eq("id", input.requestId).maybeSingle();
  if (request.error) throw new ApiError(500, "Failed to load invite request.", request.error);
  if (!request.data) throw new ApiError(404, "Invite request not found.");
  if (input.leagueId && request.data.league_id !== input.leagueId) throw new ApiError(404, "Invite request not found.");
  if (request.data.status !== "pending") throw new ApiError(409, "This request has already been resolved.");

  const updated = await supabase
    .from("rec_team_invite_requests")
    .update({
      status: input.action,
      resolved_at: new Date().toISOString(),
      resolved_by_discord_id: input.reviewerDiscordId,
    })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to resolve invite request.", updated.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({
      status: input.action === "sent" ? "approved" : "denied",
      reviewed_by_discord_id: input.reviewerDiscordId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("source_table", "rec_team_invite_requests")
    .eq("source_id", input.requestId);

  const outcomeCopy: Record<typeof input.action, string> = {
    sent: `Your invite request was marked as sent. Check the PSN ID/Gamertag you submitted (${request.data.tag}) for the invite.`,
    cannot_send: "Your commissioner couldn't send an invite — check with them for next steps.",
    rejected: "Your invite request was rejected.",
  } as any;

  await createSiteNotification({
    userId: request.data.user_id,
    leagueId: request.data.league_id,
    kind: "team_invite_request_resolved",
    title: input.action === "sent" ? "Invite Sent" : input.action === "cannot_send" ? "Cannot Send Invite" : "Invite Request Rejected",
    body: outcomeCopy[input.action],
    href: `/l/${request.data.league_id}/buzz?section=team`,
  }).catch((error) => {
    console.error("[WARN] Failed to notify requester of invite-request resolution:", error);
  });

  return { request: updated.data };
}
