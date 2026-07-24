import { REC_ECONOMY_MINIMUM_LINKED_USERS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

/**
 * Linked users = active team assignments with a user_id.
 * Counts Discord-only coaches, site-only accounts, and fully linked accounts alike.
 */
export async function countLinkedTeamUsers(leagueId: string): Promise<number> {
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .not("user_id", "is", null);
  if (error) throw new ApiError(500, "Failed to count linked users for economy gate.", error);
  return new Set((data ?? []).map((row) => String(row.user_id))).size;
}

export type EconomyActivation = {
  enabledInSettings: boolean;
  linkedUserCount: number;
  minimumLinkedUsers: number;
  payoutsActive: boolean;
  membersShort: number;
};

export async function getEconomyActivation(leagueId: string): Promise<EconomyActivation> {
  const { data, error } = await supabase
    .from("rec_league_configuration")
    .select("coin_economy_enabled,coin_economy_minimum_linked_users")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load economy settings.", error);

  const enabledInSettings = Boolean(data?.coin_economy_enabled);
  const configuredMin = Number(data?.coin_economy_minimum_linked_users ?? REC_ECONOMY_MINIMUM_LINKED_USERS);
  const minimumLinkedUsers = Math.max(REC_ECONOMY_MINIMUM_LINKED_USERS, configuredMin || 0);
  const linkedUserCount = await countLinkedTeamUsers(leagueId);
  const payoutsActive = enabledInSettings && linkedUserCount >= minimumLinkedUsers;
  return {
    enabledInSettings,
    linkedUserCount,
    minimumLinkedUsers,
    payoutsActive,
    membersShort: Math.max(0, minimumLinkedUsers - linkedUserCount),
  };
}

/** Throws when settings are off OR the league is under the linked-user floor. */
export async function assertEconomyPayoutsActive(leagueId: string): Promise<EconomyActivation> {
  const activation = await getEconomyActivation(leagueId);
  if (!activation.enabledInSettings) {
    throw new ApiError(400, "The coin economy is not enabled for this league.");
  }
  if (!activation.payoutsActive) {
    throw new ApiError(
      400,
      `Economy payouts unlock at ${activation.minimumLinkedUsers} linked users. This league has ${activation.linkedUserCount} (needs ${activation.membersShort} more).`,
    );
  }
  return activation;
}