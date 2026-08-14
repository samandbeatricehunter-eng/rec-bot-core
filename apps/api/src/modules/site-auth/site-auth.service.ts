import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { env } from "../../config/env.js";
import { getPgPool } from "../../db/client.js";
import {
  pickDiscordHandle,
  resolveDiscordAccountHandle,
  sendDiscordDirectMessage,
} from "../../lib/discord-guild.js";
import { ApiError } from "../../lib/errors.js";
import {
  ensureRecUserForAuthUser,
  getEntitlementSummary,
  isIdentityClaimDropdownOpen,
  resolveRecUserIdByAuthUserId,
  syncLifetimePlatinumForUser,
} from "../subscriptions/entitlements.service.js";

const supabaseAuthAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function discordIdentityFromAuthUser(user: {
  identities?: Array<{
    provider?: string;
    id?: string;
    identity_data?: Record<string, unknown> | null;
  }> | null;
}): { discordId: string; username: string; globalName: string | null } | null {
  const identity = (user.identities ?? []).find((item) => item.provider === "discord");
  if (!identity) return null;
  const data = identity.identity_data ?? {};
  const discordId =
    (typeof identity.id === "string" && /^\d{5,}$/.test(identity.id) ? identity.id : null) ||
    (typeof data.provider_id === "string" ? data.provider_id : null) ||
    (typeof data.sub === "string" ? data.sub : null);
  if (!discordId) return null;
  const username =
    (typeof data.full_name === "string" && data.full_name) ||
    (typeof data.preferred_username === "string" && data.preferred_username) ||
    (typeof data.name === "string" && data.name) ||
    (typeof data.custom_claims === "object" &&
      data.custom_claims &&
      typeof (data.custom_claims as { global_name?: string }).global_name === "string" &&
      (data.custom_claims as { global_name: string }).global_name) ||
    discordId;
  const globalName =
    typeof data.custom_claims === "object" &&
    data.custom_claims &&
    typeof (data.custom_claims as { global_name?: string }).global_name === "string"
      ? (data.custom_claims as { global_name: string }).global_name
      : typeof data.full_name === "string"
        ? data.full_name
        : null;
  return { discordId, username: String(username), globalName };
}

/** Repairs team requests created before Discord was linked. Older site sessions were passed
 * through the Discord-shaped API as `site:<recUserId>`; the team-request service mistakenly
 * created a second REC user for that synthetic id. Move the league-facing records back onto
 * the authenticated profile and replace the synthetic id with the real Discord snowflake. */
async function reconcilePreDiscordTeamRecords(input: {
  canonicalUserId: string;
  discordId: string;
}) {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const synthetic = await client.query(
      `select user_id from rec_discord_accounts where discord_id = $1 for update`,
      [`site:${input.canonicalUserId}`],
    );
    const duplicateUserId = (synthetic.rows[0] as { user_id?: string } | undefined)?.user_id;
    if (!duplicateUserId || duplicateUserId === input.canonicalUserId) {
      await client.query("commit");
      return;
    }

    await client.query(
      `update rec_team_link_requests
       set requester_user_id = $1, requester_discord_id = $2, updated_at = now()
       where requester_user_id = $3`,
      [input.canonicalUserId, input.discordId, duplicateUserId],
    );
    await client.query(
      `update rec_commissioners_inbox
       set requester_user_id = $1, requester_discord_id = $2, updated_at = now()
       where requester_user_id = $3`,
      [input.canonicalUserId, input.discordId, duplicateUserId],
    );
    await client.query(
      `update rec_team_assignments set user_id = $1 where user_id = $2`,
      [input.canonicalUserId, duplicateUserId],
    );
    await client.query(
      `insert into rec_league_memberships (league_id, user_id, status, role, created_at, updated_at)
       select league_id, $1, status, role, created_at, now()
       from rec_league_memberships where user_id = $2
       on conflict (league_id, user_id) do update
         set status = excluded.status, role = excluded.role, updated_at = now()`,
      [input.canonicalUserId, duplicateUserId],
    );
    await client.query(`delete from rec_league_memberships where user_id = $1`, [duplicateUserId]);
    await client.query(
      `update rec_team_invite_requests set user_id = $1, discord_id = $2 where user_id = $3`,
      [input.canonicalUserId, input.discordId, duplicateUserId],
    );
    await client.query(`delete from rec_discord_accounts where discord_id = $1`, [`site:${input.canonicalUserId}`]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * After Discord OAuth (or when a Discord identity is already on the Supabase user),
 * link the snowflake to rec_discord_accounts / rec_users and sync REC OG lifetime Platinum.
 */
export async function linkDiscordFromOAuth(input: {
  authUserId: string;
  email: string | null;
}): Promise<SiteLinkProfile & { lifetimePlatinum: boolean; discordLinked: boolean; isNewDiscordLink: boolean }> {
  const { data, error } = await supabaseAuthAdmin.auth.admin.getUserById(input.authUserId);
  if (error || !data.user) {
    throw new ApiError(401, "Could not load auth user for Discord linking.");
  }

  const discord = discordIdentityFromAuthUser(data.user);
  if (!discord) {
    // Email/password confirmations hit this path too — still create the rec_users row so the
    // account is visible in admin and can proceed to promo/Stripe without the retired claim UI.
    await ensureRecUserForAuthUser(input.authUserId, input.email);
    const profile = await getSiteLinkProfile({ authUserId: input.authUserId });
    return { ...profile, lifetimePlatinum: false, discordLinked: false, isNewDiscordLink: false };
  }

  const existingDiscord = await getPgPool().query(
    `
      select da.user_id, u.supabase_auth_user_id
      from rec_discord_accounts da
      inner join rec_users u on u.id = da.user_id
      where da.discord_id = $1
      limit 1
    `,
    [discord.discordId],
  );
  const existing = existingDiscord.rows[0] as
    | { user_id: string; supabase_auth_user_id: string | null }
    | undefined;
  // This exact Discord snowflake has never appeared in rec_discord_accounts before — the
  // signal AuthCallback uses to decide whether to prompt for a promo code. A returning Discord
  // user (existing truthy) should never see that prompt again.
  const isNewDiscordLink = !existing;

  let recUserId: string;
  if (existing) {
    // The snowflake is already in rec_discord_accounts. A user signing in via Discord OAuth has
    // just proven control of that exact Discord account, so that snowflake's REC profile is THE
    // profile they should land on — adopt it for the current auth user instead of creating a fresh
    // empty one (which historically looked like "signing in took my membership away") and instead
    // of 403ing when the profile happens to be bound to a different site auth user (which blocked
    // re-linking forever: "won't let me link my discord even though I signed in through discord").
    //
    // Only genuine conflicts — where BOTH the current auth user and the snowflake's owner already
    // have distinct, active profiles — stay blocked so we never flatten a separate real account.
    const ownerAuthUserId = existing.supabase_auth_user_id;
    const currentProfile = await resolveRecUserIdByAuthUserId(input.authUserId);
    if (
      ownerAuthUserId &&
      ownerAuthUserId !== input.authUserId &&
      currentProfile &&
      currentProfile !== existing.user_id
    ) {
      throw new ApiError(
        409,
        "That Discord account is already linked to a different REC Leagues account with its own profile. Contact support to merge them.",
      );
    }
    recUserId = existing.user_id;

    if (ownerAuthUserId !== input.authUserId) {
      // Adopt: rebind the snowflake's profile to the currently signed-in auth user. If the
      // current auth user already owned some profile row, clear that orphan binding first so
      // this auth user resolves to the membership-bearing Discord profile (the partial unique
      // index on supabase_auth_user_id admits only one row, so the old binding must be freed
      // before the new one lands). Any pending identity claim for this auth user or this
      // profile is replaced so both uniqueness keys stay satisfied.
      if (currentProfile && currentProfile !== existing.user_id) {
        await getPgPool().query(
          `
            update rec_users
            set supabase_auth_user_id = null, updated_at = now()
            where id = $1 and supabase_auth_user_id = $2
          `,
          [currentProfile, input.authUserId],
        );
      }
      await getPgPool().query(`update rec_users set supabase_auth_user_id = $1, updated_at = now() where id = $2`, [
        input.authUserId,
        recUserId,
      ]);
      await getPgPool().query(`delete from rec_site_identity_claims where auth_user_id = $1 or rec_user_id = $2`, [
        input.authUserId,
        recUserId,
      ]);
      await getPgPool().query(
        `
          insert into rec_site_identity_claims (auth_user_id, rec_user_id)
          values ($1, $2)
        `,
        [input.authUserId, recUserId],
      );
    }
    await getPgPool().query(
      `
        update rec_discord_accounts
        set username = $2, global_name = $3
        where discord_id = $1
      `,
      [discord.discordId, discord.username, discord.globalName],
    );
  } else {
    recUserId = await ensureRecUserForAuthUser(input.authUserId, input.email);
    const insert = await getPgPool().query(
      `
        insert into rec_discord_accounts (user_id, discord_id, username, global_name)
        values ($1, $2, $3, $4)
        on conflict (discord_id) do update
          set username = excluded.username,
              global_name = excluded.global_name
        returning user_id
      `,
      [recUserId, discord.discordId, discord.username, discord.globalName],
    );
    const linkedUserId = (insert.rows[0] as { user_id: string } | undefined)?.user_id;
    if (linkedUserId && linkedUserId !== recUserId) {
      // A concurrent sign-in claimed this snowflake between our lookup and this insert. The
      // person controlling the Discord is the legitimate owner; adopt that profile too.
      // recUserId was just ensured for this auth user; it's an empty orphan now that the
      // snowflake's owner profile took over — unbind it FIRST (the partial unique index on
      // supabase_auth_user_id admits only one row) so the adopted profile can be bound next.
      await getPgPool().query(`update rec_users set supabase_auth_user_id = null, updated_at = now() where id = $1`, [
        recUserId,
      ]);
      await getPgPool().query(`update rec_users set supabase_auth_user_id = $1, updated_at = now() where id = $2`, [
        input.authUserId,
        linkedUserId,
      ]);
      await getPgPool().query(`delete from rec_site_identity_claims where auth_user_id = $1 or rec_user_id = $2`, [
        input.authUserId,
        linkedUserId,
      ]);
      await getPgPool().query(
        `
          insert into rec_site_identity_claims (auth_user_id, rec_user_id)
          values ($1, $2)
        `,
        [input.authUserId, linkedUserId],
      );
      recUserId = linkedUserId;
    } else {
      await getPgPool().query(
        `
          insert into rec_site_identity_claims (auth_user_id, rec_user_id)
          values ($1, $2)
          on conflict (auth_user_id) do nothing
        `,
        [input.authUserId, recUserId],
      );
    }
  }

  await reconcilePreDiscordTeamRecords({ canonicalUserId: recUserId, discordId: discord.discordId });
  const lifetimePlatinum = await syncLifetimePlatinumForUser(recUserId);
  // This user just went from Discord-only to site-linked — release anything that was queued
  // for them specifically because they couldn't receive payouts yet (Heisman awards, etc.).
  const { releaseBacklogForUser } = await import("../economy/economy-backlog.js");
  void releaseBacklogForUser(recUserId).catch((error) => console.error("[ERROR] Failed to release user's payout backlog after linking (non-fatal):", error));
  const profile = await getSiteLinkProfile({ authUserId: input.authUserId });
  return { ...profile, lifetimePlatinum, discordLinked: true, isNewDiscordLink };
}

export type SiteLinkProfile = {
  linked: boolean;
  recUserId: string | null;
  displayName: string | null;
  username: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  entitlements: Awaited<ReturnType<typeof getEntitlementSummary>> | null;
  claimDropdownOpen: boolean;
};

export async function getSiteLinkProfile(input: {
  authUserId: string;
}): Promise<SiteLinkProfile> {
  const claimDropdownOpen = await isIdentityClaimDropdownOpen();
  const result = await getPgPool().query(
    `
      select
        u.id,
        u.display_name,
        u.username,
        da.username as discord_username,
        da.global_name as discord_global_name,
        da.avatar_url as discord_avatar_url
      from rec_users u
      left join rec_discord_accounts da on da.user_id = u.id
      where u.supabase_auth_user_id = $1
      limit 1
    `,
    [input.authUserId],
  );
  const row = result.rows[0] as
    | {
        id: string;
        display_name: string | null;
        username: string | null;
        discord_username: string | null;
        discord_global_name: string | null;
        discord_avatar_url: string | null;
      }
    | undefined;
  if (!row) {
    return {
      linked: false,
      recUserId: null,
      displayName: null,
      username: null,
      discordUsername: null,
      avatarUrl: null,
      entitlements: null,
      claimDropdownOpen,
    };
  }
  const entitlements = await getEntitlementSummary(row.id);
  return {
    linked: true,
    recUserId: row.id,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    discordUsername: row.discord_global_name ?? row.discord_username ?? null,
    avatarUrl: row.discord_avatar_url ?? null,
    entitlements,
    claimDropdownOpen,
  };
}

export async function listLinkCandidates(input: {
  query?: string;
  limit: number;
  offset: number;
}) {
  if (!(await isIdentityClaimDropdownOpen())) {
    return { total: 0, candidates: [] as Array<{
      recUserId: string;
      discordAccountId: string;
      discordUsername: string;
      teamLabel: string;
    }> };
  }
  const query = String(input.query ?? "").trim();
  const whereQuery = query ? `%${query}%` : null;
  const values = [whereQuery, input.limit, input.offset];
  const rows = await getPgPool().query(
    `
      with claimable as (
        select
          u.id as rec_user_id,
          da.id as discord_account_id,
          da.discord_id,
          da.username as stored_username,
          da.global_name as stored_global_name,
          u.display_name as user_display_name,
          u.username as user_username,
          coalesce(
            string_agg(
              distinct coalesce(t.display_abbr, t.abbreviation, t.name),
              ', ' order by coalesce(t.display_abbr, t.abbreviation, t.name)
            ),
            ''
          ) as team_labels
        from rec_users u
        inner join rec_discord_accounts da on da.user_id = u.id
        inner join rec_team_assignments ta on ta.user_id = u.id
          and ta.assignment_status = 'active'
          and ta.ended_at is null
        inner join rec_teams t on t.id = ta.team_id
        where u.supabase_auth_user_id is null
          and (
            $1::text is null
            or da.username ilike $1::text
            or da.global_name ilike $1::text
            or u.display_name ilike $1::text
            or u.username ilike $1::text
            or da.discord_id ilike $1::text
          )
        group by u.id, da.id, da.discord_id, da.username, da.global_name, u.display_name, u.username
      )
      select *
      from claimable
      order by lower(coalesce(user_username, nullif(stored_username, discord_id), stored_global_name, user_display_name, discord_id)), rec_user_id
      limit $2
      offset $3
    `,
    values,
  );
  const total = await getPgPool().query(
    `
      with claimable as (
        select da.id
        from rec_users u
        inner join rec_discord_accounts da on da.user_id = u.id
        inner join rec_team_assignments ta on ta.user_id = u.id
          and ta.assignment_status = 'active'
          and ta.ended_at is null
        where u.supabase_auth_user_id is null
          and (
            $1::text is null
            or da.username ilike $1::text
            or da.global_name ilike $1::text
            or u.display_name ilike $1::text
            or u.username ilike $1::text
            or da.discord_id ilike $1::text
          )
        group by da.id
      )
      select count(*)::int as count from claimable
    `,
    [whereQuery],
  );

  const candidates: Array<{
    recUserId: string;
    discordAccountId: string;
    discordUsername: string;
    teamLabel: string;
  }> = [];
  for (const row of rows.rows as Array<Record<string, unknown>>) {
    const stored = pickDiscordHandle(
      row.user_username as string | null,
      row.stored_username as string | null,
      row.stored_global_name as string | null,
      row.user_display_name as string | null,
    );
    const resolved = stored ?? await resolveDiscordAccountHandle({
      discordAccountId: String(row.discord_account_id),
      discordId: String(row.discord_id ?? ""),
      username: row.stored_username as string | null,
      globalName: row.stored_global_name as string | null,
    });
    candidates.push({
      recUserId: String(row.rec_user_id),
      discordAccountId: String(row.discord_account_id),
      discordUsername: resolved ?? "Discord member",
      teamLabel: String(row.team_labels ?? ""),
    });
  }

  return {
    total: Number(total.rows[0]?.count ?? 0),
    candidates,
  };
}

function claimCodeHash(input: {
  authUserId: string;
  recUserId: string;
  code: string;
}) {
  return createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
    .update(`${input.authUserId}:${input.recUserId}:${input.code}`)
    .digest("hex");
}

async function claimIdentityWithClient(
  client: PoolClient,
  input: { authUserId: string; recUserId: string },
) {
  const existing = await client.query(
    `
      select id, display_name, username
      from rec_users
      where supabase_auth_user_id = $1
      limit 1
    `,
    [input.authUserId],
  );
  const linked = existing.rows[0] as
    | { id: string; display_name: string | null; username: string | null }
    | undefined;
  if (linked) {
    if (linked.id === input.recUserId) {
      return {
        linked: true,
        recUserId: linked.id,
        displayName: linked.display_name ?? null,
        username: linked.username ?? null,
        alreadyLinked: true,
      };
    }
    throw new ApiError(409, "This account is already linked to a REC profile.");
  }
  const updated = await client.query(
    `
      update rec_users u
      set
        supabase_auth_user_id = $1,
        updated_at = now()
      where u.id = $2
        and u.supabase_auth_user_id is null
        and exists (
          select 1
          from rec_team_assignments ta
          where ta.user_id = u.id
            and ta.assignment_status = 'active'
            and ta.ended_at is null
        )
      returning u.id, u.display_name, u.username
    `,
    [input.authUserId, input.recUserId],
  );
  const row = updated.rows[0] as
    | { id: string; display_name: string | null; username: string | null }
    | undefined;
  if (!row) {
    throw new ApiError(
      409,
      "This Discord identity was already claimed or is no longer available.",
    );
  }
  await client.query(
    `
      insert into rec_site_identity_claims (auth_user_id, rec_user_id)
      values ($1, $2)
    `,
    [input.authUserId, row.id],
  );
  return {
    linked: true,
    recUserId: row.id,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    alreadyLinked: false,
  };
}

export async function requestIdentityClaimCode(input: {
  authUserId: string;
  discordAccountId: string;
}) {
  const alreadyLinked = await getSiteLinkProfile({ authUserId: input.authUserId });
  if (alreadyLinked.linked) {
    throw new ApiError(409, "This account is already linked to a REC profile.");
  }
  const client = await getPgPool().connect();
  let row:
    | {
        discord_id: string;
        username: string | null;
        global_name: string | null;
        rec_user_id: string;
      }
    | undefined;
  let code = "";
  let codeHash = "";
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `auth:${input.authUserId}`,
    ]);
    const linkedInsideTransaction = await client.query(
      `
        select id
        from rec_users
        where supabase_auth_user_id = $1
        limit 1
      `,
      [input.authUserId],
    );
    if (linkedInsideTransaction.rowCount) {
      throw new ApiError(409, "This account is already linked to a REC profile.");
    }
    const candidate = await client.query(
      `
        select da.discord_id, da.username, da.global_name, da.user_id as rec_user_id
        from rec_discord_accounts da
        inner join rec_users u on u.id = da.user_id
        where da.id = $1
          and u.supabase_auth_user_id is null
          and exists (
            select 1
            from rec_team_assignments ta
            where ta.user_id = u.id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
          )
        limit 1
      `,
      [input.discordAccountId],
    );
    row = candidate.rows[0] as
      | { discord_id: string; username: string | null; global_name: string | null; rec_user_id: string }
      | undefined;
    if (!row) {
      throw new ApiError(409, "This Discord identity is no longer available.");
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `rec:${row.rec_user_id}`,
    ]);
    const recent = await client.query(
      `
        select id
        from rec_site_identity_claim_challenges
        where (auth_user_id = $1 or rec_user_id = $2)
          and updated_at > now() - interval '60 seconds'
        limit 1
      `,
      [input.authUserId, row.rec_user_id],
    );
    if (recent.rowCount) {
      throw new ApiError(429, "Wait one minute before requesting another code.");
    }
    code = String(randomInt(100000, 1000000));
    codeHash = claimCodeHash({
      authUserId: input.authUserId,
      recUserId: row.rec_user_id,
      code,
    });
    await client.query(
      `
        insert into rec_site_identity_claim_challenges (
          auth_user_id,
          rec_user_id,
          discord_account_id,
          code_hash,
          expires_at,
          attempt_count,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, now() + interval '10 minutes', 0, now(), now())
        on conflict (auth_user_id)
        do update set
          rec_user_id = excluded.rec_user_id,
          discord_account_id = excluded.discord_account_id,
          code_hash = excluded.code_hash,
          expires_at = excluded.expires_at,
          attempt_count = 0,
          updated_at = now()
      `,
      [input.authUserId, row.rec_user_id, input.discordAccountId, codeHash],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  try {
    await sendDiscordDirectMessage(
      row!.discord_id,
      `Your REC account-linking code is **${code}**. It expires in 10 minutes. If you did not request this, ignore this message.`,
    );
  } catch {
    await getPgPool().query(
      `
        delete from rec_site_identity_claim_challenges
        where auth_user_id = $1 and code_hash = $2
      `,
      [input.authUserId, codeHash],
    );
    throw new ApiError(
      502,
      "Could not send a Discord DM. Enable DMs from the REC server and try again.",
    );
  }
  return {
    sent: true,
    discordUsername: pickDiscordHandle(row!.username, row!.global_name) ?? row!.username ?? "Discord member",
    expiresInSeconds: 600,
  };
}

export async function verifyIdentityClaimCode(input: {
  authUserId: string;
  discordAccountId: string;
  code: string;
}) {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const challenge = await client.query(
      `
        select rec_user_id, discord_account_id, code_hash, expires_at, attempt_count
        from rec_site_identity_claim_challenges
        where auth_user_id = $1
        for update
        limit 1
      `,
      [input.authUserId],
    );
    const challengeRow = challenge.rows[0] as
      | {
          rec_user_id: string;
          discord_account_id: string;
          code_hash: string;
          expires_at: Date | string;
          attempt_count: number;
        }
      | undefined;
    if (
      !challengeRow ||
      challengeRow.discord_account_id !== input.discordAccountId
    ) {
      throw new ApiError(400, "Request a new verification code.");
    }
    if (
      new Date(challengeRow.expires_at).getTime() <= Date.now() ||
      challengeRow.attempt_count >= 5
    ) {
      throw new ApiError(400, "This verification code expired. Request a new one.");
    }
    const expected = Buffer.from(challengeRow.code_hash, "hex");
    const provided = Buffer.from(
      claimCodeHash({
        authUserId: input.authUserId,
        recUserId: challengeRow.rec_user_id,
        code: input.code,
      }),
      "hex",
    );
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      await client.query(
        `
          update rec_site_identity_claim_challenges
          set attempt_count = attempt_count + 1, updated_at = now()
          where auth_user_id = $1
        `,
        [input.authUserId],
      );
      await client.query("commit");
      throw new ApiError(400, "Incorrect verification code.");
    }
    const profile = await claimIdentityWithClient(client, {
      authUserId: input.authUserId,
      recUserId: challengeRow.rec_user_id,
    });
    await client.query(
      "delete from rec_site_identity_claim_challenges where auth_user_id = $1",
      [input.authUserId],
    );
    await client.query("commit");
    return profile;
  } catch (error) {
    if (!(error instanceof ApiError && error.message === "Incorrect verification code.")) {
      await client.query("rollback");
    }
    if ((error as any)?.code === "23505") {
      throw new ApiError(409, "This account or Discord identity was already linked.");
    }
    throw error;
  } finally {
    client.release();
  }
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,24}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "commissioner",
  "mod",
  "moderator",
  "rec",
  "support",
  "system",
]);

function usernameValidationError(username: string) {
  if (!USERNAME_PATTERN.test(username)) {
    return "Username must be 3-24 chars and use only letters, numbers, dots, or underscores.";
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return "That username is reserved.";
  }
  return null;
}

export async function checkSiteUsername(input: {
  authUserId: string;
  username: string;
}) {
  const username = input.username.trim();
  const validationError = usernameValidationError(username);
  if (validationError) return { available: false, reason: validationError };
  const existing = await getPgPool().query(
    `
      select id
      from rec_users
      where lower(username) = lower($1)
        and supabase_auth_user_id is distinct from $2
      limit 1
    `,
    [username, input.authUserId],
  );
  return {
    available: existing.rowCount === 0,
    reason: existing.rowCount === 0 ? null : "That username is already taken.",
  };
}

export async function setSiteUsername(input: {
  authUserId: string;
  username: string;
}) {
  const username = input.username.trim();
  const validationError = usernameValidationError(username);
  if (validationError) throw new ApiError(400, validationError);
  try {
    const updated = await getPgPool().query(
      `
        update rec_users
        set username = $2, updated_at = now()
        where supabase_auth_user_id = $1
        returning id, display_name, username
      `,
      [input.authUserId, username],
    );
    const row = updated.rows[0] as
      | { id: string; display_name: string | null; username: string | null }
      | undefined;
    if (!row) throw new ApiError(404, "Link your identity before setting a username.");
    return {
      linked: true,
      recUserId: row.id,
      displayName: row.display_name ?? null,
      username: row.username ?? null,
    };
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new ApiError(409, "That username is already taken.");
    }
    throw error;
  }
}
