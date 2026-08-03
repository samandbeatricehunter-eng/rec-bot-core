import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { postDiscordChannelMessage, deleteDiscordMessage, getDiscordPollResults, expireDiscordPoll } from "../../lib/discord-guild.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 24 * 30; // Discord's own poll duration cap is 32 days; 30 gives headroom.

type PollOption = { id: number; text: string };

function normalizeOptions(raw: string[]): string[] {
  const cleaned = raw.map((option) => option.trim()).filter(Boolean).map((option) => option.slice(0, 55));
  if (cleaned.length < MIN_OPTIONS) throw new ApiError(400, `A poll needs at least ${MIN_OPTIONS} options.`);
  if (cleaned.length > MAX_OPTIONS) throw new ApiError(400, `A poll can have at most ${MAX_OPTIONS} options.`);
  if (new Set(cleaned.map((option) => option.toLowerCase())).size !== cleaned.length) {
    throw new ApiError(400, "Poll options must be unique.");
  }
  return cleaned;
}

// Re-reads a still-open poll's live Discord tallies and, if Discord has finalized it (duration
// elapsed), flips our row to closed with the final counts. Best-effort: a Discord fetch failure
// just leaves the cached row as-is rather than failing the whole list/detail call.
async function refreshPollIfOpen(poll: any): Promise<any> {
  if (poll.status !== "open" || !poll.discord_channel_id || !poll.discord_message_id) return poll;
  const live = await getDiscordPollResults(poll.discord_channel_id, poll.discord_message_id).catch(() => null);
  if (!live) return poll;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { results: live, updated_at: now };
  if (live.isFinalized) {
    patch.status = "closed";
    patch.closed_at = now;
  }
  const updated = await supabase.from("rec_commissioner_polls").update(patch).eq("id", poll.id).select("*").single();
  return updated.error ? { ...poll, ...patch } : updated.data;
}

export async function createCommissionerPoll(input: { guildId: string; discordId: string; question: string; options: string[]; durationHours: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const question = input.question.trim().slice(0, 300);
  if (!question) throw new ApiError(400, "Enter a poll question.");
  const options = normalizeOptions(input.options);
  const durationHours = Math.min(MAX_DURATION_HOURS, Math.max(MIN_DURATION_HOURS, Math.round(input.durationHours)));

  const channelId = String((context.routes as any)?.voting_polls_channel_id ?? "");
  if (!channelId) throw new ApiError(400, "No voting polls channel is configured for this league — set one in Server Setup first.");

  const creator = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();

  const sent = await postDiscordChannelMessage(channelId, {
    content: "@everyone",
    poll: {
      question: { text: question },
      answers: options.map((text) => ({ poll_media: { text } })),
      duration: durationHours,
      allow_multiselect: false,
      layout_type: 1,
    },
    allowed_mentions: { parse: ["everyone"] },
  });
  if (!sent) throw new ApiError(502, "Discord rejected the poll post. Double-check the voting polls channel still exists.");

  const answers: PollOption[] = (sent.poll?.answers ?? []).map((a: any, index: number) => ({
    id: a.answer_id ?? index + 1,
    text: options[index] ?? String(a.poll_media?.text ?? ""),
  }));

  const now = new Date().toISOString();
  const id = randomUUID();
  const inserted = await supabase.from("rec_commissioner_polls").insert({
    id,
    league_id: context.leagueId,
    season_number: seasonNumber,
    question,
    options: answers.length ? answers : options.map((text, index) => ({ id: index + 1, text })),
    status: "open",
    discord_channel_id: channelId,
    discord_message_id: sent.id,
    created_by_user_id: creator.data?.user_id ?? null,
    closes_at: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
    created_at: now,
    updated_at: now,
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Poll was posted to Discord but failed to save.", inserted.error);
  return inserted.data;
}

export async function listCommissionerPolls(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const rows = await supabase
    .from("rec_commissioner_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(25);
  if (rows.error) throw new ApiError(500, "Failed to load polls.", rows.error);
  const refreshed = await Promise.all((rows.data ?? []).map((poll) => refreshPollIfOpen(poll)));
  return { polls: refreshed };
}

async function loadOwnedPoll(leagueId: string, pollId: string) {
  const poll = await supabase.from("rec_commissioner_polls").select("*").eq("id", pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "Failed to load poll.", poll.error);
  if (!poll.data || poll.data.league_id !== leagueId) throw new ApiError(404, "Poll not found.");
  return poll.data;
}

export async function closeCommissionerPoll(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await loadOwnedPoll(context.leagueId, input.pollId);
  if (poll.status !== "open") throw new ApiError(400, "Poll is already closed.");

  if (poll.discord_channel_id && poll.discord_message_id) {
    await expireDiscordPoll(poll.discord_channel_id, poll.discord_message_id).catch(() => undefined);
  }
  const live = poll.discord_channel_id && poll.discord_message_id
    ? await getDiscordPollResults(poll.discord_channel_id, poll.discord_message_id).catch(() => null)
    : null;

  const now = new Date().toISOString();
  const updated = await supabase
    .from("rec_commissioner_polls")
    .update({ status: "closed", results: live ?? poll.results, closed_at: now, updated_at: now })
    .eq("id", poll.id)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to close poll.", updated.error);
  return updated.data;
}

export async function cancelCommissionerPoll(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await loadOwnedPoll(context.leagueId, input.pollId);
  if (poll.status === "cancelled") return poll;

  if (poll.discord_channel_id && poll.discord_message_id) {
    await deleteDiscordMessage(poll.discord_channel_id, poll.discord_message_id).catch(() => undefined);
  }
  const now = new Date().toISOString();
  const updated = await supabase
    .from("rec_commissioner_polls")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", poll.id)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to cancel poll.", updated.error);
  return updated.data;
}
