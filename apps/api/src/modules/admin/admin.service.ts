import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { deleteAllLeagueStreamHighlights } from "../media/media.service.js";
import { preserveGlobalContributionsBeforeLeagueDelete, preserveH2hHistoryBeforeLeagueDelete } from "../official-records/official-records.service.js";

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
  await writeAuditLog({
    action: "site_announcement.created",
    entityType: "rec_site_announcements",
    entityId: (inserted.data as { id: string }).id,
    newValue: input,
    source: "admin_correction",
  }).catch(() => undefined);
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
  await writeAuditLog({
    action: "site_announcement.updated",
    entityType: "rec_site_announcements",
    entityId: input.id,
    newValue: patch,
    source: "admin_correction",
  }).catch(() => undefined);
  return { announcement: updated.data };
}

export async function deleteAdminAnnouncement(id: string) {
  const deleted = await supabase.from("rec_site_announcements").delete().eq("id", id).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to delete announcement.", deleted.error);
  if (!deleted.data) throw new ApiError(404, "Announcement not found.");
  await writeAuditLog({
    action: "site_announcement.deleted",
    entityType: "rec_site_announcements",
    entityId: id,
    source: "admin_correction",
  }).catch(() => undefined);
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
        c.user_id, c.team_name, c.membership_role, u.username, u.display_name
      from combined c
      inner join rec_users u on u.id = c.user_id
      order by c.user_id, c.team_name nulls last
    `,
    [leagueId],
  );
  return {
    members: result.rows.map((row: any) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.username ?? row.display_name ?? "REC Member",
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
      returning id
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
  await writeAuditLog({
    action: "league.member.removed_by_admin",
    entityType: "rec_leagues",
    entityId: input.leagueId,
    newValue: { userId: input.userId, endedAssignments: ended.rows.length, removedMemberships: removedMembership.rows.length },
    source: "admin_correction",
  }).catch(() => undefined);
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

  await writeAuditLog({
    action: "league.deleted_by_admin",
    entityType: "rec_leagues",
    entityId: input.leagueId,
    newValue: { leagueName, result: deleted.data },
    source: "admin_correction",
  }).catch(() => undefined);

  return { ok: true as const, leagueName };
}

// ----------------------------------------------------------------------------
// Users / impersonation
// ----------------------------------------------------------------------------

export type AdminUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
  subscriptionTier: string;
  hasSiteAccount: boolean;
};

/** Backs the Stats snapshot's expandable "New accounts (7d)" tile — same 7-day window
 * getAdminStats counts, listed out by name instead of just the number. */
export async function listRecentAdminUsers(): Promise<{ users: AdminUserSummary[] }> {
  const result = await getPgPool().query(`
    select id, username, display_name, subscription_tier, supabase_auth_user_id
    from rec_users
    where created_at >= now() - interval '7 days'
    order by created_at desc
    limit 200
  `);
  return {
    users: result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.username ?? row.display_name ?? "REC Member",
      subscriptionTier: row.subscription_tier,
      hasSiteAccount: Boolean(row.supabase_auth_user_id),
    })),
  };
}

export async function searchAdminUsers(input: { query?: string; limit?: number }): Promise<{
  users: AdminUserSummary[];
}> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const query = input.query?.trim();
  const result = await getPgPool().query(
    `
      select id, username, display_name, subscription_tier, supabase_auth_user_id
      from rec_users
      where $1::text is null or username ilike $1 or display_name ilike $1
      order by username nulls last, display_name
      limit $2
    `,
    [query ? `%${query}%` : null, limit],
  );
  return {
    users: result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.username ?? row.display_name ?? "REC Member",
      subscriptionTier: row.subscription_tier,
      hasSiteAccount: Boolean(row.supabase_auth_user_id),
    })),
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

  await writeAuditLog({
    action: "admin.impersonate",
    entityType: "rec_users",
    entityId: row.id,
    newValue: { adminAuthUserId: input.adminAuthUserId, targetUsername: row.username },
    source: "admin_correction",
  }).catch(() => undefined);

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
      count(*) filter (where supabase_auth_user_id is null and subscription_tier = 'platinum')::int as unlinked_platinum,
      count(*) filter (where supabase_auth_user_id is null and subscription_tier = 'gold')::int as unlinked_gold,
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
