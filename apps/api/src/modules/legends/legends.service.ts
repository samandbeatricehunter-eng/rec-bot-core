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
    .select("details,discord_id")
    .eq("league_id", leagueId)
    .eq("purchase_type", "legend")
    .in("status", ACTIVE_STATUSES);
  if (error) throw new ApiError(500, "Failed to load legend purchases.", error);
  return data ?? [];
}

export async function listLeagueLegendAvailability(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await activeLeagueLegendPurchases(context.leagueId);
  const soldLegendIds = [...new Set(rows.map((row: any) => row.details?.legendId).filter(Boolean))];
  return { soldLegendIds };
}

async function purchasingTeam(leagueId: string, discordId: string): Promise<{ teamId: string | null; teamName: string | null }> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) return { teamId: null, teamName: null };
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id,rec_teams(name,display_abbr,abbreviation)")
    .eq("league_id", leagueId)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team.", assignment.error);
  const team = assignment.data?.rec_teams as any;
  return { teamId: assignment.data?.team_id ?? null, teamName: team?.name ?? team?.display_abbr ?? team?.abbreviation ?? null };
}

export async function createLegendPurchaseRequest(input: { guildId: string; discordId: string; legendId: string; replacePlayerRequest?: string | null }) {
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
    // Buyer's requested replacement player, if any. When blank, the installing
    // admin defaults to replacing the roster's lowest-OVR player at this position.
    replacePlayerRequest: input.replacePlayerRequest?.trim() || null,
  };

  return createPurchaseRequest({ guildId: input.guildId, discordId: input.discordId, purchaseType: "legend", details });
}
