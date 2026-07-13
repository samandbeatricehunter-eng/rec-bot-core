import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type LinkedCoach = {
  userId: string;
  discordId: string;
  teamId: string;
  teamName: string;
};

function teamName(team: any) {
  if (!team) return "Team";
  if (team.display_city || team.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return team.display_abbr ?? team.abbreviation ?? team.name ?? "Team";
}

async function loadLinkedCoaches(leagueId: string): Promise<LinkedCoach[]> {
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,team:rec_teams(id,name,abbreviation,display_abbr,display_city,display_nick)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load linked teams for active check.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load Discord accounts for active check.", accounts.error);

  const discordByUser = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  return (assignments.data ?? [])
    .map((row: any) => ({
      userId: row.user_id,
      discordId: discordByUser.get(row.user_id),
      teamId: row.team_id,
      teamName: teamName(row.team),
    }))
    .filter((row: LinkedCoach) => row.userId && row.discordId && row.teamId);
}

export async function createActiveCheckEvent(input: {
  guildId: string;
  discordChannelId: string;
  discordMessageId: string;
  createdByDiscordId: string;
  closesAt: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();

  await supabase
    .from("rec_active_check_events")
    .update({ status: "cancelled", closed_at: now, updated_at: now })
    .eq("league_id", context.leagueId)
    .eq("status", "open");

  const inserted = await supabase
    .from("rec_active_check_events")
    .insert({
      league_id: context.leagueId,
      season_number: Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1),
      week_number: Number(context.rec_leagues.current_week ?? 1),
      status: "open",
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      created_by_discord_id: input.createdByDiscordId,
      closes_at: input.closesAt,
      updated_at: now,
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create active check event.", inserted.error);

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: inserted.data.league_id,
    season_number: inserted.data.season_number,
    week_number: inserted.data.week_number,
    queue_type: "active_check",
    status: "pending",
    priority: 0,
    header: `Week ${inserted.data.week_number} Active Check`,
    summary: `Active check started in <#${input.discordChannelId}>.`,
    requester_discord_id: input.createdByDiscordId,
    requester_user_id: null,
    amount: null,
    source_table: "rec_active_check_events",
    source_id: inserted.data.id,
    payload: { eventId: inserted.data.id, discordChannelId: input.discordChannelId, discordMessageId: input.discordMessageId, closesAt: input.closesAt },
  });

  return { event: inserted.data };
}

export async function listOpenActiveCheckEvents() {
  const events = await supabase
    .from("rec_active_check_events")
    .select("*")
    .eq("status", "open")
    .order("closes_at", { ascending: true });
  if (events.error) throw new ApiError(500, "Failed to load open active checks.", events.error);

  const leagueIds = [...new Set((events.data ?? []).map((event: any) => event.league_id).filter(Boolean))];
  const links = leagueIds.length
    ? await supabase
        .from("rec_server_league_links")
        .select("league_id,server_id")
        .in("league_id", leagueIds)
        .eq("is_primary", true)
    : { data: [], error: null };
  if (links.error) throw new ApiError(500, "Failed to load active-check Discord servers.", links.error);

  const serverIds = [...new Set((links.data ?? []).map((row: any) => row.server_id).filter(Boolean))];
  const servers = serverIds.length
    ? await supabase.from("rec_discord_servers").select("id,guild_id").in("id", serverIds)
    : { data: [], error: null };
  if (servers.error) throw new ApiError(500, "Failed to load active-check Discord server records.", servers.error);

  const guildByServerId = new Map((servers.data ?? []).map((row: any) => [row.id, row.guild_id]));
  const guildByLeague = new Map((links.data ?? []).map((row: any) => [row.league_id, guildByServerId.get(row.server_id)]));
  return {
    events: (events.data ?? []).map((event: any) => ({ ...event, guildId: guildByLeague.get(event.league_id) ?? null })),
  };
}

export async function settleActiveCheckEvent(input: {
  eventId: string;
  activeDiscordIds: string[];
  kickMeDiscordIds: string[];
}) {
  const event = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).maybeSingle();
  if (event.error) throw new ApiError(500, "Failed to load active check event.", event.error);
  if (!event.data) throw new ApiError(404, "Active check event not found.");

  const linked = await loadLinkedCoaches(event.data.league_id);
  const active = new Set(input.activeDiscordIds);
  const kickMe = new Set(input.kickMeDiscordIds);
  const now = new Date().toISOString();

  const responseRows = linked
    .filter((row) => active.has(row.discordId) || kickMe.has(row.discordId))
    .map((row) => ({
      event_id: input.eventId,
      league_id: event.data.league_id,
      user_id: row.userId,
      discord_id: row.discordId,
      team_id: row.teamId,
      response_type: kickMe.has(row.discordId) ? "kick_me" : "active",
      responded_at: now,
      updated_at: now,
    }));
  if (responseRows.length) {
    const responses = await supabase
      .from("rec_active_check_responses")
      .upsert(responseRows, { onConflict: "event_id,user_id" });
    if (responses.error) throw new ApiError(500, "Failed to save active-check responses.", responses.error);
  }

  const missRows = linked
    .filter((row) => !active.has(row.discordId) && !kickMe.has(row.discordId))
    .map((row) => ({
      event_id: input.eventId,
      league_id: event.data.league_id,
      user_id: row.userId,
      discord_id: row.discordId,
      team_id: row.teamId,
      missed_at: now,
      boot_status: "pending",
    }));
  if (missRows.length) {
    const misses = await supabase
      .from("rec_active_check_misses")
      .upsert(missRows, { onConflict: "event_id,user_id" });
    if (misses.error) throw new ApiError(500, "Failed to save active-check misses.", misses.error);
  }

  const updated = await supabase
    .from("rec_active_check_events")
    .update({ status: "settled", closed_at: now, updated_at: now })
    .eq("id", input.eventId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to settle active check.", updated.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_at: now })
    .eq("source_table", "rec_active_check_events")
    .eq("source_id", input.eventId);

  return getActiveCheckReview(input.eventId);
}

export async function getActiveCheckReview(eventId: string) {
  const event = await supabase.from("rec_active_check_events").select("*").eq("id", eventId).maybeSingle();
  if (event.error) throw new ApiError(500, "Failed to load active check event.", event.error);
  if (!event.data) throw new ApiError(404, "Active check event not found.");

  const [misses, responses, teams] = await Promise.all([
    supabase.from("rec_active_check_misses").select("*").eq("event_id", eventId).eq("boot_status", "pending"),
    supabase.from("rec_active_check_responses").select("*").eq("event_id", eventId).eq("response_type", "kick_me"),
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick").eq("league_id", event.data.league_id),
  ]);
  if (misses.error) throw new ApiError(500, "Failed to load active-check misses.", misses.error);
  if (responses.error) throw new ApiError(500, "Failed to load active-check responses.", responses.error);
  if (teams.error) throw new ApiError(500, "Failed to load active-check teams.", teams.error);

  const teamById = new Map((teams.data ?? []).map((team: any) => [team.id, teamName(team)]));
  const mapRow = (row: any) => ({
    discordId: row.discord_id,
    userId: row.user_id,
    teamId: row.team_id,
    teamName: teamById.get(row.team_id) ?? "Team",
    label: `${teamById.get(row.team_id) ?? "Team"} - <@${row.discord_id}>`,
  });

  return {
    event: event.data,
    inactive: (misses.data ?? []).map(mapRow).filter((row) => row.discordId && row.teamId),
    kickMe: (responses.data ?? []).map(mapRow).filter((row) => row.discordId && row.teamId),
  };
}

export async function keepActiveCheckUsers(input: { eventId: string; discordIds: string[] }) {
  if (!input.discordIds.length) return getActiveCheckReview(input.eventId);
  const event = await supabase.from("rec_active_check_events").select("id").eq("id", input.eventId).maybeSingle();
  if (event.error) throw new ApiError(500, "Failed to load active check event.", event.error);
  if (!event.data) throw new ApiError(404, "Active check event not found.");

  const misses = await supabase
    .from("rec_active_check_misses")
    .update({ boot_status: "kept" })
    .eq("event_id", input.eventId)
    .in("discord_id", input.discordIds);
  if (misses.error) throw new ApiError(500, "Failed to update active-check misses.", misses.error);

  const responses = await supabase
    .from("rec_active_check_responses")
    .delete()
    .eq("event_id", input.eventId)
    .eq("response_type", "kick_me")
    .in("discord_id", input.discordIds);
  if (responses.error) throw new ApiError(500, "Failed to update active-check responses.", responses.error);

  return getActiveCheckReview(input.eventId);
}

export async function markActiveCheckBooted(input: { eventId: string; discordIds: string[] }) {
  if (!input.discordIds.length) return { updated: 0 };
  const misses = await supabase
    .from("rec_active_check_misses")
    .update({ boot_status: "booted" })
    .eq("event_id", input.eventId)
    .in("discord_id", input.discordIds)
    .select("id");
  if (misses.error) throw new ApiError(500, "Failed to mark active-check users booted.", misses.error);
  return { updated: misses.data?.length ?? 0 };
}

export async function markActiveCheckNeedsReview(input: { eventId: string; reason: string }) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_active_check_events")
    .update({ status: "needs_review", closed_at: now, updated_at: now })
    .eq("id", input.eventId)
    .select("*")
    .single();
  if (result.error) throw new ApiError(500, "Failed to mark active check for manual review.", result.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "resolved", reviewed_at: now, review_reason: input.reason })
    .eq("source_table", "rec_active_check_events")
    .eq("source_id", input.eventId);

  return { event: result.data, reason: input.reason };
}
