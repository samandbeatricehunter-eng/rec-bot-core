// Weekly Transactions Discord embed, per docs/handoff-total/00_MASTER/MASTER_PLAN.md:
// "one team-oriented embed per Advance, summarizes prior-week Coin/XP transaction activity,
// includes relevant pending-purchase line, does not publish wallet balances, source-aware and
// idempotent." One embed per user with an active team assignment, single-line-per-transaction.
import { formatCoins, isRiseToImmortalityLeagueType } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signedXp(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")} XP`;
}

/** Runs once per advance, right after the week's results are finalized. Non-fatal on failure --
 * called the same way as every other post-advance side effect in advance-results.service.ts. */
export async function postWeeklyTransactionsForAdvance(input: {
  guildId: string;
  seasonNumber: number;
  weekNumber: number;
  windowStartIso: string;
  windowEndIso: string;
}): Promise<{ posted: number; skipped: number }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const channelId = (context.routes as any)?.weekly_transactions_channel_id as string | null | undefined;
  if (!channelId) return { posted: 0, skipped: 0 };

  const leagueId = context.leagueId;
  const isRti = isRiseToImmortalityLeagueType(context.league.leagueType);

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team:rec_teams(name,display_city,display_nick,is_relocated)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error || !assignments.data?.length) return { posted: 0, skipped: 0 };

  const teamByUser = new Map<string, any>();
  for (const row of assignments.data as any[]) teamByUser.set(row.user_id, row.team);
  const userIds = [...teamByUser.keys()];
  if (!userIds.length) return { posted: 0, skipped: 0 };

  const [coinRows, purchaseRows, nonRtiXpRows, rtiProspects] = await Promise.all([
    supabase.from("rec_dollar_ledger")
      .select("user_id,amount,transaction_type,description,created_at")
      .eq("league_id", leagueId).in("user_id", userIds)
      .gte("created_at", input.windowStartIso).lt("created_at", input.windowEndIso),
    supabase.from("rec_purchases")
      .select("user_id,purchase_type,cost")
      .eq("league_id", leagueId).eq("status", "pending").in("user_id", userIds),
    isRti
      ? Promise.resolve({ data: [] as any[], error: null })
      : supabase.from("rec_player_xp_ledger")
          .select("credited_to_user_id,awarded_xp,event_type,created_at")
          .eq("league_id", leagueId).in("credited_to_user_id", userIds)
          .gte("created_at", input.windowStartIso).lt("created_at", input.windowEndIso),
    isRti
      ? supabase.from("rec_immortality_prospects").select("id,user_id,immortality_league_id").in("user_id", userIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (coinRows.error) throw coinRows.error;
  if (purchaseRows.error) throw purchaseRows.error;
  if (nonRtiXpRows.error) throw nonRtiXpRows.error;
  if (rtiProspects.error) throw rtiProspects.error;

  // RTI Player XP is prospect-scoped, not user-scoped -- resolve prospect -> owning user first,
  // scoped to this REC league's immortality league (rtiProspects was already filtered to userIds,
  // so every row here belongs to this league by construction).
  const prospectIds = (rtiProspects.data ?? []).map((row: any) => row.id);
  const userByProspect = new Map<string, string>((rtiProspects.data ?? []).map((row: any) => [row.id, row.user_id] as [string, string]));
  const rtiXpRows = prospectIds.length
    ? await supabase.from("rec_immortality_xp_ledger")
        .select("prospect_id,player_xp_delta,event_type,created_at")
        .in("prospect_id", prospectIds)
        .gte("created_at", input.windowStartIso).lt("created_at", input.windowEndIso)
    : { data: [] as any[], error: null };
  if (rtiXpRows.error) throw rtiXpRows.error;

  const coinsByUser = new Map<string, any[]>();
  for (const row of coinRows.data ?? []) {
    if (!coinsByUser.has(row.user_id)) coinsByUser.set(row.user_id, []);
    coinsByUser.get(row.user_id)!.push(row);
  }
  const purchasesByUser = new Map<string, any[]>();
  for (const row of purchaseRows.data ?? []) {
    if (!purchasesByUser.has(row.user_id)) purchasesByUser.set(row.user_id, []);
    purchasesByUser.get(row.user_id)!.push(row);
  }
  const xpByUser = new Map<string, Array<{ delta: number; eventType: string }>>();
  for (const row of nonRtiXpRows.data ?? []) {
    const userId = row.credited_to_user_id;
    if (!userId) continue;
    if (!xpByUser.has(userId)) xpByUser.set(userId, []);
    xpByUser.get(userId)!.push({ delta: Number(row.awarded_xp ?? 0), eventType: row.event_type });
  }
  for (const row of rtiXpRows.data ?? []) {
    const userId = userByProspect.get(row.prospect_id);
    if (!userId) continue;
    if (!xpByUser.has(userId)) xpByUser.set(userId, []);
    xpByUser.get(userId)!.push({ delta: Number(row.player_xp_delta ?? 0), eventType: row.event_type });
  }

  let posted = 0;
  let skipped = 0;
  for (const userId of userIds) {
    const coins = coinsByUser.get(userId) ?? [];
    const purchases = purchasesByUser.get(userId) ?? [];
    const xp = xpByUser.get(userId) ?? [];
    if (!coins.length && !purchases.length && !xp.length) continue; // nothing to report this week

    // Claim the (league, season, week, user) slot first -- a unique-constraint conflict means
    // this user's embed already posted for this advance (retry-safe, source-aware/idempotent).
    const claim = await supabase.from("rec_weekly_transaction_posts").insert({
      league_id: leagueId, season_number: input.seasonNumber, week_number: input.weekNumber,
      user_id: userId, discord_channel_id: channelId,
    }).select("id").single();
    if (claim.error) {
      if (claim.error.code === "23505") { skipped += 1; continue; }
      throw claim.error;
    }

    const lines: string[] = [];
    for (const row of coins) {
      const amount = Number(row.amount ?? 0);
      lines.push(`${formatCoins(amount, { signed: true })} — ${row.description?.trim() || humanize(row.transaction_type)}`);
    }
    for (const row of xp) {
      if (row.delta === 0) continue;
      lines.push(`${signedXp(row.delta)} — ${humanize(row.eventType)}`);
    }
    if (purchases.length) {
      const totalCost = purchases.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
      lines.push(`⏳ ${purchases.length} pending purchase${purchases.length === 1 ? "" : "s"} (${formatCoins(totalCost)}) awaiting commissioner review`);
    }

    const team = teamByUser.get(userId);
    const teamName = formatTeamDisplayName(team) ?? "Your Team";
    const message = await postDiscordChannelMessage(channelId, {
      embeds: [{
        title: `${teamName} — Week ${input.weekNumber} Transactions`,
        description: lines.join("\n"),
        color: 0xd9a521,
      }],
    }).catch((error) => {
      console.error(`[WeeklyTransactions] Failed to post embed for user ${userId} (non-fatal):`, error);
      return null;
    });

    if (message?.id) {
      await supabase.from("rec_weekly_transaction_posts").update({ discord_message_id: message.id }).eq("id", claim.data.id);
    }
    posted += 1;
  }

  return { posted, skipped };
}
