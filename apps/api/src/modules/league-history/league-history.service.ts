// Season-by-season League History — tabs of completed seasons with each coach's record,
// postseason results, bowl/championship outcomes, three power-ranking snapshots (start/mid/
// end), and the final CFB Top 25. Shared by the authenticated site nav page and the public
// /viewleague page — nothing here is more sensitive than what's already public on standings.
import { isCfb, type LeagueGame } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

// "Midpoint" power-ranking week per game type — CFB's regular season peaks around week 7,
// Madden's around week 9 (Samuel's call; there's no single neutral "half the season" week
// that works for both once bye weeks/postseason length are folded in).
function midSeasonWeek(game: LeagueGame): number {
  return isCfb(game) ? 7 : 9;
}

function teamName(t: { name?: string | null; display_city?: string | null; display_nick?: string | null; is_relocated?: boolean | null } | null | undefined): string {
  return formatTeamDisplayName(t) ?? t?.name ?? "Team";
}

type TeamRow = { id: string; name: string | null; abbreviation: string | null; display_abbr: string | null; display_city: string | null; display_nick: string | null; is_relocated: boolean | null };

type GameResultRow = {
  id: string; game_id: string | null; week_number: number | null;
  home_team_id: string | null; away_team_id: string | null;
  home_user_id: string | null; away_user_id: string | null;
  home_score: number | null; away_score: number | null;
  winning_team_id: string | null; losing_team_id: string | null;
  is_tie: boolean | null; is_playoff: boolean | null; is_super_bowl: boolean | null;
};

// Every user's "team" for a past season isn't stored anywhere directly (team assignments
// only track current occupancy, not season-scoped history) — infer it from whichever team_id
// shows up most often for that user in that season's logged results.
function primaryTeamForUsers(results: GameResultRow[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const bump = (userId: string | null, teamId: string | null) => {
    if (!userId || !teamId) return;
    const byTeam = counts.get(userId) ?? new Map<string, number>();
    byTeam.set(teamId, (byTeam.get(teamId) ?? 0) + 1);
    counts.set(userId, byTeam);
  };
  for (const g of results) {
    bump(g.home_user_id, g.home_team_id);
    bump(g.away_user_id, g.away_team_id);
  }
  const primary = new Map<string, string>();
  for (const [userId, byTeam] of counts) {
    let bestTeam: string | null = null, bestCount = -1;
    for (const [teamId, count] of byTeam) if (count > bestCount) { bestTeam = teamId; bestCount = count; }
    if (bestTeam) primary.set(userId, bestTeam);
  }
  return primary;
}

export type LeagueHistorySeason = {
  seasonNumber: number;
  teamRecords: Array<{ userId: string; coachName: string; teamId: string | null; teamName: string; abbr: string | null; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>;
  postseasonGames: Array<{ weekNumber: number | null; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; winner: string | null; isBowl: boolean; bowlName: string | null; isNationalChampionship: boolean; isSuperBowl: boolean; postseasonRound: string | null }>;
  bowlWinners: Array<{ bowlName: string | null; winner: string | null; loser: string | null; score: string | null }>;
  championship: { winner: string | null; runnerUp: string | null; score: string | null } | null;
  powerRankings: {
    start: Array<{ rank: number; teamName: string; score: number }>; startWeek: number | null;
    mid: Array<{ rank: number; teamName: string; score: number }>; midWeek: number | null;
    end: Array<{ rank: number; teamName: string; score: number }>; endWeek: number | null;
  };
  finalTop25: Array<{ rank: number; teamName: string; conferenceChampion: boolean }>;
};

async function buildSeasonHistory(leagueId: string, seasonNumber: number, game: LeagueGame, teamById: Map<string, TeamRow>): Promise<LeagueHistorySeason> {
  const [resultsRes, recordsRes, snapshotsRes] = await Promise.all([
    supabase.from("rec_game_results")
      .select("id,game_id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,is_playoff,is_super_bowl")
      .eq("league_id", leagueId).eq("season_number", seasonNumber),
    supabase.from("rec_season_user_records")
      .select("user_id,wins,losses,ties,points_for,points_against,user:rec_users(display_name)")
      .eq("league_id", leagueId).eq("season_number", seasonNumber),
    supabase.from("rec_power_ranking_snapshots").select("week_number,team_id,rank,score").eq("league_id", leagueId).eq("season_number", seasonNumber),
  ]);
  if (resultsRes.error) throw new ApiError(500, "Failed to load season results for league history.", resultsRes.error);
  if (recordsRes.error) throw new ApiError(500, "Failed to load season records for league history.", recordsRes.error);
  if (snapshotsRes.error) throw new ApiError(500, "Failed to load power-ranking snapshots for league history.", snapshotsRes.error);

  const results = (resultsRes.data ?? []) as GameResultRow[];
  const primaryTeam = primaryTeamForUsers(results);

  const teamRecords = (recordsRes.data ?? []).map((r: any) => {
    const tId = primaryTeam.get(r.user_id) ?? null;
    const t = tId ? teamById.get(tId) : null;
    return {
      userId: r.user_id,
      coachName: r.user?.display_name ?? "REC Member",
      teamId: tId,
      teamName: t ? teamName(t) : "Unassigned",
      abbr: t?.display_abbr ?? t?.abbreviation ?? null,
      wins: Number(r.wins ?? 0), losses: Number(r.losses ?? 0), ties: Number(r.ties ?? 0),
      pointsFor: Number(r.points_for ?? 0), pointsAgainst: Number(r.points_against ?? 0),
    };
  }).sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.wins - a.wins);

  // Postseason: CFB tags bowls/national championship on rec_games (joined via game_id);
  // Madden's playoff/Super Bowl flags already live directly on rec_game_results.
  const postseasonResults = results.filter((g) => g.is_playoff || g.is_super_bowl);
  const gameIds = postseasonResults.map((g) => g.game_id).filter((id): id is string => Boolean(id));
  let gameMetaById = new Map<string, { is_bowl_game: boolean | null; is_national_championship: boolean | null; bowl_name: string | null; postseason_round: string | null }>();
  if (isCfb(game) && gameIds.length) {
    const gamesRes = await supabase.from("rec_games").select("id,is_bowl_game,is_national_championship,bowl_name,postseason_round").in("id", gameIds);
    if (gamesRes.error) throw new ApiError(500, "Failed to load postseason game metadata for league history.", gamesRes.error);
    gameMetaById = new Map((gamesRes.data ?? []).map((row: any) => [row.id, row]));
  }

  const postseasonGames = postseasonResults
    .map((g) => {
      const meta = g.game_id ? gameMetaById.get(g.game_id) : undefined;
      const homeName = teamName(teamById.get(g.home_team_id ?? "") ?? null);
      const awayName = teamName(teamById.get(g.away_team_id ?? "") ?? null);
      const winnerName = g.winning_team_id ? teamName(teamById.get(g.winning_team_id) ?? null) : null;
      return {
        weekNumber: g.week_number, homeTeam: homeName, awayTeam: awayName,
        homeScore: g.home_score, awayScore: g.away_score, winner: winnerName,
        isBowl: Boolean(meta?.is_bowl_game), bowlName: meta?.bowl_name ?? null,
        isNationalChampionship: Boolean(meta?.is_national_championship), isSuperBowl: Boolean(g.is_super_bowl),
        postseasonRound: meta?.postseason_round ?? null,
      };
    })
    .sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0));

  const bowlWinners = postseasonGames.filter((g) => g.isBowl).map((g) => {
    const loser = g.winner === g.homeTeam ? g.awayTeam : g.homeTeam;
    const score = g.homeScore != null && g.awayScore != null ? `${Math.max(g.homeScore, g.awayScore)}-${Math.min(g.homeScore, g.awayScore)}` : null;
    return { bowlName: g.bowlName, winner: g.winner, loser, score };
  });

  const championshipGame = isCfb(game) ? postseasonGames.find((g) => g.isNationalChampionship) : postseasonGames.find((g) => g.isSuperBowl);
  const championship = championshipGame
    ? {
        winner: championshipGame.winner,
        runnerUp: championshipGame.winner === championshipGame.homeTeam ? championshipGame.awayTeam : championshipGame.homeTeam,
        score: championshipGame.homeScore != null && championshipGame.awayScore != null
          ? `${Math.max(championshipGame.homeScore, championshipGame.awayScore)}-${Math.min(championshipGame.homeScore, championshipGame.awayScore)}`
          : null,
      }
    : null;

  // Power-ranking snapshots: start = earliest logged week, end = latest, mid = the game's
  // configured midpoint week if a snapshot exists for it, else whichever logged week is closest.
  const snapshots = snapshotsRes.data ?? [];
  const weeksAvailable: number[] = Array.from(new Set<number>(snapshots.map((r: any) => Number(r.week_number)))).sort((a: number, b: number) => a - b);
  const startWeek: number | null = weeksAvailable[0] ?? null;
  const endWeek: number | null = weeksAvailable.length ? weeksAvailable[weeksAvailable.length - 1] : null;
  const targetMid = midSeasonWeek(game);
  const midWeek: number | null = weeksAvailable.length
    ? weeksAvailable.reduce((best: number, w: number) => (Math.abs(w - targetMid) < Math.abs(best - targetMid) ? w : best), weeksAvailable[0])
    : null;
  function snapshotFor(week: number | null) {
    if (week == null) return [];
    return snapshots
      .filter((r: any) => Number(r.week_number) === week)
      .sort((a: any, b: any) => Number(a.rank) - Number(b.rank))
      .map((r: any) => ({ rank: Number(r.rank), teamName: teamName(teamById.get(r.team_id) ?? null), score: Number(r.score ?? 0) }));
  }
  const powerRankings = {
    start: snapshotFor(startWeek), startWeek,
    mid: snapshotFor(midWeek), midWeek,
    end: snapshotFor(endWeek), endWeek,
  };

  let finalTop25: LeagueHistorySeason["finalTop25"] = [];
  if (isCfb(game)) {
    const top25Res = await supabase.from("rec_cfp_rankings").select("rank,team_id,conference_champion")
      .eq("league_id", leagueId).eq("season_number", seasonNumber).lte("rank", 25).order("rank", { ascending: true });
    if (top25Res.error) throw new ApiError(500, "Failed to load final Top 25 for league history.", top25Res.error);
    finalTop25 = (top25Res.data ?? []).map((r: any) => ({ rank: Number(r.rank), teamName: teamName(teamById.get(r.team_id) ?? null), conferenceChampion: Boolean(r.conference_champion) }));
  }

  return { seasonNumber, teamRecords, postseasonGames, bowlWinners, championship, powerRankings, finalTop25 };
}

export async function getLeagueHistory(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const game = context.rec_leagues.game as LeagueGame;
  const currentSeason = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const [seasonsRes, teamsRes] = await Promise.all([
    supabase.from("rec_seasons").select("display_season_number").eq("league_id", leagueId).lt("display_season_number", currentSeason),
    supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated").eq("league_id", leagueId),
  ]);
  if (seasonsRes.error) throw new ApiError(500, "Failed to load completed seasons.", seasonsRes.error);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for league history.", teamsRes.error);

  const teamById = new Map<string, TeamRow>((teamsRes.data ?? []).map((t: any) => [t.id, t]));
  const seasonNumbers: number[] = Array.from(new Set<number>((seasonsRes.data ?? []).map((r: any) => Number(r.display_season_number)))).sort((a: number, b: number) => b - a);

  const seasons = await Promise.all(seasonNumbers.map((n: number) => buildSeasonHistory(leagueId, n, game, teamById)));

  return {
    league: { name: context.rec_leagues.name ?? "REC League", game },
    currentSeason,
    seasons: seasons.filter((s) => s.teamRecords.length > 0 || s.postseasonGames.length > 0),
  };
}
