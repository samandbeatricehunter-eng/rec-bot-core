// Import-time orchestration: runs after a box score is approved and its
// rec_team_game_stats rows are written. Computes the game profile and generates
// the game story/headline, then persists them. Advance only READS these rows —
// it must not call this.
//
// Idempotent / re-import-safe: game-scoped derived rows (profile, story) are
// deleted before re-insert, so re-uploading a corrected box score self-heals
// instead of double-counting.

import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { computeGameProfile, rowToGameStats, type TeamGameStatsRow } from "./game-profile.js";
import { generateGameStory } from "./story-angles.js";
import { buildRoundtableDiscussion } from "../hub/roundtable.js";

/** The box-score submission row (rec_box_score_submissions). Loosely typed — only a few fields are read. */
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

type PerformanceTagRow = {
  team_id: string;
  subject_type: "player" | "unit";
  watched_player_id: string | null;
  unit: string | null;
  stat_lines: Array<{ statKey: string; label: string; value: number }>;
  performance_grade: "standout" | "solid" | "neutral" | "poor";
};

// Turns commissioner-entered player/unit performance tags into roundtable notes, and — for
// a standout player tag on the winning team with a real stat line — a sharper, named
// headline in place of the generic angle-based one. Leaves the 20-angle scoring system
// (story-angles.ts) as the untouched fallback for the common case where no tags exist yet.
async function loadPerformanceTagNotes(gameId: string, winnerTeamId: string | null): Promise<{ notes: string[]; headline: string | null }> {
  const tagsResult = await supabase.from("rec_game_performance_tags").select("team_id,subject_type,watched_player_id,unit,stat_lines,performance_grade").eq("game_id", gameId);
  if (tagsResult.error || !tagsResult.data?.length) return { notes: [], headline: null };
  const tags = tagsResult.data as PerformanceTagRow[];

  const playerIds = [...new Set(tags.filter((tag) => tag.subject_type === "player" && tag.watched_player_id).map((tag) => tag.watched_player_id!))];
  const playersResult = playerIds.length
    ? await supabase.from("rec_watched_players").select("id,player_name,position,class_year").in("id", playerIds)
    : { data: [] as any[] };
  const playerById = new Map<string, any>((playersResult.data ?? []).map((row: any) => [row.id, row]));

  const notes: string[] = [];
  let bestStandout: { text: string; magnitude: number } | null = null;

  for (const tag of tags) {
    if (tag.subject_type === "player" && tag.watched_player_id) {
      const player = playerById.get(tag.watched_player_id);
      if (!player) continue;
      const classLabel = player.class_year ? `${player.class_year} ` : "";
      const statText = (tag.stat_lines ?? []).map((line) => `${line.value} ${line.label.toLowerCase()}`).join(", ");
      const gradeWord = tag.performance_grade === "standout" ? "stood out" : tag.performance_grade === "poor" ? "struggled" : null;
      const sentence = statText
        ? `${classLabel}${player.position} ${player.player_name} posted ${statText}${gradeWord ? ` and ${gradeWord}` : ""}.`
        : gradeWord ? `${classLabel}${player.position} ${player.player_name} ${gradeWord} this week.` : null;
      if (sentence) notes.push(sentence);
      if (tag.performance_grade === "standout" && tag.stat_lines?.length && tag.team_id === winnerTeamId) {
        const magnitude = Math.max(...tag.stat_lines.map((line) => Number(line.value) || 0));
        const headlineText = `${classLabel}${player.position} ${player.player_name} Shines With ${tag.stat_lines[0].value} ${tag.stat_lines[0].label}`;
        if (!bestStandout || magnitude > bestStandout.magnitude) bestStandout = { text: headlineText, magnitude };
      }
    } else if (tag.subject_type === "unit" && tag.unit) {
      const unitLabel = tag.unit.replace("_", " ");
      const gradeWord = tag.performance_grade === "standout" || tag.performance_grade === "solid" ? "had a strong showing" : tag.performance_grade === "poor" ? "had a rough night" : null;
      if (gradeWord) notes.push(`The ${unitLabel} unit ${gradeWord}.`);
    }
  }

  return { notes, headline: bestStandout?.text ?? null };
}

export async function processGameIntelligence(sub: SubmissionRow): Promise<void> {
  const gameId = sub.game_id ?? null;
  const leagueGame = await loadLeagueGame(sub.league_id);

  // Look up team-game-stats rows by submission_id first (box-score path). If none found,
  // fall back to game_id — EA-imported stats have submission_id=null but game_id is set.
  let { data: rows, error } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("submission_id", sub.id);
  if (error) throw error;
  if ((!rows || rows.length === 0) && gameId) {
    const fallback = await supabase
      .from("rec_team_game_stats")
      .select("*")
      .eq("game_id", gameId)
      .eq("league_id", sub.league_id);
    if (fallback.error) throw fallback.error;
    rows = fallback.data;
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
    const performanceNotes = await loadPerformanceTagNotes(gameId, winner.teamId ?? null);
    const headline = performanceNotes.headline ?? story.headline;
    const inserted = await supabase.from("rec_game_stories").insert({
      league_id: sub.league_id,
      season: sub.season_number,
      week: sub.week_number,
      game_id: gameId,
      winner_team_id: winner.teamId,
      loser_team_id: loser.teamId,
      primary_angle: story.primaryAngle,
      headline,
      body: story.body,
      notes: story.notes,
      story_type: "game_article",
      roundtable: buildRoundtableDiscussion({ headline: story.headline, body: story.body, notes: [...story.notes, ...performanceNotes.notes] }),
    }).select("id").single();
    if (!inserted.error && inserted.data?.id) {
      await postGeneratedHeadlineToDiscord({ leagueId: sub.league_id, storyId: inserted.data.id, headline, body: story.body });
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
