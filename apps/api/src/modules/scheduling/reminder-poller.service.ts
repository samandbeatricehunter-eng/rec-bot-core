// 60s-polled reminder sweep for the REC Game Scheduling System -- mirrors the existing fantasy-
// draft reminder poller's pattern (index.ts's setInterval): threshold windows sized with a few
// minutes of slack so an occasional slow tick never skips a reminder, de-duped per (game/user,
// type) via rec_scheduling_reminders_sent so a restart or a slow tick never double-sends either.
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, deleteDiscordMessage } from "../../lib/discord-guild.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { autoResetSchedulingAfterMissedKickoff, getActiveRuleKeys } from "./matchup-scheduling.service.js";
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

// -- Contact reminders: 2h/4h/8h/12h since the response clock started (= channel creation --
// startResponseClock runs right after the channel is made), for whichever side(s) haven't
// responded yet. "Responded" now includes a plain chat message in the channel (see
// game-chat.service.ts's ingestDiscordGameChatMessage -> markResponded wiring), not just
// scheduling-panel actions, so the 2h tier below doubles as the spec's "channel silence" ping
// without a separate/redundant mechanism. The 12h tier also surfaces "Request AutoPilot"
// (neither responded at all in 12h is one of the two AutoPilot trigger conditions).
async function runContactReminders(hours: 2 | 4 | 8 | 12, type: string) {
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

// Most-recent send timestamp for a (game, type) pair -- unlike alreadySent's "has this ever
// fired" Set (fine for the one-shot reminders above), the recurring schedule-in-system nag needs
// to know HOW LONG AGO it last fired so it can re-fire every 2h, not just once.
async function lastSentAt(gameId: string, type: string): Promise<number | null> {
  const { data, error } = await supabase.from("rec_scheduling_reminders_sent").select("sent_at").eq("game_id", gameId).eq("reminder_type", type).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("[ERROR] scheduling reminder poller: lastSentAt query failed (non-fatal):", error); return null; }
  return data?.sent_at ? new Date(data.sent_at).getTime() : null;
}

// -- Recurring "schedule in our system" nag: once at least one coach has spoken in the channel
// (home_responded_at/away_responded_at, now driven by chat messages too -- see
// game-chat.service.ts) but neither has proposed a time through the system, ping every 2h
// starting 2h after that first message, repeating until a proposal exists or the game leaves
// not_scheduled (any other logged action -- Can't Make Game, a status change, etc. -- moves the
// status off not_scheduled, which is exactly the stop condition this checks).
async function runScheduleInSystemNag() {
  const { data, error } = await supabase.from("rec_game_scheduling")
    .select("game_id,league_id,home_responded_at,away_responded_at")
    .eq("status", "not_scheduled")
    .or("home_responded_at.not.is.null,away_responded_at.not.is.null");
  if (error) { console.error("[ERROR] scheduling reminder poller: schedule-in-system nag query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; home_responded_at: string | null; away_responded_at: string | null }>;
  if (!rows.length) return;

  const gameIds = rows.map((r) => r.game_id);
  const proposals = await supabase.from("rec_game_time_proposals").select("game_id").in("game_id", gameIds);
  if (proposals.error) { console.error("[ERROR] scheduling reminder poller: schedule-in-system nag proposal check failed (non-fatal):", proposals.error); return; }
  const proposedGameIds = new Set((proposals.data ?? []).map((r: any) => String(r.game_id)));
  const candidates = rows.filter((r) => !proposedGameIds.has(r.game_id));
  if (!candidates.length) return;

  const games = await loadGamesById(candidates.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));
  const now = Date.now();

  for (const row of candidates) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const firstSpokeMs = Math.min(
      ...[row.home_responded_at, row.away_responded_at].filter((v): v is string => Boolean(v)).map((v) => new Date(v).getTime()),
    );
    if (!Number.isFinite(firstSpokeMs) || now - firstSpokeMs < 2 * HOUR) continue;

    const last = await lastSentAt(row.game_id, "schedule_in_system_nag");
    if (last != null && now - last < 2 * HOUR) continue;

    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
    await postToGameChannel(row.game_id, `${mentions} — still no time lined up through the scheduling system. Use the buttons above to line up a kickoff before advance.`, mentionIds);
    await markSent(row.game_id, "schedule_in_system_nag");
    await logSchedulingEvent({ gameId: row.game_id, eventType: "reminder_sent", payload: { type: "schedule_in_system_nag" } });
  }
}

// -- 8h after one coach has responded/spoken and the other still hasn't, surface a "Request FW
// for failure to schedule" button to the coach who DID respond -- gated on the league having
// `failure_to_schedule` active in force_win_rules_* for the current season stage. Reuses the
// contact_8h query shape (same anchor as the pre-existing 8h contact reminder) rather than a
// separate scan, since it's the same underlying condition with an extra settings gate.
async function runFailureToScheduleFwSurface() {
  const cutoff = new Date(Date.now() - 8 * HOUR).toISOString();
  const { data, error } = await supabase.from("rec_game_scheduling")
    .select("game_id,league_id,home_responded_at,away_responded_at")
    .not("response_started_at", "is", null)
    .lte("response_started_at", cutoff)
    .not("status", "in", "(confirmed,completed)")
    .or("and(home_responded_at.not.is.null,away_responded_at.is.null),and(home_responded_at.is.null,away_responded_at.not.is.null)");
  if (error) { console.error("[ERROR] scheduling reminder poller: failure-to-schedule FW query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; home_responded_at: string | null; away_responded_at: string | null }>;
  if (!rows.length) return;

  const sent = await alreadySent(rows.map((r) => r.game_id), "fw_failure_to_schedule_8h");
  const pending = rows.filter((r) => !sent.has(r.game_id));
  if (!pending.length) return;

  const games = await loadGamesById(pending.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));

  for (const row of pending) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const active = await getActiveRuleKeys(row.league_id).catch(() => ({ forceWin: [] as string[], fairSim: [] as string[] }));
    if (!active.forceWin.includes("failure_to_schedule")) continue;

    const respondedUserId = row.home_responded_at ? game.home_user_id : game.away_user_id;
    const respondedDiscordId = respondedUserId ? discordByUser.get(respondedUserId) : null;
    const channel = await getGameChannelByGameId(row.game_id);
    if (channel?.discord_channel_id) {
      await postDiscordChannelMessage(channel.discord_channel_id, {
        content: `${respondedDiscordId ? `<@${respondedDiscordId}>` : "A coach"} — your opponent hasn't engaged with scheduling in 8 hours. If you'd like to request a Force Win for failure to schedule, hit the button below.`,
        // Deliberately a different customId prefix than the existing rec:gamesched:fwrequest:
        // button (missed-kickoff-after-checkin justification, gated on a check-in state this
        // never-scheduled game doesn't have) -- reusing it here would silently 403.
        components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: `rec:gamesched:fwfts:${row.game_id}`, label: "Request Force Win" }] }],
        allowed_mentions: { users: respondedDiscordId ? [respondedDiscordId] : [] },
      }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post failure-to-schedule FW surface (non-fatal):", error));
    }
    await markSent(row.game_id, "fw_failure_to_schedule_8h");
    await logSchedulingEvent({ gameId: row.game_id, eventType: "fw_eligibility_notice_posted", payload: { reason: "failure_to_schedule" } });
  }
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
//
// Includes status="live" (not just "confirmed") -- a game can go live via a stream with no prior
// confirmed kickoff at all (markGameStarted clears scheduled_for), and this follow-up sequence
// is exactly what catches a genuine no-show opponent, so it can't just stop applying the moment
// one coach starts streaming solo. game_started_at stands in for scheduled_for as the reference
// "kickoff happened" moment when there was never a confirmed time.
async function runCheckinFollowUps() {
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,status,scheduled_for,game_started_at").in("status", ["confirmed", "live"]);
  if (error) { console.error("[ERROR] scheduling reminder poller: checkin-followup query failed (non-fatal):", error); return; }
  const rows = ((data ?? []) as Array<{ game_id: string; league_id: string; status: string; scheduled_for: string | null; game_started_at: string | null }>)
    .map((r) => ({ ...r, referenceAt: r.scheduled_for ?? r.game_started_at }))
    .filter((r): r is typeof r & { referenceAt: string } => r.referenceAt != null && new Date(r.referenceAt).getTime() < Date.now());
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
    const pastMin = (now - new Date(row.referenceAt).getTime()) / MIN;
    const checkedIn = checkinsByGame.get(row.game_id) ?? [];
    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");

    if (pastMin >= 30 && pastMin < 35 && checkedIn.length === 0 && !sentFollowup.has(row.game_id)) {
      await postToGameChannel(row.game_id, `${mentions} — reminder to hit ✅ once you're ready or already loaded in.`, mentionIds);
      await markSent(row.game_id, "game_kickoff_followup_30m");
    }

    // A live game already has visible proof someone showed up (that's how it became live) --
    // auto-resetting it back to not_scheduled would silently wipe out a real, in-progress game.
    // Confirmed-but-never-started games are the ones this is meant to unstick.
    if (row.status === "confirmed" && pastMin >= 120 && checkedIn.length < 2 && !sentReset.has(row.game_id)) {
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

// -- 45 minutes after a game goes live (marked started manually or by a stream going up), ping
// both coaches with a "Game is Over" button so they can close it out (optionally with a final
// score), which updates the announcement and stops any stream from showing live on the site.
async function runGameOverPrompt() {
  const cutoff = new Date(Date.now() - 45 * MIN).toISOString();
  const laterCutoff = new Date(Date.now() - 50 * MIN).toISOString();
  const { data, error } = await supabase.from("rec_game_scheduling").select("game_id,league_id,game_started_at")
    .not("game_started_at", "is", null).lte("game_started_at", cutoff).gt("game_started_at", laterCutoff).neq("status", "completed");
  if (error) { console.error("[ERROR] scheduling reminder poller: game-over prompt query failed (non-fatal):", error); return; }
  const rows = (data ?? []) as Array<{ game_id: string; league_id: string; game_started_at: string }>;
  if (!rows.length) return;
  const sent = await alreadySent(rows.map((r) => r.game_id), "game_over_prompt");
  const pending = rows.filter((r) => !sent.has(r.game_id));
  if (!pending.length) return;
  const games = await loadGamesById(pending.map((r) => r.game_id));
  const discordByUser = await discordIdsFor([...games.values()].flatMap((g) => [g.home_user_id, g.away_user_id]).filter((v): v is string => Boolean(v)));

  for (const row of pending) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const mentionIds = [game.home_user_id, game.away_user_id].filter((v): v is string => Boolean(v)).map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
    const channel = await getGameChannelByGameId(row.game_id);
    if (channel?.discord_channel_id) {
      await postDiscordChannelMessage(channel.discord_channel_id, {
        content: `${mentions} — done playing? Hit the button below to wrap up this game.`,
        components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: `rec:gamesched:gameover:${row.game_id}`, label: "Game is Over" }] }],
        allowed_mentions: { users: mentionIds },
      }).catch((error) => console.error("[ERROR] scheduling reminder poller: failed to post Game is Over prompt (non-fatal):", error));
    }
    await markSent(row.game_id, "game_over_prompt");
  }
}

// In-process circuit breaker for the availability nag, independent of rec_availability_nag_state
// -- a prior incident had this posting every single minute for hours despite the DB-backed 4h
// gate, because the state upsert was silently failing every tick (never persisted, so every
// tick read as "nothing posted yet"). This in-memory floor means a single process can physically
// never re-post for a league sooner than this interval, regardless of whether the DB write
// behind it is working. Reset on every deploy/restart, which is fine -- worst case one extra
// early post right after a restart, never a repeating one.
const lastAvailabilityNagAttempt = new Map<string, number>();
const AVAILABILITY_NAG_MIN_INTERVAL_MS = 4 * HOUR;

// -- Missing-availability nag: one message per league listing every linked coach with no
// timezone and/or no weekly windows set, gated to at most once per 4h AT THE LEAGUE LEVEL (not
// per user) and replacing its own previous post each time it fires. The old design cooled down
// per user, so whenever different users' individual 4h windows happened to lapse minutes apart
// (common right after several coaches join around the same time) the channel accumulated a
// fresh near-duplicate message every few minutes. A timezone alone isn't "availability set"
// either -- a coach who picked a timezone but never added a single recurring window still has
// nothing for the overlap finder to work with.
async function runAvailabilityNag() {
  const { data: leagues, error } = await supabase.from("rec_leagues").select("id");
  if (error) { console.error("[ERROR] scheduling reminder poller: availability nag league query failed (non-fatal):", error); return; }
  for (const league of leagues ?? []) {
    const leagueId = String((league as any).id);
    const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
    const channelId = String((routes?.routes as any)?.scheduling_channel_id ?? "");
    if (!channelId) continue;

    const assignments = await supabase.from("rec_team_assignments").select("user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null);
    const userIds: string[] = [...new Set<string>((assignments.data ?? []).map((a: any) => String(a.user_id)))];
    if (!userIds.length) continue;

    const [profiles, windows, state] = await Promise.all([
      supabase.from("rec_user_availability_profiles").select("user_id,timezone").in("user_id", userIds),
      supabase.from("rec_user_availability_windows").select("user_id").in("user_id", userIds).eq("active", true),
      supabase.from("rec_availability_nag_state").select("channel_id,message_id,posted_at").eq("league_id", leagueId).maybeSingle(),
    ]);
    // Fail closed, not open: if any of these reads errors, `state.data` would silently read as
    // "nothing ever posted" and the 4h gate below would never actually gate anything -- this is
    // exactly what turned into a message-every-minute incident once. Skip the league this tick
    // rather than risk spamming on bad data.
    if (profiles.error || windows.error || state.error) {
      console.error("[ERROR] scheduling reminder poller: availability nag read failed for league (skipping this tick, non-fatal):", leagueId, profiles.error ?? windows.error ?? state.error);
      continue;
    }
    const hasTimezone = new Set((profiles.data ?? []).filter((p: any) => p.timezone).map((p: any) => String(p.user_id)));
    const hasWindows = new Set((windows.data ?? []).map((w: any) => String(w.user_id)));
    const missing = userIds.filter((id) => !hasTimezone.has(id) || !hasWindows.has(id));

    if (!missing.length) {
      // Everyone's set now -- clean up any lingering nag instead of leaving it stale forever.
      if (state.data?.message_id) {
        await deleteDiscordMessage(state.data.channel_id, state.data.message_id).catch(() => undefined);
        await supabase.from("rec_availability_nag_state").delete().eq("league_id", leagueId);
      }
      continue;
    }

    const lastPostedMs = state.data?.posted_at ? new Date(state.data.posted_at).getTime() : 0;
    const lastAttemptMs = lastAvailabilityNagAttempt.get(leagueId) ?? 0;
    if (Date.now() - lastPostedMs < 4 * HOUR || Date.now() - lastAttemptMs < AVAILABILITY_NAG_MIN_INTERVAL_MS) continue;
    lastAvailabilityNagAttempt.set(leagueId, Date.now());

    const discordByUser = await discordIdsFor(missing);
    const mentionIds = missing.map((id) => discordByUser.get(id)).filter((v): v is string => Boolean(v));
    if (!mentionIds.length) continue;
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");

    if (state.data?.message_id) {
      await deleteDiscordMessage(state.data.channel_id, state.data.message_id).catch(() => undefined);
    }
    const posted = await postDiscordChannelMessage(channelId, {
      content: `${mentions} — set your availability and timezone through here or the site so the scheduling system can find shared kickoff windows for your games.`,
      allowed_mentions: { users: mentionIds },
    }).catch((error) => { console.error("[ERROR] scheduling reminder poller: failed to post availability nag (non-fatal):", error); return null; });
    if (posted?.id) {
      // onConflict must be explicit here -- unlike real supabase-js/PostgREST, this project's
      // Postgres-shim client does NOT default a bare .upsert() to the table's primary key. With
      // no onConflict it emits a plain `ON CONFLICT DO NOTHING` (no target), which only ever
      // creates a row the very first time; every later post for the same league silently no-ops
      // instead of updating posted_at/message_id -- so this row would freeze after its first
      // write and every tick after that would (correctly, given what it read) think the last
      // real post was ages ago and never actually persisted state, both root causes of the
      // repeated/duplicate availability-nag postings this was built to stop.
      const upserted = await supabase.from("rec_availability_nag_state").upsert(
        { league_id: leagueId, channel_id: channelId, message_id: posted.id, posted_at: new Date().toISOString() },
        { onConflict: "league_id" },
      );
      if (upserted.error) console.error("[ERROR] scheduling reminder poller: failed to record availability nag state -- next tick may repost early (non-fatal):", upserted.error);
    }
  }
}

export async function runSchedulingReminderSweep() {
  await runContactReminders(2, "contact_2h");
  await runContactReminders(4, "contact_4h");
  await runContactReminders(8, "contact_8h");
  await runContactReminders(12, "contact_escalate_12h");
  await runStaleProposalAutoPilot();
  await runScheduleInSystemNag();
  await runFailureToScheduleFwSurface();
  await runConfirmedGameReminders();
  await runCheckinFollowUps();
  await runGameOverPrompt();
  await runAvailabilityNag();
}
