// @ts-nocheck
import { randomUUID } from "node:crypto";
import { isCfb, regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { buildTeamNameCandidates as buildTeamCandidates, matchTeamByName, TEAM_NAME_AUTO_MATCH_THRESHOLD as AUTO_MATCH_THRESHOLD } from "../../lib/team-name-match.js";
import { persistStitchedUploadImage } from "../box-score/box-score.service.js";
import { parseTeamScheduleImages, type ParsedTeamScheduleRow } from "./cfb-team-schedule.parser.js";
import { listScheduleSeason, loadSchedulePlaceholderTeamIds, saveManualScheduleGame } from "./schedule.service.js";
import { assignKnownRivalryToGame, ensureLeagueRivalries, loadGameRivalries } from "../rivalries/rivalries.service.js";

type ConfirmedWeek = {
  gameId: string;
  weekNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  opponentTeamId: string;
  opponentName: string;
  homeAway: "home" | "away";
  matchupType: "h2h" | "cpu";
};

// Shared by the OCR-driven preview (previewCfbTeamScheduleImport, still CFB-only — that
// parser only understands the CFB Team Schedule screenshot format) and the web dashboard's
// no-OCR manual preview (getTeamScheduleManualState, now game-generic) — a team+week already
// has a confirmed matchup (from either side of the game, from any source: OCR import, manual
// Discord wizard, or the web dashboard) if a rec_games row already covers it.
function buildConfirmedByWeekMap(season: { weeks: Array<{ weekNumber: number; games: any[] }> }, teamId: string): Map<number, ConfirmedWeek> {
  const confirmedByWeek = new Map<number, ConfirmedWeek>();
  for (const week of season.weeks) {
    for (const game of week.games) {
      const isAway = game.away_team_id === teamId;
      const isHome = game.home_team_id === teamId;
      if (!isAway && !isHome) continue;
      const opponent = isAway ? game.home_team : game.away_team;
      const opponentUserId = isAway ? game.home_user_id : game.away_user_id;
      confirmedByWeek.set(week.weekNumber, {
        gameId: game.id,
        weekNumber: week.weekNumber,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        opponentTeamId: isAway ? game.home_team_id : game.away_team_id,
        opponentName: opponent?.name ?? opponent?.abbreviation ?? "Team",
        homeAway: isAway ? "away" : "home",
        matchupType: opponentUserId ? "h2h" : "cpu",
      });
    }
  }
  return confirmedByWeek;
}

// The web dashboard's schedule builder is also where box scores get uploaded/reviewed and
// final scores get manually recorded (see team-schedule.service.ts's plan doc) — every
// week row needs to know not just "who's the opponent" but "does this game already have a
// result, or a box-score submission awaiting review," so the UI can show the right actions
// instead of asking the commissioner to open each game to check.
type GameResultAndSubmission = {
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
  boxScoreSubmissionId: string | null;
  boxScoreStatus: string | null;
};

export type GameResultLookupDescriptor = { id: string; weekNumber: number; homeTeamId: string; awayTeamId: string };

// Exported so the bulk team-management-summary aggregation (team-schedule-summary.service.ts)
// can reuse this instead of duplicating the result/pending-submission query per team.
//
// rec_game_results has no game_id column — a result is a standalone row correlated to a
// scheduled matchup by (league_id, season_number, week_number, home_team_id, away_team_id),
// same as manual-scores.service.ts's listManualScoreGames. rec_box_score_submissions DOES
// have game_id, so that half stays a direct lookup.
export async function loadResultsAndPendingSubmissions(
  leagueId: string,
  seasonNumber: number,
  games: GameResultLookupDescriptor[],
): Promise<Map<string, GameResultAndSubmission>> {
  const byGameId = new Map<string, GameResultAndSubmission>();
  if (!games.length) return byGameId;
  const gameIds = games.map((g) => g.id);
  const weekNumbers = [...new Set(games.map((g) => g.weekNumber))];

  const [resultsRes, submissionsRes] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("week_number,home_team_id,away_team_id,home_score,away_score,is_tie,source")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .in("week_number", weekNumbers),
    supabase.from("rec_box_score_submissions").select("id,game_id,status,updated_at,created_at").in("status", ["pending", "approved"]).in("game_id", gameIds),
  ]);
  if (resultsRes.error) throw new ApiError(500, "Failed to load existing game results.", resultsRes.error);
  if (submissionsRes.error) throw new ApiError(500, "Failed to load pending box score submissions.", submissionsRes.error);

  const resultByMatchup = new Map(
    (resultsRes.data ?? []).map((row: any) => [`${row.week_number}:${row.home_team_id}:${row.away_team_id}`, row]),
  );
  const submissionByGameId = new Map<string, any>();
  for (const row of submissionsRes.data ?? []) {
    if (!row.game_id) continue;
    const current = submissionByGameId.get(row.game_id);
    if (!current || String(row.updated_at ?? row.created_at ?? "") > String(current.updated_at ?? current.created_at ?? "")) {
      submissionByGameId.set(row.game_id, row);
    }
  }

  for (const g of games) {
    const row = resultByMatchup.get(`${g.weekNumber}:${g.homeTeamId}:${g.awayTeamId}`);
    const submission = submissionByGameId.get(g.id) ?? null;
    byGameId.set(g.id, {
      result: row ? { homeScore: row.home_score, awayScore: row.away_score, isTie: row.is_tie, source: row.source } : null,
      pendingBoxScoreSubmissionId: submission?.status === "pending" ? submission.id : null,
      boxScoreSubmissionId: submission?.id ?? null,
      boxScoreStatus: submission?.status ?? null,
    });
  }
  return byGameId;
}

// Matches below AUTO_MATCH_THRESHOLD are surfaced but not auto-selected — the review
// embed shows the raw OCR text and lets the commissioner pick from a dropdown either way.

export type TeamScheduleWeekPreview = {
  weekNumber: number | null;
  weekLabel: string;
  isBye: boolean;
  rivalry: { enabled: boolean; optedOut: boolean; details: any | null };
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

// OCR-screenshot-driven preview — CFB only (the parser only understands the CFB Team
// Schedule screenshot format). Left untouched; not part of the Madden generalization.
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
  await ensureLeagueRivalries(leagueId, context.rec_leagues.game);

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
// Game-generic (cfb_27 | madden_26 | madden_27) — the week range and stage labels already
// come from @rec/shared's game-aware helpers, so no CFB-only guard is needed here.
export type TeamScheduleManualWeek = {
  weekNumber: number;
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  confirmedMatchupType: "h2h" | "cpu" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
  boxScoreSubmissionId: string | null;
  boxScoreStatus: string | null;
  /** Persisted from rec_team_byes — stays checked across reloads until the commissioner unchecks and re-saves. */
  isBye: boolean;
};

export async function getTeamScheduleManualState(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
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
  const gameDescriptors = [...confirmedByWeek.values()].map((c) => ({ id: c.gameId, weekNumber: c.weekNumber, homeTeamId: c.homeTeamId, awayTeamId: c.awayTeamId }));
  const resultsAndSubmissions = await loadResultsAndPendingSubmissions(leagueId, seasonNumber, gameDescriptors);
  await Promise.all(gameDescriptors.map((game) => assignKnownRivalryToGame(game.id)));
  const rivalries = await loadGameRivalries(gameDescriptors.map((game) => game.id));

  const byeRows = await supabase.from("rec_team_byes").select("week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", input.teamId);
  if (byeRows.error) throw new ApiError(500, "Failed to load bye weeks.", byeRows.error);
  const byeWeeks = new Set((byeRows.data ?? []).map((row: any) => row.week_number));

  // CFB's schedule builder also covers Conference Championship (week 15) as a schedulable
  // matchup row, so the season spans 16 weeks (0-15) instead of stopping at the regular
  // season's last week (14) — regularSeasonWeeks() itself stays 14 for stage-transition math.
  const lastWeek = regularSeasonWeeks(context.rec_leagues.game) + (isCfb(context.rec_leagues.game) ? 1 : 0);
  // CFB's regular season starts at Week 0; Madden's starts at Week 1.
  const firstWeek = context.rec_leagues.game === "cfb_27" ? 0 : 1;
  const weeks: TeamScheduleManualWeek[] = [];
  for (let weekNumber = firstWeek; weekNumber <= lastWeek; weekNumber++) {
    const confirmed = confirmedByWeek.get(weekNumber);
    const extra = confirmed ? resultsAndSubmissions.get(confirmed.gameId) : undefined;
    weeks.push({
      weekNumber,
      alreadyConfirmed: Boolean(confirmed),
      confirmedOpponentTeamId: confirmed?.opponentTeamId ?? null,
      confirmedOpponentName: confirmed?.opponentName ?? null,
      confirmedHomeAway: confirmed?.homeAway ?? null,
      confirmedMatchupType: confirmed?.matchupType ?? null,
      gameId: confirmed?.gameId ?? null,
      result: extra?.result ?? null,
      pendingBoxScoreSubmissionId: extra?.pendingBoxScoreSubmissionId ?? null,
      boxScoreSubmissionId: extra?.boxScoreSubmissionId ?? null,
      boxScoreStatus: extra?.boxScoreStatus ?? null,
      isBye: !confirmed && byeWeeks.has(weekNumber),
      rivalry: confirmed ? (rivalries.get(confirmed.gameId) ?? { enabled: false, optedOut: false, details: null }) : { enabled: false, optedOut: false, details: null },
    });
  }

  return {
    team: { id: team.id, name: team.name, abbreviation: team.abbreviation },
    seasonNumber,
    game: context.rec_leagues.game,
    weeks,
  };
}

export async function commitTeamScheduleDecisions(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
  decisions: Array<{ weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" }>;
  byeWeeks?: number[];
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  // Full-replace diff against the checkbox state submitted by the whole-season form — a week
  // that's unchecked and re-saved needs its bye row removed, not just left un-added.
  const desiredByeWeeks = new Set(input.byeWeeks ?? []);
  const existingByes = await supabase.from("rec_team_byes").select("week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", input.teamId);
  if (existingByes.error) throw new ApiError(500, "Failed to load existing bye weeks.", existingByes.error);
  const existingByeWeeks = new Set((existingByes.data ?? []).map((row: any) => row.week_number));
  const byeWeeksToDelete = [...existingByeWeeks].filter((week) => !desiredByeWeeks.has(week));
  const byeWeeksToInsert = [...desiredByeWeeks].filter((week) => !existingByeWeeks.has(week));
  if (byeWeeksToDelete.length) {
    const removed = await supabase.from("rec_team_byes").delete().eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", input.teamId).in("week_number", byeWeeksToDelete);
    if (removed.error) throw new ApiError(500, "Failed to clear unchecked bye weeks.", removed.error);
  }
  if (byeWeeksToInsert.length) {
    const inserted = await supabase.from("rec_team_byes").insert(byeWeeksToInsert.map((weekNumber) => ({
      id: randomUUID(), league_id: leagueId, season_number: seasonNumber, team_id: input.teamId, week_number: weekNumber, created_at: new Date().toISOString(),
    })));
    if (inserted.error) throw new ApiError(500, "Failed to save bye weeks.", inserted.error);
  }

  const saved: Array<{ weekNumber: number; skipped: boolean; reason?: string }> = [];
  for (const decision of input.decisions) {
    const awayTeamId = decision.homeAway === "away" ? input.teamId : decision.opponentTeamId;
    const homeTeamId = decision.homeAway === "away" ? decision.opponentTeamId : input.teamId;

    const placeholderTeamIds = await loadSchedulePlaceholderTeamIds(leagueId, [awayTeamId, homeTeamId]);
    if (placeholderTeamIds.has(awayTeamId) && placeholderTeamIds.has(homeTeamId)) {
      saved.push({ weekNumber: decision.weekNumber, skipped: true, reason: "placeholder_needs_real_opponent" });
      continue;
    }
    const protectedTeamIds = [awayTeamId, homeTeamId].filter((teamId) => !placeholderTeamIds.has(teamId));
    const existing = protectedTeamIds.length
      ? await supabase
          .from("rec_games")
          .select("id,week_number,home_team_id,away_team_id")
          .eq("league_id", leagueId)
          .eq("season_id", seasonId)
          .eq("week_number", decision.weekNumber)
          .or(`home_team_id.in.(${protectedTeamIds.join(",")}),away_team_id.in.(${protectedTeamIds.join(",")})`)
      : { data: [], error: null };
    if (existing.error) throw new ApiError(500, "Failed to check existing schedule matchups.", existing.error);
    const conflicts = existing.data ?? [];
    const exactMatch = conflicts.find((game: any) => game.home_team_id === homeTeamId && game.away_team_id === awayTeamId);
    if (exactMatch) {
      await assignKnownRivalryToGame(exactMatch.id);
      saved.push({ weekNumber: decision.weekNumber, skipped: false });
      continue;
    }
    if (conflicts.length) {
      const gameDescriptors = conflicts.map((game: any) => ({ id: game.id, weekNumber: game.week_number, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id }));
      const locked = await loadResultsAndPendingSubmissions(leagueId, seasonNumber, gameDescriptors);
      const lockedConflict = gameDescriptors.find((game: any) => {
        const extra = locked.get(game.id);
        return extra?.result || extra?.boxScoreSubmissionId;
      });
      if (lockedConflict) {
        saved.push({ weekNumber: decision.weekNumber, skipped: true, reason: "locked_result_or_box_score" });
        continue;
      }
      const removal = await supabase.from("rec_games").delete().in("id", conflicts.map((game: any) => game.id));
      if (removal.error) throw new ApiError(500, "Failed to clear conflicting unlocked schedule games.", removal.error);
    }
    if (false && (existing.data ?? []).length) {
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

      const savedGame = await saveManualScheduleGame({
        guildId: input.guildId,
        seasonNumber,
        weekNumber: decision.weekNumber,
        slotNumber: (weekGames.data ?? []).length + 1,
        awayTeamId,
        homeTeamId,
        requestedByDiscordId: input.requestedByDiscordId,
      });
      await assignKnownRivalryToGame(savedGame.game.id);
      saved.push({ weekNumber: decision.weekNumber, skipped: false });
    } catch (err) {
      // One bad week (e.g. a race with another commissioner's concurrent save) shouldn't
      // abort every other week in this batch — report it and keep going.
      saved.push({ weekNumber: decision.weekNumber, skipped: true, reason: err instanceof ApiError ? err.message : "save_failed" });
    }
  }

  return { saved };
}
