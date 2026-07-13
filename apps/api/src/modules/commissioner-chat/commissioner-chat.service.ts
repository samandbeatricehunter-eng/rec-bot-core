import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const MESSAGE_PAGE_SIZE = 200;

async function resolveUserId(discordId: string): Promise<string | null> {
  const { data, error } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load Discord account.", error);
  return data?.user_id ?? null;
}

export async function listChatMessages(guildId: string, sinceIso?: string | null) {
  let query = supabase
    .from("rec_commissioner_chat_messages")
    .select("id,author_discord_id,body,created_at")
    .eq("guild_id", guildId)
    .order("created_at", { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);
  if (sinceIso) query = query.gt("created_at", sinceIso);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load commissioner chat messages.", error);
  return { messages: data ?? [] };
}

export async function postChatMessage(input: { guildId: string; discordId: string; body: string }) {
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
    })
    .select("id,author_discord_id,body,created_at")
    .single();
  if (error) throw new ApiError(500, "Failed to post message.", error);
  return { message: data };
}

export async function listChatTopics(guildId: string) {
  const { data: topics, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .select("id,title,description,options,status,closes_at,created_by_discord_id,created_at")
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ApiError(500, "Failed to load voting topics.", error);

  const topicIds = (topics ?? []).map((t) => t.id);
  const votes = topicIds.length
    ? await supabase.from("rec_commissioner_chat_topic_votes").select("topic_id,voter_discord_id,option_index").in("topic_id", topicIds)
    : { data: [], error: null };
  if (votes.error) throw new ApiError(500, "Failed to load votes.", votes.error);

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
      return { ...t, options, tally, totalVotes: topicVotes.length, voters: topicVotes };
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
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to create voting topic.", error);
  return { topic: data };
}

export async function voteOnChatTopic(input: { guildId: string; discordId: string; topicId: string; optionIndex: number }) {
  const topic = await supabase.from("rec_commissioner_chat_topics").select("id,options,status").eq("id", input.topicId).maybeSingle();
  if (topic.error) throw new ApiError(500, "Failed to load topic.", topic.error);
  if (!topic.data) throw new ApiError(404, "Topic not found.");
  if (topic.data.status !== "open") throw new ApiError(400, "Voting is closed for this topic.");
  const options = Array.isArray(topic.data.options) ? (topic.data.options as string[]) : [];
  if (input.optionIndex < 0 || input.optionIndex >= options.length) throw new ApiError(400, "Invalid option.");

  const userId = await resolveUserId(input.discordId);
  const { error } = await supabase
    .from("rec_commissioner_chat_topic_votes")
    .upsert(
      { topic_id: input.topicId, voter_user_id: userId, voter_discord_id: input.discordId, option_index: input.optionIndex, updated_at: new Date().toISOString() },
      { onConflict: "topic_id,voter_discord_id" },
    );
  if (error) throw new ApiError(500, "Failed to record vote.", error);
  return { ok: true };
}

export async function closeChatTopic(input: { guildId: string; topicId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioner_chat_topics")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", input.topicId)
    .eq("guild_id", input.guildId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to close topic.", error);
  if (!data) throw new ApiError(404, "Topic not found.");
  return { ok: true };
}
