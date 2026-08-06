// Payout-granting flows (box score, wager, highlight, stream, badge bonus, EOS payout/award,
// GOTW guess, article/interview payout) call creditOrBacklog instead of add_to_wallet
// directly. Below the coin-economy's linked-user floor, the amount is queued here instead of
// hitting the wallet — the triggering notification/approval workflow still fires normally,
// only the credit itself waits. releaseBacklogForLeague bulk-issues everything once a league
// crosses the floor (called right after a new team assignment goes active); wipeBacklogForSeason
// clears whatever's left on season rollover (called from setLeagueWeek) rather than carrying
// it into the new season.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getEconomyActivation } from "./economy-gate.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { sendPushToUser } from "../push/push.service.js";

export type CreditOrBacklogInput = {
  leagueId: string;
  seasonNumber: number;
  userId: string;
  amount: number;
  description: string;
  transactionType: string;
  source: string;
  sourceReference?: Record<string, unknown>;
};

async function issuePayout(input: CreditOrBacklogInput): Promise<string | null> {
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_league_id: input.leagueId,
    p_description: input.description,
    p_transaction_type: input.transactionType,
    p_source: input.source,
    p_source_reference: input.sourceReference ?? {},
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue payout.", ledger.error);
  return ledger.data ?? null;
}

async function backlogPayout(input: CreditOrBacklogInput): Promise<{ backlogged: boolean; ledgerId: string | null }> {
  // Mirrors add_to_wallet's own dedup (same user/type/source/reference short-circuits to the
  // existing ledger row) — some callers (badge bonuses on a box-score correction) re-issue the
  // same payout idempotently and must not queue a second backlog row for it.
  const existing = await supabase
    .from("rec_economy_payout_backlog")
    .select("id")
    .eq("user_id", input.userId)
    .eq("transaction_type", input.transactionType)
    .eq("source", input.source)
    .eq("source_reference", JSON.stringify(input.sourceReference ?? {}))
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check for an existing backlogged payout.", existing.error);
  if (existing.data) return { backlogged: true, ledgerId: null };

  const inserted = await supabase
    .from("rec_economy_payout_backlog")
    .insert({
      league_id: input.leagueId,
      season_number: input.seasonNumber,
      user_id: input.userId,
      amount: input.amount,
      description: input.description,
      transaction_type: input.transactionType,
      source: input.source,
      source_reference: input.sourceReference ?? {},
    })
    .select("id")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to queue backlogged payout.", inserted.error);
  return { backlogged: true, ledgerId: null };
}

/** Non-positive amounts (badge penalties, zero-amount no-ops) always apply immediately — only a real payout waits on the economy floor. */
export async function creditOrBacklog(input: CreditOrBacklogInput): Promise<{ backlogged: boolean; ledgerId: string | null }> {
  if (input.amount <= 0) {
    return { backlogged: false, ledgerId: await issuePayout(input) };
  }

  // Discord-only accounts (no linked site login) are supposed to be excluded from payout
  // eligibility, same as they're already blocked from spending (assertSiteAccountForEconomy) —
  // box score/badge/EOS/GOTW/article payouts all route through here and were crediting a
  // wallet those accounts can't touch yet regardless. Queue it the same way the league-floor
  // backlog below already does; releaseBacklogForUser pays it out once they link.
  const { isDiscordOnlyUser } = await import("../subscriptions/discord-only.service.js");
  if (await isDiscordOnlyUser(input.userId)) {
    return backlogPayout(input);
  }

  const activation = await getEconomyActivation(input.leagueId);
  if (activation.payoutsActive) {
    return { backlogged: false, ledgerId: await issuePayout(input) };
  }

  return backlogPayout(input);
}

/** Called right after a league's linked-user count could have crossed the floor (a new team gets linked). No-ops quietly if the league still isn't eligible or has nothing queued. */
export async function releaseBacklogForLeague(leagueId: string, seasonNumber: number): Promise<{ released: boolean; userCount: number; totalAmount: number }> {
  const activation = await getEconomyActivation(leagueId);
  if (!activation.payoutsActive) return { released: false, userCount: 0, totalAmount: 0 };

  const backlog = await supabase
    .from("rec_economy_payout_backlog")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .is("released_at", null);
  if (backlog.error) throw new ApiError(500, "Failed to load payout backlog.", backlog.error);
  const rows = backlog.data ?? [];
  if (!rows.length) return { released: false, userCount: 0, totalAmount: 0 };

  const now = new Date().toISOString();
  const perUser = new Map<string, { total: number; items: string[] }>();

  for (const row of rows as any[]) {
    const ledger = await supabase.rpc("add_to_wallet", {
      p_user_id: row.user_id,
      p_amount: row.amount,
      p_league_id: leagueId,
      p_description: row.description,
      p_transaction_type: row.transaction_type,
      p_source: row.source,
      p_source_reference: row.source_reference ?? {},
    });
    if (ledger.error) {
      console.error("[ERROR] Failed to release backlogged payout row", row.id, ledger.error);
      continue;
    }
    await supabase.from("rec_economy_payout_backlog").update({ released_at: now }).eq("id", row.id);
    const entry = perUser.get(row.user_id) ?? { total: 0, items: [] };
    entry.total += Number(row.amount);
    entry.items.push(`${row.description} (+${row.amount})`);
    perUser.set(row.user_id, entry);
  }

  const league = await supabase.from("rec_leagues").select("name").eq("id", leagueId).maybeSingle();
  const leagueName = league.data?.name ?? "your league";
  const href = `/l/${leagueId}/matchups`;

  for (const [userId, entry] of perUser) {
    const title = `Backlogged coins released in ${leagueName}: +${entry.total}`;
    const body = entry.items.length > 10
      ? `${entry.items.slice(0, 10).join("; ")}; and ${entry.items.length - 10} more`
      : entry.items.join("; ");
    void createSiteNotification({ userId, leagueId, kind: "economy_backlog_released", title, body, href }).catch(() => undefined);
    void sendPushToUser(userId, { title, body, url: href }).catch(() => undefined);
  }

  return {
    released: true,
    userCount: perUser.size,
    totalAmount: [...perUser.values()].reduce((sum, entry) => sum + entry.total, 0),
  };
}

/** Called once a user links a real site account (linkDiscordFromOAuth) — releases every payout
 * that was queued for them specifically because they were Discord-only, regardless of any
 * league's linked-user floor (that's releaseBacklogForLeague's separate concern). */
export async function releaseBacklogForUser(userId: string): Promise<{ released: boolean; totalAmount: number }> {
  const backlog = await supabase
    .from("rec_economy_payout_backlog")
    .select("*")
    .eq("user_id", userId)
    .is("released_at", null);
  if (backlog.error) throw new ApiError(500, "Failed to load user's payout backlog.", backlog.error);
  const rows = backlog.data ?? [];
  if (!rows.length) return { released: false, totalAmount: 0 };

  const now = new Date().toISOString();
  let totalAmount = 0;
  const items: string[] = [];

  for (const row of rows as any[]) {
    const ledger = await supabase.rpc("add_to_wallet", {
      p_user_id: row.user_id,
      p_amount: row.amount,
      p_league_id: row.league_id,
      p_description: row.description,
      p_transaction_type: row.transaction_type,
      p_source: row.source,
      p_source_reference: row.source_reference ?? {},
    });
    if (ledger.error) {
      console.error("[ERROR] Failed to release user's backlogged payout row", row.id, ledger.error);
      continue;
    }
    await supabase.from("rec_economy_payout_backlog").update({ released_at: now }).eq("id", row.id);
    totalAmount += Number(row.amount);
    items.push(`${row.description} (+${row.amount})`);
  }

  if (totalAmount > 0) {
    const title = `Coins released: +${totalAmount}`;
    const body = items.length > 10 ? `${items.slice(0, 10).join("; ")}; and ${items.length - 10} more` : items.join("; ");
    void createSiteNotification({ userId, kind: "economy_backlog_released", title, body, href: "/account" }).catch(() => undefined);
    void sendPushToUser(userId, { title, body, url: "/account" }).catch(() => undefined);
  }

  return { released: true, totalAmount };
}

/** Called on season rollover (setLeagueWeek, when seasonNumber changes) — backlogs don't carry into the new season. */
export async function wipeBacklogForSeason(leagueId: string, seasonNumber: number): Promise<{ wiped: number }> {
  const deleted = await supabase
    .from("rec_economy_payout_backlog")
    .delete()
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .is("released_at", null)
    .select("id");
  if (deleted.error) throw new ApiError(500, "Failed to wipe season payout backlog.", deleted.error);
  return { wiped: deleted.data?.length ?? 0 };
}
