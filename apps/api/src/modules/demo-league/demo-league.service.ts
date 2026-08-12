// Public, read-only "try before you sign up" preview — lets a visitor with no account browse
// a real current league (Campus Buzz feed, a team's matchup/roster, League History, standings)
// as if they were sitting in that team's seat. Nothing here can mutate anything: every query is
// a plain select, there is no session, and no route in this module accepts a write.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { getPublicLeagueSnapshot } from "../public-league/public-league.service.js";
import { getLeagueHistory } from "../league-history/league-history.service.js";
import { type DemoPhase, getDemoPhaseContent } from "./demo-league-fixtures.js";
import { getLeagueStatsForLeagueId, getLeagueTeamStatsForLeagueId } from "../league-stats/league-stats.service.js";

export type { DemoPhase } from "./demo-league-fixtures.js";

// Which phases each league's game type actually offers a scenario for — Madden gets an extra
// "draft" phase, CFB doesn't have a fantasy draft at all.
export function listDemoPhases(game: string): Array<{ value: DemoPhase; label: string }> {
  const base: Array<{ value: DemoPhase; label: string }> = [
    { value: "live", label: "Current (Live)" },
    { value: "week1", label: "Week 1" },
    { value: "playoffs", label: "Playoffs" },
    { value: "championship", label: "Championship" },
  ];
  if (game === "madden_27" || game === "madden_26") base.push({ value: "draft", label: "Fantasy Draft" });
  return base;
}

// The two leagues actually featured — deliberately not "every league on the site" (that would
// let anyone browse leagues that never opted into being a public showcase). Update this map if
// the leagues used for the demo change. guildId lets Standings/League History reuse the
// existing public-league endpoints (they're keyed by guild, not league id).
const DEMO_LEAGUE_GUILDS: Record<string, string> = {
  "b7cca5ad-8f0a-4305-a4df-22f5f396874d": "1517544683495227392",
  "e342e8bd-71ad-40f6-96f9-2731d702755c": "1476251181524189438",
};
const DEMO_LEAGUE_IDS = Object.keys(DEMO_LEAGUE_GUILDS);

async function requireDemoLeague(leagueId: string) {
  if (!DEMO_LEAGUE_IDS.includes(leagueId)) throw new ApiError(404, "That league isn't available in the demo.");
  const { data, error } = await supabase.from("rec_leagues").select("id,name,game,season_number,current_week").eq("id", leagueId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load demo league.", error);
  if (!data) throw new ApiError(404, "Demo league not found.");
  return data;
}

export async function listDemoLeagues() {
  const { data, error } = await supabase.from("rec_leagues").select("id,name,game,season_number").in("id", DEMO_LEAGUE_IDS);
  if (error) throw new ApiError(500, "Failed to load demo leagues.", error);
  return {
    leagues: (data ?? []).map((row: any) => ({
      id: row.id, name: row.name, game: row.game, seasonNumber: row.season_number,
      phases: listDemoPhases(row.game),
    })),
  };
}

export async function listDemoTeams(leagueId: string) {
  const league = await requireDemoLeague(leagueId);
  const teams = await supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated,conference,division").eq("league_id", leagueId).order("conference").order("name");
  if (teams.error) throw new ApiError(500, "Failed to load teams.", teams.error);
  const assignments = await supabase.from("rec_team_assignments").select("team_id,user:rec_users(display_name)").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
  const coachByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user?.display_name ?? "REC Coach"]));
  const userTeams = (teams.data ?? []).filter((team: any) => coachByTeam.has(team.id));
  return {
    league: { id: league.id, name: league.name, game: league.game },
    teams: userTeams.map((team: any) => ({
      id: team.id, name: formatTeamDisplayName(team) ?? team.name, abbr: team.display_abbr ?? team.abbreviation ?? null,
      conference: team.conference ?? null, coachName: coachByTeam.get(team.id) ?? "REC Coach",
    })),
  };
}

export async function getDemoNewsFeed(leagueId: string, phase: DemoPhase = "live") {
  const league = await requireDemoLeague(leagueId);
  if (phase !== "live") {
    const content = getDemoPhaseContent(league.game as string, phase);
    return { posts: content?.news ?? [], demo: true, phaseLabel: content?.phaseLabel ?? phase };
  }
  const { data, error } = await supabase.from("rec_hub_announcements").select("id,title,body,created_at").eq("league_id", leagueId).order("created_at", { ascending: false }).limit(15);
  if (error) throw new ApiError(500, "Failed to load news feed.", error);
  return { posts: (data ?? []).map((row: any) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at })), demo: false };
}

export async function getDemoTeamMatchup(leagueId: string, teamId: string, phase: DemoPhase = "live") {
  const league = await requireDemoLeague(leagueId);
  if (phase !== "live") {
    const content = getDemoPhaseContent(league.game as string, phase);
    if (phase === "draft") return { weekNumber: null, matchup: null, draftBoard: content?.draftBoard ?? [], demo: true, phaseLabel: content?.phaseLabel ?? phase };
    const teams = await listDemoTeams(leagueId);
    const teamName = teams.teams.find((t) => t.id === teamId)?.name;
    const matchup = (teamName && content?.matchupByTeam[teamName]) ?? null;
    return { weekNumber: null, matchup, demo: true, phaseLabel: content?.phaseLabel ?? phase };
  }
  const seasonNumber = Number(league.season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const games = await leagueWeekGamesQuery(supabase, { leagueId, seasonId, weekNumber },
    "id,week_number,home_score,away_score,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,display_nick,display_city,display_abbr,abbreviation,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,display_nick,display_city,display_abbr,abbreviation,is_relocated)")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .limit(1).maybeSingle();
  if (games.error) throw new ApiError(500, "Failed to load matchup.", games.error);
  if (!games.data) return { weekNumber, matchup: null, demo: false };
  const g: any = games.data;
  return {
    weekNumber,
    demo: false,
    matchup: {
      homeTeam: formatTeamDisplayName(g.home_team) ?? g.home_team?.name, awayTeam: formatTeamDisplayName(g.away_team) ?? g.away_team?.name,
      homeScore: g.home_score, awayScore: g.away_score, status: g.status,
    },
  };
}

export async function getDemoStandings(leagueId: string, phase: DemoPhase = "live") {
  const league = await requireDemoLeague(leagueId);
  if (phase !== "live") {
    const content = getDemoPhaseContent(league.game as string, phase);
    return {
      demo: true,
      phaseLabel: content?.phaseLabel ?? phase,
      standings: (content?.standings ?? []).map((row) => ({ team: row.team, wins: row.wins, losses: row.losses, ties: row.ties })),
    };
  }
  const guildId = DEMO_LEAGUE_GUILDS[leagueId];
  if (!guildId) throw new ApiError(404, "That league isn't available in the demo.");
  const snapshot = await getPublicLeagueSnapshot(guildId);
  return { ...snapshot, demo: false };
}

export async function getDemoLeagueHistory(leagueId: string) {
  await requireDemoLeague(leagueId);
  const guildId = DEMO_LEAGUE_GUILDS[leagueId];
  if (!guildId) throw new ApiError(404, "That league isn't available in the demo.");
  return getLeagueHistory(guildId);
}

export async function getDemoTeamRoster(leagueId: string, teamId: string) {
  await requireDemoLeague(leagueId);
  const { data, error } = await supabase
    .from("rec_players").select("id,full_name,position,overall_rating,dev_trait")
    .eq("league_id", leagueId).eq("team_id", teamId).in("roster_status", ["active", "transferred_in"])
    .order("overall_rating", { ascending: false });
  if (error) throw new ApiError(500, "Failed to load roster.", error);
  return { players: (data ?? []).map((row: any) => ({ id: row.id, name: row.full_name, position: row.position, overallRating: row.overall_rating, devTrait: row.dev_trait })) };
}

export async function getDemoLeagueStats(leagueId: string, input: { teamId?: string | null; position?: string | null } = {}) {
  await requireDemoLeague(leagueId);
  return getLeagueStatsForLeagueId(leagueId, input);
}

export async function getDemoLeagueTeamStats(leagueId: string) {
  await requireDemoLeague(leagueId);
  return getLeagueTeamStatsForLeagueId(leagueId);
}

/** A bounded slice of the approved Madden baseline used by the real fantasy-draft room.
 * Public only through the hardcoded showcase leagues and intentionally excludes private data. */
export async function getDemoFantasyDraftPool(leagueId: string) {
  const league = await requireDemoLeague(leagueId);
  if (league.game !== "madden_27" && league.game !== "madden_26") {
    throw new ApiError(400, "Fantasy draft is only available for Madden leagues.");
  }
  const dataset = await supabase
    .from("rec_madden_roster_datasets")
    .select("id")
    .eq("game_title", league.game)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dataset.error) throw new ApiError(500, "Failed to load the Madden roster dataset.", dataset.error);
  if (!dataset.data) return { players: [] };

  const columns = [
    "id", "name", "position", "jersey_number", "overall_rating", "photo_url", "dev_trait",
    "speed", "acceleration", "strength", "agility", "awareness", "jumping", "injury", "stamina", "toughness",
    "throw_power", "throw_under_pressure", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep",
    "catching", "catch_in_traffic", "spectacular_catch", "carrying", "break_tackle", "change_of_direction",
    "tackle", "hit_power", "block_shedding", "man_coverage", "zone_coverage", "pass_block", "run_block",
  ].join(",");
  const pool = await supabase
    .from("rec_madden_baseline_players")
    .select(columns)
    .eq("dataset_id", dataset.data.id)
    .not("overall_rating", "is", null)
    .order("overall_rating", { ascending: false })
    .order("name")
    .limit(180);
  if (pool.error) throw new ApiError(500, "Failed to load the fantasy-draft player pool.", pool.error);
  return {
    players: (pool.data ?? []).map((row: any) => ({
      id: row.id, name: row.name, position: row.position, jerseyNumber: row.jersey_number,
      overallRating: row.overall_rating, photoUrl: row.photo_url, devTrait: row.dev_trait,
      attributes: {
        SPD: row.speed, ACC: row.acceleration, STR: row.strength, AGI: row.agility, AWR: row.awareness,
        JMP: row.jumping, INJ: row.injury, STA: row.stamina, TOU: row.toughness, THP: row.throw_power,
        TUP: row.throw_under_pressure, SAC: row.throw_accuracy_short, MAC: row.throw_accuracy_mid,
        DAC: row.throw_accuracy_deep, CAT: row.catching, CIT: row.catch_in_traffic, SPC: row.spectacular_catch,
        CAR: row.carrying, BTK: row.break_tackle, COD: row.change_of_direction, TKL: row.tackle,
        POW: row.hit_power, BSH: row.block_shedding, MCV: row.man_coverage, ZCV: row.zone_coverage,
        PBK: row.pass_block, RBK: row.run_block,
      },
    })),
  };
}
