import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

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
  const selectedSeason = Number(seasonNumber ?? context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,season_number,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr)")
    .eq("league_id", context.leagueId)
    .eq("season_number", selectedSeason)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load schedule week.", error);
  return { seasonNumber: selectedSeason, weekNumber, games: data ?? [] };
}

export async function listScheduleSeason(guildId: string, seasonNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const selectedSeason = Number(seasonNumber ?? context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,external_game_id,season_number,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,display_city,display_nick)")
    .eq("league_id", context.leagueId)
    .eq("season_number", selectedSeason)
    .order("week_number", { ascending: true })
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load season schedule.", error);

  const userIds = [...new Set((data ?? []).flatMap((game: any) => [game.away_user_id, game.home_user_id]).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load schedule Discord accounts.", accounts.error);
  const discordByUser = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  const games = (data ?? []).map((game: any) => ({
    ...game,
    away_discord_id: game.away_user_id ? discordByUser.get(game.away_user_id) ?? null : null,
    home_discord_id: game.home_user_id ? discordByUser.get(game.home_user_id) ?? null : null,
  }));

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
  const seasonNumber = Number(input.seasonNumber ?? context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
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
    .eq("season_number", seasonNumber)
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
    season_number: seasonNumber,
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
