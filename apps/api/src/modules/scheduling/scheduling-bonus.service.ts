import { supabase } from "../../lib/supabase.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { qualifiesForSchedulingPayoutBonus } from "./scheduling-guardrails.js";

/** A qualifying H2H game doubles both the winner and loser result payout. */
export async function getSchedulingPayoutMultiplier(input: {
  gameId: string;
  homeUserId: string | null | undefined;
  awayUserId: string | null | undefined;
}): Promise<1 | 2> {
  if (!input.homeUserId || !input.awayUserId) return 1;
  const [scheduling, markedOver] = await Promise.all([
    supabase.from("rec_game_scheduling").select("confirmed_at").eq("game_id", input.gameId).maybeSingle(),
    supabase.from("rec_game_scheduling_events").select("id").eq("game_id", input.gameId).eq("event_type", "game_marked_over").limit(1).maybeSingle(),
  ]);
  if (scheduling.error || markedOver.error) {
    console.error("[ERROR] Failed to evaluate scheduling payout bonus (non-fatal):", scheduling.error ?? markedOver.error);
    return 1;
  }
  return qualifiesForSchedulingPayoutBonus({
    confirmedAt: scheduling.data?.confirmed_at,
    homeUserId: input.homeUserId,
    awayUserId: input.awayUserId,
    markedOver: Boolean(markedOver.data),
  }) ? 2 : 1;
}

// Sum of a user's already-issued/approved weekly payouts (interview, article, stream,
// highlights, GOTW correct-guess) OTHER than the game result itself -- mirrors hub.service.ts's
// own weeklyItems "earned" math so the top-up below always matches what the Ways To Get Paid
// panel shows the coach they'd already banked that week.
async function sumOtherWeeklyPayoutsForUser(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  userId: string;
}): Promise<number> {
  const [media, highlights, streams, gotw] = await Promise.all([
    supabase.from("rec_media_submissions").select("amount,status").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("submitter_user_id", input.userId).neq("status", "denied"),
    supabase.from("rec_highlight_payout_reviews").select("amount,status").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("user_id", input.userId).eq("payout_kind", "weekly_highlight").neq("status", "denied"),
    supabase.from("rec_stream_payout_reviews").select("amount,status").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("user_id", input.userId).neq("status", "denied"),
    supabase.from("rec_game_of_week_votes").select("payout_amount").eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("user_id", input.userId),
  ]);
  const paid = (rows: any[] | null | undefined) => (rows ?? []).filter((row) => row.status === "issued" || row.status === "approved").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const gotwPaid = (gotw.data ?? []).reduce((sum: number, row: any) => sum + Number(row.payout_amount ?? 0), 0);
  return paid(media.data) + paid(highlights.data) + paid(streams.data) + gotwPaid;
}

/**
 * The scheduling-completion bonus doubles EVERY coin a coach earned that week, not just the
 * game result -- schedule through REC, both coaches check in, mark the game over, and every
 * interview/article/stream/highlight/GOTW payout already banked that week gets matched.
 * Called alongside the win/loss bonus wherever schedulingMultiplier === 2 is checked (box
 * score approval and commissioner/imported advance) -- idempotent via the same
 * (userId, transactionType, source, sourceReference) dedup add_to_wallet already enforces for
 * the win/loss bonus, keyed here by a distinct `kind` so it never collides with that row.
 */
export async function topUpOtherWeeklyPayoutsForSchedulingBonus(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  gameId: string;
  userId: string;
}): Promise<void> {
  const amount = await sumOtherWeeklyPayoutsForUser(input);
  if (amount <= 0) return;
  await creditOrBacklog({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    userId: input.userId,
    amount,
    description: `Scheduling completion bonus (other weekly actions) — Wk ${input.weekNumber}`,
    transactionType: "scheduling_bonus_payout",
    source: "box_score",
    sourceReference: { gameId: input.gameId, userId: input.userId, kind: "weekly_actions" },
  });
}
