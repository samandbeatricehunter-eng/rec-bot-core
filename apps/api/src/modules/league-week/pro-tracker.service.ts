// Rise to Immortality: weekly "Pro Tracker" recap -- one post per RTI user per advance, showing
// both of their players' previous-week stat line, season totals, and rank at their position in
// the league. Read-only compute (same shape as player-of-week.service.ts) plus a best-effort
// Discord post, called once from the advance flow right alongside Player of the Week.
import {
  defensePlayerOfWeekScore, emptyWeeklyPlayerStatLine, gameplaySeasonStages, isImmortalityOffensePosition,
  offensePlayerOfWeekScore, type LeagueGame, type WeeklyPlayerStatLine,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessageWithFile } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, isSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { renderProTrackerPng } from "../../lib/pro-tracker-render.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { getLeagueStatsForLeagueId } from "../league-stats/league-stats.service.js";
import { statLinesForPosition } from "../immortality/player-stat-line.js";

const STAT_KEY_MAP: Record<keyof WeeklyPlayerStatLine, string> = {
  passYards: "pass_yards", rushYards: "rush_yards", receivingYards: "receiving_yards",
  passTds: "pass_tds", rushTds: "rush_tds", receivingTds: "receiving_tds",
  interceptionsThrown: "interceptions_thrown", rushingFumbles: "rushing_fumbles",
  sacks: "sacks", interceptions: "interceptions", forcedFumbles: "forced_fumbles",
  fumbleRecoveries: "fumble_recoveries", tacklesForLoss: "tackles_for_loss",
  defensiveTds: "defensive_tds", tackles: "tackles",
};

function num(value: unknown): number { return Number(value) || 0; }

function aggregateLine(rows: Array<{ stats: Record<string, unknown> | null }>): WeeklyPlayerStatLine {
  const line = emptyWeeklyPlayerStatLine();
  for (const row of rows) {
    const stats = row.stats ?? {};
    for (const [field, key] of Object.entries(STAT_KEY_MAP) as Array<[keyof WeeklyPlayerStatLine, string]>) {
      line[field] += num(stats[key]);
    }
  }
  return line;
}

function offenseLines(s: WeeklyPlayerStatLine): string[] {
  const lines: string[] = [];
  if (s.passYards > 0 || s.passTds > 0) lines.push(`${s.passYards} PASS YDS, ${s.passTds} PASS TD`);
  if (s.rushYards > 0 || s.rushTds > 0) lines.push(`${s.rushYards} RUSH YDS, ${s.rushTds} RUSH TD`);
  if (s.receivingYards > 0 || s.receivingTds > 0) lines.push(`${s.receivingYards} REC YDS, ${s.receivingTds} REC TD`);
  const turnovers = s.interceptionsThrown + s.rushingFumbles;
  if (turnovers > 0) lines.push(`${turnovers} TURNOVER${turnovers === 1 ? "" : "S"}`);
  return lines.length ? lines : ["No stats logged"];
}

function defenseLines(s: WeeklyPlayerStatLine): string[] {
  const parts: string[] = [];
  if (s.tackles > 0) parts.push(`${s.tackles} TKL`);
  if (s.sacks > 0) parts.push(`${s.sacks} SACK${s.sacks === 1 ? "" : "S"}`);
  if (s.interceptions > 0) parts.push(`${s.interceptions} INT`);
  if (s.forcedFumbles > 0) parts.push(`${s.forcedFumbles} FF`);
  if (s.fumbleRecoveries > 0) parts.push(`${s.fumbleRecoveries} FR`);
  if (s.tacklesForLoss > 0) parts.push(`${s.tacklesForLoss} TFL`);
  if (s.defensiveTds > 0) parts.push(`${s.defensiveTds} TD`);
  return parts.length ? [parts.join(", ")] : ["No stats logged"];
}

export type ProTrackerPlayerLine = {
  playerId: string; playerName: string; position: string | null; headshotUrl: string | null;
  teamName: string; teamAbbr: string | null; teamLogoUrl: string | null;
  teamPrimaryColor: string | null; teamSecondaryColor: string | null;
  weekLines: string[]; seasonLines: string[];
  positionRank: number | null; positionCount: number | null;
};

export async function computePlayerLine(input: { leagueId: string; playerId: string; seasonNumber: number; weekNumber: number }): Promise<ProTrackerPlayerLine | null> {
  const player = await supabase.from("rec_players").select("id,full_name,position,team_id,photo_url").eq("id", input.playerId).maybeSingle();
  if (player.error || !player.data) return null;

  const [weekRows, seasonRows, positionRows, team, seasonStats] = await Promise.all([
    supabase.from("rec_player_weekly_stats").select("stats").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("player_id", input.playerId),
    supabase.from("rec_player_weekly_stats").select("stats").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).lte("week_number", input.weekNumber).eq("player_id", input.playerId),
    supabase.from("rec_player_weekly_stats").select("player_id,stats").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).lte("week_number", input.weekNumber).eq("position", player.data.position),
    // rec_teams has no secondary_color column (that only exists on the separate
    // rec_league_team_identities table) -- selecting it made this query fail with Postgres
    // error 42703 (undefined_column) on every call, which silently produced a null team.data
    // and rendered every single player as "Free Agent" regardless of their actual team_id.
    player.data.team_id
      ? supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated,abbreviation,display_abbr,logo_url,primary_color").eq("id", player.data.team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Season-scope totals (with passer rating/completion % etc. already derived) for the fuller
    // "current season" stat line -- separate from weekRows/seasonRows above, which only feed
    // the score-based position rank and the compact per-week recap line.
    getLeagueStatsForLeagueId(input.leagueId, { scope: "season" }),
  ]);

  const offense = isImmortalityOffensePosition(player.data.position ?? "");
  const scoreFor = offense ? offensePlayerOfWeekScore : defensePlayerOfWeekScore;

  const byPlayer = new Map<string, Array<{ stats: Record<string, unknown> | null }>>();
  for (const row of (positionRows.data ?? []) as Array<{ player_id: string; stats: Record<string, unknown> | null }>) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push({ stats: row.stats });
    byPlayer.set(row.player_id, list);
  }
  const ranked = [...byPlayer.entries()]
    .map(([playerId, rows]) => ({ playerId, score: scoreFor(aggregateLine(rows)) }))
    .sort((a, b) => b.score - a.score);
  const positionCount = ranked.length || null;
  const positionRank = ranked.length ? ranked.findIndex((r) => r.playerId === input.playerId) + 1 || null : null;

  const teamData = team.data as Record<string, unknown> | null;
  const seasonPlayerRow = (seasonStats.players as Array<Record<string, unknown>>).find((row) => String(row.id) === String(input.playerId));
  const seasonTotals = (seasonPlayerRow?.stats as Record<string, unknown>) ?? {};
  return {
    playerId: input.playerId, playerName: player.data.full_name ?? "Player", position: player.data.position,
    headshotUrl: player.data.photo_url ?? null,
    teamName: teamData ? (formatTeamDisplayName(teamData as any) ?? String(teamData.name ?? "Team")) : "Free Agent",
    teamAbbr: (teamData?.display_abbr as string) ?? (teamData?.abbreviation as string) ?? null,
    teamLogoUrl: (teamData?.logo_url as string) ?? null,
    teamPrimaryColor: (teamData?.primary_color as string) ?? null,
    teamSecondaryColor: (teamData?.secondary_color as string) ?? null,
    weekLines: offense ? offenseLines(aggregateLine(weekRows.data ?? [])) : defenseLines(aggregateLine(weekRows.data ?? [])),
    seasonLines: statLinesForPosition(String(player.data.position ?? ""), seasonTotals),
    positionRank, positionCount,
  };
}

/** Backs the chromeless /render/pro-tracker/:userId/:leagueId/:weekNumber site route. */
export async function getProTrackerRenderData(userId: string, leagueId: string, weekNumber: number) {
  const league = await supabase.from("rec_leagues").select("season_number,display_season_number").eq("id", leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "Could not load this league.", league.error);
  const seasonNumber = Number(league.data?.season_number ?? league.data?.display_season_number ?? 1);

  const immortalityLeague = await loadImmortalityLeague(leagueId);
  if (!immortalityLeague) throw new ApiError(404, "This is not a Rise to Immortality league.");

  const prospects = await supabase.from("rec_immortality_prospects").select("side,player_id")
    .eq("immortality_league_id", immortalityLeague.id).eq("user_id", userId).not("player_id", "is", null);
  if (prospects.error) throw new ApiError(500, "Could not load this user's prospects.", prospects.error);

  const offenseProspect = (prospects.data ?? []).find((p) => p.side === "offense");
  const defenseProspect = (prospects.data ?? []).find((p) => p.side === "defense");

  const [offense, defense] = await Promise.all([
    offenseProspect?.player_id ? computePlayerLine({ leagueId, playerId: offenseProspect.player_id, seasonNumber, weekNumber }) : Promise.resolve(null),
    defenseProspect?.player_id ? computePlayerLine({ leagueId, playerId: defenseProspect.player_id, seasonNumber, weekNumber }) : Promise.resolve(null),
  ]);

  return { seasonNumber, weekNumber, offense, defense };
}

async function discordIdForUser(userId: string): Promise<string | null> {
  const accounts = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId);
  const real = (accounts.data ?? []).find((row) => row.discord_id && !isSiteOnlyDiscordId(String(row.discord_id)));
  return real?.discord_id ? String(real.discord_id) : null;
}

/**
 * Call after a week's advance completes, once per RTI user with an active franchise. No-ops for
 * preseason/offseason (gameplaySeasonStages), for a non-RTI league, or once a channel is set.
 * Best-effort -- one user's render/post failing never blocks the others or the advance itself.
 */
export async function postWeeklyProTrackerUpdates(input: { leagueId: string; weekNumber: number; seasonStage: string; game: LeagueGame }): Promise<void> {
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return;
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (!immortalityLeague) return;

  const routes = await findServerRoutesForLeague(input.leagueId);
  const channelId = routes?.routes?.pro_tracker_channel_id as string | null | undefined;
  if (!channelId) return;

  const assignments = await supabase.from("rec_immortality_user_team_assignments").select("user_id,team_id").eq("immortality_league_id", immortalityLeague.id);
  if (assignments.error || !assignments.data?.length) return;

  for (const assignment of assignments.data) {
    try {
      const data = await getProTrackerRenderData(assignment.user_id, input.leagueId, input.weekNumber);
      if (!data.offense && !data.defense) continue;
      const discordId = await discordIdForUser(assignment.user_id);
      const teamName = data.offense?.teamName ?? data.defense?.teamName ?? "Team";
      const png = await renderProTrackerPng(assignment.user_id, input.leagueId, input.weekNumber);
      await postDiscordChannelMessageWithFile(
        channelId,
        {
          content: `${discordId ? `<@${discordId}> · ` : ""}${teamName}`,
          embeds: [{ title: `Pro Tracker — Week ${input.weekNumber}`, color: 0x2f9e6f, image: { url: "attachment://pro-tracker.png" } }],
        },
        { buffer: png, name: "pro-tracker.png", contentType: "image/png" },
      );
    } catch (err) {
      console.error(`[ERROR] Failed to post Pro Tracker update for user ${assignment.user_id} (non-fatal):`, err);
    }
  }
}
