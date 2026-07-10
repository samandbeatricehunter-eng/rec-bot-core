// @ts-nocheck
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { buildTeamNameCandidates as buildTeamCandidates, matchTeamByName, TEAM_NAME_AUTO_MATCH_THRESHOLD as AUTO_MATCH_THRESHOLD } from "../../lib/team-name-match.js";
import { parseTeamScheduleImages, type ParsedTeamScheduleRow } from "./cfb-team-schedule.parser.js";
import { listScheduleSeason, saveManualScheduleGame } from "./schedule.service.js";

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
  // Confirmed matchup (if any) for this team, keyed by week — from either side of the game.
  const confirmedByWeek = new Map<number, { opponentTeamId: string; opponentName: string; homeAway: "home" | "away" }>();
  for (const week of season.weeks) {
    for (const game of week.games) {
      const isAway = game.away_team_id === input.teamId;
      const isHome = game.home_team_id === input.teamId;
      if (!isAway && !isHome) continue;
      const opponent = isAway ? game.home_team : game.away_team;
      confirmedByWeek.set(week.weekNumber, {
        opponentTeamId: isAway ? game.home_team_id : game.away_team_id,
        opponentName: opponent?.name ?? opponent?.abbreviation ?? "Team",
        homeAway: isAway ? "away" : "home",
      });
    }
  }

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

  return {
    team: { id: team.id, name: team.name, abbreviation: team.abbreviation },
    seasonNumber,
    weeks,
    warnings: parsed.warnings,
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
