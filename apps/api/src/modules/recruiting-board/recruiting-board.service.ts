// Cross-league Discord "recruiting board": one live-edited embed per league (with open teams)
// in the management guild's per-game-type league-post channel, plus the request flow for
// users who aren't in that league's own Discord server (or whose league has none) yet.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage, deleteDiscordMessage, getGuildMemberDisplayNameMap } from "../../lib/discord-guild.js";
import { getSiteDiscordConfig } from "../admin/site-discord-config.service.js";
import { checkLeagueLinked } from "../setup/setup.service.js";
import { listOpenTeamsForLeagueId } from "../team-ownership/team-ownership.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { grantWelcomeBonus } from "../economy/welcome-bonus.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";

const GAME_LABELS: Record<string, string> = { madden_26: "Madden NFL 26", madden_27: "Madden NFL 27", cfb_27: "College Football 27" };

function channelForGame(config: Awaited<ReturnType<typeof getSiteDiscordConfig>>, game: string): string | null {
  if (game === "madden_26") return config.leaguePostChannels.madden_26;
  if (game === "madden_27") return config.leaguePostChannels.madden_27;
  if (game === "cfb_27") return config.leaguePostChannels.cfb_27;
  return null;
}

async function loadLeagueForAd(leagueId: string) {
  const { data, error } = await supabase.from("rec_leagues").select("id,name,game,max_members").eq("id", leagueId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load league.", error);
  return data as { id: string; name: string; game: string; max_members: number | null } | null;
}

async function removeAd(leagueId: string) {
  const existing = await supabase.from("rec_league_recruiting_ads").select("*").eq("league_id", leagueId).maybeSingle();
  if (existing.data?.message_id) await deleteDiscordMessage(existing.data.channel_id, existing.data.message_id);
  if (existing.data) await supabase.from("rec_league_recruiting_ads").delete().eq("league_id", leagueId);
}

function buildAdPayload(league: { id: string; name: string; game: string }, allTeams: any[], openTeamIds: Set<string>) {
  const openCount = allTeams.filter((team) => openTeamIds.has(team.id)).length;
  const lines = allTeams
    .map((team) => formatTeamDisplayName(team) ?? team.name)
    .map((name, index) => (openTeamIds.has(allTeams[index]!.id) ? `${name}` : `~~${name}~~`));
  const embed = {
    title: league.name,
    description: `${GAME_LABELS[league.game] ?? league.game} — **${openCount}** of **${allTeams.length}** teams open.\n\n${lines.join("\n") || "No teams configured yet."}`,
    color: 0x2ecc71,
    footer: { text: "Click Open Teams to see availability, or Request Team to claim one." },
  };
  const components = [
    {
      type: 1,
      components: [{ type: 2, style: 2, label: "Open Teams", custom_id: `rec:board:open:${league.id}` }],
    },
  ];
  if (openCount > 0) {
    const options = allTeams
      .filter((team) => openTeamIds.has(team.id))
      .slice(0, 25)
      .map((team) => ({ label: (formatTeamDisplayName(team) ?? team.name).slice(0, 100), value: team.id }));
    components.push({
      type: 1,
      components: [{ type: 3, custom_id: `rec:board:request:${league.id}`, placeholder: "Request a team", options } as any],
    });
  }
  return { embeds: [embed], components };
}

/** Re-render (or remove) a single league's recruiting-board ad. Called after any team
 * assignment/request change so the embed's strikethroughs stay current; safe to call whenever
 * — it's a no-op if the league has no game-type channel configured yet. */
export async function syncLeagueRecruitingAd(leagueId: string): Promise<void> {
  try {
    const league = await loadLeagueForAd(leagueId);
    if (!league) return void (await removeAd(leagueId));

    const config = await getSiteDiscordConfig();
    const channelId = channelForGame(config, league.game);
    if (!channelId) return void (await removeAd(leagueId));

    const { openTeams, allTeams } = await listOpenTeamsForLeagueId(leagueId);
    if (!openTeams.length) return void (await removeAd(leagueId));

    const openTeamIds = new Set<string>(openTeams.map((team: any) => String(team.id)));
    const payload = buildAdPayload(league, allTeams, openTeamIds);

    const existing = await supabase.from("rec_league_recruiting_ads").select("*").eq("league_id", leagueId).maybeSingle();
    if (existing.data?.message_id && existing.data.channel_id === channelId) {
      const edited = await editDiscordMessage(channelId, existing.data.message_id, payload);
      if (edited) {
        await supabase.from("rec_league_recruiting_ads").update({ game: league.game, updated_at: new Date().toISOString() }).eq("league_id", leagueId);
        return;
      }
    } else if (existing.data?.message_id) {
      await deleteDiscordMessage(existing.data.channel_id, existing.data.message_id);
    }

    const posted = await postDiscordChannelMessage(channelId, payload);
    await supabase.from("rec_league_recruiting_ads").upsert(
      { league_id: leagueId, game: league.game, channel_id: channelId, message_id: posted?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "league_id" },
    );
  } catch (error) {
    console.error("[WARN] Failed to sync recruiting-board ad:", error);
  }
}

/** Backfill/repair every league of a game family — used after an admin sets or changes a
 * league-post channel so already-open leagues appear without waiting for their next roster event. */
export async function syncAllRecruitingAdsForGame(game: string): Promise<void> {
  const leagues = await supabase.from("rec_leagues").select("id").eq("game", game);
  if (leagues.error) throw new ApiError(500, "Failed to load leagues for recruiting-board backfill.", leagues.error);
  for (const row of leagues.data ?? []) await syncLeagueRecruitingAd(row.id);
}

export async function getRecruitingBoardOpenTeams(leagueId: string) {
  const league = await loadLeagueForAd(leagueId);
  if (!league) throw new ApiError(404, "League not found.");
  const { openTeams } = await listOpenTeamsForLeagueId(leagueId);
  return {
    leagueName: league.name,
    game: league.game,
    openTeams: openTeams.map((team: any) => ({
      id: team.id,
      name: formatTeamDisplayName(team) ?? team.name,
      conference: team.conference ?? null,
      division: team.division ?? null,
    })),
  };
}

/** Team-request creation for the cross-league recruiting board — the requester is interacting
 * from the management guild, not the league's own guild, so this takes an explicit leagueId
 * rather than resolving one from guildId context (contrast createTeamLinkRequest). */
export async function createRecruitingBoardTeamRequest(input: { leagueId: string; discordId: string; teamId: string }) {
  const league = await loadLeagueForAd(input.leagueId);
  if (!league) throw new ApiError(404, "League not found.");

  const link = await checkLeagueLinked(input.leagueId);
  const guildIdForRequest = link.linked && link.guildId ? link.guildId : `site:${input.leagueId}`;

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  let userId = account.data?.user_id ?? null;

  if (!link.linked) {
    // Unlinked leagues have no Discord server to invite anyone into, so approval only ever
    // does a site-side membership/assignment — the requester must already be a registered
    // site account (Discord identity alone isn't enough here).
    if (!userId) throw new ApiError(400, "This league doesn't have a linked Discord server yet — sign up on the REC site and link your Discord account before requesting a team.");
    const user = await supabase.from("rec_users").select("supabase_auth_user_id").eq("id", userId).maybeSingle();
    if (user.error) throw new ApiError(500, "Failed to load your account.", user.error);
    if (!user.data?.supabase_auth_user_id) throw new ApiError(400, "This league doesn't have a linked Discord server yet — sign up on the REC site and link your Discord account before requesting a team.");
  } else if (!userId) {
    // Look up the real Discord nickname/username instead of stashing the raw snowflake as a
    // placeholder — that placeholder was never getting corrected later. "" (the column's own
    // default) stands in for a failed/missed lookup; a later login or hub read can still
    // resolve a real name, but a written snowflake never self-heals.
    const liveName = await getGuildMemberDisplayNameMap(link.guildId!).then((names) => names.get(input.discordId) ?? null).catch(() => null);
    const createdUser = await supabase.from("rec_users").insert({ display_name: liveName ?? "", status: "active" }).select("id").single();
    if (createdUser.error) throw new ApiError(500, "Failed to create REC user.", createdUser.error);
    userId = createdUser.data.id;
    void grantWelcomeBonus(String(userId));
    const createdAccount = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: userId, discord_id: input.discordId, username: null, global_name: null })
      .select("user_id")
      .single();
    if (createdAccount.error) {
      await supabase.from("rec_users").delete().eq("id", userId);
      throw new ApiError(500, "Failed to link Discord account.", createdAccount.error);
    }
  }

  const existingAssignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", input.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (existingAssignment.error) throw new ApiError(500, "Failed to check existing assignment.", existingAssignment.error);
  if (existingAssignment.data) throw new ApiError(409, "You are already linked to a team in this league.");

  const team = await supabase.from("rec_teams").select("*").eq("id", input.teamId).eq("league_id", input.leagueId).maybeSingle();
  if (team.error) throw new ApiError(500, "Failed to load team.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");

  const teamTaken = await supabase.from("rec_team_assignments").select("id")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (teamTaken.error) throw new ApiError(500, "Failed to check team availability.", teamTaken.error);
  if (teamTaken.data) throw new ApiError(409, "That team is no longer available.");

  const teamRequested = await supabase.from("rec_team_link_requests").select("id")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId).in("status", ["pending", "approved"]).maybeSingle();
  if (teamRequested.error) throw new ApiError(500, "Failed to check team availability.", teamRequested.error);
  if (teamRequested.data) throw new ApiError(409, "That team already has a pending request from another member.");

  const pending = await supabase.from("rec_team_link_requests").select("id")
    .eq("league_id", input.leagueId).eq("requester_user_id", userId).in("status", ["pending", "approved"]).maybeSingle();
  if (pending.error) throw new ApiError(500, "Failed to check pending requests.", pending.error);
  if (pending.data) throw new ApiError(409, "You already have a pending team request.");

  const inserted = await supabase
    .from("rec_team_link_requests")
    .insert({
      guild_id: guildIdForRequest,
      league_id: input.leagueId,
      team_id: input.teamId,
      requester_user_id: userId,
      requester_discord_id: input.discordId,
      status: "pending",
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create team request.", inserted.error);

  const teamName = formatTeamDisplayName(team.data) ?? team.data.name;
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildIdForRequest,
    server_id: null,
    league_id: input.leagueId,
    season_number: null,
    week_number: null,
    queue_type: "team_request",
    status: "pending",
    priority: 0,
    header: teamName ? `Team link request: ${teamName}` : "Team link request",
    summary: `Requested by <@${input.discordId}> via the recruiting board.`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: input.teamId,
    source_table: "rec_team_link_requests",
    source_id: inserted.data.id,
    payload: { requestId: inserted.data.id, teamId: input.teamId },
  });
  void notifyLeagueCommissionersOfPendingItem(input.leagueId);
  await syncLeagueRecruitingAd(input.leagueId);

  return { request: inserted.data, teamName, leagueName: league.name };
}
