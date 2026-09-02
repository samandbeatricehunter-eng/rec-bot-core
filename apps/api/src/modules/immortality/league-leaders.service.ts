// Rise to Immortality: "League Leaders" weekly render -- top 5 at each of a curated set of
// marquee stat categories (the same set the site's own League Stats "Leaders" tab shows, see
// apps/web/src/routes/hub/LeagueStatsHome.tsx's OFFENSE_LEADER_CATEGORIES/DEFENSE_LEADER_CATEGORIES),
// with each entry's team logo and player photo, screenshotted via the same Playwright render
// pipeline the prospect card and Pro Tracker posts already use. Fired once per RTI league per
// advance, alongside Pro Tracker and the tweet queue.
import { gameplaySeasonStages, type LeagueGame } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessageWithFile } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { getLeagueStatsForLeagueId } from "../league-stats/league-stats.service.js";
import { renderLeagueLeadersPng } from "../../lib/league-leaders-render.js";
import { loadImmortalityLeague } from "./immortality.service.js";

const LEADER_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "pass_yards", label: "Passing Yards" },
  { key: "rush_yards", label: "Rushing Yards" },
  { key: "receiving_yards", label: "Receiving Yards" },
  { key: "interceptions", label: "Interceptions" },
  { key: "tackles", label: "Tackles" },
];

export type LeagueLeaderEntry = {
  playerId: string;
  playerName: string;
  position: string | null;
  photoUrl: string | null;
  teamName: string | null;
  teamAbbr: string | null;
  teamLogoUrl: string | null;
  value: number;
};

export type LeagueLeadersRenderData = {
  leagueName: string;
  seasonNumber: number;
  weekNumber: number;
  categories: Array<{ key: string; label: string; entries: LeagueLeaderEntry[] }>;
};

/** Backs the chromeless /render/league-leaders/:leagueId/:weekNumber site route. */
export async function getLeagueLeadersRenderData(leagueId: string, weekNumber: number): Promise<LeagueLeadersRenderData> {
  const leagueRow = await supabase.from("rec_leagues").select("name,season_number").eq("id", leagueId).maybeSingle();
  if (leagueRow.error) throw new ApiError(500, "Could not load this league.", leagueRow.error);

  const stats = await getLeagueStatsForLeagueId(leagueId, { scope: "season" });
  const leaderRowsByCategory = LEADER_CATEGORIES.map((cat) => ({
    ...cat,
    rows: ((stats.leaders as Record<string, Array<Record<string, unknown>>>)[cat.key] ?? []).slice(0, 5),
  }));

  const playerIds = new Set<string>();
  for (const cat of leaderRowsByCategory) for (const row of cat.rows) playerIds.add(String(row.playerId));

  const players = playerIds.size
    ? await supabase.from("rec_players").select("id,photo_url,team_id").in("id", [...playerIds])
    : { data: [] as Array<{ id: string; photo_url: string | null; team_id: string | null }> };
  const playerById = new Map(((players.data ?? []) as Array<{ id: string; photo_url: string | null; team_id: string | null }>).map((p) => [String(p.id), p]));

  const teamIds = new Set([...playerById.values()].map((p) => p.team_id).filter((id): id is string => Boolean(id)));
  const teams = teamIds.size
    ? await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated,abbreviation,display_abbr,logo_url").in("id", [...teamIds])
    : { data: [] as Array<Record<string, unknown>> };
  const teamById = new Map<string, Record<string, unknown>>((teams.data ?? []).map((t: any) => [String(t.id), t]));

  const categories = leaderRowsByCategory.map((cat) => ({
    key: cat.key,
    label: cat.label,
    entries: cat.rows.map((row): LeagueLeaderEntry => {
      const player = playerById.get(String(row.playerId));
      const team = player?.team_id ? teamById.get(String(player.team_id)) : null;
      return {
        playerId: String(row.playerId),
        playerName: String(row.playerName ?? ""),
        position: (row.position as string | null) ?? null,
        photoUrl: player?.photo_url ?? null,
        teamName: team ? (formatTeamDisplayName(team) ?? String(team.name ?? "")) : ((row.teamName as string | null) ?? null),
        teamAbbr: (team?.display_abbr ?? team?.abbreviation ?? row.teamAbbreviation ?? null) as string | null,
        teamLogoUrl: (team?.logo_url as string | null) ?? null,
        value: Number(row.value ?? 0),
      };
    }),
  }));

  return {
    leagueName: leagueRow.data?.name ?? "League",
    seasonNumber: Number(leagueRow.data?.season_number ?? 1),
    weekNumber,
    categories,
  };
}

/** Called once from the advance flow, right alongside Pro Tracker and the tweet queue. No-ops
 * for non-RTI leagues, preseason/offseason, and leagues with no league_leaders_channel_id set. */
export async function postLeagueLeadersForAdvance(input: { leagueId: string; weekNumber: number; seasonStage: string; game: LeagueGame }): Promise<void> {
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return;
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (!immortalityLeague) return;

  const routes = await findServerRoutesForLeague(input.leagueId);
  const channelId = routes?.routes?.league_leaders_channel_id as string | null | undefined;
  if (!channelId) return;

  const png = await renderLeagueLeadersPng(input.leagueId, input.weekNumber);
  await postDiscordChannelMessageWithFile(
    channelId,
    { embeds: [{ title: `League Leaders — Week ${input.weekNumber}`, color: 0x2f81f7, image: { url: "attachment://league-leaders.png" } }] },
    { buffer: png, name: "league-leaders.png", contentType: "image/png" },
  );
}
