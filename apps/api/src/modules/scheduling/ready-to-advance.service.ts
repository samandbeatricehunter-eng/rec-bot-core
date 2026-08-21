// Leftover Ready to Advance endpoints. The weekly matchups embed no longer posts that button;
// these remain so a click on a not-yet-refreshed Discord message still resolves. CPU Force Win
// is rejected — Force Wins are H2H-only.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { userIdFromDiscordId } from "./shared.js";
import { ensureScheduling } from "./matchup-scheduling.service.js";
import { refreshMatchupsChannelForGame } from "./matchups-channel.service.js";

export type ReadyToAdvanceStatus =
  | { kind: "not_linked" }
  | { kind: "no_game" }
  | { kind: "h2h_ready"; gameId: string; opponentLabel: string; isComplete: boolean; scheduledFor: string | null }
  | { kind: "h2h_needs_input"; gameId: string; opponentLabel: string }
  | { kind: "cpu_ready"; gameId: string; isComplete: boolean; fwRequested: boolean }
  | { kind: "cpu_needs_input"; gameId: string };

async function currentWeekGameForUser(guildId: string, userId: string) {
  const { getAdvanceWeekGames } = await import("../league-week/advance-results.service.js");
  const week = await getAdvanceWeekGames(guildId);
  const game = (week.games as any[]).find((g) => g.homeUserId === userId || g.awayUserId === userId);
  return game ?? null;
}

export async function getReadyToAdvanceStatus(input: { guildId: string; discordId: string }): Promise<ReadyToAdvanceStatus> {
  let userId: string;
  try {
    userId = await userIdFromDiscordId(input.discordId);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return { kind: "not_linked" };
    throw error;
  }

  const game = await currentWeekGameForUser(input.guildId, userId);
  if (!game) return { kind: "no_game" };

  const isHome = game.homeUserId === userId;
  const opponentLabel = String(isHome ? game.awayTeamName : game.homeTeamName);
  const scheduling = await supabase.from("rec_game_scheduling").select("status,scheduled_for,fw_flagged").eq("game_id", game.gameId).maybeSingle();
  const isComplete = scheduling.data?.status === "completed" || (game.homeScore != null && game.awayScore != null);

  if (game.isH2h) {
    const isScheduled = scheduling.data?.status === "confirmed" || scheduling.data?.status === "live";
    if (isScheduled || isComplete) {
      return { kind: "h2h_ready", gameId: game.gameId, opponentLabel, isComplete, scheduledFor: scheduling.data?.scheduled_for ?? null };
    }
    return { kind: "h2h_needs_input", gameId: game.gameId, opponentLabel };
  }

  // CPU (human_cpu) matchup -- no opponent to schedule against, so "ready" is either an
  // entered score or an already-flagged Force Win request.
  const fwRequested = Boolean(scheduling.data?.fw_flagged);
  if (isComplete || fwRequested) return { kind: "cpu_ready", gameId: game.gameId, isComplete, fwRequested };
  return { kind: "cpu_needs_input", gameId: game.gameId };
}

async function resolveOwnGame(guildId: string, discordId: string, gameId: string) {
  const userId = await userIdFromDiscordId(discordId);
  const game = await currentWeekGameForUser(guildId, userId);
  if (!game || game.gameId !== gameId) throw new ApiError(404, "That matchup could not be found for your current week.");
  const isHome = game.homeUserId === userId;
  const isAway = game.awayUserId === userId;
  if (!isHome && !isAway) throw new ApiError(403, "Only a coach in this matchup can report its score.");
  return { userId, game, isHome };
}

// Covers both branches that end in a score: the H2H "yes, I played" prompt and the CPU
// "I played" prompt. `myScore`/`opponentScore` are always in the caller's own frame of
// reference -- this maps them onto home/away before handing off to the shared manual-entry
// pipeline so every downstream consumer (records, wagers, GOTW) sees a normal result row.
export async function reportOwnGameScore(input: { guildId: string; discordId: string; gameId: string; myScore: number; opponentScore: number }) {
  const { game, isHome } = await resolveOwnGame(input.guildId, input.discordId, input.gameId);
  const homeScore = isHome ? input.myScore : input.opponentScore;
  const awayScore = isHome ? input.opponentScore : input.myScore;
  const outcome: "home" | "away" | "tie" = homeScore === awayScore ? "tie" : homeScore > awayScore ? "home" : "away";

  const { recordManualGameResult } = await import("../league-week/manual-scores.service.js");
  await recordManualGameResult({ guildId: input.guildId, gameId: input.gameId, outcome, homeScore, awayScore, submittedByDiscordId: input.discordId });

  await ensureScheduling(input.gameId);
  await supabase.from("rec_game_scheduling").update({ status: "completed", updated_at: new Date().toISOString() }).eq("game_id", input.gameId);
  await refreshMatchupsChannelForGame(input.gameId);
  return { ok: true as const, homeScore, awayScore };
}

// CPU Force Win used to be requested from the weekly matchups embed's Ready to Advance
// button. That button is gone, and Force Wins are H2H-only. Leftover Discord messages may
// still hit this endpoint, so reject rather than flagging a CPU game.
export async function requestCpuForceWin(_input: { guildId: string; discordId: string; gameId: string }) {
  throw new ApiError(400, "Force Wins are only available for human vs human matchups.");
}
