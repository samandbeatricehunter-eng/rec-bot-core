// Import-time orchestration: runs after EA-imported rec_team_game_stats rows are written.
// Computes the game profile and generates the game story/headline, then persists them.
// Advance only READS these rows — it must not call this.
//
// Idempotent / re-import-safe: game-scoped derived rows (profile, story) are
// deleted before re-insert, so re-importing a corrected game self-heals instead
// of double-counting.

import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { computeGameProfile, rowToGameStats, type TeamGameStatsRow } from "./game-profile.js";
import { generateGameStory } from "./story-angles.js";
import { buildRoundtableDiscussion } from "../hub/roundtable.js";

/** A lightweight descriptor identifying the game/import batch this run is for. Loosely typed —
 * only a few fields are read. The caller (EA import) passes a synthetic non-UUID `id`, since
 * there's no real submission row backing this anymore. */
type SubmissionRow = {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  game_id: string | null;
};

// Mirrors an auto-generated game headline to the guild's configured Headlines channel
// (Platinum Discord-bot add-on), stamping posted_channel_id/posted_message_id on the
// rec_game_stories row for parity with the manual advance-story posting fields.
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

export async function processGameIntelligence(sub: SubmissionRow, options?: { postToDiscord?: boolean }): Promise<void> {
  const gameId = sub.game_id ?? null;
  const leagueGame = await loadLeagueGame(sub.league_id);

  // EA-imported stats are looked up by game_id (the only caller now is EA import, which
  // passes a synthetic non-UUID sub.id since there's no real submission row anymore).
  let rows: unknown[] | null = null;
  if (gameId) {
    const result = await supabase
      .from("rec_team_game_stats")
      .select("*")
      .eq("game_id", gameId)
      .eq("league_id", sub.league_id);
    if (result.error) throw result.error;
    rows = result.data;
  }
  if (!rows || rows.length === 0) return;

  const games = rows.map((r) => rowToGameStats(r as TeamGameStatsRow, leagueGame));
  const teamIds = [...new Set<string>(rows.map((r: any) => String(r.team_id)).filter(Boolean))];
  const nameById = await loadTeamNames(teamIds);

  // Re-import safety: clear game-scoped derived rows before recompute.
  if (gameId) {
    await supabase.from("rec_game_stories").delete().eq("game_id", gameId);
    await supabase.from("rec_game_profiles").delete().eq("game_id", gameId);
  }

  // Game story (one per game; needs a distinct winner/loser).
  const winner = games.find((g) => g.won);
  const loser = games.find((g) => g.lost);
  if (gameId && winner && loser) {
    const story = generateGameStory({
      winner,
      loser,
      winnerName: nameById.get(winner.teamId ?? "") ?? "Home",
      loserName: nameById.get(loser.teamId ?? "") ?? "Away",
    });
    const inserted = await supabase.from("rec_game_stories").insert({
      league_id: sub.league_id,
      season: sub.season_number,
      week: sub.week_number,
      game_id: gameId,
      winner_team_id: winner.teamId,
      loser_team_id: loser.teamId,
      primary_angle: story.primaryAngle,
      headline: story.headline,
      body: story.body,
      notes: story.notes,
      story_type: "game_article",
      roundtable: buildRoundtableDiscussion({ headline: story.headline, body: story.body, notes: story.notes }),
    }).select("id").single();
    if (!inserted.error && inserted.data?.id && options?.postToDiscord !== false) {
      await postGeneratedHeadlineToDiscord({ leagueId: sub.league_id, storyId: inserted.data.id, headline: story.headline, body: story.body });
    }
  }

  // Per-team profile — both teams are independent, run in parallel.
  await Promise.all(games.map(async (g) => {
    if (!gameId) return;
    const profile = computeGameProfile(g);
    await supabase.from("rec_game_profiles").insert({
      league_id: g.leagueId,
      season: g.season,
      week: g.week,
      game_id: gameId,
      team_id: g.teamId,
      user_id: g.userId,
      opponent_team_id: g.opponentTeamId,
      won: g.won,
      margin: g.margin,
      story_angles: winner && loser ? generateGameStory({ winner, loser, winnerName: "", loserName: "" }).angleScores : null,
      profile,
    });
  }));
}

async function loadLeagueGame(leagueId: string): Promise<string> {
  const leagueResult = await supabase.from("rec_leagues").select("game").eq("id", leagueId).maybeSingle();
  return String(leagueResult.data?.game ?? "madden_26");
}

async function loadTeamNames(teamIds: string[]): Promise<Map<string, string>> {
  if (!teamIds.length) return new Map();
  const { data } = await supabase
    .from("rec_teams")
    .select("id,name,display_abbr,abbreviation")
    .in("id", teamIds);
  const map = new Map<string, string>();
  for (const t of data ?? []) {
    map.set(t.id, (t.name as string) || (t.display_abbr as string) || (t.abbreviation as string) || "Team");
  }
  return map;
}
