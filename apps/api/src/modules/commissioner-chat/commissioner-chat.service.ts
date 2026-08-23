import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getGuildMemberDisplayNameMap, getMentionableCommissioners, sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";

const MESSAGE_PAGE_SIZE = 200;
const MESSAGE_RETENTION_HOURS = 72;

async function resolveUserId(discordId: string): Promise<string | null> {
  const { data, error } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load your Discord account. Please try again.", error);
  return data?.user_id ?? null;
}

/** A rec-leagues username is canonical once set — only unlinked/username-less accounts fall back to the live Discord nickname/username lookup. */
async function resolveUsernamesByDiscordId(discordIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(discordIds)];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("discord_id,user:rec_users(username)")
    .in("discord_id", ids);
  if (error) throw new ApiError(500, "We couldn't load chat author names. Please try again.", error);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as any[]) {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    if (user?.username) map.set(row.discord_id, user.username);
  }
  return map;
}

// No scheduled job in this codebase for chat-specific cleanup — piggyback a lazy purge of
// anything past the retention window onto the read path, which already runs on every 5s
// poll. Fire-and-forget: a failed purge just means cleanup happens on the next read instead.
function purgeOldMessages(guildId: string): void {
  const cutoffIso = new Date(Date.now() - MESSAGE_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  supabase
    .from("rec_commissioner_chat_messages")
    .delete()
    .eq("guild_id", guildId)
    .lt("created_at", cutoffIso)
    .then(({ error }) => {
      if (error) console.error("[ERROR] purgeOldMessages failed (non-fatal):", error);
    });
}

export async function listChatMessages(guildId: string, sinceIso?: string | null) {
  purgeOldMessages(guildId);
  let query = supabase
    .from("rec_commissioner_chat_messages")
    .select("id,author_discord_id,body,created_at,edited_at,reply_to_message_id")
    .eq("guild_id", guildId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (sinceIso) query = query.gt("created_at", sinceIso);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "We couldn't load commissioner chat messages. Please try again.", error);

  // A rec-leagues username wins when set; otherwise fall back to the live Discord
  // nickname/username — rec_users.display_name can't be relied on here (it's sometimes
  // just a placeholder copy of the Discord ID from account auto-provisioning).
  const authorDiscordIds = [...new Set((data ?? []).map((row) => row.author_discord_id))] as string[];
  const [usernames, liveNames] = await Promise.all([
    resolveUsernamesByDiscordId(authorDiscordIds),
    getGuildMemberDisplayNameMap(guildId).catch(() => new Map<string, string>()),
  ]);
  const messages = (data ?? []).reverse().map((row) => ({
    ...row,
    author_display_name: usernames.get(row.author_discord_id) ?? liveNames.get(row.author_discord_id) ?? null,
  }));
  return { messages };
}

export async function editChatMessage(input: { guildId: string; discordId: string; messageId: string; body: string }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const { data, error } = await supabase
    .from("rec_commissioner_chat_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("guild_id", input.guildId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id,author_discord_id,body,created_at,edited_at")
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't edit that message. Please try again.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  const message = { ...data, author_display_name: null };
  broadcastChatEvent("commissioner", input.guildId, { kind: "edit", row: message });
  return { message };
}

export async function deleteChatMessage(input: { guildId: string; discordId: string; messageId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioner_chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("guild_id", input.guildId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't delete that message. Please try again.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  broadcastChatEvent("commissioner", input.guildId, { kind: "delete", messageId: data.id });
  return { ok: true as const };
}

export async function postChatMessage(input: { guildId: string; discordId: string; body: string; replyToMessageId?: string | null }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await resolveUserId(input.discordId);
  const { data, error } = await supabase
    .from("rec_commissioner_chat_messages")
    .insert({
      guild_id: input.guildId,
      league_id: context.leagueId,
      author_user_id: userId,
      author_discord_id: input.discordId,
      body: trimmed,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select("id,author_discord_id,body,created_at,reply_to_message_id")
    .single();
  if (error) throw new ApiError(500, "We couldn't post that message. Please try again.", error);
  const [usernames, liveNames] = await Promise.all([
    resolveUsernamesByDiscordId([input.discordId]),
    getGuildMemberDisplayNameMap(input.guildId).catch(() => new Map<string, string>()),
  ]);
  const authorDisplayName = usernames.get(input.discordId) ?? liveNames.get(input.discordId) ?? null;
  const directMentions = [...trimmed.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
  const roleMentioned = /<@&(\d+)>/.test(trimmed);
  void (async () => {
    const recipients = new Set(directMentions);
    if (roleMentioned) {
      const mentionable = await getMentionableCommissioners(input.guildId);
      for (const member of mentionable.members) recipients.add(member.discordId);
    }
    recipients.delete(input.discordId);
    if (!recipients.size) return;
    const author = authorDisplayName ?? "A commissioner";
    const message = `**${author}** mentioned you in commissioner chat:\n\n${trimmed.slice(0, 1200)}\n\nOpen the league on the REC site and use the chat drawer (Commissioner Chat) to reply.`;
    await Promise.allSettled([...recipients].map((discordId) => sendDiscordDirectMessage(discordId, message)));
  })().catch((notifyError) => console.error("[ERROR] Failed to send commissioner-chat mention DMs (non-fatal):", notifyError));
  const sentMessage = { ...data, author_display_name: authorDisplayName };
  broadcastChatEvent("commissioner", input.guildId, { kind: "message", row: sentMessage });
  return { message: sentMessage };
}

// No cron job flips a topic to "closed" when its time limit runs out — piggyback on the next
// list read instead (same lazy pattern as purgeOldMessages above), flipping status in the DB
// and posting the result to commissioner chat so the league hears about it even if nobody
// happens to reopen that specific poll card. Fire-and-forget: doesn't delay the read.
function closeAndAnnounceExpiredTopics(guildId: string, topics: Array<{ id: string; guild_id?: string; title: string; options: unknown; status: string; closes_at: string | null }>): void {
  const expired = topics.filter((t) => t.status === "open" && t.closes_at && new Date(t.closes_at).getTime() <= Date.now());
  if (!expired.length) return;
  void (async () => {
    for (const topic of expired) {
      const updated = await supabase.from("rec_commissioner_chat_topics").update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("id", topic.id).eq("status", "open").select("id").maybeSingle();
      if (updated.error || !updated.data) continue; // already closed by a concurrent read
      await announceTopicResult({ id: topic.id, guild_id: guildId, title: topic.title, options: topic.options });
    }
  })().catch((err) => console.error("[ERROR] Failed to auto-close expired poll(s) (non-fatal):", err));
}

export async function listChatTopics(guildId: string) {
  const { data: topics, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .select("id,title,description,options,status,closes_at,created_by_discord_id,created_at,audience")
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ApiError(500, "We couldn't load voting topics. Please try again.", error);
  closeAndAnnounceExpiredTopics(guildId, topics ?? []);

  const topicIds = (topics ?? []).map((t) => t.id);
  const votes = topicIds.length
    ? await supabase.from("rec_commissioner_chat_topic_votes").select("topic_id,voter_discord_id,option_index").in("topic_id", topicIds)
    : { data: [], error: null };
  if (votes.error) throw new ApiError(500, "We couldn't load votes. Please try again.", votes.error);

  const votesByTopic = new Map<string, { voterDiscordId: string; optionIndex: number }[]>();
  for (const row of votes.data ?? []) {
    const list = votesByTopic.get(row.topic_id) ?? [];
    list.push({ voterDiscordId: row.voter_discord_id, optionIndex: row.option_index });
    votesByTopic.set(row.topic_id, list);
  }

  return {
    topics: (topics ?? []).map((t) => {
      const topicVotes = votesByTopic.get(t.id) ?? [];
      const options = Array.isArray(t.options) ? (t.options as string[]) : [];
      const tally = options.map((_, index) => topicVotes.filter((v) => v.optionIndex === index).length);
      // Same "no cron job flips status" nuance as voteOnChatTopic — reflect an expired time
      // limit in the list view too, so the UI can disable voting without waiting for a
      // failed vote attempt to find out.
      const isExpired = Boolean(t.closes_at && new Date(t.closes_at).getTime() <= Date.now());
      const status = isExpired && t.status === "open" ? "closed" : t.status;
      return { ...t, status, options, tally, totalVotes: topicVotes.length, voters: topicVotes };
    }),
  };
}

export async function createChatTopic(input: {
  guildId: string;
  discordId: string;
  title: string;
  description?: string | null;
  options: string[];
  closesAt?: string | null;
  /** "commissioners" (default, staff-only — unchanged behavior for every existing caller) or
   * "league" (open to every league member — see listPublicPolls/voteOnPublicPoll below). */
  audience?: "commissioners" | "league";
}) {
  const title = input.title.trim();
  if (!title) throw new ApiError(400, "Topic title can't be empty.");
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) throw new ApiError(400, "A voting topic needs at least 2 options.");
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await resolveUserId(input.discordId);
  const { data, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .insert({
      guild_id: input.guildId,
      league_id: context.leagueId,
      created_by_user_id: userId,
      created_by_discord_id: input.discordId,
      title,
      description: input.description?.trim() || null,
      options,
      closes_at: input.closesAt ?? null,
      audience: input.audience ?? "commissioners",
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "We couldn't create that voting topic. Please try again.", error);
  // Commissioner-only polls need a push, unlike public polls (which surface passively on
  // Campus Buzz for anyone browsing) — a co-commissioner has no other reason to know a vote
  // is waiting on them.
  if ((input.audience ?? "commissioners") === "commissioners") {
    void (async () => {
      const mentionable = await getMentionableCommissioners(input.guildId);
      const recipients = mentionable.members.map((m) => m.discordId).filter((id) => id !== input.discordId);
      if (!recipients.length) return;
      const message = `A new commissioner poll needs your vote: **${title}**\n\nOpen League Management to vote — pending commissioner polls appear at the top of the command center.`;
      await Promise.allSettled(recipients.map((discordId) => sendDiscordDirectMessage(discordId, message)));
    })().catch((err) => console.error("[ERROR] Failed to notify commissioners of new poll (non-fatal):", err));
  }
  return { topic: data };
}

// Fired once a topic actually closes (manual close, or lazily discovered past its closes_at
// on the next list read — see listChatTopics/listPublicPolls) so the league always hears the
// result somewhere, not just from whoever happens to reopen the poll card. Posted as a plain
// system message (no author_discord_id) rather than routed through postChatMessage, since
// this isn't attributable to any one commissioner and shouldn't trigger @mention DMs.
async function announceTopicResult(topic: { id: string; guild_id: string; title: string; options: unknown }) {
  const votes = await supabase.from("rec_commissioner_chat_topic_votes").select("option_index").eq("topic_id", topic.id);
  if (votes.error) { console.error("[ERROR] Failed to load votes for topic result announcement:", votes.error); return; }
  const options = Array.isArray(topic.options) ? (topic.options as string[]) : [];
  const tally = options.map((_, index) => (votes.data ?? []).filter((v) => v.option_index === index).length);
  const totalVotes = tally.reduce((sum, n) => sum + n, 0);
  let body: string;
  if (!totalVotes) {
    body = `📊 **Poll closed — no votes cast:** ${topic.title}`;
  } else {
    const maxVotes = Math.max(...tally);
    const winners = options.filter((_, i) => tally[i] === maxVotes);
    const winnerLine = winners.length > 1 ? `Tied: ${winners.join(", ")}` : `Winner: **${winners[0]}**`;
    const breakdown = options.map((opt, i) => `${opt}: ${tally[i]}`).join(" · ");
    body = `📊 **Poll closed:** ${topic.title}\n${winnerLine} (${totalVotes} vote${totalVotes === 1 ? "" : "s"})\n${breakdown}`;
  }
  const posted = await supabase.from("rec_commissioner_chat_messages").insert({
    guild_id: topic.guild_id, author_user_id: null, author_discord_id: "rec-bot", body,
  }).select("id,body,created_at").maybeSingle();
  if (posted.error) { console.error("[ERROR] Failed to post poll result to commissioner chat:", posted.error); return; }
  if (posted.data) broadcastChatEvent("commissioner", topic.guild_id, { kind: "message", row: { ...posted.data, author_discord_id: "rec-bot", author_display_name: "REC Bot" } });
}

// League-wide (audience:"league") polls — same table/tally mechanics as the staff-only topics
// above, but listable/votable by any league member, not just co-commissioners. Kept as separate
// functions (rather than loosening listChatTopics/voteOnChatTopic's own permission gate) so the
// existing staff-only routes and their co_commissioner authorization are untouched.
export async function listPublicPolls(guildId: string, discordId: string) {
  const { data: topics, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .select("id,title,description,options,status,closes_at,created_by_discord_id,created_at")
    .eq("guild_id", guildId)
    .eq("audience", "league")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ApiError(500, "We couldn't load polls. Please try again.", error);
  closeAndAnnounceExpiredTopics(guildId, topics ?? []);

  const topicIds = (topics ?? []).map((t) => t.id);
  const votes = topicIds.length
    ? await supabase.from("rec_commissioner_chat_topic_votes").select("topic_id,voter_discord_id,option_index").in("topic_id", topicIds)
    : { data: [], error: null };
  if (votes.error) throw new ApiError(500, "We couldn't load votes. Please try again.", votes.error);

  const votesByTopic = new Map<string, { voterDiscordId: string; optionIndex: number }[]>();
  for (const row of votes.data ?? []) {
    const list = votesByTopic.get(row.topic_id) ?? [];
    list.push({ voterDiscordId: row.voter_discord_id, optionIndex: row.option_index });
    votesByTopic.set(row.topic_id, list);
  }

  return {
    polls: (topics ?? []).map((t) => {
      const topicVotes = votesByTopic.get(t.id) ?? [];
      const options = Array.isArray(t.options) ? (t.options as string[]) : [];
      const tally = options.map((_, index) => topicVotes.filter((v) => v.optionIndex === index).length);
      const isExpired = Boolean(t.closes_at && new Date(t.closes_at).getTime() <= Date.now());
      const status = isExpired && t.status === "open" ? "closed" : t.status;
      const myVoteOptionIndex = topicVotes.find((v) => v.voterDiscordId === discordId)?.optionIndex ?? null;
      return { ...t, status, options, tally, totalVotes: topicVotes.length, myVoteOptionIndex };
    }),
  };
}

export async function voteOnPublicPoll(input: { guildId: string; discordId: string; topicId: string; optionIndex: number }) {
  const topic = await supabase.from("rec_commissioner_chat_topics").select("id,guild_id,audience,options,status,closes_at").eq("id", input.topicId).maybeSingle();
  if (topic.error) throw new ApiError(500, "We couldn't load that poll. Please try again.", topic.error);
  if (!topic.data || topic.data.guild_id !== input.guildId) throw new ApiError(404, "Poll not found.");
  if (topic.data.audience !== "league") throw new ApiError(403, "This poll isn't open to the whole league.");
  if (topic.data.status !== "open") throw new ApiError(400, "Voting is closed for this poll.");
  if (topic.data.closes_at && new Date(topic.data.closes_at).getTime() <= Date.now()) throw new ApiError(400, "Voting has closed for this poll.");
  const options = Array.isArray(topic.data.options) ? (topic.data.options as string[]) : [];
  if (input.optionIndex < 0 || input.optionIndex >= options.length) throw new ApiError(400, "Invalid option.");

  const userId = await resolveUserId(input.discordId);
  const { error } = await supabase
    .from("rec_commissioner_chat_topic_votes")
    .upsert(
      { topic_id: input.topicId, voter_user_id: userId, voter_discord_id: input.discordId, option_index: input.optionIndex, updated_at: new Date().toISOString() },
      { onConflict: "topic_id,voter_discord_id" },
    );
  if (error) throw new ApiError(500, "We couldn't record your vote. Please try again.", error);
  return { ok: true };
}

export async function voteOnChatTopic(input: { guildId: string; discordId: string; topicId: string; optionIndex: number }) {
  const topic = await supabase.from("rec_commissioner_chat_topics").select("id,options,status,closes_at").eq("id", input.topicId).maybeSingle();
  if (topic.error) throw new ApiError(500, "We couldn't load that topic. Please try again.", topic.error);
  if (!topic.data) throw new ApiError(404, "Topic not found.");
  if (topic.data.status !== "open") throw new ApiError(400, "Voting is closed for this topic.");
  // Nothing flips status to "closed" automatically when a time limit runs out (no cron job
  // for this) — check the timestamp directly at vote-time instead.
  if (topic.data.closes_at && new Date(topic.data.closes_at).getTime() <= Date.now()) {
    throw new ApiError(400, "Voting has closed for this topic.");
  }
  const options = Array.isArray(topic.data.options) ? (topic.data.options as string[]) : [];
  if (input.optionIndex < 0 || input.optionIndex >= options.length) throw new ApiError(400, "Invalid option.");

  const userId = await resolveUserId(input.discordId);
  const { error } = await supabase
    .from("rec_commissioner_chat_topic_votes")
    .upsert(
      { topic_id: input.topicId, voter_user_id: userId, voter_discord_id: input.discordId, option_index: input.optionIndex, updated_at: new Date().toISOString() },
      { onConflict: "topic_id,voter_discord_id" },
    );
  if (error) throw new ApiError(500, "We couldn't record your vote. Please try again.", error);
  return { ok: true };
}

export async function closeChatTopic(input: { guildId: string; topicId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", input.topicId)
    .eq("guild_id", input.guildId)
    .eq("status", "open")
    .select("id,title,options")
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't close that topic. Please try again.", error);
  if (!data) throw new ApiError(404, "Topic not found, or already closed.");
  await announceTopicResult({ id: data.id, guild_id: input.guildId, title: data.title, options: data.options });
  return { ok: true };
}
