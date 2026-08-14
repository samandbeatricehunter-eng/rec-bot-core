import { randomUUID } from "node:crypto";
import { gameplaySeasonStages } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage, getDiscordMessagePayload, deleteDiscordMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { buildRoundtableDiscussion } from "./roundtable.js";
import { formatInterviewBody } from "./interview-headlines.js";
import { loadHostOverridesForLeague } from "./roundtable-hosts.service.js";

// Mirrors an auto-generated headline/article to the guild's configured Headlines channel
// (Platinum Discord-bot add-on). Shared by every generated-story path in this file.
const EMBED_DESC_LIMIT = 4000;
const EMBED_MAX_PER_MESSAGE = 10;

/** Split a long body into chunks that fit within Discord's embed description limit,
 *  breaking at paragraph boundaries when possible. */
function splitBodyIntoChunks(body: string, maxLen = EMBED_DESC_LIMIT): string[] {
  if (body.length <= maxLen) return [body];
  const chunks: string[] = [];
  let remaining = body;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    // Find the last paragraph break before the limit
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut <= 0) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = remaining.lastIndexOf(". ", maxLen);
    if (cut <= 0) cut = maxLen;
    else cut += (remaining[cut] === "\n" ? 1 : 2); // skip past the delimiter
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}

export async function postGeneratedHeadlineToDiscord(input: { leagueId: string; storyId: string; headline: string; body: string; image_url?: string }): Promise<void> {
  try {
    const linked = await findServerRoutesForLeague(input.leagueId);
    const channelId = linked?.routes?.headlines_channel_id as string | null | undefined;
    if (!channelId) return;
    const chunks = splitBodyIntoChunks(input.body);
    const embeds = chunks.slice(0, EMBED_MAX_PER_MESSAGE).map((chunk, i) => {
      const embed: any = {
        title: i === 0 ? input.headline : `${input.headline} (${i + 1}/${chunks.length})`,
        color: 0xd9a521,
        description: chunk,
      };
      // Attach the image to the first embed only
      if (i === 0 && input.image_url) {
        embed.image = { url: input.image_url };
      }
      return embed;
    });
    const sent = await postDiscordChannelMessage(channelId, {
      content: "@everyone",
      embeds,
    });
    if (sent?.id) {
      await supabase.from("rec_game_stories").update({ posted_channel_id: channelId, posted_message_id: sent.id }).eq("id", input.storyId);
    }
  } catch (err) {
    console.error("[ERROR] Failed to post generated headline to Discord (non-fatal):", err);
  }
}

/** Retroactively attach an image to an existing headline embed by editing the Discord message. */
export async function attachImageToExistingHeadline(channelId: string, messageId: string, imageUrl: string): Promise<boolean> {
  try {
    const msg = await getDiscordMessagePayload(channelId, messageId);
    if (!msg?.embeds?.length) return false;
    const embeds = msg.embeds.map((e, i) => ({ ...e, ...(i === 0 ? { image: { url: imageUrl } } : {}) }));
    return editDiscordMessage(channelId, messageId, { embeds });
  } catch {
    return false;
  }
}

export type HeadlineBackfillResult = {
  scanned: number;
  imageAttached: number;
  reposted: number;
  skipped: number;
  failures: Array<{ storyId: string; reason: string }>;
};

/** Retroactively repair Discord-published headlines for a league:
 *  - stories with an image_url but no image on their posted embed get the image attached,
 *  - stories whose body was posted as a single (truncated) embed when it exceeded the
 *    embed limit get re-posted through the current splitting/image-aware path,
 *  - the superseded message is deleted when a story is re-posted.
 *  Only touches rows with a posted_message_id; old messages that no longer exist are skipped. */
export async function backfillDiscordHeadlines(guildId: string): Promise<HeadlineBackfillResult> {
  const result: HeadlineBackfillResult = { scanned: 0, imageAttached: 0, reposted: 0, skipped: 0, failures: [] };
  const context = await getCurrentLeagueContext(guildId);
  const linked = await findServerRoutesForLeague(context.leagueId);
  const fallbackChannelId = linked?.routes?.headlines_channel_id as string | null | undefined;
  const rows = await supabase.from("rec_game_stories")
    .select("id,headline,body,image_url,posted_channel_id,posted_message_id")
    .eq("league_id", context.leagueId)
    .not("posted_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (rows.error) throw new ApiError(500, "We couldn't load posted headlines right now. Please try again.", rows.error);
  for (const story of rows.data ?? []) {
    result.scanned += 1;
    const channelId = (story.posted_channel_id as string | null) ?? fallbackChannelId;
    const messageId = story.posted_message_id as string | null;
    if (!channelId || !messageId) { result.skipped += 1; continue; }
    let msg: Awaited<ReturnType<typeof getDiscordMessagePayload>>;
    try { msg = await getDiscordMessagePayload(channelId, messageId); } catch { msg = null; }
    if (!msg?.embeds?.length) {
      result.failures.push({ storyId: story.id, reason: "no embeds on posted message" });
      continue;
    }
    const body = (story.body as string | null) ?? "";
    const chunkCount = splitBodyIntoChunks(body).length;
    const embedCount = msg.embeds.length;
    const imageUrl = (story.image_url as string | null) ?? undefined;
    const needsRepost = chunkCount > 1 && embedCount < chunkCount;
    if (needsRepost) {
      await postGeneratedHeadlineToDiscord({ leagueId: context.leagueId, storyId: story.id, headline: story.headline as string, body, image_url: imageUrl });
      const check = await supabase.from("rec_game_stories").select("posted_message_id").eq("id", story.id).maybeSingle();
      const newMessageId = (check.data?.posted_message_id as string | null) ?? null;
      if (newMessageId && newMessageId !== messageId) {
        try { await deleteDiscordMessage(channelId, messageId); } catch { /* superseded message already gone */ }
        result.reposted += 1;
      } else {
        result.failures.push({ storyId: story.id, reason: "re-post did not produce a new message id" });
      }
      continue;
    }
    const embedHasImage = Boolean(msg.embeds[0]?.image);
    if (imageUrl && !embedHasImage) {
      const ok = await attachImageToExistingHeadline(channelId, messageId, imageUrl);
      if (ok) result.imageAttached += 1;
      else result.failures.push({ storyId: story.id, reason: "image attach failed" });
      continue;
    }
    result.skipped += 1;
  }
  return result;
}

// Shared by Recruiting and Transfer Portal — both need to drop a non-game-attached
// headline/article into the same rec_game_stories feed the Hub already reads, using the
// same shape publishHubStory() already uses for commissioner-authored stories
// (game_id: null). Kept here (not in a "recruiting" or "transfer-portal" module) so neither
// feature module has to duplicate the other's story-insert logic.
export async function publishTransitionStory(input: {
  guildId: string;
  headline: string;
  body: string;
  primaryAngle: string;
  storyType?: "headline" | "article";
}): Promise<{ storyId: string }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const season = Number(context.rec_leagues.season_number ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? "");
  // A "week" only means anything during a real gameplay stage — during offseason stages
  // (end of season recap, transfer portal, signing day, etc.) current_week is stale leftover
  // state from the last real week, so stamping it here mislabels these stories as "Week N".
  const isGameplayStage = gameplaySeasonStages(context.rec_leagues.game).has(seasonStage);
  const week = isGameplayStage ? Number(context.rec_leagues.current_week ?? 1) : null;
  const storyType = input.storyType ?? "headline";
  const hostOverrides = storyType === "article" ? await loadHostOverridesForLeague(context.leagueId) : undefined;
  const roundtable = storyType === "article" ? buildRoundtableDiscussion({ headline: input.headline, body: input.body, hostOverrides }) : null;
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(), league_id: context.leagueId, season, week, season_stage: isGameplayStage ? null : seasonStage, game_id: null,
    primary_angle: input.primaryAngle, headline: input.headline, body: input.body,
    notes: [], story_type: storyType, roundtable,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error) throw new ApiError(500, "We couldn't publish that story. Please try again.", result.error);
  await postGeneratedHeadlineToDiscord({ leagueId: context.leagueId, storyId: result.data.id, headline: input.headline, body: input.body });
  return { storyId: result.data.id };
}

async function publishMediaSubmissionStory(submission: any, discordId: string | null) {
  const interviewAnswers = (submission.interview_answers ?? []) as Array<{ question: string; answer: string }>;
  const body =
    submission.submission_type === "interview" && interviewAnswers.length
      ? formatInterviewBody(interviewAnswers)
      : submission.body;
  const roundtable = null;
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(),
    league_id: submission.league_id,
    season: submission.season_number,
    week: submission.week_number,
    game_id: submission.game_id ?? null,
    primary_angle: submission.submission_type,
    headline: submission.title,
    body,
    notes: [],
    story_type: "article",
    roundtable,
    image_url: submission.image_url ?? null,
    media_kind: submission.submission_type,
    author_user_id: submission.submitter_user_id ?? null,
    author_discord_id: submission.submitter_discord_id ?? discordId,
    source_submission_id: submission.id,
    published_by_discord_id: discordId,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error) throw new ApiError(500, "We couldn't publish that scheduled media story. Please try again.", result.error);
  await postGeneratedHeadlineToDiscord({ leagueId: submission.league_id, storyId: result.data.id, headline: submission.title, body, image_url: submission.image_url ?? undefined });
  return result.data.id as string;
}

export async function publishScheduledMediaForAdvance(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_media_submissions").select("*").eq("league_id", context.leagueId).eq("submission_type", "commissioner_article").eq("status", "scheduled");
  if (rows.error) throw new ApiError(500, "We couldn't load scheduled media right now. Please try again.", rows.error);
  const storyIds: string[] = [];
  for (const row of rows.data ?? []) {
    const storyId = await publishMediaSubmissionStory(row, row.submitter_discord_id ?? null);
    const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updated.error) throw new ApiError(500, "We couldn't mark that scheduled media as published. Please try again.", updated.error);
    storyIds.push(storyId);
  }
  return { publishedCount: storyIds.length, storyIds };
}
