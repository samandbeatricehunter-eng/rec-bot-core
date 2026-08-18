// Division-grouped Discord availability board: one persistent control-panel message plus one
// persistent message per division, all edited in place (never reposted) via
// rec_availability_board_messages. Posts to the league's existing scheduling_channel_id
// (a reserved-but-previously-unused rec_server_routes column) -- no new channel setting needed.
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatClock(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(minute).padStart(2, "0")}${meridiem}`;
}

function tzAbbrFor(timezone: string | null): string {
  if (!timezone) return "";
  const map: Record<string, string> = {
    "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT",
    "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HT",
  };
  return map[timezone] ?? timezone;
}

async function upsertBoardMessage(leagueId: string, channelId: string, sectionKey: string, payload: Record<string, unknown>) {
  const existing = await supabase.from("rec_availability_board_messages").select("*").eq("league_id", leagueId).eq("section_key", sectionKey).maybeSingle();
  if (existing.error) { console.error("[ERROR] availability board: failed to look up tracked message (non-fatal):", existing.error); return; }

  if (existing.data?.discord_message_id) {
    const edited = await editDiscordMessage(channelId, existing.data.discord_message_id, payload).catch(() => false);
    if (edited) {
      await supabase.from("rec_availability_board_messages").update({ updated_at: new Date().toISOString() }).eq("id", existing.data.id);
      return;
    }
    // Edit failed (message deleted out-of-band) -- fall through and re-post.
  }

  const posted = await postDiscordChannelMessage(channelId, payload);
  if (!posted?.id) return;
  await supabase.from("rec_availability_board_messages").upsert({
    league_id: leagueId, discord_channel_id: channelId, section_key: sectionKey, discord_message_id: posted.id, updated_at: new Date().toISOString(),
  }, { onConflict: "league_id,section_key" });
}

function controlPanelPayload() {
  return {
    embeds: [{ title: "League Availability", color: 0xd9a521, description: "Set your weekly availability and timezone here or on the site — coaches use this so the scheduling system can find a shared kickoff window automatically." }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: "rec:availboard:setavailability", label: "Set Availability" },
        { type: 2, style: 2, custom_id: "rec:availboard:settimezone", label: "Set Timezone" },
        { type: 2, style: 2, custom_id: "rec:availboard:thisweek", label: "This Week" },
      ],
    }],
  };
}

type DivisionTeam = { teamName: string; discordId: string | null; timezone: string | null; windowsByDay: Map<number, Array<{ startMinute: number; endMinute: number }>> };

function divisionEmbed(conference: string, division: string, teams: DivisionTeam[]) {
  const lines = teams.map((t) => {
    const header = t.discordId ? `**${t.teamName}** — <@${t.discordId}>` : `**${t.teamName}** — unlinked`;
    if (!t.discordId) return header;
    if (!t.timezone) return `${header}\n⚠️ **SET YOUR AVAILABILITY AND TIMEZONE THRU HERE OR THE SITE**`;
    const tz = tzAbbrFor(t.timezone);
    const dayLines = WEEKDAY_ABBR.map((abbr, weekday) => {
      const windows = t.windowsByDay.get(weekday) ?? [];
      const text = windows.length ? windows.map((w) => `${formatClock(w.startMinute)}-${formatClock(w.endMinute % 1440)}`).join(", ") : "Unavailable";
      return `${abbr}: ${text}`;
    }).join(" · ");
    return `${header} \`${tz}\`\n${dayLines}`;
  });
  return {
    embeds: [{
      title: `${conference} — ${division}`,
      color: 0xb8bdc4,
      description: lines.join("\n\n").slice(0, 4096) || "No linked teams in this division.",
      footer: { text: "Availability updates automatically as coaches set their windows." },
    }],
  };
}

export async function syncAvailabilityBoard(guildId: string, opts: { announceLinked?: boolean } = {}) {
  const context = await getCurrentLeagueContext(guildId);
  const channelId = String((context.routes as any)?.scheduling_channel_id ?? "");
  if (!channelId) return { synced: false, reason: "no_channel" as const };
  const leagueId = context.leagueId;

  if (opts.announceLinked) {
    await postDiscordChannelMessage(channelId, {
      content: "@everyone This channel now tracks league availability. Set your availability and timezone through here or the site so the scheduling system can find shared kickoff windows for your games.",
      allowed_mentions: { parse: ["everyone"] },
    }).catch((error) => console.error("[ERROR] Failed to post availability-channel-linked announcement (non-fatal):", error));
  }

  const [teamsResult, assignmentsResult] = await Promise.all([
    supabase.from("rec_teams").select("id,name,display_abbr,display_nick,display_city,is_relocated,conference,division").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null),
  ]);
  if (teamsResult.error || assignmentsResult.error) return { synced: false, reason: "load_failed" as const };

  const userIdByTeam = new Map<string, string>((assignmentsResult.data ?? []).map((a: any) => [a.team_id, a.user_id]));
  const userIds = [...new Set(userIdByTeam.values())];
  const [accounts, profiles, windows] = await Promise.all([
    userIds.length ? supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? supabase.from("rec_user_availability_profiles").select("user_id,timezone").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? supabase.from("rec_user_availability_windows").select("user_id,weekday,start_minute,end_minute").in("user_id", userIds).is("league_id", null).eq("active", true) : Promise.resolve({ data: [] as any[] }),
  ]);
  const discordByUser = new Map<string, string>((accounts.data ?? []).map((a: any) => [a.user_id, a.discord_id]));
  const timezoneByUser = new Map<string, string | null>((profiles.data ?? []).map((p: any) => [p.user_id, p.timezone]));
  const windowsByUser = new Map<string, Map<number, Array<{ startMinute: number; endMinute: number }>>>();
  for (const w of windows.data ?? []) {
    const byDay = windowsByUser.get(w.user_id) ?? new Map();
    byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), { startMinute: w.start_minute, endMinute: w.end_minute }]);
    windowsByUser.set(w.user_id, byDay);
  }

  const teamName = (t: any) => t.display_nick ? `${t.display_city ?? ""} ${t.display_nick}`.trim() : t.name;
  const groups = new Map<string, Map<string, DivisionTeam[]>>();
  for (const t of teamsResult.data ?? []) {
    const userId = userIdByTeam.get(t.id);
    if (!userId) continue; // Open teams don't need availability tracked.
    const conference = t.conference || "League";
    const division = t.division || "Division";
    const byConf = groups.get(conference) ?? new Map();
    const list = byConf.get(division) ?? [];
    list.push({
      teamName: teamName(t),
      discordId: discordByUser.get(userId) ?? null,
      timezone: timezoneByUser.get(userId) ?? null,
      windowsByDay: windowsByUser.get(userId) ?? new Map(),
    });
    byConf.set(division, list);
    groups.set(conference, byConf);
  }

  await upsertBoardMessage(leagueId, channelId, "control_panel", controlPanelPayload());
  for (const [conference, divisions] of groups) {
    for (const [division, teams] of divisions) {
      const sectionKey = `division:${conference}:${division}`;
      await upsertBoardMessage(leagueId, channelId, sectionKey, divisionEmbed(conference, division, teams.sort((a, b) => a.teamName.localeCompare(b.teamName))));
    }
  }
  return { synced: true as const };
}
