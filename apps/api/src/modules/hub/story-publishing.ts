import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { buildRoundtableDiscussion } from "./roundtable.js";

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
  const week = Number(context.rec_leagues.current_week ?? 1);
  const storyType = input.storyType ?? "headline";
  const roundtable = storyType === "article" ? buildRoundtableDiscussion({ headline: input.headline, body: input.body }) : null;
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(), league_id: context.leagueId, season, week, game_id: null,
    primary_angle: input.primaryAngle, headline: input.headline, body: input.body,
    notes: [], story_type: storyType, roundtable,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error) throw new ApiError(500, "Failed to publish the story.", result.error);
  return { storyId: result.data.id };
}

async function publishMediaSubmissionStory(submission: any, discordId: string | null) {
  const roundtable = submission.submission_type === "interview"
    ? (submission.interview_answers ?? []).map((answer: any) => ({ speaker: "Coach", role: answer.question, take: answer.answer }))
    : buildRoundtableDiscussion({ headline: submission.title, body: submission.body });
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(),
    league_id: submission.league_id,
    season: submission.season_number,
    week: submission.week_number,
    game_id: submission.game_id ?? null,
    primary_angle: submission.submission_type,
    headline: submission.title,
    body: submission.body,
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
  if (result.error) throw new ApiError(500, "Failed to publish scheduled media story.", result.error);
  return result.data.id as string;
}

export async function publishScheduledMediaForAdvance(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_media_submissions").select("*").eq("league_id", context.leagueId).eq("submission_type", "commissioner_article").eq("status", "scheduled");
  if (rows.error) throw new ApiError(500, "Failed to load scheduled media.", rows.error);
  const storyIds: string[] = [];
  for (const row of rows.data ?? []) {
    const storyId = await publishMediaSubmissionStory(row, row.submitter_discord_id ?? null);
    const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updated.error) throw new ApiError(500, "Failed to mark scheduled media published.", updated.error);
    storyIds.push(storyId);
  }
  return { publishedCount: storyIds.length, storyIds };
}
