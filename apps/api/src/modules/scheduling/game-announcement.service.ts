// Announcements-channel countdown post for a confirmed H2H game: posted once, then edited in
// place as streams go live and again with the final score -- never reposted, so it never spams
// the announcements channel. Distinct from the game-channel scheduling panel (matchup-scheduling
// .service.ts), which lives in the private H2H channel, not the public announcements one.
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
  if (game.home_score != null && game.away_score != null) {
    const winner = game.home_score > game.away_score ? homeLabel : game.away_score > game.home_score ? awayLabel : "Tie";
    lines.push(`**Final: ${awayLabel} ${game.away_score} — ${homeLabel} ${game.home_score}**`, winner === "Tie" ? "Game ended in a tie." : `${winner} wins.`);
  } else if (s?.scheduled_for) {
    const unix = Math.floor(new Date(s.scheduled_for).getTime() / 1000);
    lines.push(`Kickoff: <t:${unix}:F> (<t:${unix}:R>)`);
  }

  const streamByTeam = new Map<string, string>((streams.data ?? []).map((row: any) => [String(row.team_id), row.message_url]));
  const awayStream = game.away_team_id ? streamByTeam.get(String(game.away_team_id)) : null;
  const homeStream = game.home_team_id ? streamByTeam.get(String(game.home_team_id)) : null;
  const streamLines = [
    awayStream ? `[Watch ${awayLabel} Stream](${awayStream})` : null,
    homeStream ? `[Watch ${homeLabel} Stream](${homeStream})` : null,
  ].filter((v): v is string => Boolean(v));
  if (streamLines.length) lines.push("", ...streamLines);

  return { embeds: [{ title, color: 0xd9a521, description: lines.join("\n") }] };
}

export async function postOrUpdateGameAnnouncement(gameId: string, opts: { announceNow?: boolean } = {}) {
  const scheduling = await supabase.from("rec_game_scheduling").select("league_id,announcement_channel_id,announcement_message_id").eq("game_id", gameId).maybeSingle();
  if (scheduling.error || !scheduling.data) return;
  const context = await getCurrentLeagueContext((await getGuildIdForLeague(scheduling.data.league_id)) ?? "");
  const channelId = scheduling.data.announcement_channel_id ?? String((context?.routes as any)?.announcements_channel_id ?? "");
  if (!channelId) return;

  const payload = await buildAnnouncementPayload(gameId);

  if (scheduling.data.announcement_message_id) {
    const edited = await editDiscordMessage(channelId, scheduling.data.announcement_message_id, payload).catch(() => false);
    if (edited) return;
  }
  if (!opts.announceNow) return; // Don't post a brand-new announcement on a routine update if none exists yet.

  const posted = await postDiscordChannelMessage(channelId, { content: "@everyone", allowed_mentions: { parse: ["everyone"] }, ...payload });
  if (!posted?.id) return;
  await supabase.from("rec_game_scheduling").update({ announcement_channel_id: channelId, announcement_message_id: posted.id, updated_at: new Date().toISOString() }).eq("game_id", gameId);
  await logSchedulingEvent({ gameId, eventType: "announcement_posted" });
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
  await postOrUpdateGameAnnouncement(input.gameId, { announceNow: false });
  return { ok: true as const };
}
