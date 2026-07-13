// @ts-nocheck
import { regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { buildTeamNameCandidates as buildTeamCandidates, matchTeamByName, TEAM_NAME_AUTO_MATCH_THRESHOLD as AUTO_MATCH_THRESHOLD } from "../../lib/team-name-match.js";
import { persistStitchedUploadImage } from "../box-score/box-score.service.js";
import { parseTeamScheduleImages, type ParsedTeamScheduleRow } from "./cfb-team-schedule.parser.js";
import { listScheduleSeason, saveManualScheduleGame } from "./schedule.service.js";

type ConfirmedWeek = { gameId: string; opponentTeamId: string; opponentName: string; homeAway: "home" | "away" };

// Shared by the OCR-driven preview (previewCfbTeamScheduleImport) and the web dashboard's
// no-OCR manual preview (getCfbTeamScheduleManualState) — a team+week already has a
// confirmed matchup (from either side of the game, from any source: OCR import, manual
// Discord wizard, or the web dashboard) if a rec_games row already covers it.
function buildConfirmedByWeekMap(season: { weeks: Array<{ weekNumber: number; games: any[] }> }, teamId: string): Map<number, ConfirmedWeek> {
  const confirmedByWeek = new Map<number, ConfirmedWeek>();
  for (const week of season.weeks) {
    for (const game of week.games) {
      const isAway = game.away_team_id === teamId;
      const isHome = game.home_team_id === teamId;
      if (!isAway && !isHome) continue;
      const opponent = isAway ? game.home_team : game.away_team;
      confirmedByWeek.set(week.weekNumber, {
        gameId: game.id,
        opponentTeamId: isAway ? game.home_team_id : game.away_team_id,
        opponentName: opponent?.name ?? opponent?.abbreviation ?? "Team",
        homeAway: isAway ? "away" : "home",
      });
    }
  }
  return confirmedByWeek;
}

// The web dashboard's schedule builder is also where box scores get uploaded/reviewed and
// final scores get manually recorded (see cfb-team-schedule.service.ts's plan doc) — every
// week row needs to know not just "who's the opponent" but "does this game already have a
// result, or a box-score submission awaiting review," so the UI can show the right actions
// instead of asking the commissioner to open each game to check.
type GameResultAndSubmission = {
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
};

async function loadResultsAndPendingSubmissions(gameIds: string[]): Promise<Map<string, GameResultAndSubmission>> {
  const byGameId = new Map<string, GameResultAndSubmission>();
  if (!gameIds.length) return byGameId;

  const [resultsRes, submissionsRes] = await Promise.all([
    supabase.from("rec_game_results").select("game_id,home_score,away_score,is_tie,source").in("game_id", gameIds),
    supabase.from("rec_box_score_submissions").select("id,game_id").eq("status", "pending").in("game_id", gameIds),
  ]);
  if (resultsRes.error) throw new ApiError(500, "Failed to load existing game results.", resultsRes.error);
  if (submissionsRes.error) throw new ApiError(500, "Failed to load pending box score submissions.", submissionsRes.error);

  for (const gameId of gameIds) byGameId.set(gameId, { result: null, pendingBoxScoreSubmissionId: null });
  for (const row of resultsRes.data ?? []) {
    const entry = byGameId.get(row.game_id);
    if (entry) entry.result = { homeScore: row.home_score, awayScore: row.away_score, isTie: row.is_tie, source: row.source };
  }
  for (const row of submissionsRes.data ?? []) {
    const entry = row.game_id ? byGameId.get(row.game_id) : undefined;
    if (entry) entry.pendingBoxScoreSubmissionId = row.id;
  }
  return byGameId;
}

// Matches below AUTO_MATCH_THRESHOLD are surfaced but not auto-selected — the review
// embed shows the raw OCR text and lets the commissioner pick from a dropdown either way.

export type TeamScheduleWeekPreview = {
  weekNumber: number | null;
  weekLabel: string;
  isBye: boolean;
  opponentRaw: string | null;
  opponentRank: number | null;
  homeAway: "home" | "away" | null;
  matchedOpponentTeamId: string | null;
  matchedOpponentName: string | null;
  matchConfidence: number | null;
  /** True when this team+week already has a confirmed matchup (from this or an earlier team's upload) — shown locked/read-only in the review UI. */
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
};

export async function previewCfbTeamScheduleImport(input: {
  guildId: string;
  teamId: string;
  imageUrls: string[];
  seasonNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") {
    throw new ApiError(400, "Team schedule import is only available for CFB leagues.");
  }
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);

  const teams = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr,display_city,display_nick,conference,is_relocated")
    .eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);
  const teamRows = teams.data ?? [];
  const team = teamRows.find((t: any) => t.id === input.teamId);
  if (!team) throw new ApiError(404, "Team was not found in the current league.");

  const candidates = teamRows.filter((t: any) => t.id !== input.teamId).map(buildTeamCandidates);

  const parsed = await parseTeamScheduleImages(input.imageUrls);

  const season = await listScheduleSeason(input.guildId, seasonNumber);
  const confirmedByWeek = buildConfirmedByWeekMap(season, input.teamId);

  const weeks: TeamScheduleWeekPreview[] = parsed.rows.map((row: ParsedTeamScheduleRow) => {
    const confirmed = row.weekNumber != null ? confirmedByWeek.get(row.weekNumber) : undefined;
    const match = row.isBye ? null : matchTeamByName(row.opponentRaw, candidates);
    const matchedTeam = match ? teamRows.find((t: any) => t.id === match.teamId) : null;
    return {
      weekNumber: row.weekNumber,
      weekLabel: row.weekLabel,
      isBye: row.isBye,
      opponentRaw: row.opponentRaw,
      opponentRank: row.opponentRank,
      homeAway: row.homeAway,
      matchedOpponentTeamId: match && match.score >= AUTO_MATCH_THRESHOLD ? match.teamId : null,
      matchedOpponentName: matchedTeam?.name ?? matchedTeam?.abbreviation ?? null,
      matchConfidence: match?.score ?? null,
      alreadyConfirmed: Boolean(confirmed),
      confirmedOpponentTeamId: confirmed?.opponentTeamId ?? null,
      confirmedOpponentName: confirmed?.opponentName ?? null,
      confirmedHomeAway: confirmed?.homeAway ?? null,
    };
  });

  const imageUrl = input.imageUrls.length
    ? await persistStitchedUploadImage(`cfbteamimport-${leagueId}-${seasonNumber}-${input.teamId}`, input.imageUrls)
    : null;

  return {
    team: { id: team.id, name: team.name, abbreviation: team.abbreviation },
    seasonNumber,
    weeks,
    warnings: parsed.warnings,
    imageUrl: imageUrl ?? input.imageUrls[0] ?? null,
  };
}

// The web dashboard's schedule builder — same "team + every week's confirmed status"
// shape as previewCfbTeamScheduleImport, minus the OCR step (there's no screenshot; the
// commissioner fills in every week directly in the UI instead of correcting a parsed
// guess), plus each week's existing result/pending-submission so the builder can show
// (and act on) box scores and final scores inline instead of starting from blank.
export type TeamScheduleManualWeek = {
  weekNumber: number;
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
};

export async function getCfbTeamScheduleManualState(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") {
    throw new ApiError(400, "Team schedule entry is only available for CFB leagues.");
  }
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);

  const teams = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr,display_city,display_nick,conference,is_relocated")
    .eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);
  const teamRows = teams.data ?? [];
  const team = teamRows.find((t: any) => t.id === input.teamId);
  if (!team) throw new ApiError(404, "Team was not found in the current league.");

  const season = await listScheduleSeason(input.guildId, seasonNumber);
  const confirmedByWeek = buildConfirmedByWeekMap(season, input.teamId);
  const gameIds = [...confirmedByWeek.values()].map((c) => c.gameId);
  const resultsAndSubmissions = await loadResultsAndPendingSubmissions(gameIds);

  const lastWeek = regularSeasonWeeks(context.rec_leagues.game);
  const weeks: TeamScheduleManualWeek[] = [];
  for (let weekNumber = 0; weekNumber <= lastWeek; weekNumber++) {
    const confirmed = confirmedByWeek.get(weekNumber);
    const extra = confirmed ? resultsAndSubmissions.get(confirmed.gameId) : undefined;
    weeks.push({
      weekNumber,
      alreadyConfirmed: Boolean(confirmed),
      confirmedOpponentTeamId: confirmed?.opponentTeamId ?? null,
      confirmedOpponentName: confirmed?.opponentName ?? null,
      confirmedHomeAway: confirmed?.homeAway ?? null,
      gameId: confirmed?.gameId ?? null,
      result: extra?.result ?? null,
      pendingBoxScoreSubmissionId: extra?.pendingBoxScoreSubmissionId ?? null,
    });
  }

  return {
    team: { id: team.id, name: team.name, abbreviation: team.abbreviation },
    seasonNumber,
    weeks,
  };
}

export async function commitCfbTeamScheduleImport(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
  decisions: Array<{ weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" }>;
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") {
    throw new ApiError(400, "Team schedule import is only available for CFB leagues.");
  }
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  const saved: Array<{ weekNumber: number; skipped: boolean; reason?: string }> = [];
  for (const decision of input.decisions) {
    const awayTeamId = decision.homeAway === "away" ? input.teamId : decision.opponentTeamId;
    const homeTeamId = decision.homeAway === "away" ? decision.opponentTeamId : input.teamId;

    const existing = await supabase
      .from("rec_games")
      .select("id")
      .eq("league_id", leagueId)
      .eq("season_id", seasonId)
      .eq("week_number", decision.weekNumber)
      .or(`home_team_id.in.(${awayTeamId},${homeTeamId}),away_team_id.in.(${awayTeamId},${homeTeamId})`);
    if (existing.error) throw new ApiError(500, "Failed to check existing schedule matchups.", existing.error);
    if ((existing.data ?? []).length) {
      // Already confirmed (from this or an earlier team's upload) — leave it alone rather
      // than risk a slot-conflict error or overwriting an already-approved matchup.
      saved.push({ weekNumber: decision.weekNumber, skipped: true, reason: "already_confirmed" });
      continue;
    }

    try {
      const weekGames = await supabase
        .from("rec_games")
        .select("id")
        .eq("league_id", leagueId)
        .eq("season_id", seasonId)
        .eq("week_number", decision.weekNumber);
      if (weekGames.error) throw new ApiError(500, "Failed to load week slot count.", weekGames.error);

      await saveManualScheduleGame({
        guildId: input.guildId,
        seasonNumber,
        weekNumber: decision.weekNumber,
        slotNumber: (weekGames.data ?? []).length + 1,
        awayTeamId,
        homeTeamId,
        requestedByDiscordId: input.requestedByDiscordId,
      });
      saved.push({ weekNumber: decision.weekNumber, skipped: false });
    } catch (err) {
      // One bad week (e.g. a race with another commissioner's concurrent save) shouldn't
      // abort every other week in this batch — report it and keep going.
      saved.push({ weekNumber: decision.weekNumber, skipped: true, reason: err instanceof ApiError ? err.message : "save_failed" });
    }
  }

  return { saved };
}
