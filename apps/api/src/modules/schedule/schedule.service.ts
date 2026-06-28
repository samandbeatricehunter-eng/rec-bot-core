import {
  DEFAULT_NFL_SEASON_BY_GAME,
  getDefaultNflScheduleForGame,
  type MaddenLeagueGame,
  type NflScheduleGame,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonContext, resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { persistStitchedUploadImage } from "../box-score/box-score.service.js";
import { parseScheduleImages } from "./schedule.parser.js";

// ─── Team abbreviation resolution (shared by score + matchup screenshot imports) ─
// In-game abbreviations that differ from our stored DB abbreviation — Madden
// labelling differences, not OCR errors. Extend as more surface.
export const MADDEN_ABBR_ALIASES: Record<string, string> = {
  AZ: "ARI",
};

type AbbrTeamRow = { id: string; abbreviation: string | null; display_abbr?: string | null; original_abbreviation?: string | null };

function normAbbr(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Map an in-game abbreviation to a team id. display_abbr wins collisions, because
// relocated teams show their display abbr in-game (and a relocated team's base
// abbreviation can equal another team's display abbr — e.g. Coyotes' base DAL vs
// the Cowboys' display DAL).
export function buildAbbrMap(teams: AbbrTeamRow[]): Map<string, string> {
  const map = new Map<string, string>();
  const put = (abbr: string | null | undefined, id: string) => {
    const k = normAbbr(abbr);
    if (k && !map.has(k)) map.set(k, id);
  };
  for (const t of teams) put(t.display_abbr, t.id);
  for (const t of teams) put(t.abbreviation, t.id);
  for (const t of teams) put(t.original_abbreviation, t.id);
  return map;
}

export function resolveScheduleAbbr(map: Map<string, string>, raw: string | null): string | null {
  const u = normAbbr(raw);
  if (!u) return null;
  return map.get(MADDEN_ABBR_ALIASES[u] ?? u) ?? map.get(u) ?? null;
}

type SaveManualScheduleGameInput = {
  guildId: string;
  seasonNumber?: number | null;
  weekNumber: number;
  slotNumber: number;
  awayTeamId: string;
  homeTeamId: string;
  requestedByDiscordId?: string | null;
};

function phaseForWeek(weekNumber: number) {
  if (weekNumber <= 18) return "regular_season";
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  if (weekNumber === 22) return "super_bowl";
  return "postseason";
}

function assertWeekSlot(input: { weekNumber: number; slotNumber?: number }) {
  if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1 || input.weekNumber > 22) {
    throw new ApiError(400, "Week must be between 1 and 22.");
  }
  if (input.slotNumber != null && (!Number.isInteger(input.slotNumber) || input.slotNumber < 1 || input.slotNumber > 32)) {
    throw new ApiError(400, "Matchup slot must be between 1 and 32.");
  }
}

export async function listScheduleTeams(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_city,display_nick,display_abbr,conference,division,is_relocated")
    .eq("league_id", context.leagueId)
    .order("conference", { ascending: true })
    .order("division", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load league teams.", error);
  return {
    league: {
      id: context.leagueId,
      seasonNumber: Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1),
      currentWeek: Number(context.rec_leagues.current_week ?? 1),
    },
    teams: data ?? [],
  };
}

export async function listScheduleWeek(guildId: string, weekNumber: number, seasonNumber?: number | null) {
  assertWeekSlot({ weekNumber });
  const context = await getCurrentLeagueContext(guildId);
  const selectedSeason = resolveSeasonNumber(context, seasonNumber);
  const seasonId = await resolveSeasonId(context.leagueId, selectedSeason);
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load schedule week.", error);
  return { seasonNumber: selectedSeason, weekNumber, games: data ?? [] };
}

export async function listScheduleSeason(guildId: string, seasonNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const selectedSeason = resolveSeasonNumber(context, seasonNumber);
  const seasonId = await resolveSeasonId(context.leagueId, selectedSeason);
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .order("week_number", { ascending: true })
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load season schedule.", error);

  // Resolve user IDs from current active team assignments rather than the stale
  // stored home_user_id/away_user_id values — those were written at schedule-import
  // time and are null when teams weren't linked to users yet.
  const teamIds = [...new Set((data ?? []).flatMap((game: any) => [game.home_team_id, game.away_team_id]).filter(Boolean))];
  const assignments = teamIds.length
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,user_id")
        .eq("league_id", context.leagueId)
        .in("team_id", teamIds)
        .eq("assignment_status", "active")
        .is("ended_at", null)
    : { data: [], error: null };
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments for schedule.", assignments.error);
  console.log(`[DEBUG listScheduleSeason] teamIds=${teamIds.length} assignments=${(assignments.data ?? []).length} leagueId=${context.leagueId}`);
  const userByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user_id]));

  const allUserIds = [...new Set([...userByTeam.values()].filter(Boolean))];
  const accounts = allUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", allUserIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load schedule Discord accounts.", accounts.error);
  const discordByUser = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  const games = (data ?? []).map((game: any) => {
    const homeUserId = userByTeam.get(game.home_team_id) ?? game.home_user_id ?? null;
    const awayUserId = userByTeam.get(game.away_team_id) ?? game.away_user_id ?? null;
    return {
      ...game,
      home_user_id: homeUserId,
      away_user_id: awayUserId,
      away_discord_id: awayUserId ? discordByUser.get(awayUserId) ?? null : null,
      home_discord_id: homeUserId ? discordByUser.get(homeUserId) ?? null : null,
    };
  });

  return {
    league: {
      id: context.leagueId,
      name: context.rec_leagues.name ?? null,
      seasonNumber: selectedSeason,
      currentWeek: Number(context.rec_leagues.current_week ?? 1),
    },
    weeks: Array.from({ length: 22 }, (_, idx) => {
      const weekNumber = idx + 1;
      return {
        weekNumber,
        phase: phaseForWeek(weekNumber),
        games: games.filter((game: any) => Number(game.week_number) === weekNumber),
      };
    }),
  };
}

export async function saveManualScheduleGame(input: SaveManualScheduleGameInput) {
  assertWeekSlot(input);
  if (input.awayTeamId === input.homeTeamId) throw new ApiError(400, "Away and home teams must be different.");

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const externalGameId = `manual:${leagueId}:${seasonNumber}:${input.weekNumber}:${input.slotNumber}`;

  const teams = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr")
    .eq("league_id", leagueId)
    .in("id", [input.awayTeamId, input.homeTeamId]);
  if (teams.error) throw new ApiError(500, "Failed to validate matchup teams.", teams.error);
  if ((teams.data ?? []).length !== 2) throw new ApiError(400, "Both teams must belong to the current league.");

  const duplicates = await supabase
    .from("rec_games")
    .select("id,external_game_id,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", input.weekNumber)
    .or(`home_team_id.in.(${input.awayTeamId},${input.homeTeamId}),away_team_id.in.(${input.awayTeamId},${input.homeTeamId})`);
  if (duplicates.error) throw new ApiError(500, "Failed to check existing schedule matchups.", duplicates.error);
  const conflicting = (duplicates.data ?? []).filter((row) => row.external_game_id !== externalGameId);
  if (conflicting.length) throw new ApiError(409, "One of those teams is already scheduled for this week.");

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("team_id", [input.awayTeamId, input.homeTeamId]);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((row) => [row.team_id, row.user_id]));

  const payload = {
    league_id: leagueId,
    season_id: seasonId,
    week_number: input.weekNumber,
    phase: phaseForWeek(input.weekNumber),
    external_game_id: externalGameId,
    away_team_id: input.awayTeamId,
    home_team_id: input.homeTeamId,
    away_user_id: userByTeam.get(input.awayTeamId) ?? null,
    home_user_id: userByTeam.get(input.homeTeamId) ?? null,
    status: "scheduled",
    updated_at: new Date().toISOString(),
  };

  const existing = await supabase
    .from("rec_games")
    .select("id")
    .eq("league_id", leagueId)
    .eq("external_game_id", externalGameId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load existing manual matchup.", existing.error);

  const result = existing.data?.id
    ? await supabase.from("rec_games").update(payload).eq("id", existing.data.id).select("*").single()
    : await supabase.from("rec_games").insert({ ...payload, created_at: new Date().toISOString() }).select("*").single();
  if (result.error) {
    if (result.error.code === "23505") throw new ApiError(409, "That manual schedule slot already exists.", result.error);
    throw new ApiError(500, "Failed to save manual matchup.", result.error);
  }

  return {
    game: result.data,
    week: await listScheduleWeek(input.guildId, input.weekNumber, seasonNumber),
  };
}

type ParsedScheduleMatchup = {
  awayTeamId: string;
  homeTeamId: string;
  slotNumber: number;
};

function buildNflSlotTeamMap(teams: Array<{ id: string; abbreviation: string; original_abbreviation?: string | null }>) {
  const map = new Map<string, string>();
  for (const team of teams) {
    map.set(team.abbreviation.toUpperCase(), team.id);
    if (team.original_abbreviation) map.set(team.original_abbreviation.toUpperCase(), team.id);
  }
  return map;
}

async function loadLeagueTeamSlotMap(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_teams")
    .select("id,abbreviation,original_abbreviation")
    .eq("league_id", leagueId);
  if (error) throw new ApiError(500, "Failed to load league teams for schedule seeding.", error);
  return buildNflSlotTeamMap(data ?? []);
}

async function loadUserIdsByTeam(leagueId: string, teamIds: string[]) {
  if (!teamIds.length) return new Map<string, string>();
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("team_id", teamIds);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments for schedule seeding.", assignments.error);
  return new Map((assignments.data ?? []).map((row) => [row.team_id, row.user_id]));
}

function resolveTemplateGames(game: MaddenLeagueGame): NflScheduleGame[] {
  return getDefaultNflScheduleForGame(game);
}

function defaultExternalGameId(leagueId: string, seasonNumber: number, weekNumber: number, slotNumber: number) {
  return `default:${leagueId}:${seasonNumber}:${weekNumber}:${slotNumber}`;
}

function parsedExternalGameId(leagueId: string, seasonNumber: number, weekNumber: number, slotNumber: number) {
  return `parsed:${leagueId}:${seasonNumber}:${weekNumber}:${slotNumber}`;
}

async function insertScheduleGames(input: {
  leagueId: string;
  guildId: string;
  seasonId: string;
  seasonNumber: number;
  games: ParsedScheduleMatchup[];
  weekNumber: number;
  externalGameIdForSlot: (slotNumber: number) => string;
  requestedByDiscordId?: string | null;
  auditAction: string;
}) {
  const teamIds = [...new Set(input.games.flatMap((game) => [game.awayTeamId, game.homeTeamId]))];
  const userByTeam = await loadUserIdsByTeam(input.leagueId, teamIds);
  const now = new Date().toISOString();
  const rows = input.games.map((game) => ({
    league_id: input.leagueId,
    season_id: input.seasonId,
    week_number: input.weekNumber,
    phase: phaseForWeek(input.weekNumber),
    external_game_id: input.externalGameIdForSlot(game.slotNumber),
    away_team_id: game.awayTeamId,
    home_team_id: game.homeTeamId,
    away_user_id: userByTeam.get(game.awayTeamId) ?? null,
    home_user_id: userByTeam.get(game.homeTeamId) ?? null,
    status: "scheduled",
    created_at: now,
    updated_at: now,
  }));

  const result = await supabase.from("rec_games").insert(rows).select("id");
  if (result.error) throw new ApiError(500, "Failed to save schedule games.", result.error);

  await writeAuditLog({
    action: input.auditAction,
    entityType: "rec_games",
    newValue: {
      guildId: input.guildId,
      leagueId: input.leagueId,
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
      gameCount: rows.length,
      requestedByDiscordId: input.requestedByDiscordId ?? null,
    },
    reason: "Schedule games saved for league.",
    source: "manual_admin_entry",
  });

  return rows.length;
}

export async function seedDefaultScheduleForGuild(input: {
  guildId: string;
  requestedByDiscordId?: string | null;
  force?: boolean;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const game = context.rec_leagues.game as string | null;
  if (game !== "madden_26" && game !== "madden_27") {
    return { seeded: false as const, reason: "unsupported_game" as const, gameCount: 0 };
  }

  const seasonNumber = resolveSeasonNumber(context, null);
  if (seasonNumber !== 1) {
    return { seeded: false as const, reason: "not_league_year_one" as const, gameCount: 0 };
  }

  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  const configuration = await supabase
    .from("rec_league_configuration")
    .select("default_schedule_seed_requested,default_schedule_seeded_at")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (configuration.error) throw new ApiError(500, "Failed to load league configuration.", configuration.error);
  if (!configuration.data?.default_schedule_seed_requested) {
    return { seeded: false as const, reason: "not_requested" as const, gameCount: 0 };
  }
  if (configuration.data.default_schedule_seeded_at && !input.force) {
    return {
      seeded: false as const,
      reason: "already_seeded" as const,
      gameCount: 0,
      seededAt: configuration.data.default_schedule_seeded_at,
    };
  }

  const slotMap = await loadLeagueTeamSlotMap(leagueId);
  const template = resolveTemplateGames(game as MaddenLeagueGame);
  const nflSeason = DEFAULT_NFL_SEASON_BY_GAME[game as MaddenLeagueGame];
  const missingAbbrs = new Set<string>();
  for (const gameRow of template) {
    if (!slotMap.has(gameRow.away.toUpperCase())) missingAbbrs.add(gameRow.away);
    if (!slotMap.has(gameRow.home.toUpperCase())) missingAbbrs.add(gameRow.home);
  }
  if (missingAbbrs.size) {
    throw new ApiError(
      409,
      `Cannot seed default schedule until default NFL teams exist. Missing slots: ${[...missingAbbrs].sort().join(", ")}.`
    );
  }

  const existing = await supabase
    .from("rec_games")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .lte("week_number", 18);
  if (existing.error) throw new ApiError(500, "Failed to check existing schedule.", existing.error);
  if ((existing.count ?? 0) > 0 && !input.force) {
    return { seeded: false as const, reason: "schedule_exists" as const, gameCount: existing.count ?? 0 };
  }

  if ((existing.count ?? 0) > 0 && input.force) {
    const removal = await supabase
      .from("rec_games")
      .delete()
      .eq("league_id", leagueId)
      .eq("season_id", seasonId)
      .lte("week_number", 18);
    if (removal.error) throw new ApiError(500, "Failed to clear existing regular-season schedule.", removal.error);
  }

  const gamesByWeek = new Map<number, ParsedScheduleMatchup[]>();
  for (const gameRow of template) {
    const weekGames = gamesByWeek.get(gameRow.week) ?? [];
    weekGames.push({
      awayTeamId: slotMap.get(gameRow.away.toUpperCase())!,
      homeTeamId: slotMap.get(gameRow.home.toUpperCase())!,
      slotNumber: weekGames.length + 1,
    });
    gamesByWeek.set(gameRow.week, weekGames);
  }

  let gameCount = 0;
  for (const weekNumber of [...gamesByWeek.keys()].sort((a, b) => a - b)) {
    gameCount += await insertScheduleGames({
      leagueId,
      guildId: input.guildId,
      seasonId,
      seasonNumber,
      weekNumber,
      games: gamesByWeek.get(weekNumber)!,
      externalGameIdForSlot: (slotNumber) => defaultExternalGameId(leagueId, seasonNumber, weekNumber, slotNumber),
      requestedByDiscordId: input.requestedByDiscordId,
      auditAction: "schedule.default_nfl_seeded",
    });
  }

  const seededAt = new Date().toISOString();
  const update = await supabase
    .from("rec_league_configuration")
    .update({ default_schedule_seeded_at: seededAt, updated_at: seededAt })
    .eq("league_id", leagueId);
  if (update.error) throw new ApiError(500, "Failed to mark default schedule as seeded.", update.error);

  await writeAuditLog({
    action: "schedule.default_nfl_seed_completed",
    entityType: "rec_league_configuration",
    entityId: leagueId,
    newValue: {
      guildId: input.guildId,
      leagueId,
      game,
      nflSeason,
      gameCount,
      requestedByDiscordId: input.requestedByDiscordId ?? null,
    },
    reason: `Seeded default ${nflSeason} NFL regular-season schedule.`,
    source: "manual_admin_entry",
  });

  return { seeded: true as const, reason: "seeded" as const, gameCount, seededAt, nflSeason };
}

export async function replaceScheduleWeek(input: {
  guildId: string;
  seasonNumber?: number | null;
  weekNumber: number;
  games: Array<{ awayTeamId: string; homeTeamId: string }>;
  requestedByDiscordId?: string | null;
}) {
  assertWeekSlot({ weekNumber: input.weekNumber });
  if (input.weekNumber > 18) throw new ApiError(400, "Screenshot schedule imports are limited to regular-season weeks 1–18.");

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  if (!input.games.length) throw new ApiError(400, "At least one parsed matchup is required.");

  const teamIds = [...new Set(input.games.flatMap((game) => [game.awayTeamId, game.homeTeamId]))];
  const teams = await supabase.from("rec_teams").select("id").eq("league_id", leagueId).in("id", teamIds);
  if (teams.error) throw new ApiError(500, "Failed to validate parsed schedule teams.", teams.error);
  if ((teams.data ?? []).length !== teamIds.length) throw new ApiError(400, "All parsed teams must belong to the current league.");

  const removal = await supabase
    .from("rec_games")
    .delete()
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", input.weekNumber);
  if (removal.error) throw new ApiError(500, "Failed to clear existing week schedule.", removal.error);

  const parsedGames = input.games.map((game, index) => ({
    awayTeamId: game.awayTeamId,
    homeTeamId: game.homeTeamId,
    slotNumber: index + 1,
  }));

  const gameCount = await insertScheduleGames({
    leagueId,
    guildId: input.guildId,
    seasonId,
    seasonNumber,
    weekNumber: input.weekNumber,
    games: parsedGames,
    externalGameIdForSlot: (slotNumber) => parsedExternalGameId(leagueId, seasonNumber, input.weekNumber, slotNumber),
    requestedByDiscordId: input.requestedByDiscordId,
    auditAction: "schedule.week_replaced_from_parse",
  });

  return {
    seasonNumber,
    weekNumber: input.weekNumber,
    gameCount,
    week: await listScheduleWeek(input.guildId, input.weekNumber, seasonNumber),
  };
}

export async function trySeedDefaultScheduleAfterTeamsReady(input: {
  guildId: string;
  requestedByDiscordId?: string | null;
}) {
  return seedDefaultScheduleForGuild(input);
}

// ─── Matchup import from a League Schedule screenshot ───────────────────────────

export type ScheduleImportGame = {
  awayTeamId: string | null;
  homeTeamId: string | null;
  awayLabel: string;
  homeLabel: string;
  matched: boolean;
};

export type ScheduleImportPreview = {
  seasonNumber: number;
  weekNumber: number;
  expectedGames: number;
  games: ScheduleImportGame[];
  matchedCount: number;
  warnings: string[];
  imageUrl: string | null;
};

function nickNorm(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

// Nickname → team id, as a fallback when the RESULT abbr can't be read (the MATCHUP
// column is often legible on rows whose result is not). Keys: display_nick, full
// name, and the last word of the name (e.g. "Vikings" from "Minnesota Vikings").
function buildNickMap(teams: Array<{ id: string; name: string | null; display_nick?: string | null }>): Map<string, string> {
  const map = new Map<string, string>();
  const put = (s: string | null | undefined, id: string) => {
    const k = nickNorm(s);
    if (k.length >= 3 && !map.has(k)) map.set(k, id);
  };
  for (const t of teams) {
    put(t.display_nick, t.id);
    put(t.name, t.id);
    const words = String(t.name ?? "").trim().split(/\s+/);
    if (words.length > 1) put(words[words.length - 1], t.id);
  }
  return map;
}

export async function previewScheduleImport(input: {
  guildId: string;
  weekNumber: number;
  imageUrls: string[];
}): Promise<ScheduleImportPreview> {
  assertWeekSlot({ weekNumber: input.weekNumber });
  if (input.weekNumber > 18) throw new ApiError(400, "Screenshot schedule imports are limited to regular-season weeks 1–18.");

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const teamsRes = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr,display_city,display_nick,original_abbreviation")
    .eq("league_id", leagueId);
  if (teamsRes.error) throw new ApiError(500, "Failed to load league teams for schedule import.", teamsRes.error);
  const teams = teamsRes.data ?? [];

  const abbrMap = buildAbbrMap(teams);
  const nickMap = buildNickMap(teams);
  const labelById = new Map(teams.map((t) => [t.id, formatTeamDisplayName(t) ?? t.name ?? t.display_abbr ?? t.abbreviation ?? "Team"]));
  const resolve = (abbr: string | null, nick: string | null): string | null =>
    resolveScheduleAbbr(abbrMap, abbr) ?? (nick ? nickMap.get(nickNorm(nick)) ?? null : null);

  const parsed = await parseScheduleImages(input.imageUrls);

  const seen = new Set<string>();
  const games: ScheduleImportGame[] = [];
  for (const p of parsed.games) {
    const awayTeamId = resolve(p.awayAbbr, p.awayNick);
    const homeTeamId = resolve(p.homeAbbr, p.homeNick);
    const matched = !!(awayTeamId && homeTeamId && awayTeamId !== homeTeamId);
    if (matched) {
      const k = `${awayTeamId}:${homeTeamId}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    games.push({
      awayTeamId,
      homeTeamId,
      awayLabel: (awayTeamId ? labelById.get(awayTeamId) : null) ?? p.awayNick ?? p.awayAbbr ?? "?",
      homeLabel: (homeTeamId ? labelById.get(homeTeamId) : null) ?? p.homeNick ?? p.homeAbbr ?? "?",
      matched,
    });
  }

  const imageUrl = input.imageUrls.length
    ? await persistStitchedUploadImage(`schedimport-${leagueId}-${seasonNumber}-${input.weekNumber}`, input.imageUrls)
    : null;

  return {
    seasonNumber,
    weekNumber: input.weekNumber,
    expectedGames: Math.floor(teams.length / 2),
    games,
    matchedCount: games.filter((g) => g.matched).length,
    warnings: parsed.warnings,
    imageUrl: imageUrl ?? input.imageUrls[0] ?? null,
  };
}
