import { randomUUID } from "node:crypto";
import { gameplaySeasonStages } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { buildRoundtableDiscussion } from "./roundtable.js";
import { formatInterviewBody } from "./interview-headlines.js";
import { loadHostOverridesForLeague } from "./roundtable-hosts.service.js";

// Mirrors an auto-generated headline/article to the guild's configured Headlines channel
// (Platinum Discord-bot add-on). Shared by every generated-story path in this file.
async function postGeneratedHeadlineToDiscord(input: { leagueId: string; storyId: string; headline: string; body: string }): Promise<void> {
  try {
    const linked = await findServerRoutesForLeague(input.leagueId);
    const channelId = linked?.routes?.headlines_channel_id as string | null | undefined;
    if (!channelId) return;
    const sent = await postDiscordChannelMessage(channelId, {
      embeds: [{ title: input.headline, color: 0xd9a521, description: input.body.slice(0, 4096) }],
    });
    if (sent?.id) {
      await supabase.from("rec_game_stories").update({ posted_channel_id: channelId, posted_message_id: sent.id }).eq("id", input.storyId);
    }
  } catch (err) {
    console.error("[ERROR] Failed to post generated headline to Discord (non-fatal):", err);
  }
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
  const hostOverrides = await loadHostOverridesForLeague(submission.league_id);
  const roundtable =
    submission.submission_type === "interview"
      ? buildRoundtableDiscussion({
          headline: submission.title,
          body,
          notes: interviewAnswers.map((a) => a.answer),
          hostOverrides,
        })
      : buildRoundtableDiscussion({ headline: submission.title, body: submission.body, hostOverrides });
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
