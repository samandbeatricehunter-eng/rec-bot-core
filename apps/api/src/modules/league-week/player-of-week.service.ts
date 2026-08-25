// Player of the Week -- one offense + one defense winner per conference (AFC/NFC) per week,
// scored with a community-deconstructed approximation of Madden's own grading (see
// packages/shared/src/player-of-week.ts for the formula and its documented limitation).
// Read-only/compute-on-demand for now, same pattern GOTW nomination uses -- no persistence,
// no auto-posting; this exposes the computation for a caller (advance flow, a future Discord
// post) to act on.
import {
  defensePlayerOfWeekScore,
  emptyWeeklyPlayerStatLine,
  hasDefensiveStatLine,
  hasOffensiveStatLine,
  offensePlayerOfWeekScore,
  type WeeklyPlayerStatLine,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

const STAT_KEY_MAP: Record<keyof WeeklyPlayerStatLine, string> = {
  passYards: "pass_yards",
  rushYards: "rush_yards",
  receivingYards: "receiving_yards",
  passTds: "pass_tds",
  rushTds: "rush_tds",
  receivingTds: "receiving_tds",
  interceptionsThrown: "interceptions_thrown",
  rushingFumbles: "rushing_fumbles",
  sacks: "sacks",
  interceptions: "interceptions",
  tacklesForLoss: "tackles_for_loss",
  defensiveTds: "defensive_tds",
};

function num(value: unknown): number {
  return Number(value) || 0;
}

export type PlayerOfWeekWinner = {
  conference: "AFC" | "NFC";
  side: "offense" | "defense";
  playerId: string;
  playerName: string;
  position: string | null;
  teamId: string;
  teamName: string;
  score: number;
  statLine: WeeklyPlayerStatLine;
};

export async function computeWeeklyPlayerOfWeek(guildId: string, weekNumber: number): Promise<PlayerOfWeekWinner[]> {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  const statsRes = await supabase
    .from("rec_player_weekly_stats")
    .select("player_id,team_id,position,player_name,stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (statsRes.error) throw new ApiError(500, "We couldn't load player stats for this week. Please try again.", statsRes.error);
  const rows = (statsRes.data ?? []) as Array<{ player_id: string | null; team_id: string | null; position: string | null; player_name: string | null; stats: Record<string, unknown> | null }>;
  if (!rows.length) return [];

  const teamIds = [...new Set(rows.flatMap((row) => (row.team_id ? [row.team_id] : [])))];
  const teamsRes = teamIds.length
    ? await supabase.from("rec_teams").select("id,conference,name,display_city,display_nick,is_relocated").in("id", teamIds)
    : { data: [] as any[], error: null };
  if (teamsRes.error) throw new ApiError(500, "We couldn't load team conferences for this week. Please try again.", teamsRes.error);
  const teamById = new Map<string, any>((teamsRes.data ?? []).map((team: any) => [team.id, team]));

  type PlayerAgg = { playerId: string; playerName: string; position: string | null; teamId: string; line: WeeklyPlayerStatLine };
  const byPlayer = new Map<string, PlayerAgg>();
  for (const row of rows) {
    if (!row.player_id || !row.team_id) continue;
    const agg = byPlayer.get(row.player_id) ?? {
      playerId: row.player_id, playerName: row.player_name ?? "Player", position: row.position ?? null,
      teamId: row.team_id, line: emptyWeeklyPlayerStatLine(),
    };
    const stats = row.stats ?? {};
    for (const [field, canonicalKey] of Object.entries(STAT_KEY_MAP) as Array<[keyof WeeklyPlayerStatLine, string]>) {
      agg.line[field] += num(stats[canonicalKey]);
    }
    if (row.position) agg.position = row.position;
    byPlayer.set(row.player_id, agg);
  }

  const winners: PlayerOfWeekWinner[] = [];
  for (const conference of ["AFC", "NFC"] as const) {
    const inConference = [...byPlayer.values()].filter((player) => teamById.get(player.teamId)?.conference === conference);

    const topOffense = inConference
      .filter((player) => hasOffensiveStatLine(player.line))
      .map((player) => ({ player, score: offensePlayerOfWeekScore(player.line) }))
      .sort((a, b) => b.score - a.score || a.player.playerName.localeCompare(b.player.playerName))[0];
    if (topOffense) winners.push(toWinner(conference, "offense", topOffense.player, topOffense.score, teamById));

    const topDefense = inConference
      .filter((player) => hasDefensiveStatLine(player.line))
      .map((player) => ({ player, score: defensePlayerOfWeekScore(player.line) }))
      .sort((a, b) => b.score - a.score || a.player.playerName.localeCompare(b.player.playerName))[0];
    if (topDefense) winners.push(toWinner(conference, "defense", topDefense.player, topDefense.score, teamById));
  }
  return winners;
}

function toWinner(
  conference: "AFC" | "NFC", side: "offense" | "defense",
  player: { playerId: string; playerName: string; position: string | null; teamId: string; line: WeeklyPlayerStatLine },
  score: number,
  teamById: Map<string, any>,
): PlayerOfWeekWinner {
  const team = teamById.get(player.teamId);
  return {
    conference, side,
    playerId: player.playerId, playerName: player.playerName, position: player.position,
    teamId: player.teamId, teamName: team ? (formatTeamDisplayName(team) ?? team.name ?? "Team") : "Team",
    score: Math.round(score * 10) / 10, statLine: player.line,
  };
}
