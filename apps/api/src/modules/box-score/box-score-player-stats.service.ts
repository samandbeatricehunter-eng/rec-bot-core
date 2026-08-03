import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

// The two continuous-stat categories a team box score can attribute to a single player with
// real confidence — passing and rushing. Receiving/kicking/punting aren't broken out
// separately from the team-aggregate numbers this parser captures. Turnovers are handled
// separately below (see TURNOVER_KINDS) since each individual interception/fumble can go to a
// different player, unlike a single running passing-yards total.
export const ASSIGNABLE_CATEGORIES = ["passing", "rushing"] as const;
export type AssignableCategory = (typeof ASSIGNABLE_CATEGORIES)[number];

// Turnovers cut both ways: a team's own interceptions-thrown/fumbles-lost are an offensive
// player's liability ("committed"), and that same event is simultaneously a defensive player's
// credit on the OPPOSING team ("forced") — pulled from the opponent's committed numbers, not a
// separate parsed field. Each is a per-instance count (2 interceptions thrown = 2 independently
// assignable slots, possibly to two different players), not a single running total.
export const TURNOVER_KINDS = ["interceptions_thrown", "fumbles_lost", "interceptions_made", "forced_fumble"] as const;
export type TurnoverKind = (typeof TURNOVER_KINDS)[number];

const TURNOVER_LABEL: Record<TurnoverKind, string> = {
  interceptions_thrown: "Interception Thrown",
  fumbles_lost: "Fumble Lost",
  interceptions_made: "Interception Made",
  forced_fumble: "Forced Fumble",
};
const TURNOVER_UNIT: Record<TurnoverKind, "offense" | "defense"> = {
  interceptions_thrown: "offense",
  fumbles_lost: "offense",
  interceptions_made: "defense",
  forced_fumble: "defense",
};

type StatLine = { statKey: string; label: string; value: number };
type TeamStats = Record<string, { team1?: string; team2?: string }>;

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function opposite(side: "team1" | "team2"): "team1" | "team2" {
  return side === "team1" ? "team2" : "team1";
}

function passingStatLines(stats: TeamStats, side: "team1" | "team2"): StatLine[] {
  const lines: StatLine[] = [];
  const completions = num(stats["pass_completions"]?.[side]);
  const attempts = num(stats["pass_attempts"]?.[side]);
  const yards = num(stats["off_pass_yards"]?.[side]);
  const touchdowns = num(stats["off_pass_tds"]?.[side]);
  if (completions != null) lines.push({ statKey: "completions", label: "Completions", value: completions });
  if (attempts != null) lines.push({ statKey: "attempts", label: "Attempts", value: attempts });
  if (yards != null) lines.push({ statKey: "yards", label: "Passing yards", value: yards });
  if (touchdowns != null) lines.push({ statKey: "touchdowns", label: "Passing touchdowns", value: touchdowns });
  return lines;
}

function rushingStatLines(stats: TeamStats, side: "team1" | "team2"): StatLine[] {
  const lines: StatLine[] = [];
  const carries = num(stats["off_rush_attempts"]?.[side]);
  const yards = num(stats["off_rush_yards"]?.[side]);
  const touchdowns = num(stats["off_rush_tds"]?.[side]);
  if (carries != null) lines.push({ statKey: "carries", label: "Carries", value: carries });
  if (yards != null) lines.push({ statKey: "yards", label: "Rushing yards", value: yards });
  if (touchdowns != null) lines.push({ statKey: "touchdowns", label: "Rushing touchdowns", value: touchdowns });
  return lines;
}

/** How many instances of this turnover kind are available to assign, for my side. */
function turnoverCount(stats: TeamStats, mySide: "team1" | "team2", kind: TurnoverKind): number {
  if (kind === "interceptions_thrown") return num(stats["interceptions_thrown"]?.[mySide]) ?? 0;
  if (kind === "fumbles_lost") return num(stats["fumbles_lost"]?.[mySide]) ?? 0;
  // "made"/"forced" credit comes from the OPPONENT's committed numbers.
  const oppSide = opposite(mySide);
  if (kind === "interceptions_made") return num(stats["interceptions_thrown"]?.[oppSide]) ?? 0;
  return num(stats["fumbles_lost"]?.[oppSide]) ?? 0;
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
  turnovers: Partial<Record<TurnoverKind, number>>;
};

export async function getAssignableBoxScoreStats(input: { guildId: string; discordId: string; submissionId: string }): Promise<AssignableBoxScoreStats> {
  const context = await getCurrentLeagueContext(input.guildId);
  const teamId = await resolveActiveTeamId(context.leagueId, input.discordId);
  const submission = await loadSubmissionForSide(input.guildId, input.submissionId);
  const side = resolveSide(submission, teamId);
  const stats = (submission.team_stats ?? {}) as TeamStats;

  const categories: Partial<Record<AssignableCategory, StatLine[]>> = {};
  const passing = passingStatLines(stats, side);
  const rushing = rushingStatLines(stats, side);
  if (passing.length) categories.passing = passing;
  if (rushing.length) categories.rushing = rushing;

  const turnovers: Partial<Record<TurnoverKind, number>> = {};
  for (const kind of TURNOVER_KINDS) {
    const count = turnoverCount(stats, side, kind);
    if (count > 0) turnovers[kind] = count;
  }

  return { teamId, categories, turnovers };
}

async function assignStatLinesToPlayer(input: {
  context: { leagueId: string };
  teamId: string;
  rosterPlayerId: string;
  submission: { game_id: string; season_number: number; week_number: number };
  unit: "offense" | "defense";
  statLines: StatLine[];
}): Promise<{ tagId: string }> {
  const player = await supabase.from("rec_players").select("id,team_id").eq("id", input.rosterPlayerId).eq("league_id", input.context.leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load the player.", player.error);
  if (!player.data || player.data.team_id !== input.teamId) throw new ApiError(404, "Player not found on your roster.");

  const tagId = randomUUID();
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_game_performance_tags").insert({
    id: tagId,
    league_id: input.context.leagueId,
    game_id: input.submission.game_id,
    season_number: input.submission.season_number,
    week_number: input.submission.week_number,
    team_id: input.teamId,
    subject_type: "player",
    roster_player_id: input.rosterPlayerId,
    unit: input.unit,
    stat_lines: input.statLines,
    performance_grade: "solid",
    created_at: now,
    updated_at: now,
  });
  if (inserted.error) throw new ApiError(500, "Failed to assign stats to the player.", inserted.error);
  return { tagId };
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
  const stats = (submission.team_stats ?? {}) as TeamStats;

  const statLines = input.category === "passing" ? passingStatLines(stats, side) : rushingStatLines(stats, side);
  if (!statLines.length) throw new ApiError(400, `No ${input.category} stats were captured for this game.`);

  return assignStatLinesToPlayer({ context, teamId, rosterPlayerId: input.rosterPlayerId, submission, unit: "offense", statLines });
}

export async function assignBoxScoreStatAllocations(input: {
  guildId: string;
  discordId: string;
  submissionId: string;
  category: AssignableCategory;
  allocations: Array<{ rosterPlayerId: string; stats: Record<string, number> }>;
}): Promise<{ tagIds: string[] }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const teamId = await resolveActiveTeamId(context.leagueId, input.discordId);
  const submission = await loadSubmissionForSide(input.guildId, input.submissionId);
  const side = resolveSide(submission, teamId);
  const teamLines = input.category === "passing"
    ? passingStatLines((submission.team_stats ?? {}) as TeamStats, side)
    : rushingStatLines((submission.team_stats ?? {}) as TeamStats, side);
  if (!teamLines.length) throw new ApiError(400, `No ${input.category} stats were captured for this game.`);
  if (!input.allocations.length) throw new ApiError(400, "Add at least one player allocation.");
  if (new Set(input.allocations.map((row) => row.rosterPlayerId)).size !== input.allocations.length) {
    throw new ApiError(400, "Each player can appear only once in an allocation.");
  }

  for (const line of teamLines) {
    const values = input.allocations.map((row) => Number(row.stats[line.statKey] ?? 0));
    if (values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new ApiError(400, `${line.label} allocations must be non-negative whole numbers.`);
    }
    const allocated = values.reduce((sum, value) => sum + value, 0);
    if (allocated !== line.value) {
      throw new ApiError(400, `${line.label} allocations total ${allocated}; they must equal the team total of ${line.value}.`);
    }
  }

  const playerIds = input.allocations.map((row) => row.rosterPlayerId);
  const players = await supabase.from("rec_players").select("id,team_id").eq("league_id", context.leagueId).in("id", playerIds);
  if (players.error) throw new ApiError(500, "Failed to validate roster players.", players.error);
  const validIds = new Set((players.data ?? []).filter((row) => row.team_id === teamId).map((row) => row.id));
  if (playerIds.some((id) => !validIds.has(id))) throw new ApiError(404, "One or more players are not on your roster.");

  const now = new Date().toISOString();
  const rows = input.allocations.map((allocation) => ({
    id: randomUUID(), league_id: context.leagueId, game_id: submission.game_id,
    season_number: submission.season_number, week_number: submission.week_number,
    team_id: teamId, subject_type: "player", roster_player_id: allocation.rosterPlayerId,
    unit: "offense",
    stat_lines: teamLines.map((line) => ({ ...line, value: Number(allocation.stats[line.statKey] ?? 0) })),
    performance_grade: "solid", created_at: now, updated_at: now,
  }));
  const inserted = await supabase.from("rec_game_performance_tags").insert(rows);
  if (inserted.error) throw new ApiError(500, "Failed to save player stat allocations.", inserted.error);
  return { tagIds: rows.map((row) => row.id) };
}

/** Assigns ONE instance of a turnover kind to a player — call once per interception/fumble a
 * coach wants to attribute, possibly to different players for the same kind (e.g. two
 * interceptions thrown by two different players). Only checks that at least one instance of
 * this kind occurred this game; it doesn't track how many have already been assigned, so it's
 * still possible to over-assign — same trust level as the rest of this manual-entry system. */
export async function assignTurnoverToPlayer(input: {
  guildId: string;
  discordId: string;
  submissionId: string;
  kind: TurnoverKind;
  rosterPlayerId: string;
}): Promise<{ tagId: string }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const teamId = await resolveActiveTeamId(context.leagueId, input.discordId);
  const submission = await loadSubmissionForSide(input.guildId, input.submissionId);
  const side = resolveSide(submission, teamId);
  const stats = (submission.team_stats ?? {}) as TeamStats;

  const count = turnoverCount(stats, side, input.kind);
  if (count <= 0) throw new ApiError(400, `No ${TURNOVER_LABEL[input.kind].toLowerCase()} instances were captured for this game.`);

  const existing = await supabase
    .from("rec_game_performance_tags")
    .select("stat_lines")
    .eq("league_id", context.leagueId)
    .eq("game_id", submission.game_id)
    .eq("team_id", teamId)
    .not("roster_player_id", "is", null);
  if (existing.error) throw new ApiError(500, "Failed to validate existing turnover assignments.", existing.error);
  const alreadyAssigned = (existing.data ?? []).reduce((total, row) => {
    const lines = Array.isArray(row.stat_lines) ? row.stat_lines as Array<{ statKey?: string; value?: number }> : [];
    return total + lines.filter((line) => line.statKey === input.kind).reduce((sum, line) => sum + (Number(line.value) || 0), 0);
  }, 0);
  if (alreadyAssigned >= count) throw new ApiError(409, `All ${count} ${TURNOVER_LABEL[input.kind].toLowerCase()} slot${count === 1 ? " has" : "s have"} already been assigned.`);

  const statLines: StatLine[] = [{ statKey: input.kind, label: TURNOVER_LABEL[input.kind], value: 1 }];
  return assignStatLinesToPlayer({ context, teamId, rosterPlayerId: input.rosterPlayerId, submission, unit: TURNOVER_UNIT[input.kind], statLines });
}
