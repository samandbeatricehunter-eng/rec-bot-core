import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export const PLATINUM_OWN_LIMIT = 5;
export const PLATINUM_JOIN_LIMIT = 20;
export const GOLD_JOIN_LIMIT = 5;
export const GRACE_DAYS = 14;

export type SubscriptionTier = "none" | "gold" | "platinum";
export type BillingStatus =
  | "none"
  | "active"
  | "lifetime_comp"
  | "past_due"
  | "canceled"
  | "grace";

export type EntitlementUser = {
  id: string;
  subscription_tier: string | null;
  billing_status: string | null;
  subscription_grace_until: string | null;
  subscription_current_period_end?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  supabase_auth_user_id?: string | null;
};

export type EntitlementSummary = {
  tier: SubscriptionTier;
  billingStatus: BillingStatus;
  graceUntil: string | null;
  currentPeriodEnd: string | null;
  siteAccess: boolean;
  canCreateLeague: boolean;
  canEnableDiscordBot: boolean;
  joinLimit: number;
  ownLimit: number;
  ownedCounts: Record<string, number>;
  joinCounts: Record<string, number>;
  claimDropdownOpen: boolean;
};

function asTier(value: string | null | undefined): SubscriptionTier {
  if (value === "gold" || value === "platinum") return value;
  return "none";
}

function asBillingStatus(value: string | null | undefined): BillingStatus {
  if (
    value === "active" ||
    value === "lifetime_comp" ||
    value === "past_due" ||
    value === "canceled" ||
    value === "grace"
  ) {
    return value;
  }
  return "none";
}

function graceStillValid(graceUntil: string | null | undefined, now = new Date()): boolean {
  if (!graceUntil) return false;
  const until = new Date(graceUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}

export function hasSiteAccess(user: EntitlementUser, now = new Date()): boolean {
  const tier = asTier(user.subscription_tier);
  if (tier !== "gold" && tier !== "platinum") return false;

  const status = asBillingStatus(user.billing_status);
  if (status === "active" || status === "lifetime_comp" || status === "grace") {
    if (status === "grace" && !graceStillValid(user.subscription_grace_until, now)) return false;
    return true;
  }
  if (status === "past_due" && graceStillValid(user.subscription_grace_until, now)) {
    return true;
  }
  return false;
}

export function canCreateLeague(user: EntitlementUser, now = new Date()): boolean {
  return asTier(user.subscription_tier) === "platinum" && hasSiteAccess(user, now);
}

export function canEnableDiscordBot(user: EntitlementUser, now = new Date()): boolean {
  return canCreateLeague(user, now);
}

export async function assertLeagueNotFrozen(leagueId: string) {
  const result = await supabase
    .from("rec_leagues")
    .select("id,name,subscription_frozen")
    .eq("id", leagueId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load league freeze status.", result.error);
  if (!result.data) throw new ApiError(404, "League was not found.");
  if (result.data.subscription_frozen) {
    throw new ApiError(
      403,
      "This league is frozen because the owner's subscription lapsed. Renew on REC Leagues to resume season advances and mutating bot ops.",
    );
  }
  return result.data;
}

export async function assertGuildLeagueNotFrozen(guildId: string) {
  const server = await supabase
    .from("rec_discord_servers")
    .select("id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (server.error) throw new ApiError(500, "Failed to load Discord server.", server.error);
  if (!server.data) throw new ApiError(404, "Discord server is not registered.");

  const link = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.data.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (link.error) throw new ApiError(500, "Failed to load primary league link.", link.error);
  if (!link.data?.league_id) throw new ApiError(404, "No primary league linked to this server.");
  return assertLeagueNotFrozen(link.data.league_id);
}

export function joinLimitFor(user: EntitlementUser, now = new Date()): number {
  if (!hasSiteAccess(user, now)) return 0;
  const tier = asTier(user.subscription_tier);
  if (tier === "platinum") return PLATINUM_JOIN_LIMIT;
  if (tier === "gold") return GOLD_JOIN_LIMIT;
  return 0;
}

export function ownLimitFor(user: EntitlementUser, now = new Date()): number {
  if (!canCreateLeague(user, now)) return 0;
  return PLATINUM_OWN_LIMIT;
}

async function loadUser(userId: string): Promise<EntitlementUser> {
  const result = await supabase
    .from("rec_users")
    .select(
      "id,subscription_tier,billing_status,subscription_grace_until,subscription_current_period_end,stripe_customer_id,stripe_subscription_id,supabase_auth_user_id",
    )
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load user entitlements.", result.error);
  if (!result.data) throw new ApiError(404, "User was not found.");
  return result.data as EntitlementUser;
}

async function countOwnedLeagues(userId: string, game?: string): Promise<number> {
  let query = supabase
    .from("rec_leagues")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .eq("subscription_frozen", false);
  if (game) query = query.eq("game", game);
  const result = await query;
  if (result.error) throw new ApiError(500, "Failed to count owned leagues.", result.error);
  return Number(result.count ?? 0);
}

async function countJoinsByGame(userId: string, game?: string): Promise<number> {
  const values: unknown[] = [userId];
  let gameClause = "";
  if (game) {
    values.push(game);
    gameClause = ` and l.game = $2`;
  }
  const { getPgPool } = await import("../../db/client.js");
  const result = await getPgPool().query(
    `
      select count(*)::int as count
      from rec_team_assignments ta
      inner join rec_leagues l on l.id = ta.league_id
      where ta.user_id = $1
        and ta.assignment_status = 'active'
        and ta.ended_at is null
        and coalesce(l.subscription_frozen, false) = false
        ${gameClause}
    `,
    values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function ownedCountsByGame(userId: string): Promise<Record<string, number>> {
  const { getPgPool } = await import("../../db/client.js");
  const result = await getPgPool().query(
    `
      select game, count(*)::int as count
      from rec_leagues
      where owner_user_id = $1
        and coalesce(subscription_frozen, false) = false
      group by game
    `,
    [userId],
  );
  const out: Record<string, number> = {};
  for (const row of result.rows) {
    out[String(row.game)] = Number(row.count);
  }
  return out;
}

async function joinCountsByGame(userId: string): Promise<Record<string, number>> {
  const { getPgPool } = await import("../../db/client.js");
  const result = await getPgPool().query(
    `
      select l.game, count(*)::int as count
      from rec_team_assignments ta
      inner join rec_leagues l on l.id = ta.league_id
      where ta.user_id = $1
        and ta.assignment_status = 'active'
        and ta.ended_at is null
        and coalesce(l.subscription_frozen, false) = false
      group by l.game
    `,
    [userId],
  );
  const out: Record<string, number> = {};
  for (const row of result.rows) {
    out[String(row.game)] = Number(row.count);
  }
  return out;
}

export async function assertCanCreateLeague(userId: string, game: string): Promise<EntitlementUser> {
  const user = await loadUser(userId);
  if (!canCreateLeague(user)) {
    throw new ApiError(403, "Platinum subscription required to create a league.");
  }
  const owned = await countOwnedLeagues(userId, game);
  if (owned >= PLATINUM_OWN_LIMIT) {
    throw new ApiError(
      403,
      `Platinum allows at most ${PLATINUM_OWN_LIMIT} active leagues per game.`,
      { owned, limit: PLATINUM_OWN_LIMIT, game },
    );
  }
  return user;
}

export async function assertCanJoinLeague(userId: string, game: string): Promise<EntitlementUser> {
  const user = await loadUser(userId);
  const limit = joinLimitFor(user);
  if (limit <= 0) {
    throw new ApiError(403, "An active Gold or Platinum subscription is required to join a league.");
  }
  const joined = await countJoinsByGame(userId, game);
  if (joined >= limit) {
    throw new ApiError(
      403,
      `Join limit reached for this game (${joined}/${limit}).`,
      { joined, limit, game },
    );
  }
  return user;
}

export async function countClaimableUsers(): Promise<number> {
  const { getPgPool } = await import("../../db/client.js");
  const result = await getPgPool().query(
    `
      select count(*)::int as count
      from (
        select u.id
        from rec_users u
        inner join rec_discord_accounts da on da.user_id = u.id
        inner join rec_team_assignments ta on ta.user_id = u.id
          and ta.assignment_status = 'active'
          and ta.ended_at is null
        where u.supabase_auth_user_id is null
          and da.username is not null
        group by u.id
      ) claimable
    `,
  );
  return Number(result.rows[0]?.count ?? 0);
}

type ClaimDropdownSettings = {
  closed?: boolean;
  auto_close_when_empty?: boolean;
};

async function readClaimDropdownSettings(): Promise<ClaimDropdownSettings> {
  const result = await supabase
    .from("rec_app_settings")
    .select("value")
    .eq("key", "identity_claim_dropdown")
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load claim dropdown settings.", result.error);
  const value = (result.data?.value ?? {}) as ClaimDropdownSettings;
  return value ?? {};
}

export async function setIdentityClaimDropdownClosed(closed: boolean): Promise<void> {
  const current = await readClaimDropdownSettings();
  const next = {
    ...current,
    closed,
    auto_close_when_empty: current.auto_close_when_empty ?? true,
  };
  const result = await supabase.from("rec_app_settings").upsert(
    {
      key: "identity_claim_dropdown",
      value: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (result.error) throw new ApiError(500, "Failed to update claim dropdown settings.", result.error);
}

export async function isIdentityClaimDropdownOpen(): Promise<boolean> {
  const settings = await readClaimDropdownSettings();
  if (settings.closed === true) return false;

  const autoClose = settings.auto_close_when_empty !== false;
  if (autoClose) {
    const claimable = await countClaimableUsers();
    if (claimable === 0) {
      await setIdentityClaimDropdownClosed(true);
      return false;
    }
  }
  return true;
}

export async function getEntitlementSummary(userId: string): Promise<EntitlementSummary> {
  await refreshUserGraceState(userId);
  const user = await loadUser(userId);
  const [ownedCounts, joinCounts, claimDropdownOpen] = await Promise.all([
    ownedCountsByGame(userId),
    joinCountsByGame(userId),
    isIdentityClaimDropdownOpen(),
  ]);
  const tier = asTier(user.subscription_tier);
  return {
    tier,
    billingStatus: asBillingStatus(user.billing_status),
    graceUntil: user.subscription_grace_until ?? null,
    currentPeriodEnd: user.subscription_current_period_end ?? null,
    siteAccess: hasSiteAccess(user),
    canCreateLeague: canCreateLeague(user),
    canEnableDiscordBot: canEnableDiscordBot(user),
    joinLimit: joinLimitFor(user),
    ownLimit: ownLimitFor(user),
    ownedCounts,
    joinCounts,
    claimDropdownOpen,
  };
}

export async function freezeOwnedLeagues(userId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_leagues")
    .update({
      subscription_frozen: true,
      subscription_frozen_at: now,
      subscription_freeze_reason: reason,
      updated_at: now,
    })
    .eq("owner_user_id", userId)
    .eq("subscription_frozen", false);
  if (result.error) throw new ApiError(500, "Failed to freeze owned leagues.", result.error);
}

export async function unfreezeOwnedLeagues(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_leagues")
    .update({
      subscription_frozen: false,
      subscription_frozen_at: null,
      subscription_freeze_reason: null,
      updated_at: now,
    })
    .eq("owner_user_id", userId)
    .eq("subscription_frozen", true);
  if (result.error) throw new ApiError(500, "Failed to unfreeze owned leagues.", result.error);
}

export async function refreshUserGraceState(userId: string): Promise<void> {
  const user = await loadUser(userId);
  const status = asBillingStatus(user.billing_status);
  if (status !== "canceled" && status !== "past_due" && status !== "grace") return;
  if (graceStillValid(user.subscription_grace_until)) return;

  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_users")
    .update({
      billing_status: "canceled",
      updated_at: now,
    })
    .eq("id", userId);
  if (result.error) throw new ApiError(500, "Failed to refresh grace state.", result.error);
  await freezeOwnedLeagues(userId, "subscription_grace_expired");
}

export async function resolveRecUserIdByAuthUserId(authUserId: string): Promise<string | null> {
  const result = await supabase
    .from("rec_users")
    .select("id")
    .eq("supabase_auth_user_id", authUserId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to resolve linked REC user.", result.error);
  return result.data?.id ? String(result.data.id) : null;
}

export async function resolveRecUserIdByDiscordId(discordId: string): Promise<string | null> {
  const result = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to resolve Discord account.", result.error);
  return result.data?.user_id ? String(result.data.user_id) : null;
}
export async function ensureRecUserForAuthUser(
  authUserId: string,
  email: string | null,
): Promise<string> {
  const existing = await resolveRecUserIdByAuthUserId(authUserId);
  if (existing) return existing;

  const displayName = email?.split("@")[0] || "REC Member";
  const created = await supabase
    .from("rec_users")
    .insert({
      display_name: displayName,
      status: "active",
      supabase_auth_user_id: authUserId,
      subscription_tier: "none",
      billing_status: "none",
    })
    .select("id")
    .single();
  if (created.error) {
    const raced = await resolveRecUserIdByAuthUserId(authUserId);
    if (raced) return raced;
    throw new ApiError(500, "Failed to create REC user for site account.", created.error);
  }
  return String(created.data.id);
}