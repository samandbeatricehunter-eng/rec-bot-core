import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getGuildMemberDisplayNameMap } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { linkUserToTeam } from "../team-ownership/team-ownership.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { createDiscordChannelInvite } from "../../lib/discord-guild.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { grantWelcomeBonus } from "../economy/welcome-bonus.service.js";
import { syncLeagueRecruitingAd } from "../recruiting-board/recruiting-board.service.js";
import { isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { syncScheduleGameUserIdsForTeams } from "../schedule/sync-game-user-ids.js";

export async function createTeamLinkRequest(input: { guildId: string; discordId: string; teamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't look up your Discord account. Please try again.", account.error);

  let userId = account.data?.user_id;
  if (!userId && isSiteOnlyDiscordId(input.discordId)) {
    const siteUserId = recUserIdFromSiteOnlyDiscordId(input.discordId);
    const siteUser = await supabase.from("rec_users").select("id").eq("id", siteUserId).maybeSingle();
    if (siteUser.error) throw new ApiError(500, "We couldn't load your REC account. Please try again.", siteUser.error);
    if (!siteUser.data) throw new ApiError(403, "Your REC account could not be resolved.");
    userId = siteUser.data.id;
  }
  if (!userId) {
    // Look up the real Discord nickname/username instead of stashing the raw snowflake as
    // a placeholder — that placeholder was never getting corrected later, so it just showed
    // up permanently as a number in every team/roster/chat display. Leave it null on a
    // failed/missed lookup rather than falling back to the raw ID; a later login or hub read
    // can still resolve a real name, but a written snowflake never self-heals.
    const liveName = await bestEffort("discord.member_display_name", () => getGuildMemberDisplayNameMap(input.guildId).then((names) => names.get(input.discordId) ?? null), { guildId: input.guildId }) ?? null;
    // display_name is NOT NULL — "" (its own column default) stands in for a failed/missed
    // lookup rather than null, which would fail the insert outright.
    const createdUser = await supabase.from("rec_users").insert({ display_name: liveName ?? "", status: "active" }).select("id").single();
    if (createdUser.error) throw new ApiError(500, "We couldn't create your REC account. Please try again.", createdUser.error);
    userId = createdUser.data.id;
    void grantWelcomeBonus(String(userId));
    const createdAccount = await supabase
      .from("rec_discord_accounts")
      .insert({
        user_id: userId,
        discord_id: input.discordId,
        // Never store the snowflake as a display username — resolve later via Discord API.
        username: null,
        global_name: null,
      })
      .select("user_id")
      .single();
    if (createdAccount.error) {
      // Roll back the just-created rec_users row rather than leaving it orphaned with no linked account.
      await supabase.from("rec_users").delete().eq("id", userId);
      throw new ApiError(500, "We couldn't link your Discord account. Please try again.", createdAccount.error);
    }
  }

  const existingAssignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (existingAssignment.error) throw new ApiError(500, "We couldn't check your current team link. Please try again.", existingAssignment.error);
  if (existingAssignment.data) throw new ApiError(409, "You are already linked to a team in this league.");

  const team = await supabase
    .from("rec_teams")
    .select("*")
    .eq("id", input.teamId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (team.error) throw new ApiError(500, "We couldn't load that team. Please try again.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");

  const teamTaken = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", input.teamId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (teamTaken.error) throw new ApiError(500, "We couldn't check whether that team is available. Please try again.", teamTaken.error);
  if (teamTaken.data) throw new ApiError(409, "That team is no longer available.");

  // Someone else's pending/approved request on this same team also takes it off the market —
  // without this a second member could request it while the first request is still awaiting
  // the commissioner's review.
  const teamRequested = await supabase
    .from("rec_team_link_requests")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", input.teamId)
    .in("status", ["pending", "approved"])
    .maybeSingle();
  if (teamRequested.error) throw new ApiError(500, "We couldn't check whether that team is available. Please try again.", teamRequested.error);
  if (teamRequested.data) throw new ApiError(409, "That team already has a pending request from another member.");

  const pending = await supabase
    .from("rec_team_link_requests")
    .select("id")
    .eq("league_id", leagueId)
    .eq("requester_user_id", userId)
    .in("status", ["pending", "approved"])
    .maybeSingle();
  if (pending.error) throw new ApiError(500, "We couldn't check your pending team requests. Please try again.", pending.error);
  if (pending.data) throw new ApiError(409, "You already have a pending team request.");

  const inserted = await supabase
    .from("rec_team_link_requests")
    .insert({
      guild_id: input.guildId,
      league_id: leagueId,
      team_id: input.teamId,
      requester_user_id: userId,
      requester_discord_id: input.discordId,
      status: "pending",
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "We couldn't submit that team request. Please try again.", inserted.error);

  const teamName = formatTeamDisplayName(team.data) ?? team.data.name;
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: null,
    week_number: null,
    queue_type: "team_request",
    status: "pending",
    priority: 0,
    header: teamName ? `Team link request: ${teamName}` : "Team link request",
    summary: `Requested by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: input.teamId,
    source_table: "rec_team_link_requests",
    source_id: inserted.data.id,
    payload: { requestId: inserted.data.id, teamId: input.teamId },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);
  void syncLeagueRecruitingAd(leagueId);

  const teamDisplayName = formatTeamDisplayName(team.data) ?? team.data.name;
  const notifyUserIds = new Set<string>();
  const ownerUserId = context.rec_leagues?.owner_user_id ?? null;
  if (ownerUserId) notifyUserIds.add(String(ownerUserId));

  const commissioners = await supabase
    .from("rec_league_memberships")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("status", "active")
    .eq("role", "commissioner");
  if (commissioners.error) {
    console.error("[WARN] Failed to load commissioner memberships for team-request site notifications:", commissioners.error);
  } else {
    for (const row of commissioners.data ?? []) {
      if (row.user_id) notifyUserIds.add(String(row.user_id));
    }
  }

  if (notifyUserIds.size) {
    const siteUsers = await supabase
      .from("rec_users")
      .select("id, supabase_auth_user_id")
      .in("id", [...notifyUserIds])
      .not("supabase_auth_user_id", "is", null);
    if (siteUsers.error) {
      console.error("[WARN] Failed to resolve site accounts for team-request notifications:", siteUsers.error);
    } else {
      const leagueName = context.rec_leagues?.name ?? "your league";
      await Promise.all(
        (siteUsers.data ?? []).map((row) =>
          createSiteNotification({
            userId: row.id,
            leagueId,
            kind: "team_request",
            title: `Team request: ${teamDisplayName}`,
            body: `A Discord member requested ${teamDisplayName} in ${leagueName}.`,
            href: `/l/${leagueId}/mgmt`,
          }).catch((error) => {
            console.error(`[WARN] Failed to create team_request site notification for ${row.id}:`, error);
          }),
        ),
      );
    }
  }

  return {
    request: inserted.data,
    teamName: teamDisplayName,
    leagueName: context.rec_leagues.name ?? null,
  };
}

export async function getTeamLinkRequest(requestId: string) {
  const { data, error } = await supabase
    .from("rec_team_link_requests")
    .select("*,team:rec_teams(*)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load team request.", error);
  if (!data) throw new ApiError(404, "Team request not found.");
  return data;
}

async function assertLeagueHasMemberCapacity(leagueId: string, incomingUserId: string | null) {
  const [league, memberships, assignments] = await Promise.all([
    supabase.from("rec_leagues").select("max_members").eq("id", leagueId).maybeSingle(),
    supabase.from("rec_league_memberships").select("user_id").eq("league_id", leagueId).eq("status", "active"),
    supabase.from("rec_team_assignments").select("user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
  ]);
  if (league.error || !league.data) throw new ApiError(404, "League not found.", league.error ?? undefined);
  if (memberships.error || assignments.error) throw new ApiError(500, "Failed to verify league member capacity.", memberships.error ?? assignments.error);
  const members = new Set<string>();
  for (const row of memberships.data ?? []) if (row.user_id) members.add(row.user_id);
  for (const row of assignments.data ?? []) if (row.user_id) members.add(row.user_id);
  if (incomingUserId && members.has(incomingUserId)) return;
  if (members.size >= Number(league.data.max_members ?? 32)) {
    throw new ApiError(409, `This league has reached its ${Number(league.data.max_members ?? 32)}-member limit.`);
  }
}

export async function approveTeamLinkRequest(input: { requestId: string; leagueId?: string | null; reviewerDiscordId: string; autoComplete?: boolean }) {
  const request = await getTeamLinkRequest(input.requestId);
  if (input.leagueId && request.league_id !== input.leagueId) throw new ApiError(404, "Team request not found.");
  if (request.status !== "pending") throw new ApiError(409, "This request is no longer pending.");
  await assertLeagueHasMemberCapacity(request.league_id, request.requester_user_id ?? null);

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to approve team request.", updated.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString() })
    .eq("source_table", "rec_team_link_requests")
    .eq("source_id", input.requestId);

  const teamRow = await supabase.from("rec_teams").select("*").eq("id", request.team_id).maybeSingle();
  // The web dashboard has no separate role-selection step after Approve (unlike the bot's
  // flow, which explicitly calls completeTeamLinkRequest itself afterward with the chosen
  // authority) — so a web approval needs to complete the assignment immediately, or the
  // request is left stuck at "approved" with no team_assignments row and no nickname/role
  // sync ever fired. This used to key off reviewerDiscordId === "web-dashboard", a sentinel
  // the route always overwrote with the caller's real Discord id before it ever reached here.
  if (input.autoComplete) {
    try {
      return await completeTeamLinkRequest({
        requestId: input.requestId,
        authority: "member",
        reviewerDiscordId: input.reviewerDiscordId,
      });
    } catch (error) {
      // completeTeamLinkRequest can still fail here (e.g. the requester's subscription tier no
      // longer qualifies them to join) even though the request/inbox row was already flipped to
      // "approved" above — without reverting that, the request is stuck "approved" forever with
      // no real team assignment, and the pending item silently vanishes from the commissioner's
      // queue instead of surfacing the failure.
      await supabase.from("rec_team_link_requests").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", input.requestId);
      await supabase.from("rec_commissioners_inbox").update({ status: "pending", reviewed_by_discord_id: null, reviewed_at: null })
        .eq("source_table", "rec_team_link_requests").eq("source_id", input.requestId);
      throw error;
    }
  }
  return {
    ...updated.data,
    team: teamRow.data ?? null,
    teamName: formatTeamDisplayName(teamRow.data) ?? teamRow.data?.name ?? "Team",
  };
}

export async function rejectTeamLinkRequest(input: { requestId: string; leagueId?: string | null; reviewerDiscordId: string }) {
  const request = await getTeamLinkRequest(input.requestId);
  if (input.leagueId && request.league_id !== input.leagueId) throw new ApiError(404, "Team request not found.");
  if (!["pending", "approved"].includes(request.status)) throw new ApiError(409, "This request can no longer be rejected.");

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({
      status: "rejected",
      assigned_by_discord_id: input.reviewerDiscordId,
      updated_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to reject team request.", updated.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "denied", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString() })
    .eq("source_table", "rec_team_link_requests")
    .eq("source_id", input.requestId);
  void syncLeagueRecruitingAd(updated.data.league_id);
  return updated.data;
}

export async function completeTeamLinkRequest(input: {
  requestId: string;
  authority: "member" | "co_commissioner" | "commissioner";
  reviewerDiscordId: string;
}) {
  const request = await getTeamLinkRequest(input.requestId);
  if (request.status !== "approved") throw new ApiError(409, "Approve the request before assigning a role.");
  await assertLeagueHasMemberCapacity(request.league_id, request.requester_user_id ?? null);

  let link: unknown;
  // Prefer the request's requester_user_id whenever the requester is site-identified
  // (synthetic site:{userId} discord id, or an explicit requester_user_id on a Discord-guild
  // request). Routing those through linkUserToTeam(discordId=site:...) used to mint a blank
  // ghost user when the synthetic discord account was missing/mis-pointed.
  const siteRequesterUserId = request.requester_user_id
    ?? (isSiteOnlyDiscordId(String(request.requester_discord_id ?? ""))
      ? recUserIdFromSiteOnlyDiscordId(String(request.requester_discord_id))
      : null);
  if (String(request.guild_id).startsWith("site:") || (siteRequesterUserId && isSiteOnlyDiscordId(String(request.requester_discord_id ?? "")))) {
    if (!siteRequesterUserId) throw new ApiError(400, "This team request is missing the requester account.");
    const now = new Date().toISOString();
    // End any prior open assignment for this user or team before inserting.
    await supabase
      .from("rec_team_assignments")
      .update({ assignment_status: "replaced", ended_at: now })
      .eq("league_id", request.league_id)
      .is("ended_at", null)
      .or(`user_id.eq.${siteRequesterUserId},and(team_id.eq.${request.team_id},assignment_status.eq.active)`);
    const membership = await supabase
      .from("rec_league_memberships")
      .upsert(
        { league_id: request.league_id, user_id: siteRequesterUserId, status: "active", role: "member" },
        { onConflict: "league_id,user_id" },
      );
    if (membership.error) throw new ApiError(500, "Failed to add the league member.", membership.error);
    const assignment = await supabase
      .from("rec_team_assignments")
      .insert({
        league_id: request.league_id,
        team_id: request.team_id,
        user_id: siteRequesterUserId,
        assignment_status: "active",
        source: "manual_admin_entry",
        notes: "Authority: member",
        stats_credit_starts_at: now,
      })
      .select("*")
      .single();
    if (assignment.error) throw new ApiError(500, "Failed to assign the requested team.", assignment.error);
    await syncScheduleGameUserIdsForTeams(request.league_id, [request.team_id]);
    link = { assignment: assignment.data, authority: "member", accountKind: "site" };
    void syncLeagueRecruitingAd(request.league_id);
  } else {
    link = await linkUserToTeam({
      guildId: request.guild_id,
      discordId: request.requester_discord_id,
      teamId: request.team_id,
      authority: "member",
      requestedByDiscordId: input.reviewerDiscordId,
    });
  }

  const reviewerAccount = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.reviewerDiscordId)
    .maybeSingle();

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({
      status: "completed",
      authority: input.authority,
      assigned_by_discord_id: input.reviewerDiscordId,
      assigned_by_user_id: reviewerAccount.data?.user_id ?? null,
      updated_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to complete team request.", updated.error);

  const [leagueDetails, leagueConfiguration] = await Promise.all([
    supabase
      .from("rec_leagues")
      .select("name,discord_bot_enabled")
      .eq("id", request.league_id)
      .maybeSingle(),
    supabase
      .from("rec_league_configuration")
      .select("league_password")
      .eq("league_id", request.league_id)
      .maybeSingle(),
  ]);
  if (leagueDetails.error) throw new ApiError(500, "Failed to load league invite settings.", leagueDetails.error);
  if (leagueConfiguration.error) throw new ApiError(500, "Failed to load league password settings.", leagueConfiguration.error);
  const leaguePassword = leagueConfiguration.data?.league_password ?? null;
  let serverInviteUrl: string | null = null;
  if (leagueDetails.data?.discord_bot_enabled) {
    const link = await supabase
      .from("rec_server_league_links")
      .select("server_id, server:rec_discord_servers(guild_id)")
      .eq("league_id", request.league_id)
      .eq("is_primary", true)
      .maybeSingle();
    const route = link.data?.server_id
      ? await supabase
        .from("rec_server_routes")
        .select("main_chat_channel_id, general_chat_channel_id, announcements_channel_id")
        .eq("server_id", link.data.server_id)
        .maybeSingle()
      : null;
    // main_chat_channel_id is frequently never set for a server (it's only wired up by a
    // specific setup step) — falling back to whatever other invite-able channel actually IS
    // configured, and finally to any live text channel in the guild, instead of silently
    // giving up and leaving the requester with no invite at all.
    let inviteChannelId: string | null =
      route?.data?.main_chat_channel_id ?? route?.data?.general_chat_channel_id ?? route?.data?.announcements_channel_id ?? null;
    const guildId = (link.data as any)?.server?.guild_id as string | undefined;
    if (!inviteChannelId && guildId) {
      const { listGuildChannels } = await import("../../lib/discord-guild.js");
      const channels = await listGuildChannels(guildId).catch(() => [] as Awaited<ReturnType<typeof listGuildChannels>>);
      inviteChannelId = channels.find((c) => c.type === "text")?.id ?? null;
    }
    if (inviteChannelId) {
      serverInviteUrl = await createDiscordChannelInvite(inviteChannelId);
    }
  }
  await createSiteNotification({
    userId: request.requester_user_id,
    leagueId: request.league_id,
    kind: "team_request_approved",
    title: `Welcome to ${leagueDetails.data?.name ?? "your new league"}`,
    body: [
      `Your request for ${request.team?.name ?? "the team"} was approved.`,
      leaguePassword
        ? `League password: ${leaguePassword}.`
        : "This league does not require a password.",
      leagueDetails.data?.discord_bot_enabled
        ? serverInviteUrl
          ? `Discord server invite: ${serverInviteUrl}. Open My Team to enter your gamertag or PSN and request a game invite.`
          : "Open the league to request a Discord/server invite and enter your gamertag or PSN for a game invite."
        : "Open the league to get started.",
    ].join(" "),
    href: `/l/${request.league_id}/team?teamInvite=1`,
  }).catch((error) => {
    console.error("[WARN] Failed to notify approved team requester:", error);
  });

  // A site notification alone strands recruiting-board requesters — they clicked a button in
  // Discord and may never log into the site to see it. DM the same server-invite info
  // directly; requester_discord_id is always present on a team_link_request row.
  if (serverInviteUrl && request.requester_discord_id) {
    const { sendDiscordDirectMessage } = await import("../../lib/discord-guild.js");
    await sendDiscordDirectMessage(
      request.requester_discord_id,
      `Your request for ${request.team?.name ?? "a team"} in ${leagueDetails.data?.name ?? "REC Leagues"} was approved! Join the server: ${serverInviteUrl}${leaguePassword ? `\nLeague password: ${leaguePassword}` : ""}`,
    ).catch((error) => console.error("[WARN] Failed to DM approved team requester their server invite:", error));
  }

  return { request: updated.data, link };
}

export async function attachTeamLinkRequestMessage(input: {
  requestId: string;
  channelId: string;
  messageId: string;
}) {
  const { error } = await supabase
    .from("rec_team_link_requests")
    .update({
      review_channel_id: input.channelId,
      review_message_id: input.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.requestId);
  if (error) throw new ApiError(500, "Failed to attach review message.", error);
  return { ok: true };
}
