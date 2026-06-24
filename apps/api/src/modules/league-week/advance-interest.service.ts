import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";

export const SAVINGS_INTEREST_RATE = 0.035;
const MAX_ADVANCES_PER_24H = 21;
const INTEREST_DISABLE_MS = 24 * 60 * 60 * 1000;

type LeagueAdvanceContext = {
  leagueId: string;
  serverId: string;
  seasonNumber: number;
  previousWeek: number;
  previousStage: string;
  nextWeek: number;
  nextStage: string;
  leagueRow: {
    interest_disabled_until?: string | null;
    advance_rate_window_start?: string | null;
    advance_rate_count?: number | null;
  };
};

function isForwardAdvance(input: Pick<LeagueAdvanceContext, "previousWeek" | "previousStage" | "nextWeek" | "nextStage">) {
  if (input.nextWeek > input.previousWeek) return true;
  if (input.nextWeek < input.previousWeek) return false;
  const order = ["preseason_training_camp", "preseason", "regular_season", "wild_card", "divisional", "conference_championship", "super_bowl", "offseason"];
  const previousIndex = order.indexOf(input.previousStage);
  const nextIndex = order.indexOf(input.nextStage);
  if (previousIndex === -1 || nextIndex === -1) return input.nextStage !== input.previousStage;
  return nextIndex > previousIndex;
}

async function updateAdvanceRateLimit(leagueId: string, leagueRow: LeagueAdvanceContext["leagueRow"]) {
  const now = new Date();
  const windowStart = leagueRow.advance_rate_window_start ? new Date(leagueRow.advance_rate_window_start) : null;
  const windowExpired = !windowStart || now.getTime() - windowStart.getTime() > INTEREST_DISABLE_MS;
  const nextCount = windowExpired ? 1 : Number(leagueRow.advance_rate_count ?? 0) + 1;
  const nextWindowStart = windowExpired ? now : windowStart!;
  const payload: Record<string, unknown> = {
    advance_rate_window_start: nextWindowStart.toISOString(),
    advance_rate_count: nextCount,
    updated_at: now.toISOString(),
  };
  if (nextCount > MAX_ADVANCES_PER_24H) {
    payload.interest_disabled_until = new Date(now.getTime() + INTEREST_DISABLE_MS).toISOString();
  }
  const result = await supabase.from("rec_leagues").update(payload).eq("id", leagueId);
  if (result.error) throw new ApiError(500, "Failed to update advance rate limit.", result.error);
  return payload;
}

export async function applyAdvanceSavingsInterest(input: LeagueAdvanceContext) {
  if (!isForwardAdvance(input)) {
    return { applied: false as const, reason: "not_forward_advance" as const, usersCredited: 0, totalInterest: 0 };
  }

  const now = new Date();
  if (input.leagueRow.interest_disabled_until && new Date(input.leagueRow.interest_disabled_until) > now) {
    await updateAdvanceRateLimit(input.leagueId, input.leagueRow);
    return { applied: false as const, reason: "interest_disabled" as const, usersCredited: 0, totalInterest: 0 };
  }

  await updateAdvanceRateLimit(input.leagueId, input.leagueRow);

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", input.leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load league users for savings interest.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) {
    return { applied: true as const, reason: "no_linked_users" as const, usersCredited: 0, totalInterest: 0 };
  }

  const wallets = await supabase
    .from("rec_wallets")
    .select("user_id,savings_balance")
    .in("user_id", userIds)
    .gt("savings_balance", 0);
  if (wallets.error) throw new ApiError(500, "Failed to load wallets for savings interest.", wallets.error);

  let usersCredited = 0;
  let totalInterest = 0;
  const idempotencyPrefix = `advance_interest:${input.leagueId}:${input.seasonNumber}:${input.nextWeek}:${input.nextStage}`;

  for (const wallet of wallets.data ?? []) {
    const savings = Number(wallet.savings_balance ?? 0);
    const interest = Math.floor(savings * SAVINGS_INTEREST_RATE);
    if (interest <= 0) continue;

    const idempotencyKey = `${idempotencyPrefix}:${wallet.user_id}`;
    const existing = await supabase
      .from("rec_dollar_ledger")
      .select("id")
      .eq("user_id", wallet.user_id)
      .eq("league_id", input.leagueId)
      .eq("transaction_type", "savings_interest")
      .filter("source_reference->>idempotencyKey", "eq", idempotencyKey)
      .maybeSingle();
    if (existing.error) throw new ApiError(500, "Failed to check savings interest idempotency.", existing.error);
    if (existing.data?.id) continue;

    const updated = await supabase
      .from("rec_wallets")
      .update({
        savings_balance: savings + interest,
        updated_at: now.toISOString(),
      })
      .eq("user_id", wallet.user_id);
    if (updated.error) throw new ApiError(500, "Failed to credit savings interest.", updated.error);

    const ledger = await supabase.from("rec_dollar_ledger").insert({
      user_id: wallet.user_id,
      league_id: input.leagueId,
      amount: interest,
      transaction_type: "savings_interest",
      description: `Savings interest (${Math.round(SAVINGS_INTEREST_RATE * 1000) / 10}%) — Week ${input.nextWeek}`,
      source: "commissioner_advance",
      source_reference: {
        idempotencyKey,
        seasonNumber: input.seasonNumber,
        weekNumber: input.nextWeek,
        seasonStage: input.nextStage,
        previousWeek: input.previousWeek,
        previousStage: input.previousStage,
        rate: SAVINGS_INTEREST_RATE,
      },
    });
    if (ledger.error) throw new ApiError(500, "Failed to write savings interest ledger entry.", ledger.error);

    usersCredited += 1;
    totalInterest += interest;
  }

  if (usersCredited > 0) {
    await writeAuditLog({
      action: "economy.savings_interest_applied",
      entityType: "rec_leagues",
      entityId: input.leagueId,
      newValue: {
        leagueId: input.leagueId,
        seasonNumber: input.seasonNumber,
        weekNumber: input.nextWeek,
        seasonStage: input.nextStage,
        usersCredited,
        totalInterest,
      },
      reason: "Applied savings interest on league advance.",
      source: "manual_admin_entry",
    });
  }

  return { applied: true as const, reason: "credited" as const, usersCredited, totalInterest };
}
