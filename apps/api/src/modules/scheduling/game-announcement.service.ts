// Announcements-channel countdown post for a confirmed H2H game: posted once, then edited in
// place as streams go live and again with the final score -- never reposted, so it never spams
// the announcements channel. Distinct from the game-channel scheduling panel (matchup-scheduling
// .service.ts), which lives in the private H2H channel, not the public announcements one.
import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { logSchedulingEvent, userIdFromDiscordId } from "./shared.js";

async function loadGameForAnnouncement(gameId: string) {
  const game = await supabase.from("rec_games").select(
    "id,league_id,week_number,home_team_id,away_team_id,home_score,away_score,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_abbr,display_nick,display_city,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_abbr,display_nick,display_city,is_relocated)",
  ).eq("id", gameId).maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to load game for announcement.", game.error);
  if (!game.data) throw new ApiError(404, "Game not found.");
  return game.data as any;
}

function teamLabel(team: any): string {
  if (!team) return "TBD";
  return team.display_nick ? `${team.display_city ?? ""} ${team.display_nick}`.trim() : team.name;
}

async function buildAnnouncementPayload(gameId: string) {
  const [game, scheduling, streams] = await Promise.all([
    loadGameForAnnouncement(gameId),
    supabase.from("rec_game_scheduling").select("*").eq("game_id", gameId).maybeSingle(),
    supabase.from("rec_stream_compliance_logs").select("team_id,message_url,ended_at").eq("game_id", gameId).eq("status", "posted").is("ended_at", null),
  ]);
  const s = scheduling.data;
  const awayLabel = teamLabel(game.away_team);
  const homeLabel = teamLabel(game.home_team);
  const title = `${awayLabel} @ ${homeLabel}`;

  const lines: string[] = [`Week ${game.week_number ?? "?"}`];
  const isLive = s?.status === "live" || (s?.game_started_at && s?.status !== "completed");
  if (game.home_score != null && game.away_score != null) {
    const winner = game.home_score > game.away_score ? homeLabel : game.away_score > game.home_score ? awayLabel : "Tie";
    lines.push(`**Final: ${awayLabel} ${game.away_score} — ${homeLabel} ${game.home_score}**`, winner === "Tie" ? "Game ended in a tie." : `${winner} wins.`);
  } else if (isLive) {
    lines.push("🔴 **LIVE NOW**");
  } else if (s?.scheduled_for) {
    const unix = Math.floor(new Date(s.scheduled_for).getTime() / 1000);
    lines.push(`Kickoff: <t:${unix}:F> (<t:${unix}:R>)`);
  }

  const streamByTeam = new Map<string, string>((streams.data ?? []).map((row: any) => [String(row.team_id), row.message_url]));
  const awayStream = game.away_team_id ? streamByTeam.get(String(game.away_team_id)) : null;
  const homeStream = game.home_team_id ? streamByTeam.get(String(game.home_team_id)) : null;
  const streamLines = [
    awayStream ? `[${awayLabel} Stream](${awayStream})` : null,
    homeStream ? `[${homeLabel} Stream](${homeStream})` : null,
  ].filter((v): v is string => Boolean(v));
  if (streamLines.length) lines.push("", ...streamLines);

  return { embeds: [{ title, color: isLive ? 0xdc3545 : 0xd9a521, description: lines.join("\n") }] };
}

export async function postOrUpdateGameAnnouncement(gameId: string, opts: { announceNow?: boolean } = {}) {
  const scheduling = await supabase.from("rec_game_scheduling").select("league_id,announcement_channel_id,announcement_message_id,status,game_started_at").eq("game_id", gameId).maybeSingle();
  if (scheduling.error || !scheduling.data) return;
  const context = await getCurrentLeagueContext((await getGuildIdForLeague(scheduling.data.league_id)) ?? "");
  const channelId = scheduling.data.announcement_channel_id ?? String((context?.routes as any)?.announcements_channel_id ?? "");
  if (!channelId) return;

  const payload = await buildAnnouncementPayload(gameId);
  let staleMessage = false;

  // Live-game announcements should read as "the game between X and Y is LIVE", not a kickoff
  // countdown -- the embed title already carries the matchup ("Away @ Home"), so the ping just
  // needs to point everyone at it.
  const announceIsLive = scheduling.data.status === "live" || (scheduling.data.game_started_at && scheduling.data.status !== "completed");
  const liveContent = announceIsLive ? "@everyone — this game is LIVE now:" : "@everyone";

  if (scheduling.data.announcement_message_id) {
    // Previously only `payload` (embeds) was sent on edit -- Discord's PATCH treats an omitted
    // field as "leave it unchanged", so the "@everyone — this game is LIVE now:" text from the
    // original kickoff post could never be cleared by a later edit (a final score from
    // markGameOver, a routine stream-link refresh, anything). The embed itself correctly
    // flipped to the final score, but the message content above it stayed stuck on LIVE
    // forever. Include content on every edit, not just the first post, so it tracks real status.
    const edited = await editDiscordMessage(channelId, scheduling.data.announcement_message_id, { ...payload, content: liveContent, allowed_mentions: { parse: ["everyone"] } }).catch(() => false);
    if (edited) return;
    // The tracked message is gone (deleted, channel changed, etc.) -- every future call would
    // otherwise keep trying to edit the same dead id and silently no-op forever (e.g. a final
    // score from markGameOver, which always calls with announceNow:false, would never actually
    // reach the channel). Clear it and fall through to repost as a repair, not a fresh event.
    staleMessage = true;
    await supabase.from("rec_game_scheduling").update({ announcement_channel_id: null, announcement_message_id: null }).eq("game_id", gameId);
  }
  if (!opts.announceNow && !staleMessage) return; // Don't post a brand-new announcement on a routine update if none exists yet.

  // A repair repost (staleMessage) never re-pings @everyone -- it's recovering an existing
  // announcement, not a new event.
  const content = staleMessage ? undefined : liveContent;
  const posted = await postDiscordChannelMessage(channelId, { ...(content ? { content, allowed_mentions: { parse: ["everyone"] } } : {}), ...payload });
  if (!posted?.id) return;
  await supabase.from("rec_game_scheduling").update({ announcement_channel_id: channelId, announcement_message_id: posted.id, updated_at: new Date().toISOString() }).eq("game_id", gameId);
  await logSchedulingEvent({ gameId, eventType: "announcement_posted" });
}

// Phase 8: the "a proposal was accepted" moment specifically posts/edits ONE per-week "Confirmed
// Matchups" message instead of a separate announcement per game -- rebuilds the full field list
// from confirmedGames (the DB-stored source of truth) on every call rather than trying to
// read-modify Discord's own returned embed content back. Only this one call site changed; the
// per-game postOrUpdateGameAnnouncement above is unchanged and still handles LIVE status and
// final-score updates with their own dedicated posts, per the spec's literal scope.
export async function postOrUpdateWeeklyConfirmedAnnouncement(gameId: string) {
  const [game, scheduling] = await Promise.all([
    loadGameForAnnouncement(gameId),
    supabase.from("rec_game_scheduling").select("scheduled_for").eq("game_id", gameId).maybeSingle(),
  ]);
  if (!scheduling.data?.scheduled_for) return;

  const league = await supabase.from("rec_leagues").select("season_number").eq("id", game.league_id).maybeSingle();
  const seasonNumber = Number(league.data?.season_number ?? 1);
  const weekNumber = Number(game.week_number ?? 1);

  const context = await getCurrentLeagueContext((await getGuildIdForLeague(game.league_id)) ?? "");
  const channelId = String((context?.routes as any)?.announcements_channel_id ?? "");

  const awayLabel = teamLabel(game.away_team);
  const homeLabel = teamLabel(game.home_team);
  const entry = { gameId, awayLabel, homeLabel, scheduledFor: scheduling.data.scheduled_for };

  const existing = await supabase.from("rec_weekly_confirmed_announcements").select("*")
    .eq("league_id", game.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).maybeSingle();
  const priorGames = Array.isArray(existing.data?.confirmed_games) ? (existing.data.confirmed_games as any[]) : [];
  const games = [...priorGames.filter((g) => g.gameId !== gameId), entry]
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const fields = games.map((g) => {
    const unix = Math.floor(new Date(g.scheduledFor).getTime() / 1000);
    return { name: `${g.awayLabel} @ ${g.homeLabel}`, value: `<t:${unix}:F> (<t:${unix}:R>)`, inline: false };
  });
  const payload = { embeds: [{ title: `Week ${weekNumber} — Confirmed Matchups`, color: 0xd9a521, fields }] };

  if (existing.data?.message_id && existing.data?.channel_id) {
    const edited = await editDiscordMessage(existing.data.channel_id, existing.data.message_id, payload).catch(() => false);
    if (edited) {
      await supabase.from("rec_weekly_confirmed_announcements").update({ confirmed_games: games, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
      return;
    }
  }
  if (!channelId) return;
  const posted = await postDiscordChannelMessage(channelId, payload).catch(() => null);
  if (!posted?.id) return;
  if (existing.data?.id) {
    await supabase.from("rec_weekly_confirmed_announcements").update({ channel_id: channelId, message_id: posted.id, confirmed_games: games, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
  } else {
    await supabase.from("rec_weekly_confirmed_announcements").insert({
      id: randomUUID(), league_id: game.league_id, season_number: seasonNumber, week_number: weekNumber,
      channel_id: channelId, message_id: posted.id, confirmed_games: games, updated_at: new Date().toISOString(),
    });
  }
}

async function getGuildIdForLeague(leagueId: string): Promise<string | null> {
  const { findServerRoutesForLeague, siteOnlyGuildId } = await import("../league-context/league-context.service.js");
  const routes = await findServerRoutesForLeague(leagueId);
  return routes?.guildId ?? siteOnlyGuildId(leagueId);
}

// "Game Is Over" -- either coach can close it out with an optional final score. Updates the
// announcement to show the final result and ends any live stream logs for this game so they
// stop showing on the site's Live Games board.
export async function markGameOver(input: { gameId: string; discordId: string; homeScore?: number | null; awayScore?: number | null }) {
  const game = await supabase.from("rec_games").select("home_user_id,away_user_id").eq("id", input.gameId).maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to load game.", game.error);
  const userId = await userIdFromDiscordId(input.discordId);
  if (!game.data || (userId !== game.data.home_user_id && userId !== game.data.away_user_id)) {
    throw new ApiError(403, "Only the two coaches in this matchup can mark the game over.");
  }
  if (input.homeScore != null && input.awayScore != null) {
    await supabase.from("rec_games").update({ home_score: input.homeScore, away_score: input.awayScore, updated_at: new Date().toISOString() }).eq("id", input.gameId);
  }
  await supabase.from("rec_game_scheduling").update({ status: "completed", updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await supabase.from("rec_stream_compliance_logs").update({ ended_at: new Date().toISOString() }).eq("game_id", input.gameId).is("ended_at", null);
  await logSchedulingEvent({ gameId: input.gameId, eventType: "game_marked_over", payload: { homeScore: input.homeScore ?? null, awayScore: input.awayScore ?? null } });
  // Dynamic import avoids a static scheduling-service cycle.
  const { updateSchedulingPanel } = await import("./matchup-scheduling.service.js");
  await updateSchedulingPanel(input.gameId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panel (non-fatal):", error));
  const { refreshMatchupsChannelForGame } = await import("./matchups-channel.service.js");
  await refreshMatchupsChannelForGame(input.gameId);
  return { ok: true as const };
}
