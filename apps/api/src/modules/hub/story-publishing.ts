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
