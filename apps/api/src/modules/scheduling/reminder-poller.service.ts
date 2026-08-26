// 5-minute-polled reminder sweep for the REC Game Scheduling System. Collapsed from ~10
// chronologically-firing reminder types down to 3, all de-duped per (game, type) via
// rec_scheduling_reminders_sent: a single 12-hour no-attempt ping, a 30-minute-to-kickoff ping,
// and a proactive kickoff-time prompt. Availability nagging moved to be advance-triggered (see
// availability-nag.service.ts) instead of polled. Self-service Force Win/AutoPilot escalation
// and the post-kickoff check-in/auto-reset safety net were retired entirely in favor of
// commissioner-driven /commishtools -- see apps/bot/src/flows/commish-tools-flow.ts.
import { supabase } from "../../lib/supabase.js";
import { postKickoffPrompt } from "./matchup-scheduling.service.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { logSchedulingEvent } from "./shared.js";
import { isGameChannelQuietHours } from "./scheduling-guardrails.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";

export { isGameChannelQuietHours } from "./scheduling-guardrails.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

type Game = { id: string; league_id: string; home_user_id: string | null; away_user_id: string | null };

async function discordIdsFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", ids);
  if (error) { console.error("[ERROR] scheduling reminder poller: failed to load discord ids (non-fatal):", error); return new Map(); }
  return new Map((data ?? []).map((r: any) => [String(r.user_id), String(r.discord_id)]));
}

async function alreadySent(gameIds: string[], type: string): Promise<Set<string>> {
  if (!gameIds.length) return new Set();
  const { data, error } = await supabase.from("rec_scheduling_reminders_sent").select("game_id").eq("reminder_type", type).in("game_id", gameIds);
  if (error) { console.error("[ERROR] scheduling reminder poller: failed to check sent reminders (non-fatal):", error); return new Set(); }
  return new Set((data ?? []).map((r: any) => String(r.game_id)));
}

async function markSent(gameId: string, type: string) {
  await supabase.from("rec_scheduling_reminders_sent").insert({ game_id: gameId, reminder_type: type }).then(({ error }) => {
    if (error) console.error("[ERROR] scheduling reminder poller: failed to record sent reminder (non-fatal):", error);
  });
}

async function loadGamesById(gameIds: string[]): Promise<Map<string, Game>> {
  if (!gameIds.length) return new Map();
  const { data, error } = await supabase.from("rec_games").select("id,league_id,home_user_id,away_user_id").in("id", gameIds);
  if (error) { console.error("[ERROR] scheduling reminder poller: failed to load games (non-fatal):", error); return new Map(); }
  return new Map((data ?? []).map((g: any) => [String(g.id), g as Game]));
}

async function postToGameChannel(gameId: string, content: string, mentionUserIds: string[] = []) {
  const channel = await getGameChannelByGameId(gameId);
  if (!channel?.discord_channel_id) return;
  await postDiscordChannelMessage(channel.discord_channel_id, {
    content,
    allowed_mentions: { users: mentionUserIds, parse: mentionUserIds.length ? [] : undefined },
  }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post reminder (non-fatal):", error));
}

// -- Single 12-hour no-attempt ping: whichever side(s) haven't taken any scheduling action
// (accept/counter/reschedule -- see matchup-scheduling.service.ts's markResponded) since the
// response clock started at channel creation.
async function runNoAttemptReminder() {
  const cutoff = new Date(Date.now() - 12 * HOUR).toISOString();
  const { data, error } = await supabase.from("rec_game_scheduling")
    .select("game_id,league_id,status,home_responded_at,away_responded_at")
    .not("response_started_at", "is", null)
    .lte("response_started_at", cutoff)
    .not("status", "in", "(confirmed,completed)")
    .or("home_responded_at.is.null,away_responded_at.is.null");
  if (error) { console.error("[ERROR] scheduling reminder poller: no-attempt query failed (non-fatal):", error); return; }
  type Row = { game_id: string; league_id: string; status: string; home_responded_at: string | null; away_responded_at: string | null };
  const rows = (data ?? []) as Row[];
  if (!rows.length) return;

  const sent = await alreadySent(rows.map((r) => r.game_id), "no_attempt_12h");
  const pending = rows.filter((r) => !sent.has(r.game_id));
  if (!pending.length) return;

  const games = await loadGamesById(pending.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));

  for (const row of pending) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const waitingOn = [
      !row.home_responded_at && game.home_user_id ? discordByUser.get(game.home_user_id) : null,
      !row.away_responded_at && game.away_user_id ? discordByUser.get(game.away_user_id) : null,
    ].filter((v): v is string => Boolean(v));
    if (!waitingOn.length) continue;
    const mentions = waitingOn.map((id) => `<@${id}>`).join(" ");
    await postToGameChannel(row.game_id, `${mentions} — schedule a time or reach out to your opponent.`, waitingOn);
    await markSent(row.game_id, "no_attempt_12h");
    await logSchedulingEvent({ gameId: row.game_id, eventType: "reminder_sent", payload: { type: "no_attempt_12h" } });
  }
}

// -- Single 30-minutes-to-kickoff ping for confirmed games.
async function runThirtyMinuteReminder() {
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,scheduled_for").eq("status", "confirmed").not("scheduled_for", "is", null);
  if (error) { console.error("[ERROR] scheduling reminder poller: 30m query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; scheduled_for: string }>;
  if (!rows.length) return;

  const sent = await alreadySent(rows.map((r) => r.game_id), "game_30m");
  const games = await loadGamesById(rows.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));

  const now = Date.now();
  for (const row of rows) {
    if (sent.has(row.game_id)) continue;
    const game = games.get(row.game_id);
    if (!game) continue;
    const deltaMin = (new Date(row.scheduled_for).getTime() - now) / MIN;
    if (deltaMin > 30 || deltaMin <= 20) continue; // 10-minute firing window so a slower tick can't skip it
    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
    const channel = await getGameChannelByGameId(row.game_id);
    if (channel?.discord_channel_id) {
      await postDiscordChannelMessage(channel.discord_channel_id, {
        content: `${mentions} — your game is scheduled in about 30 minutes.`,
        components: [{
          type: 1,
          components: [
            { type: 2, style: 2, custom_id: `rec:gamesched:panel:propose:${row.game_id}`, label: "Reschedule / Cancel" },
            { type: 2, style: 4, custom_id: `rec:gamesched:panel:cantmake:${row.game_id}`, label: "Can't Make Game" },
          ],
        }],
        allowed_mentions: { users: mentionIds },
      }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post 30m reminder (non-fatal):", error));
    }
    await markSent(row.game_id, "game_30m");
  }
}

// -- Proactive kickoff-time prompt: surfaces the panel's existing Game Started/Game Ended
// buttons right when the game is supposed to start, pinging both coaches.
async function runKickoffPrompt() {
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,scheduled_for").eq("status", "confirmed").not("scheduled_for", "is", null);
  if (error) { console.error("[ERROR] scheduling reminder poller: kickoff-prompt query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; scheduled_for: string }>;
  if (!rows.length) return;

  const sent = await alreadySent(rows.map((r) => r.game_id), "game_start_prompt");
  const now = Date.now();
  for (const row of rows) {
    if (sent.has(row.game_id)) continue;
    const deltaMin = (new Date(row.scheduled_for).getTime() - now) / MIN;
    if (deltaMin > 0 || deltaMin <= -10) continue; // 10-minute firing window
    await postKickoffPrompt(row.game_id);
    await markSent(row.game_id, "game_start_prompt");
    await logSchedulingEvent({ gameId: row.game_id, eventType: "kickoff_reminder_posted" });
  }
}

export async function runSchedulingReminderSweep() {
  if (isGameChannelQuietHours()) return;
  await runNoAttemptReminder();
  await runThirtyMinuteReminder();
  await runKickoffPrompt();
}
