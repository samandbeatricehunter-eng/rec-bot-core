import { randomUUID } from "node:crypto";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { postDiscordChannelMessage, deleteDiscordMessage } from "../../lib/discord-guild.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 24 * 30;

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

async function tallyFor(pollId: string, options: PollOption[]) {
  const votes = await supabase.from("rec_commissioner_poll_votes").select("option_id,voter_discord_id").eq("poll_id", pollId);
  if (votes.error) throw new ApiError(500, "Failed to load poll votes.", votes.error);
  const rows = votes.data ?? [];
  const tally = options.map((opt) => ({ ...opt, votes: rows.filter((v) => v.option_id === opt.id).length }));
  return { tally, totalVotes: rows.length, voterRows: rows };
}

// Site is canonical: this only flips a still-open poll to closed once its time limit has
// passed (no cron job — same lazy-on-read pattern used elsewhere in this app), it never reads
// Discord vote state as a source of truth.
async function closeIfExpired(poll: any): Promise<any> {
  if (poll.status !== "open" || !poll.closes_at || new Date(poll.closes_at).getTime() > Date.now()) return poll;
  const now = new Date().toISOString();
  const updated = await supabase.from("rec_commissioner_polls").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", poll.id).eq("status", "open").select("*").maybeSingle();
  return updated.data ?? poll;
}

export async function createCommissionerPoll(input: { guildId: string; discordId: string; question: string; options: string[]; durationHours: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const question = input.question.trim().slice(0, 300);
  if (!question) throw new ApiError(400, "Enter a poll question.");
  const options = normalizeOptions(input.options);
  const durationHours = Math.min(MAX_DURATION_HOURS, Math.max(MIN_DURATION_HOURS, Math.round(input.durationHours)));
  const optionRows: PollOption[] = options.map((text, index) => ({ id: index + 1, text }));

  const creator = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();

  const now = new Date().toISOString();
  const id = randomUUID();
  const inserted = await supabase.from("rec_commissioner_polls").insert({
    id,
    league_id: context.leagueId,
    season_number: seasonNumber,
    question,
    options: optionRows,
    status: "open",
    created_by_user_id: creator.data?.user_id ?? null,
    closes_at: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
    created_at: now,
    updated_at: now,
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Failed to create poll.", inserted.error);

  // Discord is an optional mirror, not the vote surface — post an informational (non-
  // interactive) embed if a channel is configured; skip silently if not, since the poll is
  // already fully usable from the site with no Discord link required.
  const channelId = String((context.routes as any)?.voting_polls_channel_id ?? "");
  if (channelId) {
    void postDiscordChannelMessage(channelId, {
      content: "@everyone",
      embeds: [{
        title: "New Commissioner Poll",
        color: 0xd9a521,
        description: `**${question}**\n\n${options.map((o) => `• ${o}`).join("\n")}\n\nVote on the site — open the Media page.`,
      }],
      allowed_mentions: { parse: ["everyone"] },
    }).then((sent) => {
      if (sent?.id) void supabase.from("rec_commissioner_polls").update({ discord_channel_id: channelId, discord_message_id: sent.id }).eq("id", id);
    }).catch((err) => console.error("[ERROR] Failed to post poll to Discord (non-fatal):", err));
  }

  return { ...inserted.data, tally: optionRows.map((o) => ({ ...o, votes: 0 })), totalVotes: 0, myVoteOptionId: null };
}

export async function listCommissionerPolls(input: { guildId: string; discordId?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const rows = await supabase
    .from("rec_commissioner_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(25);
  if (rows.error) throw new ApiError(500, "Failed to load polls.", rows.error);
  const closed = await Promise.all((rows.data ?? []).map((poll) => closeIfExpired(poll)));
  const polls = await Promise.all(closed.map(async (poll) => {
    const options = Array.isArray(poll.options) ? (poll.options as PollOption[]) : [];
    const { tally, totalVotes, voterRows } = await tallyFor(poll.id, options);
    const myVote = input.discordId ? voterRows.find((v) => v.voter_discord_id === input.discordId) : undefined;
    return { ...poll, tally, totalVotes, hasVoted: Boolean(myVote), myVoteOptionId: myVote?.option_id ?? null };
  }));
  return { polls };
}

async function loadOwnedPoll(leagueId: string, pollId: string) {
  const poll = await supabase.from("rec_commissioner_polls").select("*").eq("id", pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "Failed to load poll.", poll.error);
  if (!poll.data || poll.data.league_id !== leagueId) throw new ApiError(404, "Poll not found.");
  return poll.data;
}

export async function voteOnCommissionerPoll(input: { guildId: string; discordId: string; pollId: string; optionId: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await loadOwnedPoll(context.leagueId, input.pollId);
  const resolved = await closeIfExpired(poll);
  if (resolved.status !== "open") throw new ApiError(400, "Voting is closed for this poll.");
  const options = Array.isArray(resolved.options) ? (resolved.options as PollOption[]) : [];
  if (!options.some((o) => o.id === input.optionId)) throw new ApiError(400, "Invalid option.");

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const { error } = await supabase.from("rec_commissioner_poll_votes").upsert(
    { poll_id: input.pollId, voter_user_id: account.data?.user_id ?? null, voter_discord_id: input.discordId, option_id: input.optionId, updated_at: new Date().toISOString() },
    { onConflict: "poll_id,voter_discord_id" },
  );
  if (error) throw new ApiError(500, "Failed to record vote.", error);
  return { ok: true as const };
}

export async function closeCommissionerPoll(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await loadOwnedPoll(context.leagueId, input.pollId);
  if (poll.status !== "open") throw new ApiError(400, "Poll is already closed.");

  const now = new Date().toISOString();
  const updated = await supabase.from("rec_commissioner_polls").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", poll.id).select("*").single();
  if (updated.error) throw new ApiError(500, "Failed to close poll.", updated.error);

  if (poll.discord_channel_id && poll.discord_message_id) {
    const options = Array.isArray(poll.options) ? (poll.options as PollOption[]) : [];
    const { tally, totalVotes } = await tallyFor(poll.id, options);
    void postDiscordChannelMessage(poll.discord_channel_id, {
      embeds: [{
        title: "Poll Closed",
        color: 0x2fb86a,
        description: `**${poll.question}**\n\n${tally.map((t) => `${t.text}: ${t.votes}`).join("\n")}\n\n${totalVotes} total vote${totalVotes === 1 ? "" : "s"}.`,
      }],
    }).catch((err) => console.error("[ERROR] Failed to post poll results to Discord (non-fatal):", err));
  }
  return updated.data;
}

export async function cancelCommissionerPoll(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await loadOwnedPoll(context.leagueId, input.pollId);
  if (poll.status === "cancelled") return poll;

  if (poll.discord_channel_id && poll.discord_message_id) {
    await bestEffort("discord.delete_poll_message", () => deleteDiscordMessage(poll.discord_channel_id, poll.discord_message_id), { leagueId: context.leagueId, guildId: input.guildId, entityId: input.pollId });
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
