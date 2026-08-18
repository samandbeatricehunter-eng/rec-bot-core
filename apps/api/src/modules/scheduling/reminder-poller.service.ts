// 60s-polled reminder sweep for the REC Game Scheduling System -- mirrors the existing fantasy-
// draft reminder poller's pattern (index.ts's setInterval): threshold windows sized with a few
// minutes of slack so an occasional slow tick never skips a reminder, de-duped per (game/user,
// type) via rec_scheduling_reminders_sent so a restart or a slow tick never double-sends either.
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { autoResetSchedulingAfterMissedKickoff } from "./matchup-scheduling.service.js";
import { logSchedulingEvent } from "./shared.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

type SchedulingRow = {
  game_id: string; league_id: string; status: string; response_started_at: string | null;
  home_responded_at: string | null; away_responded_at: string | null; scheduled_for: string | null;
};
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

async function commissionerRoleMention(leagueId: string): Promise<string> {
  const routes = await findServerRoutesForLeague(leagueId);
  const roleId = String((routes?.routes as any)?.commissioner_role_id ?? "");
  return roleId ? `<@&${roleId}>` : "";
}

async function postToGameChannel(gameId: string, content: string, mentionUserIds: string[] = []) {
  const channel = await getGameChannelByGameId(gameId);
  if (!channel?.discord_channel_id) return;
  await postDiscordChannelMessage(channel.discord_channel_id, {
    content,
    allowed_mentions: { users: mentionUserIds, parse: mentionUserIds.length ? [] : undefined },
  }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post reminder (non-fatal):", error));
}

// -- Contact reminders: 4h/8h/12h since the response clock started, for whichever side(s)
// haven't responded yet. The 12h tier also surfaces "Request AutoPilot" (neither responded at
// all in 12h is one of the two AutoPilot trigger conditions).
async function runContactReminders(hours: 4 | 8 | 12, type: string) {
  const cutoff = new Date(Date.now() - hours * HOUR).toISOString();
  const { data, error } = await supabase.from("rec_game_scheduling")
    .select("game_id,league_id,status,response_started_at,home_responded_at,away_responded_at,scheduled_for")
    .not("response_started_at", "is", null)
    .lte("response_started_at", cutoff)
    .not("status", "in", "(confirmed,completed)")
    .or("home_responded_at.is.null,away_responded_at.is.null");
  if (error) { console.error("[ERROR] scheduling reminder poller: contact reminder query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as SchedulingRow[];
  if (!rows.length) return;

  const sent = await alreadySent(rows.map((r) => r.game_id), type);
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
    await postToGameChannel(row.game_id, `${mentions} — you haven't responded in your game channel yet. Set a time or adjust your availability before advance.`, waitingOn);
    await markSent(row.game_id, type);
    await logSchedulingEvent({ gameId: row.game_id, eventType: "reminder_sent", payload: { type } });

    if (hours === 12) await surfaceAutoPilot(row.game_id, game, "autopilot_surface_12h", "Neither coach has responded in 12 hours.");
  }
}

// -- AutoPilot condition 2: a proposal has sat unanswered for 8+ hours.
async function runStaleProposalAutoPilot() {
  const cutoff = new Date(Date.now() - 8 * HOUR).toISOString();
  const { data, error } = await supabase.from("rec_game_time_proposals").select("game_id,created_at").eq("status", "pending").lte("created_at", cutoff);
  if (error) { console.error("[ERROR] scheduling reminder poller: stale proposal query failed (non-fatal):", error); return; }
  const gameIds: string[] = [...new Set<string>((data ?? []).map((r: any) => String(r.game_id)))];
  if (!gameIds.length) return;
  const sent = await alreadySent(gameIds, "autopilot_surface_proposal_8h");
  const pending = gameIds.filter((id) => !sent.has(id));
  if (!pending.length) return;
  const games = await loadGamesById(pending);
  for (const gameId of pending) {
    const game = games.get(gameId);
    if (!game) continue;
    await surfaceAutoPilot(gameId, game, "autopilot_surface_proposal_8h", "A proposed time has gone unanswered for 8 hours.");
  }
}

async function surfaceAutoPilot(gameId: string, game: Game, type: string, reason: string) {
  const discordByUser = await discordIdsFor([game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)));
  const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
  const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
  const channel = await getGameChannelByGameId(gameId);
  if (!channel?.discord_channel_id) return;
  await postDiscordChannelMessage(channel.discord_channel_id, {
    content: `${mentions}\n${reason} If you can't reach a scheduled time, either coach can request AutoPilot for this game.`,
    components: [{
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `rec:gamesched:autopilot:${gameId}`, label: "Request AutoPilot" }],
    }],
    allowed_mentions: { users: mentionIds },
  }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post AutoPilot surface (non-fatal):", error));
  await markSent(gameId, type);
  await logSchedulingEvent({ gameId, eventType: "autopilot_surfaced", payload: { type } });
}

// -- Confirmed-game reminders: 30m before, 10m before, at kickoff (post the check-in embed).
async function runConfirmedGameReminders() {
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,scheduled_for").eq("status", "confirmed").not("scheduled_for", "is", null);
  if (error) { console.error("[ERROR] scheduling reminder poller: confirmed-game query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; scheduled_for: string }>;
  if (!rows.length) return;

  const [sent30, sent10, sentKickoff] = await Promise.all([
    alreadySent(rows.map((r) => r.game_id), "game_30m"),
    alreadySent(rows.map((r) => r.game_id), "game_10m"),
    alreadySent(rows.map((r) => r.game_id), "game_kickoff"),
  ]);
  const games = await loadGamesById(rows.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));

  const now = Date.now();
  for (const row of rows) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const deltaMin = (new Date(row.scheduled_for).getTime() - now) / MIN;
    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");

    if (deltaMin <= 30 && deltaMin > 25 && !sent30.has(row.game_id)) {
      await postToGameChannel(row.game_id, `${mentions} — your game is scheduled in about 30 minutes.`, mentionIds);
      await markSent(row.game_id, "game_30m");
    }
    if (deltaMin <= 10 && deltaMin > 5 && !sent10.has(row.game_id)) {
      await postToGameChannel(row.game_id, `${mentions} — kickoff in about 10 minutes. Don't forget to share your stream when you go live.`, mentionIds);
      await markSent(row.game_id, "game_10m");
    }
    if (deltaMin <= 0 && deltaMin > -5 && !sentKickoff.has(row.game_id)) {
      const channel = await getGameChannelByGameId(row.game_id);
      if (channel?.discord_channel_id) {
        await postDiscordChannelMessage(channel.discord_channel_id, {
          content: `${mentions} — it's game time! Hit ✅ below once you're ready or already loaded in.`,
          components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: `rec:gamesched:checkin:${row.game_id}`, emoji: { name: "✅" }, label: "I'm Ready" }] }],
          allowed_mentions: { users: mentionIds },
        }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post kickoff embed (non-fatal):", error));
      }
      await markSent(row.game_id, "game_kickoff");
      await logSchedulingEvent({ gameId: row.game_id, eventType: "kickoff_reminder_posted" });
    }
  }
}

// -- Post-kickoff check-in follow-up (+30m if neither checked in) and auto-reset (+2h if still
// neither checked in) -- and the "one checked in, one didn't" Force-Win-eligible notice at +1h
// from the FIRST check-in specifically (not from kickoff).
async function runCheckinFollowUps() {
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,scheduled_for").eq("status", "confirmed").not("scheduled_for", "is", null).lt("scheduled_for", new Date().toISOString());
  if (error) { console.error("[ERROR] scheduling reminder poller: checkin-followup query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; scheduled_for: string }>;
  if (!rows.length) return;

  const gameIds = rows.map((r) => r.game_id);
  const [checkins, sentFollowup, sentReset, sentFw] = await Promise.all([
    supabase.from("rec_game_kickoff_checkins").select("game_id,user_id,checked_in_at").in("game_id", gameIds),
    alreadySent(gameIds, "game_kickoff_followup_30m"),
    alreadySent(gameIds, "game_reset_2h"),
    alreadySent(gameIds, "fw_eligible"),
  ]);
  const checkinsByGame = new Map<string, Array<{ user_id: string; checked_in_at: string }>>();
  for (const row of checkins.data ?? []) checkinsByGame.set(String((row as any).game_id), [...(checkinsByGame.get(String((row as any).game_id)) ?? []), row as any]);

  const games = await loadGamesById(gameIds);
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));
  const now = Date.now();

  for (const row of rows) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const scheduledMs = new Date(row.scheduled_for).getTime();
    const pastMin = (now - scheduledMs) / MIN;
    const checkedIn = checkinsByGame.get(row.game_id) ?? [];
    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");

    if (pastMin >= 30 && pastMin < 35 && checkedIn.length === 0 && !sentFollowup.has(row.game_id)) {
      await postToGameChannel(row.game_id, `${mentions} — reminder to hit ✅ once you're ready or already loaded in.`, mentionIds);
      await markSent(row.game_id, "game_kickoff_followup_30m");
    }

    if (pastMin >= 120 && checkedIn.length < 2 && !sentReset.has(row.game_id)) {
      await autoResetSchedulingAfterMissedKickoff(row.game_id);
      await markSent(row.game_id, "game_reset_2h");
      continue;
    }

    if (checkedIn.length === 1 && !sentFw.has(row.game_id)) {
      const [checkedInUserId] = checkedIn.map((c) => c.user_id);
      const firstCheckinMs = new Date(checkedIn[0]!.checked_in_at).getTime();
      const sinceCheckinMin = (now - firstCheckinMs) / MIN;
      if (sinceCheckinMin >= 60 && sinceCheckinMin < 65) {
        const checkedInDiscordId = discordByUser.get(checkedInUserId!);
        const roleMention = await commissionerRoleMention(row.league_id);
        const channel = await getGameChannelByGameId(row.game_id);
        if (channel?.discord_channel_id) {
          await postDiscordChannelMessage(channel.discord_channel_id, {
            content: `${checkedInDiscordId ? `<@${checkedInDiscordId}>` : "The checked-in coach"} — your opponent hasn't checked in an hour after the confirmed kickoff. ${roleMention ? `${roleMention} ` : ""}If you'd like to request a Force Win, hit ✅ below.`,
            components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: `rec:gamesched:fwrequest:${row.game_id}`, emoji: { name: "✅" }, label: "Request Force Win" }] }],
            allowed_mentions: { users: checkedInDiscordId ? [checkedInDiscordId] : [] },
          }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post FW-eligible notice (non-fatal):", error));
        }
        await markSent(row.game_id, "fw_eligible");
        await logSchedulingEvent({ gameId: row.game_id, eventType: "fw_eligibility_notice_posted" });
      }
    }
  }
}

export async function runSchedulingReminderSweep() {
  await runContactReminders(4, "contact_4h");
  await runContactReminders(8, "contact_8h");
  await runContactReminders(12, "contact_escalate_12h");
  await runStaleProposalAutoPilot();
  await runConfirmedGameReminders();
  await runCheckinFollowUps();
}
