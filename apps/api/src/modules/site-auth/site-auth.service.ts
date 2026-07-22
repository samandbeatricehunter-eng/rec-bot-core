import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "../../config/env.js";
import { getPgPool } from "../../db/client.js";
import { sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { ApiError } from "../../lib/errors.js";
import {
  getEntitlementSummary,
  isIdentityClaimDropdownOpen,
} from "../subscriptions/entitlements.service.js";

export type SiteLinkProfile = {
  linked: boolean;
  recUserId: string | null;
  displayName: string | null;
  username: string | null;
  entitlements: Awaited<ReturnType<typeof getEntitlementSummary>> | null;
  claimDropdownOpen: boolean;
};

export async function getSiteLinkProfile(input: {
  authUserId: string;
}): Promise<SiteLinkProfile> {
  const claimDropdownOpen = await isIdentityClaimDropdownOpen();
  const result = await getPgPool().query(
    `
      select id, display_name, username
      from rec_users
      where supabase_auth_user_id = $1
      limit 1
    `,
    [input.authUserId],
  );
  const row = result.rows[0] as
    | { id: string; display_name: string | null; username: string | null }
    | undefined;
  if (!row) {
    return {
      linked: false,
      recUserId: null,
      displayName: null,
      username: null,
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
          da.username as discord_username,
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
          and da.username is not null
          and ($1::text is null or da.username ilike $1::text)
        group by u.id, da.id, da.username
      )
      select rec_user_id, discord_account_id, discord_username, team_labels
      from claimable
      order by lower(discord_username), rec_user_id
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
          and da.username is not null
          and ($1::text is null or da.username ilike $1::text)
        group by da.id
      )
      select count(*)::int as count from claimable
    `,
    [whereQuery],
  );
  return {
    total: Number(total.rows[0]?.count ?? 0),
    candidates: rows.rows.map((row) => ({
      recUserId: String((row as any).rec_user_id),
      discordAccountId: String((row as any).discord_account_id),
      discordUsername: String((row as any).discord_username),
      teamLabel: String((row as any).team_labels ?? ""),
    })),
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
          from rec_discord_accounts da
          where da.user_id = u.id
            and da.username is not null
        )
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
        username: string;
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
        select da.discord_id, da.username, da.user_id as rec_user_id
        from rec_discord_accounts da
        inner join rec_users u on u.id = da.user_id
        where da.id = $1
          and u.supabase_auth_user_id is null
          and da.username is not null
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
      | { discord_id: string; username: string; rec_user_id: string }
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
    discordUsername: row!.username,
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
