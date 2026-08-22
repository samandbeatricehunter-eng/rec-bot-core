// Weekly "Matchups" channel: one embed per league. Same-week scheduling updates edit that
// message in place. A week advance deletes leftover boards and posts a single replacement.
// Distinct from game-announcement.service.ts (one embed per GAME in the announcements channel)
// and matchup-scheduling.service.ts's Scheduling panel (one embed per game channel) -- this is
// the single league-wide "here's the whole week" view.
import { supabase } from "../../lib/supabase.js";
import { getPgPool } from "../../db/client.js";
import {
  postDiscordChannelMessage,
  tryEditDiscordMessage,
  deleteDiscordMessage,
  listDiscordChannelMessages,
  getBotUserId,
} from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  chooseMatchupsKeepId,
  isWeeklyMatchupsEmbedTitle,
  planAfterMatchupsEditAttempt,
  planMatchupsChannelWrite,
  resolveMatchupsChannelId,
} from "./matchups-channel-plan.js";

export {
  isWeeklyMatchupsEmbedTitle,
  planAfterMatchupsEditAttempt,
  planMatchupsChannelWrite,
  resolveMatchupsChannelId,
  WEEKLY_MATCHUPS_EMBED_TITLE_RE,
} from "./matchups-channel-plan.js";
export type { MatchupsChannelPostState, MatchupsChannelWritePlan } from "./matchups-channel-plan.js";

type SchedulingRow = {
  game_id: string; status: string; scheduled_for: string | null;
  fw_flagged: boolean; fw_flagged_for_user_id: string | null; proposed_by_user_id: string | null;
  response_started_at: string | null; home_responded_at: string | null; away_responded_at: string | null;
};

// Historical custom_id for the Ready to Advance button this post used to carry. The weekly
// embed no longer attaches it; leftover Discord messages may still fire rec:rta:btn until
// the next in-place edit (which sends components: [] to strip them).
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

async function persistMatchupsChannelPost(input: {
  leagueId: string;
  weekNumber: number;
  channelId: string;
  messageId: string;
}): Promise<void> {
  // onConflict must be explicit -- this project's Postgres-shim client does NOT default a
  // bare .upsert() to the table's primary key. Without it the first insert sticks forever
  // (`ON CONFLICT DO NOTHING`) and every later refresh posts a brand-new Discord message
  // because the tracked message_id/week never move forward.
  const { error } = await supabase.from("rec_matchups_channel_posts").upsert({
    league_id: input.leagueId,
    week_number: input.weekNumber,
    channel_id: input.channelId,
    message_id: input.messageId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "league_id" });
  if (error) console.error("[ERROR] matchups channel: failed to persist post row (non-fatal):", error);
}

async function listMatchupsEmbedIds(channelId: string): Promise<string[]> {
  const [botUserId, messages] = await Promise.all([
    getBotUserId(),
    listDiscordChannelMessages(channelId, 100),
  ]);
  return messages
    .filter((message) => message.author?.id === botUserId && isWeeklyMatchupsEmbedTitle(message.embeds?.[0]?.title))
    .map((message) => message.id);
}

async function deleteMatchupsMessages(channelId: string, messageIds: string[]): Promise<void> {
  await Promise.all(messageIds.map((messageId) => deleteDiscordMessage(channelId, messageId).catch(() => undefined)));
}

async function sweepDuplicateMatchupsMessages(channelId: string, keepMessageId: string | null): Promise<void> {
  try {
    const extras = (await listMatchupsEmbedIds(channelId)).filter((messageId) => messageId !== keepMessageId);
    await deleteMatchupsMessages(channelId, extras);
  } catch (error) {
    console.error("[ERROR] matchups channel: failed to sweep duplicate posts (non-fatal):", error);
  }
}

async function withMatchupsChannelLock<T>(leagueId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getPgPool().connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [`matchups-channel:${leagueId}`]);
    return await fn();
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [`matchups-channel:${leagueId}`]);
    } finally {
      client.release();
    }
  }
}

export async function refreshMatchupsChannel(guildId: string): Promise<void> {
  const { getAdvanceWeekGames } = await import("../league-week/advance-results.service.js");
  const week = await getAdvanceWeekGames(guildId).catch((error) => { console.error("[ERROR] matchups channel: failed to load week games (non-fatal):", error); return null; });
  if (!week) return;
  const h2hGames = (week.games as any[]).filter((g) => g.isH2h);

  const context = await getCurrentLeagueContext(guildId).catch(() => null);
  if (!context) return;
  const routes = await findServerRoutesForLeague(context.leagueId).catch(() => null);
  const channelId = resolveMatchupsChannelId(routes?.routes as Record<string, unknown> | null);
  if (!channelId) return;

  // H2H-only post. If this week has no human matchups, drop any leftover embed (CPU block
  // and/or Ready to Advance button) rather than leaving a stale message in the channel.
  if (!h2hGames.length) {
    await withMatchupsChannelLock(context.leagueId, async () => {
      const state = await supabase.from("rec_matchups_channel_posts").select("channel_id,message_id").eq("league_id", context.leagueId).maybeSingle();
      if (state.data?.message_id) {
        await deleteDiscordMessage(state.data.channel_id, state.data.message_id).catch(() => undefined);
        await supabase.from("rec_matchups_channel_posts").delete().eq("league_id", context.leagueId);
      }
      await sweepDuplicateMatchupsMessages(channelId, null);
    });
    return;
  }

  const gameIds = h2hGames.map((g) => g.gameId);
  const [scheduling, streams, fairSims] = await Promise.all([
    supabase.from("rec_game_scheduling").select("game_id,status,scheduled_for,fw_flagged,fw_flagged_for_user_id,proposed_by_user_id,response_started_at,home_responded_at,away_responded_at").in("game_id", gameIds),
    supabase.from("rec_stream_compliance_logs").select("game_id,team_id,message_url").in("game_id", gameIds).eq("status", "posted").is("ended_at", null),
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

  const userIds = [...new Set(h2hGames.flatMap((g) => [g.homeUserId, g.awayUserId]).filter((v): v is string => Boolean(v)))];
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

  const seasonNumber = week.seasonNumber ?? 1;
  const title = `Season ${seasonNumber}, Week ${week.currentWeek} Matchups`;
  // components: [] is required on edit — omitting the field leaves the previous Ready to
  // Advance button on the Discord message.
  const payload = {
    embeds: [{ title, color: 0xd9a521, description: lines.join("\n\n").slice(0, 4096) }],
    components: [] as unknown[],
  };

  await withMatchupsChannelLock(context.leagueId, async () => {
    const state = await supabase.from("rec_matchups_channel_posts").select("week_number,channel_id,message_id").eq("league_id", context.leagueId).maybeSingle();
    const stored = state.data?.message_id
      ? { week_number: Number(state.data.week_number), channel_id: String(state.data.channel_id), message_id: String(state.data.message_id) }
      : null;
    const plan = planMatchupsChannelWrite({ stored, channelId, currentWeek: week.currentWeek });
    const existingIds = await listMatchupsEmbedIds(channelId).catch((error) => {
      console.error("[ERROR] matchups channel: failed to list existing posts (non-fatal):", error);
      return [] as string[];
    });

    if (plan.action === "edit") {
      const keepId = chooseMatchupsKeepId({ existingIdsNewestFirst: existingIds, preferredId: plan.messageId }) ?? plan.messageId;
      const edited = await tryEditDiscordMessage(channelId, keepId, payload);
      const next = planAfterMatchupsEditAttempt(edited);
      if (next === "done") {
        await persistMatchupsChannelPost({ leagueId: context.leagueId, weekNumber: week.currentWeek, channelId, messageId: keepId });
        const extras = existingIds.filter((messageId) => messageId !== keepId);
        if (plan.messageId !== keepId) extras.push(plan.messageId);
        await deleteMatchupsMessages(channelId, extras);
        return;
      }
      if (next === "abort") return;
    } else if (plan.action === "move") {
      await deleteDiscordMessage(plan.deleteChannelId, plan.deleteMessageId).catch(() => undefined);
    } else if (plan.action === "replace" && !existingIds.includes(plan.deleteMessageId)) {
      await deleteDiscordMessage(plan.deleteChannelId, plan.deleteMessageId).catch(() => undefined);
    }

    // Week change, first post, channel move, or a 404 on the tracked message: delete every
    // leftover "Season N, Week M Matchups" embed, then post exactly one replacement.
    await deleteMatchupsMessages(channelId, existingIds);

    const posted = await postDiscordChannelMessage(channelId, payload).catch((error) => { console.error("[ERROR] matchups channel: failed to post (non-fatal):", error); return null; });
    if (posted?.id) {
      await persistMatchupsChannelPost({ leagueId: context.leagueId, weekNumber: week.currentWeek, channelId, messageId: posted.id });
      await sweepDuplicateMatchupsMessages(channelId, posted.id);
    }
  });
}

// Live-refresh entry point for scheduling mutations, which only have a gameId on hand.
export async function refreshMatchupsChannelForGame(gameId: string): Promise<void> {
  const game = await supabase.from("rec_games").select("league_id").eq("id", gameId).maybeSingle();
  if (!game.data?.league_id) return;
  const routes = await findServerRoutesForLeague(String(game.data.league_id)).catch(() => null);
  if (!routes?.guildId) return;
  await refreshMatchupsChannel(routes.guildId).catch((error) => console.error("[ERROR] Failed to refresh matchups channel (non-fatal):", error));
}
