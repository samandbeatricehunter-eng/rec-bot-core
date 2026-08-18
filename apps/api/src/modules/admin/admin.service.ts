import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { getPgPool } from "../../db/client.js";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { formatUserIdentity } from "../../lib/user-identity.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { deleteAllLeagueStreamHighlights } from "../media/media.service.js";
import { preserveGlobalContributionsBeforeLeagueDelete, preserveH2hHistoryBeforeLeagueDelete } from "../official-records/official-records.service.js";
import { syncScheduleGameUserIdsForLeague } from "../schedule/sync-game-user-ids.js";

const supabaseAuthAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ----------------------------------------------------------------------------
// Ticker / site announcements
// ----------------------------------------------------------------------------

export async function listAdminAnnouncements() {
  const rows = await supabase
    .from("rec_site_announcements")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (rows.error) throw new ApiError(500, "Failed to load announcements.", rows.error);
  return { announcements: rows.data ?? [] };
}

export async function createAdminAnnouncement(input: {
  title: string;
  body: string;
  href: string | null;
  published: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdByUserId: string | null;
}) {
  const inserted = await supabase
    .from("rec_site_announcements")
    .insert({
      title: input.title,
      body: input.body,
      href: input.href,
      published: input.published,
      sort_order: input.sortOrder,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      created_by_user_id: input.createdByUserId,
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create announcement.", inserted.error);
  await bestEffort("audit.site_announcement_created", () => writeAuditLog({
    action: "site_announcement.created",
    entityType: "rec_site_announcements",
    entityId: (inserted.data as { id: string }).id,
    newValue: input,
    source: "admin_correction",
  }), { entityId: (inserted.data as { id: string }).id });
  return { announcement: inserted.data };
}

export async function updateAdminAnnouncement(input: {
  id: string;
  title?: string;
  body?: string;
  href?: string | null;
  published?: boolean;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.href !== undefined) patch.href = input.href;
  if (input.published !== undefined) patch.published = input.published;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.endsAt !== undefined) patch.ends_at = input.endsAt;

  const updated = await supabase
    .from("rec_site_announcements")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();
  if (updated.error) throw new ApiError(500, "Failed to update announcement.", updated.error);
  if (!updated.data) throw new ApiError(404, "Announcement not found.");
  await bestEffort("audit.site_announcement_updated", () => writeAuditLog({
    action: "site_announcement.updated",
    entityType: "rec_site_announcements",
    entityId: input.id,
    newValue: patch,
    source: "admin_correction",
  }), { entityId: input.id });
  return { announcement: updated.data };
}

export async function deleteAdminAnnouncement(id: string) {
  const deleted = await supabase.from("rec_site_announcements").delete().eq("id", id).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to delete announcement.", deleted.error);
  if (!deleted.data) throw new ApiError(404, "Announcement not found.");
  await bestEffort("audit.site_announcement_deleted", () => writeAuditLog({
    action: "site_announcement.deleted",
    entityType: "rec_site_announcements",
    entityId: id,
    source: "admin_correction",
  }), { entityId: id });
  return { ok: true as const };
}

// ----------------------------------------------------------------------------
// Leagues
// ----------------------------------------------------------------------------

export type AdminLeagueSummary = {
  id: string;
  name: string;
  game: string;
  leagueType: string;
  currentPhase: string;
  seasonStage: string;
  seasonNumber: number;
  ownerUserId: string | null;
  ownerUsername: string | null;
  memberCount: number;
  teamCount: number;
  createdAt: string;
};

export async function listAdminLeagues(input: { query?: string; limit?: number }): Promise<{
  leagues: AdminLeagueSummary[];
}> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300);
  const like = input.query?.trim() ? `%${input.query.trim()}%` : null;
  const result = await getPgPool().query(
    `
      select
        l.id,
        l.name,
        l.game,
        l.league_type,
        l.current_phase,
        l.season_stage,
        l.season_number,
        l.owner_user_id,
        coalesce(u.username, head_owner.username) as owner_username,
        l.created_at,
        (select count(*)::int from rec_league_memberships m where m.league_id = l.id and m.status = 'active') as member_count,
        (select count(*)::int from rec_teams t where t.league_id = l.id) as team_count
      from rec_leagues l
      left join rec_users u on u.id = l.owner_user_id
      left join lateral (
        select hu.username
        from rec_league_memberships hm
        join rec_users hu on hu.id = hm.user_id
        where hm.league_id = l.id and hm.status = 'active' and hm.role = 'head_commissioner'
        order by hm.created_at asc
        limit 1
      ) head_owner on true
      where $1::text is null or l.name ilike $1
      order by l.created_at desc
      limit $2
    `,
    [like, limit],
  );
  return {
    leagues: result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      game: row.game,
      leagueType: row.league_type,
      currentPhase: row.current_phase,
      seasonStage: row.season_stage,
      seasonNumber: row.season_number,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username,
      memberCount: Number(row.member_count ?? 0),
      teamCount: Number(row.team_count ?? 0),
      createdAt: row.created_at,
    })),
  };
}

export type AdminLeagueMember = {
  userId: string;
  username: string | null;
  displayName: string;
  discordUsername: string | null;
  teamName: string | null;
  membershipRole: string | null;
};

export async function listAdminLeagueMembers(leagueId: string): Promise<{ members: AdminLeagueMember[] }> {
  const result = await getPgPool().query(
    `
      with combined as (
        select
          ta.user_id,
          t.name as team_name,
          m.role as membership_role
        from rec_team_assignments ta
        inner join rec_teams t on t.id = ta.team_id
        left join rec_league_memberships m on m.league_id = ta.league_id and m.user_id = ta.user_id
        where ta.league_id = $1
          and ta.assignment_status = 'active'
          and ta.ended_at is null
          and ta.user_id is not null

        union all

        select
          m.user_id,
          null::text as team_name,
          m.role as membership_role
        from rec_league_memberships m
        where m.league_id = $1
          and m.status = 'active'
          and not exists (
            select 1 from rec_team_assignments ta
            where ta.league_id = $1 and ta.user_id = m.user_id
              and ta.assignment_status = 'active' and ta.ended_at is null
          )
      )
      select distinct on (c.user_id)
        c.user_id, c.team_name, c.membership_role, u.username, u.display_name,
        da.username as discord_username, da.global_name as discord_global_name
      from combined c
      inner join rec_users u on u.id = c.user_id
      left join lateral (
        select username, global_name
        from rec_discord_accounts
        where user_id = c.user_id
        order by last_seen_at desc nulls last, created_at desc
        limit 1
      ) da on true
      order by c.user_id, c.team_name nulls last
    `,
    [leagueId],
  );
  return {
    members: result.rows.map((row: any) => ({
      userId: row.user_id,
      username: row.username,
      displayName: formatUserIdentity({ siteUsername: row.username, displayName: row.display_name, discordGlobalName: row.discord_global_name, discordUsername: row.discord_username }),
      discordUsername: row.discord_global_name ?? row.discord_username ?? null,
      teamName: row.team_name,
      membershipRole: row.membership_role,
    })),
  };
}

export async function adminRemoveUserFromLeague(input: { leagueId: string; userId: string }) {
  const client = getPgPool();
  const ended = await client.query(
    `
      update rec_team_assignments
      set assignment_status = 'unlinked', ended_at = now(), user_id = null, updated_at = now()
      where league_id = $1 and user_id = $2 and ended_at is null
      returning id, team_id
    `,
    [input.leagueId, input.userId],
  );
  const removedMembership = await client.query(
    `delete from rec_league_memberships where league_id = $1 and user_id = $2 returning id`,
    [input.leagueId, input.userId],
  );
  if (!ended.rows.length && !removedMembership.rows.length) {
    throw new ApiError(404, "This user has no active team assignment or membership in this league.");
  }
  if (ended.rows.length) {
    await syncScheduleGameUserIdsForLeague(input.leagueId);
  }
  await bestEffort("audit.league_member_removed", () => writeAuditLog({
    action: "league.member.removed_by_admin",
    entityType: "rec_leagues",
    entityId: input.leagueId,
    newValue: { userId: input.userId, endedAssignments: ended.rows.length, removedMemberships: removedMembership.rows.length },
    source: "admin_correction",
  }), { leagueId: input.leagueId, userId: input.userId });
  return { ok: true as const };
}

export async function adminDeleteLeague(input: { leagueId: string; confirmationText: string }) {
  const league = await supabase.from("rec_leagues").select("id,name").eq("id", input.leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to look up league.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");
  const leagueName = String((league.data as { name: string }).name ?? "").trim();
  const confirmation = String(input.confirmationText ?? "").trim();
  if (!confirmation || confirmation.toLowerCase() !== leagueName.toLowerCase()) {
    throw new ApiError(400, `Confirmation did not match. Type the league name exactly ("${leagueName}") to delete it.`);
  }

  await deleteAllLeagueStreamHighlights(input.leagueId).catch((error) => {
    console.error("[ERROR] Failed to delete league Stream highlights before admin league wipe:", error);
  });

  await preserveGlobalContributionsBeforeLeagueDelete(input.leagueId).catch((error) => {
    console.error("[ERROR] Failed to preserve global contributions before admin league wipe:", error);
  });
  await preserveH2hHistoryBeforeLeagueDelete(input.leagueId).catch((error) => {
    console.error("[ERROR] Failed to preserve H2H history before admin league wipe:", error);
  });

  const deleted = await supabase.rpc("rec_delete_league", { p_league_id: input.leagueId });
  if (deleted.error) throw new ApiError(500, "Failed to delete league.", deleted.error);

  await bestEffort("audit.league_deleted_by_admin", () => writeAuditLog({
    action: "league.deleted_by_admin",
    entityType: "rec_leagues",
    entityId: input.leagueId,
    newValue: { leagueName, result: deleted.data },
    source: "admin_correction",
  }), { leagueId: input.leagueId });

  return { ok: true as const, leagueName };
}

// ----------------------------------------------------------------------------
// Users / impersonation
// ----------------------------------------------------------------------------

export type AdminUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
  discordUsername: string | null;
  subscriptionTier: string;
  billingStatus: string | null;
  hasSiteAccount: boolean;
};

/** Backs the Stats snapshot's expandable "New accounts (7d)" tile — same 7-day window
 * getAdminStats counts, listed out by name instead of just the number. */
export async function listRecentAdminUsers(): Promise<{ users: AdminUserSummary[] }> {
  const result = await getPgPool().query(`
    select u.id, u.username, u.display_name, u.subscription_tier, u.billing_status, u.supabase_auth_user_id,
           da.username as discord_username, da.global_name as discord_global_name
    from rec_users u
    left join lateral (
      select username, global_name from rec_discord_accounts
      where user_id = u.id order by last_seen_at desc nulls last, created_at desc limit 1
    ) da on true
    where created_at >= now() - interval '7 days'
    order by created_at desc
    limit 200
  `);
  return {
    users: result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: formatUserIdentity({ siteUsername: row.username, displayName: row.display_name, discordGlobalName: row.discord_global_name, discordUsername: row.discord_username }),
      discordUsername: row.discord_global_name ?? row.discord_username ?? null,
      subscriptionTier: row.subscription_tier,
      billingStatus: row.billing_status,
      hasSiteAccount: Boolean(row.supabase_auth_user_id),
    })),
  };
}

export async function searchAdminUsers(input: { query?: string; limit?: number }): Promise<{
  users: AdminUserSummary[];
}> {
  // The "View As" panel calls this with no query on first load to browse the full user base —
  // a default of 25 (with the UI offering no pagination) silently dropped every user past the
  // 25th alphabetically, with no indication anything was cut off. A user who was very much
  // still registered and active (an intact site account, real Stripe subscription) just never
  // rendered. Default and ceiling raised well past any realistic current user count; still
  // capped so a future much larger user base can't make this call unbounded.
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
  const query = input.query?.trim();
  const result = await getPgPool().query(
    `
      select u.id, u.username, u.display_name, u.subscription_tier, u.billing_status, u.supabase_auth_user_id,
             da.username as discord_username, da.global_name as discord_global_name
      from rec_users u
      left join lateral (
        select username, global_name from rec_discord_accounts
        where user_id = u.id order by last_seen_at desc nulls last, created_at desc limit 1
      ) da on true
      where $1::text is null or u.username ilike $1 or u.display_name ilike $1
         or da.username ilike $1 or da.global_name ilike $1
      order by u.username nulls last, u.display_name
      limit $2
    `,
    [query ? `%${query}%` : null, limit],
  );
  return {
    users: result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: formatUserIdentity({ siteUsername: row.username, displayName: row.display_name, discordGlobalName: row.discord_global_name, discordUsername: row.discord_username }),
      discordUsername: row.discord_global_name ?? row.discord_username ?? null,
      subscriptionTier: row.subscription_tier,
      billingStatus: row.billing_status,
      hasSiteAccount: Boolean(row.supabase_auth_user_id),
    })),
  };
}

/** Manual comp grant/revoke — lets an admin hand a user Gold/Platinum access with no Stripe
 * subscription behind it (billing_status='lifetime_comp', the same status REC OG lifetime
 * Platinum and lifetime_platinum/lifetime_gold promo codes already use, so every existing
 * entitlement check already honors it for free). Revoke only clears a comp/promo grant this
 * tool (or a promo code) created — a real Stripe subscription must still be managed through
 * Stripe/billing, never silently wiped by an admin click here. */
export async function grantAdminUserTier(input: {
  targetUserId: string;
  tier: "gold" | "platinum" | "none";
  adminAuthUserId: string;
}): Promise<{ userId: string; subscriptionTier: string; billingStatus: string }> {
  const user = await supabase
    .from("rec_users")
    .select("id,subscription_tier,billing_status")
    .eq("id", input.targetUserId)
    .maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load user.", user.error);
  if (!user.data) throw new ApiError(404, "User not found.");

  const previousTier = user.data.subscription_tier as string | null;
  const previousStatus = user.data.billing_status as string | null;

  if (input.tier === "none") {
    if (previousStatus !== "lifetime_comp" && previousStatus !== "promo_trial") {
      throw new ApiError(
        409,
        "This user's access isn't an admin/promo grant (it's a real subscription or already has no access) — manage it through Stripe billing instead.",
      );
    }
    const cleared = await supabase
      .from("rec_users")
      .update({ subscription_tier: "none", billing_status: "none", subscription_source: null, promo_trial_ends_at: null, updated_at: new Date().toISOString() })
      .eq("id", input.targetUserId)
      .select("id,subscription_tier,billing_status")
      .single();
    if (cleared.error) throw new ApiError(500, "Failed to revoke tier.", cleared.error);
    await bestEffort("audit.admin_tier_revoked", () => writeAuditLog({
      action: "admin.tier_revoked",
      entityType: "rec_users",
      entityId: input.targetUserId,
      previousValue: { tier: previousTier, billingStatus: previousStatus },
      newValue: { tier: "none", billingStatus: "none" },
      reason: `Revoked by admin ${input.adminAuthUserId}`,
      source: "admin_correction",
    }), { userId: input.targetUserId });
    return { userId: input.targetUserId, subscriptionTier: "none", billingStatus: "none" };
  }

  const granted = await supabase
    .from("rec_users")
    .update({ subscription_tier: input.tier, billing_status: "lifetime_comp", subscription_source: "admin_grant", updated_at: new Date().toISOString() })
    .eq("id", input.targetUserId)
    .select("id,subscription_tier,billing_status")
    .single();
  if (granted.error) throw new ApiError(500, "Failed to grant tier.", granted.error);
  await bestEffort("audit.admin_tier_granted", () => writeAuditLog({
    action: "admin.tier_granted",
    entityType: "rec_users",
    entityId: input.targetUserId,
    previousValue: { tier: previousTier, billingStatus: previousStatus },
    newValue: { tier: input.tier, billingStatus: "lifetime_comp" },
    reason: `Granted by admin ${input.adminAuthUserId}`,
    source: "admin_correction",
  }), { userId: input.targetUserId });
  return { userId: input.targetUserId, subscriptionTier: input.tier, billingStatus: "lifetime_comp" };
}

/** Manual coin grant/revoke from the admin console — credits (or debits, negative amount) the
 * user's global wallet via add_to_wallet with source manual_admin_entry. A timestamped
 * source_reference keeps every grant distinct so add_to_wallet's dedupe (same user/type/source/
 * reference) never collapses two separate grants into one. Negative amounts require explicit
 * allow, otherwise add_to_wallet rejects them as insufficient funds. */
export async function grantAdminUserCoins(input: {
  targetUserId: string;
  amount: number;
  adminAuthUserId: string;
}) {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, "Amount must be a non-zero whole number.");
  }
  if (amount < -250_000) {
    throw new ApiError(400, "Negative grants are capped at -250,000 coins.");
  }
  if (amount > 1_000_000_000) {
    throw new ApiError(400, "Grant capped at 1,000,000,000 coins.");
  }

  const user = await supabase
    .from("rec_users")
    .select("id,username,display_name")
    .eq("id", input.targetUserId)
    .maybeSingle();
  if (user.error) throw new ApiError(500, "Failed to load user.", user.error);
  if (!user.data) throw new ApiError(404, "User not found.");

  const sourceReference = {
    adminAuthUserId: input.adminAuthUserId,
    grantedAt: new Date().toISOString(),
    manualAdminEntry: true,
  };
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: input.targetUserId,
    p_amount: amount,
    p_league_id: null,
    p_description: amount > 0 ? `Admin coin grant of ${amount}` : `Admin coin correction of ${Math.abs(amount)}`,
    p_transaction_type: "admin_coin_grant",
    p_source: "manual_admin_entry",
    p_source_reference: sourceReference,
    p_allow_negative: amount < 0,
  });
  if (ledger.error) throw new ApiError(500, "Failed to adjust wallet balance.", ledger.error);

  await bestEffort("audit.admin_coins_granted", () => writeAuditLog({
    action: "admin.coins_granted",
    entityType: "rec_users",
    entityId: input.targetUserId,
    newValue: { amount, ledgerId: ledger.data, sourceReference },
    reason: `Granted by admin ${input.adminAuthUserId}`,
    source: "admin_correction",
  }), { userId: input.targetUserId });

  const balance = await supabase
    .from("rec_wallets")
    .select("wallet_balance")
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  if (balance.error) console.error("[ERROR] Failed to read wallet balance after coin grant:", balance.error);

  return {
    userId: input.targetUserId,
    amount,
    ledgerId: ledger.data,
    walletBalance: balance.data?.wallet_balance ?? null,
  };
}

/** Support/admin one-off outreach — DMs the user's linked Discord account if one exists,
 * otherwise falls back to a site notification so it's still waiting for them next login. */
export async function sendAdminUserMessage(input: { targetUserId: string; title: string; body: string }): Promise<{ channel: "discord" | "site" }> {
  const discordAccount = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.targetUserId).maybeSingle();
  if (discordAccount.error) throw new ApiError(500, "Failed to look up Discord account.", discordAccount.error);
  if (discordAccount.data?.discord_id) {
    const { sendDiscordDirectMessage } = await import("../../lib/discord-guild.js");
    await sendDiscordDirectMessage(discordAccount.data.discord_id, input.body);
    return { channel: "discord" };
  }
  const { createSiteNotification } = await import("../site-notifications/site-notifications.service.js");
  await createSiteNotification({ userId: input.targetUserId, leagueId: null, kind: "admin_message", title: input.title, body: input.body, href: "/account" });
  return { channel: "site" };
}

export async function adminImpersonateUser(input: { targetUserId: string; adminAuthUserId: string }): Promise<{
  accessToken: string;
  refreshToken: string;
  targetUsername: string | null;
}> {
  const target = await getPgPool().query(
    `select id, username, display_name, supabase_auth_user_id from rec_users where id = $1 limit 1`,
    [input.targetUserId],
  );
  const row = target.rows[0] as
    | { id: string; username: string | null; display_name: string | null; supabase_auth_user_id: string | null }
    | undefined;
  if (!row) throw new ApiError(404, "User not found.");
  if (!row.supabase_auth_user_id) {
    throw new ApiError(400, "This user has not created a site account yet — nothing to impersonate.");
  }

  const { data: authUser, error: authUserError } = await supabaseAuthAdmin.auth.admin.getUserById(
    row.supabase_auth_user_id,
  );
  if (authUserError || !authUser.user?.email) {
    throw new ApiError(400, "This user's site account has no email on file — cannot impersonate.");
  }

  const link = await supabaseAuthAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (link.error || !link.data.properties?.hashed_token) {
    throw new ApiError(500, "Failed to generate impersonation session.", link.error);
  }

  // Keep impersonation session minting isolated from the shared admin client. Supabase may
  // rotate a just-issued magic-link session immediately; explicitly refresh it before handing
  // it to the browser so View As never loads with an already-expired access token.
  const impersonationAuth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await impersonationAuth.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
    email: authUser.user.email,
  });
  if (verified.error || !verified.data.session) {
    throw new ApiError(500, "Failed to mint impersonation session.", verified.error);
  }
  const refreshed = await impersonationAuth.auth.refreshSession(verified.data.session);
  if (refreshed.error || !refreshed.data.session) {
    throw new ApiError(500, "Failed to refresh impersonation session.", refreshed.error);
  }

  await bestEffort("audit.admin_impersonate", () => writeAuditLog({
    action: "admin.impersonate",
    entityType: "rec_users",
    entityId: row.id,
    newValue: { adminAuthUserId: input.adminAuthUserId, targetUsername: row.username },
    source: "admin_correction",
  }), { userId: row.id });

  return {
    accessToken: refreshed.data.session.access_token,
    refreshToken: refreshed.data.session.refresh_token,
    targetUsername: row.username ?? row.display_name,
  };
}

// ----------------------------------------------------------------------------
// Stats
// ----------------------------------------------------------------------------

export async function getAdminStats() {
  // Site registration (supabase_auth_user_id) and subscription tier are independent axes —
  // a user can be Platinum via free-lifetime-comp without ever registering the site account
  // (that's exactly who the CFB free-claim DM campaign targets). Report them as a nested
  // breakdown instead of flat sibling tiles: showing "total / linked / platinum" side by side
  // previously read as total = linked + platinum, which only held today by coincidence.
  const result = await getPgPool().query(`
    select
      count(*)::int as total_users,
      count(*) filter (where supabase_auth_user_id is not null)::int as site_linked_users,
      count(*) filter (where supabase_auth_user_id is not null and subscription_tier = 'platinum')::int as linked_platinum,
      count(*) filter (where supabase_auth_user_id is not null and subscription_tier = 'gold')::int as linked_gold,
      -- "Unclaimed (Discord-only)" means exactly that: a Discord-provisioned profile with no
      -- site login yet. A row with neither a site login NOR any rec_discord_accounts row at
      -- all isn't a Discord-only claim candidate — it's an orphan (e.g. a signup that paid
      -- before ever linking Discord, then had its auth link reassigned elsewhere — see
      -- mergeOrphanedBillingIntoCanonicalUser in subscriptions/stripe.service.ts) and would
      -- otherwise get mislabeled as part of the claim campaign's remaining pool.
      count(*) filter (where supabase_auth_user_id is null and subscription_tier = 'platinum' and exists (select 1 from rec_discord_accounts da where da.user_id = rec_users.id))::int as unlinked_platinum,
      count(*) filter (where supabase_auth_user_id is null and subscription_tier = 'gold' and exists (select 1 from rec_discord_accounts da where da.user_id = rec_users.id))::int as unlinked_gold,
      count(*) filter (where supabase_auth_user_id is null and subscription_tier in ('platinum','gold') and not exists (select 1 from rec_discord_accounts da where da.user_id = rec_users.id))::int as orphaned_paid,
      count(*) filter (where subscription_tier = 'gold')::int as gold_subscribers,
      count(*) filter (where subscription_tier = 'platinum')::int as platinum_subscribers,
      count(*) filter (where created_at >= now() - interval '7 days')::int as users_last_7d
    from rec_users
  `);
  const leagueResult = await getPgPool().query(`
    select
      count(*)::int as total_leagues,
      count(*) filter (where created_at >= now() - interval '7 days')::int as leagues_last_7d
    from rec_leagues
  `);
  const incidentsResult = await getPgPool().query(`
    select id, league_id, guild_id, process, severity, title, detail,
           error_name, error_message, error_stack, context, occurred_at
    from rec_admin_incidents
    where status = 'open'
    order by occurred_at desc
    limit 50
  `);
  const row = result.rows[0] ?? {};
  const leagueRow = leagueResult.rows[0] ?? {};
  return {
    totalUsers: Number(row.total_users ?? 0),
    siteLinkedUsers: Number(row.site_linked_users ?? 0),
    linkedPlatinum: Number(row.linked_platinum ?? 0),
    linkedGold: Number(row.linked_gold ?? 0),
    unlinkedPlatinum: Number(row.unlinked_platinum ?? 0),
    unlinkedGold: Number(row.unlinked_gold ?? 0),
    orphanedPaid: Number(row.orphaned_paid ?? 0),
    goldSubscribers: Number(row.gold_subscribers ?? 0),
    platinumSubscribers: Number(row.platinum_subscribers ?? 0),
    usersLast7d: Number(row.users_last_7d ?? 0),
    totalLeagues: Number(leagueRow.total_leagues ?? 0),
    leaguesLast7d: Number(leagueRow.leagues_last_7d ?? 0),
    openIncidents: incidentsResult.rows.map((incident) => ({
      id: incident.id,
      leagueId: incident.league_id,
      guildId: incident.guild_id,
      process: incident.process,
      severity: incident.severity,
      title: incident.title,
      detail: incident.detail,
      errorName: incident.error_name,
      errorMessage: incident.error_message,
      errorStack: incident.error_stack,
      context: incident.context ?? {},
      occurredAt: incident.occurred_at,
    })),
  };
}
