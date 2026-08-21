// Weekly "Matchups" channel: one embed per league per week, edited in place as scheduling
// state changes, listing every H2H matchup with both coaches tagged and a live status per row.
// Distinct from game-announcement.service.ts (one embed per GAME in the announcements channel)
// and matchup-scheduling.service.ts's Scheduling panel (one embed per game channel) -- this is
// the single league-wide "here's the whole week" view.
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage, deleteDiscordMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type SchedulingRow = {
  game_id: string; status: string; scheduled_for: string | null;
  fw_flagged: boolean; fw_flagged_for_user_id: string | null; proposed_by_user_id: string | null;
  response_started_at: string | null; home_responded_at: string | null; away_responded_at: string | null;
};

// Channel-wide, not per-game -- the handler resolves "your game" itself from the clicking
// user's discordId (see ready-to-advance.service.ts), so no gameId needs to travel in the id.
export const READY_TO_ADVANCE_BUTTON_ID = "rec:rta:btn";

function mentionOrFallback(discordId: string | null | undefined): string {
  return discordId ? `<@${discordId}>` : "someone";
}

function statusLineFor(input: {
  s: SchedulingRow | undefined;
  homeScore: number | null; awayScore: number | null;
  discordByUser: Map<string, string>;
  fairSim: boolean;
}): string {
  const { s, homeScore, awayScore, discordByUser, fairSim } = input;
  if (s?.fw_flagged) return `FW for ${mentionOrFallback(s.fw_flagged_for_user_id ? discordByUser.get(s.fw_flagged_for_user_id) : null)}`;
  if (fairSim) return "Fair Sim";
  if (s?.status === "live") return "🔴 LIVE";
  if (s?.status === "completed" || (homeScore != null && awayScore != null)) {
    return homeScore != null && awayScore != null ? `Final: ${awayScore} — ${homeScore}` : "Completed";
  }
  if (s?.status === "confirmed" && s.scheduled_for) {
    const unix = Math.floor(new Date(s.scheduled_for).getTime() / 1000);
    return `Scheduled for <t:${unix}:F> (<t:${unix}:R>)`;
  }
  if (s?.status === "proposed" && s.proposed_by_user_id) {
    return `Time Proposed by ${mentionOrFallback(discordByUser.get(s.proposed_by_user_id))}`;
  }
  if (s?.status === "reschedule_requested") return "Reschedule Requested";
  if (s?.status === "needs_commissioner_help") return "Needs Commissioner Help";
  if (s?.status === "no_shared_availability") return "No Shared Availability";
  if (s?.home_responded_at || s?.away_responded_at) return "Scheduling attempted — not scheduled";
  return "Not scheduled";
}

// NOTE: the very first post for a new week (before rec_matchups_channel_posts has a row) has a
// narrow race if two different scheduling mutations for two different games in the same league
// fire within the same instant -- both could read "no existing post" and both post a fresh
// message, leaving a stray duplicate. Once a row exists, all further calls safely edit in place.
// Accepted as a low-severity edge case (a cosmetic duplicate, not broken data) rather than adding
// full cross-request locking for this feature.
export async function refreshMatchupsChannel(guildId: string): Promise<void> {
  const { getAdvanceWeekGames } = await import("../league-week/advance-results.service.js");
  const week = await getAdvanceWeekGames(guildId).catch((error) => { console.error("[ERROR] matchups channel: failed to load week games (non-fatal):", error); return null; });
  if (!week) return;
  const h2hGames = (week.games as any[]).filter((g) => g.isH2h);
  // A CPU matchup with one human coach (not a full CPU-vs-CPU game, which nobody needs to
  // ready up for) -- shown in its own block below the H2H list, per-game so a coach can see
  // which of their weeks still needs a Force Win request or a final score.
  const humanCpuGames = (week.games as any[]).filter((g) => !g.isH2h && (g.homeUserId || g.awayUserId));
  if (!h2hGames.length && !humanCpuGames.length) return;

  const context = await getCurrentLeagueContext(guildId).catch(() => null);
  if (!context) return;
  const routes = await findServerRoutesForLeague(context.leagueId).catch(() => null);
  const channelId = String((routes?.routes as any)?.announcements_channel_id ?? (routes?.routes as any)?.matchups_channel_id ?? "");
  if (!channelId) return;

  const gameIds = [...h2hGames, ...humanCpuGames].map((g) => g.gameId);
  const [scheduling, streams, fairSims] = await Promise.all([
    supabase.from("rec_game_scheduling").select("game_id,status,scheduled_for,fw_flagged,fw_flagged_for_user_id,proposed_by_user_id,response_started_at,home_responded_at,away_responded_at").in("game_id", gameIds),
    supabase.from("rec_stream_compliance_logs").select("game_id,team_id,message_url").in("game_id", h2hGames.map((g) => g.gameId)).eq("status", "posted").is("ended_at", null),
    supabase.from("rec_game_scheduling_events").select("game_id").in("game_id", gameIds).eq("event_type", "commissioner_grant_fs"),
  ]);
  const fairSimGameIds = new Set((fairSims.data ?? []).map((row: any) => String(row.game_id)));
  const schedulingByGame = new Map<string, SchedulingRow>((scheduling.data ?? []).map((r: any) => [String(r.game_id), r]));
  const streamsByGame = new Map<string, Array<{ team_id: string | null; message_url: string }>>();
  for (const row of (streams.data ?? []) as any[]) {
    const list = streamsByGame.get(String(row.game_id)) ?? [];
    list.push({ team_id: row.team_id ? String(row.team_id) : null, message_url: row.message_url });
    streamsByGame.set(String(row.game_id), list);
  }

  const userIds = [...new Set([...h2hGames, ...humanCpuGames].flatMap((g) => [g.homeUserId, g.awayUserId]).filter((v): v is string => Boolean(v)))];
  const accounts = userIds.length ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : { data: [] as any[] };
  const discordByUser = new Map<string, string>((accounts.data ?? []).map((a: any) => [String(a.user_id), String(a.discord_id)]));

  const lines = h2hGames.map((g) => {
    const s = schedulingByGame.get(g.gameId);
    const statusText = statusLineFor({ s, homeScore: g.homeScore, awayScore: g.awayScore, discordByUser, fairSim: fairSimGameIds.has(g.gameId) });
    const header = `**${g.awayTeamName}** ${mentionOrFallback(discordByUser.get(g.awayUserId))} VS **${g.homeTeamName}** ${mentionOrFallback(discordByUser.get(g.homeUserId))}`;

    const streamEntries = streamsByGame.get(g.gameId) ?? [];
    const awayStream = streamEntries.find((entry) => entry.team_id === g.awayTeamId);
    const homeStream = streamEntries.find((entry) => entry.team_id === g.homeTeamId);
    const streamLinks = [
      awayStream ? `[${g.awayTeamName} Stream](${awayStream.message_url})` : null,
      homeStream ? `[${g.homeTeamName} Stream](${homeStream.message_url})` : null,
    ].filter((v): v is string => Boolean(v));

    const streamLine = streamLinks.length ? `\n> ${streamLinks.join("  •  ")}` : "";
    return `${header}\n> ${statusText}${streamLine}`;
  });

  const cpuLines = humanCpuGames.map((g) => {
    const s = schedulingByGame.get(g.gameId);
    const isHome = Boolean(g.homeUserId);
    const coachTeamName = isHome ? g.homeTeamName : g.awayTeamName;
    const coachUserId = isHome ? g.homeUserId : g.awayUserId;
    const cpuTeamName = isHome ? g.awayTeamName : g.homeTeamName;
    const header = `**${coachTeamName}** ${mentionOrFallback(discordByUser.get(coachUserId))} vs **${cpuTeamName}** (CPU)`;
    const statusText = s?.fw_flagged
      ? "Requesting Force Win"
      : g.homeScore != null && g.awayScore != null
        ? `Final: ${g.awayScore} — ${g.homeScore}`
        : "Not yet reported";
    return `${header}\n> ${statusText}`;
  });

  const seasonNumber = week.seasonNumber ?? 1;
  const title = `Season ${seasonNumber}, Week ${week.currentWeek} Matchups`;
  const description = lines.join("\n\n");
  const embeds: Array<{ title: string; color: number; description: string }> = [];
  if (lines.length) embeds.push({ title, color: 0xd9a521, description: description.slice(0, 4096) });
  if (cpuLines.length) embeds.push({ title: lines.length ? "Human vs CPU" : title, color: 0x6a5120, description: cpuLines.join("\n\n").slice(0, 4096) });
  const payload = {
    embeds,
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: READY_TO_ADVANCE_BUTTON_ID, label: "Ready to Advance", emoji: { name: "✅" } }] }],
  };

  const state = await supabase.from("rec_matchups_channel_posts").select("week_number,channel_id,message_id").eq("league_id", context.leagueId).maybeSingle();

  if (state.data && state.data.week_number === week.currentWeek && state.data.channel_id === channelId) {
    const edited = await editDiscordMessage(channelId, state.data.message_id, payload).catch(() => false);
    if (edited) return;
  }
  if (state.data?.message_id) {
    await deleteDiscordMessage(state.data.channel_id, state.data.message_id).catch(() => undefined);
  }
  const posted = await postDiscordChannelMessage(channelId, payload).catch((error) => { console.error("[ERROR] matchups channel: failed to post (non-fatal):", error); return null; });
  if (posted?.id) {
    await supabase.from("rec_matchups_channel_posts").upsert({
      league_id: context.leagueId, week_number: week.currentWeek, channel_id: channelId, message_id: posted.id, updated_at: new Date().toISOString(),
    });
  }
}

// Live-refresh entry point for scheduling mutations, which only have a gameId on hand.
export async function refreshMatchupsChannelForGame(gameId: string): Promise<void> {
  const game = await supabase.from("rec_games").select("league_id").eq("id", gameId).maybeSingle();
  if (!game.data?.league_id) return;
  const routes = await findServerRoutesForLeague(String(game.data.league_id)).catch(() => null);
  if (!routes?.guildId) return;
  await refreshMatchupsChannel(routes.guildId).catch((error) => console.error("[ERROR] Failed to refresh matchups channel (non-fatal):", error));
}
