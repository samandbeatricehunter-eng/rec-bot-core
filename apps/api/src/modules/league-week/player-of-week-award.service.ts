// Fires the automated Player of the Week award at the end of every regular-season and
// postseason advance (never preseason/offseason, where there's no game data to score).
// Idempotent per (league, season, week) via rec_player_of_week_awards' unique constraint --
// safe to call more than once for the same completed week.
import { gameplaySeasonStages, type LeagueGame } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getSchedulingPayoutMultiplier } from "../scheduling/scheduling-bonus.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { postDiscordChannelMessageWithFile } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { computeWeeklyPlayerOfWeek, type PlayerOfWeekWinner } from "./player-of-week.service.js";

const POTW_BASE_COINS = 250;

async function alreadyAwarded(leagueId: string, seasonNumber: number, weekNumber: number): Promise<boolean> {
  const existing = await supabase
    .from("rec_player_of_week_awards")
    .select("id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .limit(1);
  if (existing.error) throw new ApiError(500, "Failed to check for an existing Player of the Week award.", existing.error);
  return Boolean(existing.data?.length);
}

// The winner's game that week -- needed to check whether their matchup went through the
// propose/accept scheduling flow (getSchedulingPayoutMultiplier, the same helper the game
// result payout bonus already uses) for the coin-doubling bonus.
async function loadWinnerGame(leagueId: string, weekNumber: number, teamId: string) {
  const result = await supabase
    .from("rec_games")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (result.error) return null;
  return result.data;
}

async function resolveUserIdForTeam(leagueId: string, teamId: string): Promise<string | null> {
  const result = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  return result.data?.user_id ?? null;
}

type AwardedWinner = PlayerOfWeekWinner & { userId: string | null; coinsAwarded: number; doubled: boolean };

async function awardOneWinner(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; winner: PlayerOfWeekWinner;
}): Promise<AwardedWinner> {
  const { leagueId, seasonNumber, weekNumber, winner } = input;
  const userId = await resolveUserIdForTeam(leagueId, winner.teamId);
  let doubled = false;
  if (userId) {
    const game = await loadWinnerGame(leagueId, weekNumber, winner.teamId);
    if (game) {
      const multiplier = await getSchedulingPayoutMultiplier({
        gameId: game.id, homeUserId: game.home_user_id, awayUserId: game.away_user_id,
      });
      doubled = multiplier === 2;
    }
  }
  const coinsAwarded = userId ? POTW_BASE_COINS * (doubled ? 2 : 1) : 0;

  const inserted = await supabase.from("rec_player_of_week_awards").insert({
    league_id: leagueId, season_number: seasonNumber, week_number: weekNumber,
    conference: winner.conference, side: winner.side,
    player_id: winner.playerId, player_name: winner.playerName, position: winner.position,
    team_id: winner.teamId, team_name: winner.teamName, user_id: userId,
    score: winner.score, stat_line: winner.statLine,
    coins_awarded: coinsAwarded, scheduling_bonus_doubled: doubled,
  });
  if (inserted.error) throw new ApiError(500, "Failed to record a Player of the Week award.", inserted.error);

  await import("../immortality/xp-awards.service.js").then(({ grantAbilitySlotForPlayerOfWeek }) =>
    grantAbilitySlotForPlayerOfWeek(winner.playerId, `${seasonNumber}:${weekNumber}:${winner.side}`),
  ).catch((err) => console.error("[ERROR] RTI Player of the Week ability slot failed (non-fatal):", err));

  if (userId && coinsAwarded > 0) {
    await creditOrBacklog({
      leagueId, seasonNumber, userId, amount: coinsAwarded,
      description: `Player of the Week (${winner.conference} ${winner.side}) — Wk ${weekNumber}${doubled ? " (scheduling bonus)" : ""}`,
      transactionType: "player_of_week_payout",
      source: "player_of_week",
      sourceReference: { leagueId, seasonNumber, weekNumber, conference: winner.conference, side: winner.side, playerId: winner.playerId },
    });
  }

  return { ...winner, userId, coinsAwarded, doubled };
}

async function postPlayerOfWeekHeadline(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; winners: AwardedWinner[];
}): Promise<void> {
  const headline = `Player of the Week — Week ${input.weekNumber}`;
  const body = input.winners
    .map((w) => `${w.conference} ${w.side === "offense" ? "Offense" : "Defense"}: ${w.playerName} (${w.position ?? ""} · ${w.teamName})`.replace(" ()", ""))
    .join("\n");
  const inserted = await supabase.from("rec_game_stories").insert({
    league_id: input.leagueId,
    season: input.seasonNumber,
    week: input.weekNumber,
    game_id: null,
    story_type: "player_of_week",
    headline,
    body,
    notes: { winners: input.winners },
  }).select("id").single();
  if (inserted.error || !inserted.data?.id) {
    console.error("[ERROR] Failed to create Player of the Week headline story (non-fatal):", inserted.error);
    return;
  }

  // Discord post mirrors the site's render, same pattern as the game-channel matchup-card
  // image (renderMatchupCardPng) -- best-effort, the headline article is the source of truth
  // even if Chromium/Discord posting fails.
  try {
    const routes = await findServerRoutesForLeague(input.leagueId);
    // Prefer the dedicated Player of the Week channel (RTI leagues especially); fall back to
    // headlines for leagues that haven't set it up, so this keeps working either way.
    const channelId = (routes?.routes?.player_of_the_week_channel_id ?? routes?.routes?.headlines_channel_id) as string | null | undefined;
    if (!channelId) return;
    const { renderPlayerOfWeekPng } = await import("../../lib/player-of-week-render.js");
    const png = await renderPlayerOfWeekPng(inserted.data.id);
    const sent = await postDiscordChannelMessageWithFile(
      channelId,
      { embeds: [{ title: headline, color: 0xd9a521, image: { url: "attachment://player-of-week.png" } }] },
      { buffer: png, name: "player-of-week.png", contentType: "image/png" },
    );
    if (sent?.id) {
      await supabase.from("rec_game_stories").update({ posted_channel_id: channelId, posted_message_id: sent.id }).eq("id", inserted.data.id);
    }
  } catch (err) {
    console.error("[ERROR] Failed to post Player of the Week to Discord (non-fatal):", err);
  }
}

/** Backs the chromeless /render/player-of-week/:storyId site route (Playwright screenshot pipeline). */
export async function getPlayerOfWeekRenderData(storyId: string) {
  const result = await supabase.from("rec_game_stories").select("id,headline,week,season,notes").eq("id", storyId).eq("story_type", "player_of_week").maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load Player of the Week render data.", result.error);
  if (!result.data) throw new ApiError(404, "Player of the Week story not found.");
  return {
    headline: result.data.headline,
    week: result.data.week,
    season: result.data.season,
    winners: (result.data.notes as { winners?: AwardedWinner[] } | null)?.winners ?? [],
  };
}

/**
 * Call after a week's advance completes. `seasonStage` must be the stage of the week that JUST
 * finished (not the stage being advanced into) -- gameplaySeasonStages excludes preseason and
 * every offseason stage, so this is a no-op there. Safe to call more than once for the same
 * week (idempotent via the unique constraint on rec_player_of_week_awards).
 */
export async function awardWeeklyPlayerOfWeek(input: {
  guildId: string; leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string; game: LeagueGame;
}): Promise<{ awarded: boolean; winners: AwardedWinner[] }> {
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return { awarded: false, winners: [] };
  if (await alreadyAwarded(input.leagueId, input.seasonNumber, input.weekNumber)) return { awarded: false, winners: [] };

  const winners = await computeWeeklyPlayerOfWeek(input.guildId, input.weekNumber);
  if (!winners.length) return { awarded: false, winners: [] };

  // One winner's award/payout failing (e.g. a bad credit) used to abort this whole loop before
  // the headline post below ever ran -- confirmed directly: a real week left exactly one
  // rec_player_of_week_awards row committed (with its coins already paid) but zero headline
  // stories, meaning the announcement silently never happened even though part of the award did.
  // Isolating each winner keeps one failure from canceling the announcement for everyone else.
  const awarded: AwardedWinner[] = [];
  for (const winner of winners) {
    try {
      awarded.push(await awardOneWinner({ leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, winner }));
    } catch (err) {
      console.error(`[ERROR] Failed to award Player of the Week (${winner.conference} ${winner.side}, non-fatal):`, err);
    }
  }
  if (!awarded.length) return { awarded: false, winners: [] };

  await postPlayerOfWeekHeadline({ leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, winners: awarded });
  return { awarded: true, winners: awarded };
}
