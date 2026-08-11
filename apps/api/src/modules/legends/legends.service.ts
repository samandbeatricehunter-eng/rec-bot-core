// Global legend catalog (game-agnostic reference data) + per-league sold tracking.
// "Sold" is derived from rec_purchases (purchase_type='legend', details.legendId) rather
// than a column on the catalog row, since the same catalog is shared across every league.

import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext, findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { createPurchaseRequest } from "../purchases/purchases.service.js";
import { isCompatibleReplacementPosition } from "@rec/shared";

const ACTIVE_STATUSES = ["pending", "approved", "fulfilled"];

export async function listLegendCatalog(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const gameScope = context.rec_leagues?.game === "cfb_27" ? "cfb_27" : "madden";
  const { data, error } = await supabase
    .from("rec_legend_catalog")
    .select("id,name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,college,body_type,attributes,photo_url")
    .eq("game_scope", gameScope)
    .order("position_group", { ascending: true })
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load legend catalog.", error);
  const isCfb = context.rec_leagues?.game === "cfb_27";
  return { legends: (data ?? []).map((legend: any) => ({ ...legend, dev_trait: isCfb ? null : "xfactor" })) };
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

  // Only recruits/manually-added players are eligible replacement targets — same rule as
  // custom-player builds (the default baseline roster is never selectable here).
  let replaceTarget: { playerId: string; position: string; firstName: string; lastName: string } | null = null;
  if (input.replacementPlayerId) {
    if (!teamId) throw new ApiError(403, "A linked league team is required.");
    const found = await supabase.from("rec_players").select("id,first_name,last_name,position")
      .eq("id", input.replacementPlayerId).eq("league_id", context.leagueId).eq("team_id", teamId)
      .in("roster_status", ["active", "transferred_in"]).eq("is_default_player", false).maybeSingle();
    if (found.error || !found.data) throw new ApiError(400, "Select an active recruit/added player from your roster to replace.");
    if (isCfb && !isCompatibleReplacementPosition(legend.data.position, found.data.position)) {
      throw new ApiError(400, `${legend.data.name} must replace an added/recruited player at a compatible ${legend.data.position} position.`);
    }
    replaceTarget = { playerId: found.data.id, position: found.data.position, firstName: found.data.first_name, lastName: found.data.last_name };
  }
  if (isCfb && !replaceTarget) {
    throw new ApiError(400, "CFB legends require a specific added/recruited roster player to replace so the legend inherits that roster position.");
  }

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
    devTrait: isCfb ? null : "xfactor",
    archetype: legend.data.archetype,
    buildNote: legend.data.build_note,
    college: legend.data.college,
    bodyType: legend.data.body_type,
    attributes: legend.data.attributes,
    purchasingTeamId: teamId,
    purchasingTeamName: teamName,
    isCfb,
    // CFB requires this exact compatible roster row; Madden may leave it blank or allow the
    // commissioner to override it during review.
    replaceTarget,
  };

  const result = await createPurchaseRequest({ guildId: input.guildId, discordId: input.discordId, purchaseType: "legend", details });

  // createPurchaseRequest files this under the generic "purchase" inbox category — legends
  // get their own tab, and the notification needs the full attribute list plus an explicit
  // warning not to approve until the player actually exists in the game save. One line per
  // detail/attribute (not a run-on paragraph) so it's actually readable in the Pending panel.
  const attrLines = Object.entries((legend.data.attributes as Record<string, number>) ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const summaryLines = [
    "DO NOT mark Approved & Applied In-Game until you have actually created this player.",
    `Team: ${teamName ?? "unassigned"}`,
    details.replaceTarget
      ? `Buyer requests replacing: ${details.replaceTarget.position} ${details.replaceTarget.firstName} ${details.replaceTarget.lastName}`
      : "Buyer left the replaced player up to you.",
    ...(!isCfb ? [`Dev trait: ${details.devTrait}`] : []),
    ...(details.bodyType ? [`Body type: ${details.bodyType}`] : []),
    "Final in-league OVR is normalized to 88 — nudge attributes as needed.",
    "",
    "Attributes:",
    attrLines,
  ];
  await supabase
    .from("rec_commissioners_inbox")
    .update({
      queue_type: "legend",
      header: `Legend: ${legend.data.name} (${legend.data.position}, ${legend.data.est_ovr ?? "?"} OVR) — ${teamName ?? "Unassigned"}`,
      summary: summaryLines.join("\n"),
      payload: {
        purchaseId: result.purchase.id,
        purchaseType: "legend",
        cost: result.price,
        replaceTarget: details.replaceTarget,
        legendName: legend.data.name,
        legendPosition: legend.data.position,
        estOvr: legend.data.est_ovr,
        isCfb,
        ...(!isCfb ? { devTrait: details.devTrait } : {}),
        bodyType: details.bodyType ?? null,
        height: legend.data.height ?? null,
        weight: legend.data.weight ?? null,
        teamName: teamName ?? null,
        attributes: legend.data.attributes ?? {},
      },
    })
    .eq("source_table", "rec_purchases")
    .eq("source_id", result.purchase.id);

  const linked = await findServerRoutesForLeague(context.leagueId).catch(() => null);
  const announcementsChannelId = (linked?.routes as any)?.announcements_channel_id as string | null | undefined;
  if (announcementsChannelId) {
    await postDiscordChannelMessage(announcementsChannelId, {
      embeds: [{
        title: "Legend Reserved",
        color: 0xd4af37,
        description: `**${teamName ?? "A team"}** has purchased legend **${legend.data.name}** (${legend.data.position}, ${legend.data.est_ovr ?? "?"} OVR). Pending commissioner approval.`,
      }],
    }).catch((err) => console.error("[ERROR] Failed to post legend purchase announcement (non-fatal):", err));
  }

  return result;
}
