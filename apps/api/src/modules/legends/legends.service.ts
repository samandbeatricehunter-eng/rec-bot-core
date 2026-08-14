// Global legend catalog (game-agnostic reference data) + per-league sold tracking.
// "Sold" is derived from rec_purchases (purchase_type='legend', details.legendId) rather
// than a column on the catalog row, since the same catalog is shared across every league.

import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext, findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { createPurchaseRequest } from "../purchases/purchases.service.js";
import { isCompatibleReplacementPosition, sortRecAttributeKeys } from "@rec/shared";

const ACTIVE_STATUSES = ["pending", "approved", "fulfilled"];

export async function listLegendCatalog(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_legend_catalog")
    .select("id,name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,college,body_type,attributes,abilities,legend_tier,photo_url,catalog_group")
    .order("legend_tier", { ascending: true })
    .order("position_group", { ascending: true })
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load legend catalog.", error);
  const isCfb = context.rec_leagues?.game === "cfb_27";
  return {
    legends: (data ?? []).map((legend: any) => ({
      ...legend,
      // Shared identity catalog: Madden sees tier-derived trait + abilities; CFB hides them.
      dev_trait: isCfb ? null : (legend.legend_tier === "immortal" ? "xfactor" : "superstar"),
      abilities: isCfb ? [] : (legend.abilities ?? []),
    })),
  };
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

/** Replacement-eligibility for the legend purchase panel. CFB inherits the legend's identity
 * onto the replaced player's roster slot, so it stays locked to the same recruit-only /
 * position-matched rule as custom players. Madden has no such inheritance — the commissioner
 * can apply the purchase to any active roster player, seeded or not — so every active player
 * is a candidate, sorted ascending by OVR to surface the team's weakest players first as the
 * natural replacement recommendation. */
export async function getLegendReplacementConfig(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const isCfb = context.rec_leagues.game === "cfb_27";
  const { teamId } = await purchasingTeam(context.leagueId, discordId);
  if (!teamId) return { replacementPlayers: [], blockedNoEligibleReplacement: false, isCfb };

  if (isCfb) {
    const roster = await supabase.from("rec_players").select("id,full_name,first_name,last_name,position,overall_rating,dev_trait")
      .eq("league_id", context.leagueId).eq("team_id", teamId).eq("is_default_player", false).in("roster_status", ["active", "transferred_in"]).order("position");
    if (roster.error) throw new ApiError(500, "We couldn't load your roster. Please try again.", roster.error);
    const activeRosterCount = await supabase.from("rec_players").select("id", { count: "exact", head: true })
      .eq("league_id", context.leagueId).eq("team_id", teamId).in("roster_status", ["active", "transferred_in"]);
    if (activeRosterCount.error) throw new ApiError(500, "We couldn't load your roster. Please try again.", activeRosterCount.error);
    return {
      replacementPlayers: roster.data ?? [],
      blockedNoEligibleReplacement: (activeRosterCount.count ?? 0) > 0 && (roster.data ?? []).length === 0,
      isCfb,
    };
  }

  const roster = await supabase.from("rec_players").select("id,full_name,first_name,last_name,position,overall_rating,dev_trait")
    .eq("league_id", context.leagueId).eq("team_id", teamId).in("roster_status", ["active", "transferred_in"]);
  if (roster.error) throw new ApiError(500, "We couldn't load your roster. Please try again.", roster.error);
  // Worst-OVR-first so the weakest players surface as the natural replacement recommendation;
  // unrated players sort last since we can't actually vouch for them being the weakest.
  const sorted = [...(roster.data ?? [])].sort((a: any, b: any) => (a.overall_rating ?? Infinity) - (b.overall_rating ?? Infinity));
  return { replacementPlayers: sorted, blockedNoEligibleReplacement: sorted.length === 0, isCfb };
}

export async function createLegendPurchaseRequest(input: {
  guildId: string;
  discordId: string;
  legendId: string;
  replacementPlayerId?: string | null;
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
  const isCfb = context.rec_leagues.game === "cfb_27";

  // CFB inherits the legend's identity onto the replaced player's roster slot, so it stays
  // gated to recruits/manually-added players at a compatible position — same rule as
  // custom-player builds. Madden has no such inheritance: any active roster player (seeded,
  // fantasy-drafted, or recruited) is a valid replacement target.
  let replaceTarget: { playerId: string; position: string; firstName: string; lastName: string } | null = null;
  if (input.replacementPlayerId) {
    if (!teamId) throw new ApiError(403, "A linked league team is required.");
    let query = supabase.from("rec_players").select("id,first_name,last_name,position")
      .eq("id", input.replacementPlayerId).eq("league_id", context.leagueId).eq("team_id", teamId)
      .in("roster_status", ["active", "transferred_in"]);
    if (isCfb) query = query.eq("is_default_player", false);
    const found = await query.maybeSingle();
    if (found.error || !found.data) throw new ApiError(400, isCfb ? "Select an active recruit/added player from your roster to replace." : "Select an active player from your roster to replace.");
    if (isCfb && !isCompatibleReplacementPosition(legend.data.position, found.data.position)) {
      throw new ApiError(400, `${legend.data.name} must replace an added/recruited player at a compatible ${legend.data.position} position.`);
    }
    replaceTarget = { playerId: found.data.id, position: found.data.position, firstName: found.data.first_name, lastName: found.data.last_name };
  }
  if (!replaceTarget) {
    throw new ApiError(400, isCfb
      ? "CFB legends require a specific added/recruited roster player to replace so the legend inherits that roster position."
      : "Madden legends require a roster player to replace so the purchase is linked to that player's EA identity.");
  }

  const legendTier = legend.data.legend_tier === "immortal" ? "immortal" : "legend";
  const details = {
    legendId: legend.data.id,
    name: legend.data.name,
    position: isCfb ? replaceTarget!.position : legend.data.position,
    positionGroup: legend.data.position_group,
    estOvr: legend.data.est_ovr,
    height: legend.data.height,
    weight: legend.data.weight,
    hand: legend.data.hand,
    jerseyNumber: legend.data.jersey_number,
    legendTier,
    devTrait: isCfb ? null : (legendTier === "immortal" ? "xfactor" : "superstar"),
    archetype: legend.data.archetype,
    buildNote: legend.data.build_note,
    college: legend.data.college,
    bodyType: legend.data.body_type,
    attributes: legend.data.attributes,
    abilities: isCfb ? [] : (legend.data.abilities ?? []),
    purchasingTeamId: teamId,
    purchasingTeamName: teamName,
    isCfb,
    // Both games require the buyer-selected roster row. Madden uses it as the durable EA-ID
    // slot that the companion import overwrites; commissioners must not choose it later.
    replaceTarget,
  };

  const result = await createPurchaseRequest({ guildId: input.guildId, discordId: input.discordId, purchaseType: "legend", details });

  // createPurchaseRequest files this under the generic "purchase" inbox category — legends
  // get their own tab, and the notification needs the full attribute list plus an explicit
  // warning not to approve until the player actually exists in the game save. One line per
  // detail/attribute (not a run-on paragraph) so it's actually readable in the Pending panel.
  const attributeMap = (legend.data.attributes as Record<string, number>) ?? {};
  const attrLines = sortRecAttributeKeys(Object.keys(attributeMap))
    .map((key) => `${key}: ${attributeMap[key]}`)
    .join("\n");
  const summaryLines = [
    "DO NOT mark Approved & Applied In-Game until you have actually created this player.",
    `Team: ${teamName ?? "unassigned"}`,
    details.replaceTarget
      ? `Buyer requests replacing: ${details.replaceTarget.position} ${details.replaceTarget.firstName} ${details.replaceTarget.lastName}`
      : "Buyer left the replaced player up to you.",
    `Tier: ${legendTier}`,
    ...(!isCfb ? [`Dev trait: ${details.devTrait}`] : []),
    ...(details.bodyType ? [`Body type: ${details.bodyType}`] : []),
    "Contract: 7 years at lowest possible value — renew perpetually (never lose to negotiations).",
    "Apply the catalog ratings shown and record any necessary in-game edits.",
    "",
    "Attributes:",
    attrLines,
  ];
  await supabase
    .from("rec_commissioners_inbox")
    .update({
      queue_type: "legend",
      header: `${legendTier === "immortal" ? "Immortal" : "Legend"}: ${legend.data.name} (${legend.data.position}, ${legend.data.est_ovr ?? "?"} OVR) — ${teamName ?? "Unassigned"}`,
      summary: summaryLines.join("\n"),
      payload: {
        purchaseId: result.purchase.id,
        purchaseType: "legend",
        cost: result.price,
        replaceTarget: details.replaceTarget,
        legendName: legend.data.name,
        legendPosition: legend.data.position,
        legendTier,
        estOvr: legend.data.est_ovr,
        isCfb,
        ...(!isCfb ? { devTrait: details.devTrait } : {}),
        bodyType: details.bodyType ?? null,
        height: legend.data.height ?? null,
        weight: legend.data.weight ?? null,
        teamName: teamName ?? null,
        attributes: legend.data.attributes ?? {},
        abilities: details.abilities ?? [],
        contractNote: "7-year lowest-value perpetual renew",
      },
    })
    .eq("source_table", "rec_purchases")
    .eq("source_id", result.purchase.id);

  const linked = await bestEffort("legends.find_server_routes", () => findServerRoutesForLeague(context.leagueId), { leagueId: context.leagueId }) ?? null;
  const announcementsChannelId = (linked?.routes as any)?.announcements_channel_id as string | null | undefined;
  if (announcementsChannelId) {
    await postDiscordChannelMessage(announcementsChannelId, {
      embeds: [{
        title: `${legendTier === "immortal" ? "Immortal" : "Legend"} Reserved`,
        color: 0xd4af37,
        description: `**${teamName ?? "A team"}** has purchased **${legend.data.name}** (${legendTier}, ${legend.data.position}, ${legend.data.est_ovr ?? "?"} OVR). Pending commissioner approval.\n\n7-year lowest-value contract, renewed perpetually.`,
      }],
    }).catch((err) => console.error("[ERROR] Failed to post legend purchase announcement (non-fatal):", err));
  }

  return result;
}
