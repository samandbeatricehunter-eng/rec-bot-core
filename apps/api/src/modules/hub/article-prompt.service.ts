import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
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

  const gamesRes = await supabase
    .from("rec_games")
    .select(
      "id,week_number,home_score,away_score,status,is_bowl_game,is_national_championship,postseason_round,bowl_name,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_abbr,abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_abbr,abbreviation)",
    )
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .gte("week_number", input.weekFrom)
    .lte("week_number", input.weekTo)
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("week_number", { ascending: true });
  if (gamesRes.error) throw new ApiError(500, "Failed to load results for the selected weeks.", gamesRes.error);
  const games = gamesRes.data ?? [];

  const resultLines = games.map((game: any) => {
    const home = teamLabel(game.home_team);
    const away = teamLabel(game.away_team);
    const winner = game.home_score === game.away_score ? null : game.home_score > game.away_score ? home : away;
    const round = game.postseason_round ? ` [${String(game.postseason_round).replace(/_/g, " ")}]` : "";
    const bowl = game.bowl_name ? ` (${game.bowl_name})` : "";
    return winner
      ? `Week ${game.week_number}: ${winner} def. ${winner === home ? away : home}, ${Math.max(game.home_score, game.away_score)}-${Math.min(game.home_score, game.away_score)}${round}${bowl}`
      : `Week ${game.week_number}: ${away} ${game.away_score} - ${home} ${game.home_score} (Tie)${round}${bowl}`;
  });

  let rankingLines: string[] = [];
  try {
    const rankings = await computePowerRankings(input.guildId);
    rankingLines = ((rankings as any)?.teams ?? [])
      .slice(0, 10)
      .map((team: any) => `#${team.rank} ${team.teamName ?? team.name ?? "Team"}${team.change ? ` (${team.change > 0 ? "+" : ""}${team.change})` : ""}`);
  } catch {
    // Power rankings are supplementary context — a failure here shouldn't block the prompt.
  }

  const hostOverrides = await loadHostOverridesForLeague(context.leagueId);
  const cast = (Object.keys(ANALYST_META) as AnalystVoice[])
    .map((voice) => {
      const meta = hostOverrides[voice] ?? ANALYST_META[voice];
      return `- ${meta.speaker} (${meta.role}): ${ASSIGNMENTS[voice]}`;
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
