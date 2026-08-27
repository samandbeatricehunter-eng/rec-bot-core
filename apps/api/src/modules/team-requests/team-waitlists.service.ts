import { CFB_POSITION_GROUPS, MADDEN_POSITION_GROUPS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import {
  createDiscordChannelInvite,
  getGuildMemberDisplayNameMap,
  listGuildChannels,
  sendDiscordDirectMessage,
  sendDiscordDirectMessagePayload,
} from "../../lib/discord-guild.js";
import { bestEffort } from "../../lib/best-effort.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague, getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { getTeamRoster } from "../roster/roster.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { listOpenTeamsForLeagueId } from "../team-ownership/team-ownership.service.js";
import { grantWelcomeBonus } from "../economy/welcome-bonus.service.js";

type WaitlistScope = "any_open" | "specific_team";

// Mirrors createTeamLinkRequest's account-resolution path (team-requests.service.ts) so a
// waitlist signup creates the same kind of account every other entry point does -- a real
// display name resolved from Discord instead of a permanent blank, plus the welcome bonus.
async function resolveWaitlistUser(guildId: string, discordId: string): Promise<string> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't look up your Discord account.", account.error);
  if (account.data?.user_id) return String(account.data.user_id);

  if (isSiteOnlyDiscordId(discordId)) {
    const siteUserId = recUserIdFromSiteOnlyDiscordId(discordId);
    const siteUser = await supabase.from("rec_users").select("id").eq("id", siteUserId).maybeSingle();
    if (siteUser.error) throw new ApiError(500, "We couldn't load your REC account.", siteUser.error);
    if (siteUser.data) return String(siteUser.data.id);
  }

  const liveName = await bestEffort("discord.member_display_name", () => getGuildMemberDisplayNameMap(guildId).then((names) => names.get(discordId) ?? null), { guildId }) ?? null;
  const user = await supabase.from("rec_users").insert({ display_name: liveName ?? "", status: "active" }).select("id").single();
  if (user.error) throw new ApiError(500, "We couldn't create your REC account.", user.error);
  void grantWelcomeBonus(String(user.data.id));
  const linked = await supabase.from("rec_discord_accounts").insert({
    user_id: user.data.id,
    discord_id: discordId,
    username: null,
    global_name: null,
  });
  if (linked.error) {
    await supabase.from("rec_users").delete().eq("id", user.data.id);
    throw new ApiError(500, "We couldn't link your Discord account.", linked.error);
  }
  return String(user.data.id);
}

export async function createTeamWaitlist(input: {
  guildId: string;
  discordId: string;
  conference: string;
  scope: WaitlistScope;
  teamId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const conference = input.conference.trim();
  if (!conference) throw new ApiError(400, "Choose a conference first.");
  if (input.scope === "specific_team" && !input.teamId) throw new ApiError(400, "Choose a team for this waitlist.");

  let team: any = null;
  if (input.teamId) {
    const loaded = await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated,conference")
      .eq("league_id", context.leagueId).eq("id", input.teamId).maybeSingle();
    if (loaded.error) throw new ApiError(500, "We couldn't load that team.", loaded.error);
    if (!loaded.data || String(loaded.data.conference ?? "") !== conference) throw new ApiError(404, "That team is not in the conference you're viewing.");
    const occupied = await supabase.from("rec_team_assignments").select("id").eq("league_id", context.leagueId)
      .eq("team_id", input.teamId).eq("assignment_status", "active").is("ended_at", null).limit(1);
    if (occupied.error) throw new ApiError(500, "We couldn't check that team's availability.", occupied.error);
    if (!occupied.data?.length) throw new ApiError(409, "That team is already open. Use Request Team instead.");
    team = loaded.data;
  }

  const userId = await resolveWaitlistUser(input.guildId, input.discordId);
  const inserted = await supabase.from("rec_team_waitlists").insert({
    league_id: context.leagueId,
    user_id: userId,
    requester_discord_id: input.discordId,
    team_id: input.scope === "specific_team" ? input.teamId : null,
    conference,
    scope: input.scope,
    status: "active",
  }).select("id,scope,conference,team_id,status").single();
  if (inserted.error) {
    if (String(inserted.error.code) === "23505") throw new ApiError(409, "You're already on that waitlist.");
    throw new ApiError(500, "We couldn't add you to the waitlist.", inserted.error);
  }
  return {
    ...inserted.data,
    teamName: team ? (formatTeamDisplayName(team) ?? team.name) : null,
  };
}

async function inviteForLeague(leagueId: string): Promise<string | null> {
  const linked = await findServerRoutesForLeague(leagueId);
  if (!linked) return null;
  const routes = linked.routes ?? {};
  let channelId = String(routes.main_chat_channel_id ?? routes.general_chat_channel_id ?? routes.announcements_channel_id ?? "") || null;
  if (!channelId) channelId = (await listGuildChannels(linked.guildId)).find((channel) => channel.type === "text")?.id ?? null;
  return channelId ? createDiscordChannelInvite(channelId) : null;
}

function rosterEmbed(roster: Awaited<ReturnType<typeof getTeamRoster>>, game: string | null) {
  const preferredGroups = game?.startsWith("madden") ? MADDEN_POSITION_GROUPS : CFB_POSITION_GROUPS;
  const byGroup = new Map<string, typeof roster.players>();
  for (const player of roster.players) {
    const group = player.positionGroup || player.position || "Other";
    byGroup.set(group, [...(byGroup.get(group) ?? []), player]);
  }
  const groups = [...preferredGroups, ...[...byGroup.keys()].filter((group) => !preferredGroups.includes(group as never))];
  const fields = groups.flatMap((group) => {
    const players = [...(byGroup.get(group) ?? [])].sort((a, b) => (b.overallRating ?? -1) - (a.overallRating ?? -1));
    if (!players.length) return [];
    const lines: string[] = [];
    let chars = 0;
    for (const player of players) {
      const line = `${player.position || group} · ${player.fullName} — ${player.overallRating ?? "?"} OVR${player.devTrait ? ` · ${player.devTrait}` : ""}`;
      if (chars + line.length + 1 > 1000) break;
      lines.push(line); chars += line.length + 1;
    }
    return [{ name: String(group).slice(0, 256), value: lines.join("\n") || "Roster unavailable", inline: false }];
  }).slice(0, 25);
  return {
    title: `${roster.team.name} roster`,
    description: "Players are grouped by position and sorted from highest to lowest OVR.",
    color: 0xd4af37,
    fields,
  };
}

// Reuses the canonical "which teams are open" definition (team-ownership.service.ts) instead of
// a separate copy -- that copy was missing the ghost-assignment and schedule-placeholder filters
// the real /openteams flow relies on, which could make the waitlist sweep disagree with what a
// user actually sees when they run the command.
async function openTeamsForLeague(leagueId: string) {
  const { openTeams } = await listOpenTeamsForLeagueId(leagueId);
  return openTeams;
}

async function notifyWaitlist(row: any, openTeams: any[], league: any, guildId: string) {
  const invite = await inviteForLeague(row.league_id);
  const instruction = "Run `/openteams`, open the team's conference, then choose **Request Team** to send your request to the commissioners.";
  if (row.scope === "specific_team") {
    const team = openTeams.find((candidate) => candidate.id === row.team_id);
    if (!team) return false;
    const name = formatTeamDisplayName(team) ?? team.name;
    await sendDiscordDirectMessage(row.requester_discord_id,
      [`**${name} is now open in ${league.name ?? "your REC league"}.**`, invite ? `Server invite: ${invite}` : null, instruction].filter(Boolean).join("\n"));
    return true;
  }

  const conferenceTeams = openTeams.filter((team) => String(team.conference ?? "") === row.conference);
  if (!conferenceTeams.length) return false;
  await sendDiscordDirectMessage(row.requester_discord_id,
    [`**Teams are open in ${row.conference} · ${league.name ?? "REC League"}.**`, invite ? `Server invite: ${invite}` : null, instruction, "Roster breakdowns follow below."].filter(Boolean).join("\n"));
  // The summary above already went out, so a failure partway through the roster embeds must not
  // throw back up to runTeamWaitlistSweep's catch -- that would leave the row "active" and the
  // next 60s sweep would resend the summary and every already-delivered roster embed again.
  // Best-effort per team instead: log and move on, still counting the notification delivered.
  for (const team of conferenceTeams) {
    await getTeamRoster({ guildId, discordId: row.requester_discord_id, teamId: team.id })
      .then((roster) => sendDiscordDirectMessagePayload(row.requester_discord_id, { embeds: [rosterEmbed(roster, league.game ?? null)] }))
      .catch((error) => console.error("[WARN] Failed to send waitlist roster embed", row.id, team.id, error));
  }
  return true;
}

/** Restart-safe background sweep. It catches every way a team can become open (retire,
 * commissioner unlink, member leaving Discord, imports/admin cleanup) without relying on each
 * caller remembering to emit a separate event. */
export async function runTeamWaitlistSweep() {
  const waitlists = await supabase.from("rec_team_waitlists").select("*").eq("status", "active").order("created_at", { ascending: true });
  if (waitlists.error) {
    // Allows code to deploy safely just before its migration is applied.
    if (String(waitlists.error.code) === "42P01" || String(waitlists.error.code) === "PGRST205") return { checked: 0, notified: 0 };
    throw waitlists.error;
  }
  const byLeague = new Map<string, any[]>();
  for (const row of waitlists.data ?? []) byLeague.set(row.league_id, [...(byLeague.get(row.league_id) ?? []), row]);
  let notified = 0;
  for (const [leagueId, rows] of byLeague) {
    const [leagueResult, linked, openTeams] = await Promise.all([
      supabase.from("rec_leagues").select("id,name,game").eq("id", leagueId).maybeSingle(),
      findServerRoutesForLeague(leagueId),
      openTeamsForLeague(leagueId),
    ]);
    if (!leagueResult.data || !linked || !openTeams.length) continue;
    for (const row of rows) {
      try {
        if (!await notifyWaitlist(row, openTeams, leagueResult.data, linked.guildId)) continue;
        const now = new Date().toISOString();
        await supabase.from("rec_team_waitlists").update({ status: "notified", notified_at: now, updated_at: now }).eq("id", row.id).eq("status", "active");
        notified += 1;
      } catch (error) {
        console.error("[WARN] Failed to deliver team waitlist DM", row.id, error);
      }
    }
  }
  return { checked: waitlists.data?.length ?? 0, notified };
}
