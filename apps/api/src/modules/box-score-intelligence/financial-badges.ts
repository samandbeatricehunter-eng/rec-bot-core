// Financial career badges — derived from rec_dollar_ledger / rec_purchases / rec_wallets,
// not from box-score stats, so they live outside the GameStats/CareerTotals pipeline.
//
// Earner, Spender, Attribute Purchase, and Age Reset/Dev Upgrade Purchase are lifetime
// cumulative ladders isolated per game type: a user's Madden earning/spending never
// combines with their CFB totals, computed by summing rec_dollar_ledger/rec_purchases
// only across the leagues (of every game the user's ever played) that share the same
// `game` value.
//
// Saver is different on purpose — "can be lost if the amount in account changes" is a
// LIVE balance check (current wallet + savings), re-evaluated fresh every recompute,
// not a cumulative total that only ever goes up. It's also the one badge here that
// genuinely CANNOT be isolated per game type: rec_wallets holds one global balance per
// user, not one per league/game (the whole coin economy is a single pot across every
// league a coach plays in). Flagged in code so this doesn't get "fixed" by accident.

import { supabase } from "../../lib/supabase.js";
import {
  ATTRIBUTE_PURCHASE_RUNGS,
  DEV_UPGRADE_PURCHASE_RUNGS,
  EARNER_RUNGS,
  highestRungCrossed,
  SAVER_RUNGS,
  SPENDER_RUNGS,
} from "./badge-rules.js";

const ATTRIBUTE_PURCHASE_TYPES = ["attribute", "player_trait"];
const DEV_UPGRADE_PURCHASE_TYPES = ["age_reset", "dev_upgrade"];

async function sameGameTypeLeagueIds(leagueIds: string[], game: string): Promise<Set<string>> {
  if (!leagueIds.length) return new Set();
  const { data, error } = await supabase.from("rec_leagues").select("id,game").in("id", [...new Set(leagueIds)]);
  if (error) throw error;
  return new Set((data ?? []).filter((row: any) => row.game === game).map((row: any) => row.id));
}

function ladderRow(now: string, leagueId: string, userId: string, badgeKey: string, rung: { tier: string; label: string } | null): any | null {
  if (!rung) return null;
  return {
    league_id: leagueId, user_id: userId, team_id: null, badge_key: badgeKey, badge_scope: "career",
    polarity: "positive", tier: rung.tier, season: null, week: null, earned_count: 1, last_earned_week: null, updated_at: now,
  };
}

/**
 * Financial career-badge rows for one user, scoped to `leagueId`'s game type but
 * summed across every league of that same game type the user has ever played in.
 * `leagueId` is only used to attribute the resulting rows to a league (badge
 * ownership rows require one) — the totals themselves are game-type-wide.
 */
export async function computeFinancialBadgeRows(userId: string, leagueId: string, leagueGame: string): Promise<any[]> {
  const now = new Date().toISOString();

  const [ledgerResult, purchaseResult, walletResult] = await Promise.all([
    supabase.from("rec_dollar_ledger").select("league_id,amount").eq("user_id", userId),
    supabase.from("rec_purchases").select("league_id,purchase_type,cost,status").eq("user_id", userId).in("status", ["approved", "fulfilled"]),
    supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", userId).maybeSingle(),
  ]);
  if (ledgerResult.error) throw ledgerResult.error;
  if (purchaseResult.error) throw purchaseResult.error;
  if (walletResult.error) throw walletResult.error;

  const involvedLeagueIds = [
    ...new Set([...(ledgerResult.data ?? []).map((r: any) => r.league_id), ...(purchaseResult.data ?? []).map((r: any) => r.league_id)].filter(Boolean)),
  ];
  const matching = await sameGameTypeLeagueIds(involvedLeagueIds, leagueGame);

  let totalEarned = 0;
  let totalSpent = 0;
  for (const row of ledgerResult.data ?? []) {
    if (!row.league_id || !matching.has(row.league_id)) continue;
    const amount = Number(row.amount ?? 0);
    if (amount > 0) totalEarned += amount;
    else totalSpent += Math.abs(amount);
  }

  let attributeSpend = 0;
  let devUpgradeSpend = 0;
  for (const row of purchaseResult.data ?? []) {
    if (!row.league_id || !matching.has(row.league_id)) continue;
    const purchaseType = String(row.purchase_type ?? "");
    const cost = Number(row.cost ?? 0);
    if (ATTRIBUTE_PURCHASE_TYPES.includes(purchaseType)) attributeSpend += cost;
    else if (DEV_UPGRADE_PURCHASE_TYPES.includes(purchaseType)) devUpgradeSpend += cost;
  }

  // Saver: global wallet+savings balance — see the file header on why this can't be
  // isolated per game type the way the other four are.
  const currentBalance = Number(walletResult.data?.wallet_balance ?? 0) + Number(walletResult.data?.savings_balance ?? 0);

  return [
    ladderRow(now, leagueId, userId, "earner", highestRungCrossed(totalEarned, EARNER_RUNGS)),
    ladderRow(now, leagueId, userId, "spender", highestRungCrossed(totalSpent, SPENDER_RUNGS)),
    ladderRow(now, leagueId, userId, "saver", highestRungCrossed(currentBalance, SAVER_RUNGS)),
    ladderRow(now, leagueId, userId, "attribute_purchase", highestRungCrossed(attributeSpend, ATTRIBUTE_PURCHASE_RUNGS)),
    ladderRow(now, leagueId, userId, "dev_upgrade_purchase", highestRungCrossed(devUpgradeSpend, DEV_UPGRADE_PURCHASE_RUNGS)),
  ].filter((row): row is any => row !== null);
}
