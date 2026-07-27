// Global legend catalog (game-agnostic reference data) + per-league sold tracking.
// "Sold" is derived from rec_purchases (purchase_type='legend', details.legendId) rather
// than a column on the catalog row, since the same catalog is shared across every league.

import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createPurchaseRequest } from "../purchases/purchases.service.js";

const ACTIVE_STATUSES = ["pending", "approved", "fulfilled"];

export async function listLegendCatalog(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const gameScope = context.rec_leagues?.game === "cfb_27" ? "cfb_27" : "madden";
  const { data, error } = await supabase
    .from("rec_legend_catalog")
    .select("id,name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,college,attributes")
    .eq("game_scope", gameScope)
    .order("position_group", { ascending: true })
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load legend catalog.", error);
  return { legends: data ?? [] };
}

async function activeLeagueLegendPurchases(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_purchases")
    .select("id,user_id,discord_id,status,details")
    .eq("league_id", leagueId)
    .eq("purchase_type", "legend")
    .in("status", ACTIVE_STATUSES);
  if (error) throw new ApiError(500, "Failed to load legend purchases.", error);
  return data ?? [];
}

export type LegendAvailabilityEntry = {
  legendId: string;
  purchaseId: string;
  purchaserUserId: string;
  purchaserDiscordId: string;
  status: string;
};

export async function listLeagueLegendAvailability(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await activeLeagueLegendPurchases(context.leagueId);
  const sold: LegendAvailabilityEntry[] = rows
    .filter((row: any) => row.details?.legendId)
    .map((row: any) => ({
      legendId: row.details.legendId as string,
      purchaseId: row.id as string,
      purchaserUserId: row.user_id as string,
      purchaserDiscordId: row.discord_id as string,
      status: row.status as string,
    }));
  // Kept for callers that only need the id set.
  const soldLegendIds = [...new Set(sold.map((entry) => entry.legendId))];
  return { soldLegendIds, sold };
}

/** Lets the purchaser back out and get refunded while their legend purchase is still pending
 * (not yet approved & applied in-game) — after that point it's committed and only a
 * commissioner denial can undo it. */
export async function cancelMyLegendPurchase(input: { guildId: string; discordId: string; legendId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to resolve your account.", account.error);
  if (!account.data?.user_id) throw new ApiError(403, "Link your REC account before purchasing a legend.");

  const purchase = await supabase
    .from("rec_purchases")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("purchase_type", "legend")
    .eq("user_id", account.data.user_id)
    .eq("status", "pending")
    .filter("details->>legendId", "eq", input.legendId)
    .maybeSingle();
  if (purchase.error) throw new ApiError(500, "Failed to load your legend purchase.", purchase.error);
  if (!purchase.data) throw new ApiError(404, "You don't have a pending purchase for this legend.");

  let refundLedgerId: string | null = null;
  const cost = Number(purchase.data.cost ?? 0);
  if (purchase.data.already_deducted && cost > 0) {
    const refund = await supabase.rpc("add_to_wallet", {
      p_user_id: purchase.data.user_id,
      p_amount: cost,
      p_league_id: context.leagueId,
      p_description: `Legend purchase cancelled — ${purchase.data.details?.name ?? "legend"}`,
      p_transaction_type: "purchase_refund",
      p_source: "purchase",
      p_source_reference: { purchaseId: purchase.data.id, cancelledByBuyer: true },
    });
    if (refund.error) throw new ApiError(500, "Failed to refund cancelled legend purchase.", refund.error);
    refundLedgerId = refund.data;
  }

  const cancelled = await supabase
    .from("rec_purchases")
    .update({
      status: "rejected",
      denied_reason: "Cancelled by buyer before commissioner approval.",
      refund_ledger_id: refundLedgerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", purchase.data.id)
    .select("*")
    .single();
  if (cancelled.error) throw new ApiError(500, "Failed to cancel legend purchase.", cancelled.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "denied", review_reason: "Cancelled by buyer before approval.", reviewed_at: new Date().toISOString() })
    .eq("source_table", "rec_purchases")
    .eq("source_id", purchase.data.id);

  return { ok: true, refunded: cost };
}

async function purchasingTeam(leagueId: string, discordId: string): Promise<{ teamId: string | null; teamName: string | null }> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) return { teamId: null, teamName: null };
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id,team:rec_teams(name,display_abbr,abbreviation)")
    .eq("league_id", leagueId)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team.", assignment.error);
  const team = assignment.data?.team as any;
  return { teamId: assignment.data?.team_id ?? null, teamName: team?.name ?? team?.display_abbr ?? team?.abbreviation ?? null };
}

export async function createLegendPurchaseRequest(input: {
  guildId: string;
  discordId: string;
  legendId: string;
  replaceTarget?: { position: string; firstName: string; lastName: string } | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);

  const legend = await supabase.from("rec_legend_catalog").select("*").eq("id", input.legendId).maybeSingle();
  if (legend.error) throw new ApiError(500, "Failed to load legend.", legend.error);
  if (!legend.data) throw new ApiError(404, "Legend not found.");

  const activePurchases = await activeLeagueLegendPurchases(context.leagueId);
  if (activePurchases.some((row: any) => row.details?.legendId === input.legendId)) {
    throw new ApiError(409, `${legend.data.name} has already been purchased in this league.`);
  }

  const { teamId, teamName } = await purchasingTeam(context.leagueId, input.discordId);

  const details = {
    legendId: legend.data.id,
    name: legend.data.name,
    position: legend.data.position,
    positionGroup: legend.data.position_group,
    estOvr: legend.data.est_ovr,
    height: legend.data.height,
    weight: legend.data.weight,
    hand: legend.data.hand,
    jerseyNumber: legend.data.jersey_number,
    devTrait: legend.data.dev_trait,
    archetype: legend.data.archetype,
    buildNote: legend.data.build_note,
    college: legend.data.college,
    attributes: legend.data.attributes,
    purchasingTeamId: teamId,
    purchasingTeamName: teamName,
    // Buyer's requested replacement target, if any — position + name of the roster player
    // this legend replaces. The commissioner can accept, change, or skip this designation
    // independently when they approve (see reviewLegendPurchase-equivalent flow); blank
    // means the buyer left it entirely up to the commissioner to choose.
    replaceTarget: input.replaceTarget
      ? { position: input.replaceTarget.position, firstName: input.replaceTarget.firstName.trim(), lastName: input.replaceTarget.lastName.trim() }
      : null,
  };

  const result = await createPurchaseRequest({ guildId: input.guildId, discordId: input.discordId, purchaseType: "legend", details });

  // createPurchaseRequest files this under the generic "purchase" inbox category — legends
  // get their own tab, and the notification needs the full attribute list plus an explicit
  // warning not to approve until the player actually exists in the game save.
  const attrLines = Object.entries((legend.data.attributes as Record<string, number>) ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  await supabase
    .from("rec_commissioners_inbox")
    .update({
      queue_type: "legend",
      header: `Legend: ${legend.data.name} (${legend.data.position}, ${legend.data.est_ovr ?? "?"} OVR)`,
      summary: `DO NOT mark Approved & Applied In-Game until you have actually created this player. Team: ${teamName ?? "unassigned"}${details.replaceTarget ? ` · Buyer requests replacing: ${details.replaceTarget.position} ${details.replaceTarget.firstName} ${details.replaceTarget.lastName}` : " · Buyer left the replaced player up to you"}. Dev trait: ${legend.data.dev_trait}. Final in-league OVR is normalized to 88 — nudge attributes as needed. Attributes: ${attrLines}`,
      payload: { purchaseId: result.purchase.id, purchaseType: "legend", cost: result.price, replaceTarget: details.replaceTarget },
    })
    .eq("source_table", "rec_purchases")
    .eq("source_id", result.purchase.id);

  return result;
}
