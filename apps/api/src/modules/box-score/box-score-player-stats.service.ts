import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

// Only the two categories a team box score can attribute to a single player with real
// confidence — passing and rushing. Receiving/kicking/punting/defense aren't broken out
// separately from the team-aggregate numbers this parser captures, and team-wide fields
// (time of possession, penalties, red zone %, turnovers) never belong to one player at all.
export const ASSIGNABLE_CATEGORIES = ["passing", "rushing"] as const;
export type AssignableCategory = (typeof ASSIGNABLE_CATEGORIES)[number];

type StatLine = { statKey: string; label: string; value: number };

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function passingStatLines(stats: Record<string, { team1?: string; team2?: string }>, side: "team1" | "team2"): StatLine[] {
  const lines: StatLine[] = [];
  const completions = num(stats["pass_completions"]?.[side]);
  const attempts = num(stats["pass_attempts"]?.[side]);
  const yards = num(stats["off_pass_yards"]?.[side]);
  const touchdowns = num(stats["off_pass_tds"]?.[side]);
  const interceptions = num(stats["interceptions_thrown"]?.[side]);
  if (completions != null) lines.push({ statKey: "completions", label: "Completions", value: completions });
  if (attempts != null) lines.push({ statKey: "attempts", label: "Attempts", value: attempts });
  if (yards != null) lines.push({ statKey: "yards", label: "Passing yards", value: yards });
  if (touchdowns != null) lines.push({ statKey: "touchdowns", label: "Passing touchdowns", value: touchdowns });
  if (interceptions != null) lines.push({ statKey: "interceptions", label: "Interceptions", value: interceptions });
  return lines;
}

function rushingStatLines(stats: Record<string, { team1?: string; team2?: string }>, side: "team1" | "team2"): StatLine[] {
  const lines: StatLine[] = [];
  const carries = num(stats["off_rush_attempts"]?.[side]);
  const yards = num(stats["off_rush_yards"]?.[side]);
  const touchdowns = num(stats["off_rush_tds"]?.[side]);
  if (carries != null) lines.push({ statKey: "carries", label: "Carries", value: carries });
  if (yards != null) lines.push({ statKey: "yards", label: "Rushing yards", value: yards });
  if (touchdowns != null) lines.push({ statKey: "touchdowns", label: "Rushing touchdowns", value: touchdowns });
  return lines;
}

async function loadSubmissionForSide(guildId: string, submissionId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const submission = await supabase
    .from("rec_box_score_submissions")
    .select("id,league_id,game_id,season_number,week_number,team1_id,team2_id,home_team_id,away_team_id,team_stats")
    .eq("id", submissionId)
    .maybeSingle();
  if (submission.error) throw new ApiError(500, "Failed to load the box score submission.", submission.error);
  if (!submission.data || submission.data.league_id !== context.leagueId) throw new ApiError(404, "Box score submission not found.");
  return submission.data;
}

async function resolveActiveTeamId(leagueId: string, discordId: string): Promise<string> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  if (!account.data?.user_id) throw new ApiError(400, "Link a REC team before assigning stats.");
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(400, "You aren't linked to a team in this league.");
  return assignment.data.team_id as string;
}

function resolveSide(submission: { team1_id: string | null; team2_id: string | null }, teamId: string): "team1" | "team2" {
  if (submission.team1_id === teamId) return "team1";
  if (submission.team2_id === teamId) return "team2";
  throw new ApiError(403, "This box score isn't for your team.");
}

export type AssignableBoxScoreStats = {
  teamId: string;
  categories: Partial<Record<AssignableCategory, StatLine[]>>;
};

export async function getAssignableBoxScoreStats(input: { guildId: string; discordId: string; submissionId: string }): Promise<AssignableBoxScoreStats> {
  const context = await getCurrentLeagueContext(input.guildId);
  const teamId = await resolveActiveTeamId(context.leagueId, input.discordId);
  const submission = await loadSubmissionForSide(input.guildId, input.submissionId);
  const side = resolveSide(submission, teamId);
  const stats = (submission.team_stats ?? {}) as Record<string, { team1?: string; team2?: string }>;

  const categories: Partial<Record<AssignableCategory, StatLine[]>> = {};
  const passing = passingStatLines(stats, side);
  const rushing = rushingStatLines(stats, side);
  if (passing.length) categories.passing = passing;
  if (rushing.length) categories.rushing = rushing;

  return { teamId, categories };
}

export async function assignBoxScoreStatsToPlayer(input: {
  guildId: string;
  discordId: string;
  submissionId: string;
  category: AssignableCategory;
  rosterPlayerId: string;
}): Promise<{ tagId: string }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const teamId = await resolveActiveTeamId(context.leagueId, input.discordId);
  const submission = await loadSubmissionForSide(input.guildId, input.submissionId);
  const side = resolveSide(submission, teamId);
  const stats = (submission.team_stats ?? {}) as Record<string, { team1?: string; team2?: string }>;

  const statLines = input.category === "passing" ? passingStatLines(stats, side) : rushingStatLines(stats, side);
  if (!statLines.length) throw new ApiError(400, `No ${input.category} stats were captured for this game.`);

  const player = await supabase.from("rec_players").select("id,team_id").eq("id", input.rosterPlayerId).eq("league_id", context.leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load the player.", player.error);
  if (!player.data || player.data.team_id !== teamId) throw new ApiError(404, "Player not found on your roster.");

  const tagId = randomUUID();
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_game_performance_tags").insert({
    id: tagId,
    league_id: context.leagueId,
    game_id: submission.game_id,
    season_number: submission.season_number,
    week_number: submission.week_number,
    team_id: teamId,
    subject_type: "player",
    roster_player_id: input.rosterPlayerId,
    unit: "offense",
    stat_lines: statLines,
    performance_grade: "solid",
    created_at: now,
    updated_at: now,
  });
  if (inserted.error) throw new ApiError(500, "Failed to assign stats to the player.", inserted.error);
  return { tagId };
}
