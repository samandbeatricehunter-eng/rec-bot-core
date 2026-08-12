import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { leagueSeasonGamesQuery } from "../league-context/league-games.query.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { ANALYST_META, type AnalystVoice } from "./roundtable-take-bank.js";
import { loadHostOverridesForLeague } from "./roundtable-hosts.service.js";

const GAME_LABELS: Record<string, string> = { cfb_27: "CFB 27", madden_26: "Madden 26", madden_27: "Madden 27" };
function gameLabelFor(game: string): string {
  return GAME_LABELS[game] ?? game.replace(/_/g, " ").toUpperCase();
}

// The bot has no LLM integration of its own — this builds a copy/paste prompt (league
// context, results digest, and the standing roundtable cast with a suggested writing
// assignment per voice) for a commissioner to hand to whatever external AI tool they
// use to actually draft article prose, which they then paste into the Headline/Article
// or Commissioner Feature fields on this same Media page.
const ASSIGNMENTS: Record<AnalystVoice, string> = {
  caleb: "Open the piece — set the headline stakes and why the league should care this week.",
  maya: "Break down what the tape/box scores say actually happened, not just the final score.",
  theo: "Ground it in the numbers — cite specific stats from the digest below, not vibes.",
  nina: "Close with league-wide context — standings, storylines elsewhere, what's coming next.",
};

function teamLabel(team?: { name?: string | null; display_abbr?: string | null; abbreviation?: string | null } | null) {
  if (!team) return "TBD";
  return (team.name ?? "").trim() || (team.display_abbr ?? "").trim() || (team.abbreviation ?? "").trim() || "TBD";
}

export async function buildArticlePromptDigest(input: { guildId: string; weekFrom: number; weekTo: number }) {
  if (input.weekFrom > input.weekTo) throw new ApiError(400, "Start week must be before or equal to the end week.");
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  const gamesRes = await leagueSeasonGamesQuery(supabase, { leagueId, seasonId },
    "id,week_number,is_bowl_game,is_national_championship,postseason_round,bowl_name,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_abbr,abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_abbr,abbreviation)",
  )
    .gte("week_number", input.weekFrom)
    .lte("week_number", input.weekTo)
    .order("week_number", { ascending: true });
  if (gamesRes.error) throw new ApiError(500, "Failed to load results for the selected weeks.", gamesRes.error);
  const scheduledGames = gamesRes.data ?? [];

  // Confirmed results live in rec_game_results, not rec_games.home_score/away_score (that
  // column pair is never populated by the real scoring flow) — the old query here always
  // filtered on the wrong columns and reported "no completed results" even when every game in
  // range had actually been played.
  const resultsRes = scheduledGames.length
    ? await supabase.from("rec_game_results").select("game_id,home_score,away_score,is_tie").eq("league_id", leagueId).in("game_id", scheduledGames.map((g) => g.id))
    : { data: [] as any[], error: null };
  if (resultsRes.error) throw new ApiError(500, "Failed to load results for the selected weeks.", resultsRes.error);
  const resultByGameId = new Map((resultsRes.data ?? []).map((r: any) => [r.game_id, r]));

  const games = scheduledGames
    .map((game: any) => ({ ...game, result: resultByGameId.get(game.id) ?? null }))
    .filter((game: any) => game.result && game.result.home_score != null && game.result.away_score != null);

  // Per-team box-score lines logged for each game (not just the final score) — total yards and
  // turnovers, the two stats that most changes a roundtable analyst's read of "how" a game went.
  const statsRes = games.length
    ? await supabase.from("rec_team_game_stats").select("game_id,team_id,is_home,total_yards_gained,off_yards_gained,turnovers_committed")
        .eq("league_id", leagueId).in("game_id", games.map((g: any) => g.id))
    : { data: [] as any[], error: null };
  if (statsRes.error) throw new ApiError(500, "Failed to load box-score stats for the selected weeks.", statsRes.error);
  const statsByGameId = new Map<string, any[]>();
  for (const row of statsRes.data ?? []) {
    const rows = statsByGameId.get(row.game_id) ?? [];
    rows.push(row);
    statsByGameId.set(row.game_id, rows);
  }

  const resultLines = games.map((game: any) => {
    const home = teamLabel(game.home_team);
    const away = teamLabel(game.away_team);
    const homeScore = Number(game.result.home_score);
    const awayScore = Number(game.result.away_score);
    const winner = game.result.is_tie || homeScore === awayScore ? null : homeScore > awayScore ? home : away;
    const round = game.postseason_round ? ` [${String(game.postseason_round).replace(/_/g, " ")}]` : "";
    const bowl = game.bowl_name ? ` (${game.bowl_name})` : "";
    const line = winner
      ? `Week ${game.week_number}: ${winner} def. ${winner === home ? away : home}, ${Math.max(homeScore, awayScore)}-${Math.min(homeScore, awayScore)}${round}${bowl}`
      : `Week ${game.week_number}: ${away} ${awayScore} - ${home} ${homeScore} (Tie)${round}${bowl}`;

    const statRows = statsByGameId.get(game.id) ?? [];
    const homeStats = statRows.find((r) => r.is_home);
    const awayStats = statRows.find((r) => !r.is_home);
    const yards = (r: any) => r ? Number(r.total_yards_gained ?? r.off_yards_gained ?? 0) : null;
    const homeYards = homeStats ? yards(homeStats) : null;
    const awayYards = awayStats ? yards(awayStats) : null;
    const statLine = homeYards != null && awayYards != null
      ? `    Total yards: ${away} ${awayYards} - ${home} ${homeYards} | Turnovers: ${away} ${Number(awayStats?.turnovers_committed ?? 0)} - ${home} ${Number(homeStats?.turnovers_committed ?? 0)}`
      : null;
    return statLine ? `${line}\n${statLine}` : line;
  });

  // Power ranking movement across the whole selected range, not just a single-week snapshot —
  // pulls every rec_power_ranking_snapshots row up through weekTo and, per team, compares its
  // rank at the last available week before weekFrom (the range's baseline) against its rank at
  // the last available week at or before weekTo, so the digest can say a team rose or fell over
  // the actual span being written about instead of just the most recent week.
  let rankingLines: string[] = [];
  try {
    const rankings = await computePowerRankings(input.guildId);
    const currentTeams: any[] = (rankings as any)?.teams ?? [];
    const snapshotsRes = await supabase
      .from("rec_power_ranking_snapshots")
      .select("team_id,week_number,rank")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .lte("week_number", input.weekTo)
      .order("week_number", { ascending: true });
    const baselineRankByTeam = new Map<string, number>();
    if (!snapshotsRes.error) {
      const latestBeforeRange = new Map<string, { week: number; rank: number }>();
      for (const row of snapshotsRes.data ?? []) {
        if (row.week_number > input.weekFrom - 1) continue;
        const existing = latestBeforeRange.get(row.team_id);
        if (!existing || row.week_number > existing.week) latestBeforeRange.set(row.team_id, { week: row.week_number, rank: row.rank });
      }
      for (const [teamId, entry] of latestBeforeRange) baselineRankByTeam.set(teamId, entry.rank);
    }
    rankingLines = currentTeams
      .slice(0, 10)
      .map((team: any) => {
        const baseline = baselineRankByTeam.get(team.teamId);
        const moveSinceRangeStart = baseline != null ? baseline - team.rank : null;
        const movement = moveSinceRangeStart
          ? ` (${moveSinceRangeStart > 0 ? "▲" : "▼"}${Math.abs(moveSinceRangeStart)} since Week ${input.weekFrom})`
          : team.change ? ` (${team.change > 0 ? "▲" : "▼"}${Math.abs(team.change)} last week)` : "";
        return `#${team.rank} ${team.teamName ?? team.name ?? "Team"}${movement}`;
      });
  } catch {
    // Power rankings are supplementary context — a failure here shouldn't block the prompt.
  }

  // The personality's description is a real character brief (how that voice thinks and writes),
  // not just a label — this is the whole point of handing this cast list to an external AI
  // tool: without it, "personality" was cosmetic (just a byline change), never actually shaping
  // the generated prose.
  const hostOverrides = await loadHostOverridesForLeague(context.leagueId);
  const cast = (Object.keys(ANALYST_META) as AnalystVoice[])
    .map((voice) => {
      const meta = hostOverrides[voice] ?? ANALYST_META[voice];
      const description = (meta as any).personalityDescription;
      return `- ${meta.speaker} (${meta.role})${description ? ` — VOICE: ${description}` : ""}: ${ASSIGNMENTS[voice]}`;
    })
    .join("\n");

  const prompt = [
    `Write a REC Network roundtable article for ${context.rec_leagues.name ?? "the league"} (${gameLabelFor(String(context.rec_leagues.game ?? ""))}), Season ${seasonNumber}, covering Week ${input.weekFrom}${input.weekTo !== input.weekFrom ? ` through Week ${input.weekTo}` : ""}.`,
    "",
    "RESULTS:",
    resultLines.length ? resultLines.join("\n") : "(No completed results recorded in this range.)",
    "",
    ...(rankingLines.length ? ["POWER RANKINGS (top 10):", rankingLines.join("\n"), ""] : []),
    "ROUNDTABLE CAST — write each voice's section in first person, in this order, using the assignment below as that voice's angle. Keep takes grounded in the results above, not generic:",
    cast,
    "",
    "Format the output as a headline, then a short lede paragraph, then one section per analyst voice labeled with their name and role, then a short closing paragraph. Keep the total length to roughly 400-600 words.",
  ].join("\n");

  return { prompt, resultCount: games.length };
}
