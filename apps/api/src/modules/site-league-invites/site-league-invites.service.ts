import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { getGuildMemberDisplayNameMap } from "../../lib/discord-guild.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { requireLinkedSiteUser } from "../site-inbox/site-inbox.service.js";

export { requireLinkedSiteUser };

async function resolveTargetUser(input: {
  userId?: string;
  username?: string;
}): Promise<{ id: string; username: string; displayName: string }> {
  if (input.userId) {
    const result = await getPgPool().query(
      `
        select id, username, display_name
        from rec_users
        where id = $1
        limit 1
      `,
      [input.userId],
    );
    const row = result.rows[0] as
      | { id: string; username: string | null; display_name: string | null }
      | undefined;
    if (!row?.username) {
      throw new ApiError(404, "User not found or has no username.");
    }
    return {
      id: row.id,
      username: row.username,
      displayName: row.username ?? row.display_name,
    };
  }
  const username = String(input.username ?? "").trim();
  if (!username) throw new ApiError(400, "username or userId is required.");
  const result = await getPgPool().query(
    `
      select id, username, display_name
      from rec_users
      where lower(username) = lower($1)
      limit 1
    `,
    [username],
  );
  const row = result.rows[0] as
    | { id: string; username: string | null; display_name: string | null }
    | undefined;
  if (!row?.username) {
    throw new ApiError(404, "User not found.");
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
  };
}

/** Guild members with a site account who don't hold an active team in this league — the
 *  "Invite from Discord Server" picker. Members without a site account can't be invited
 *  (they couldn't log in to accept), so they're simply omitted. */
export async function listDiscordInviteTargets(input: {
  recUserId: string;
  leagueId: string;
  guildId: string;
}) {
  const canInvite = await isLeagueOwnerOrCommissioner(input.recUserId, input.leagueId);
  if (!canInvite) {
    throw new ApiError(403, "Only the league creator or a commissioner can send invites.");
  }
  // The guild's live member list is the source of truth for who's on the server; site
  // accounts are matched by discord_id (rec_discord_accounts is global, not per-guild).
  const displayNames = await getGuildMemberDisplayNameMap(input.guildId).catch(() => new Map<string, string>());
  const guildDiscordIds = [...displayNames.keys()];
  if (guildDiscordIds.length === 0) return { members: [] };

  const members: Array<{ userId: string; username: string | null; discordId: string; displayName: string }> = [];
  for (let i = 0; i < guildDiscordIds.length; i += 500) {
    const chunk = guildDiscordIds.slice(i, i + 500);
    const result = await getPgPool().query(
      `
        select u.id as user_id, u.username, d.discord_id
        from rec_discord_accounts d
        inner join rec_users u on u.id = d.user_id
        where d.discord_id = any($1::text[])
          and not exists (
            select 1 from rec_team_assignments a
            where a.league_id = $2 and a.user_id = u.id
              and a.assignment_status = 'active' and a.ended_at is null
          )
        order by lower(coalesce(u.username, '')) asc
      `,
      [chunk, input.leagueId],
    );
    for (const row of result.rows as Array<{ user_id: string; username: string | null; discord_id: string }>) {
      members.push({
        userId: row.user_id,
        username: row.username,
        discordId: row.discord_id,
        displayName: displayNames.get(row.discord_id) ?? row.username ?? row.discord_id,
      });
    }
  }
  return { members };
}

async function isLeagueOwnerOrCommissioner(recUserId: string, leagueId: string): Promise<boolean> {
  const result = await getPgPool().query(
    `
      select l.owner_user_id, m.role
      from rec_leagues l
      left join rec_league_memberships m
        on m.league_id = l.id and m.user_id = $2
      where l.id = $1
      limit 1
    `,
    [leagueId, recUserId],
  );
  const row = result.rows[0] as
    | { owner_user_id: string | null; role: string | null }
    | undefined;
  if (!row) throw new ApiError(404, "League not found.");
  if (row.owner_user_id === recUserId) return true;
  const role = String(row.role ?? "").toLowerCase();
  return role === "commissioner" || role === "co_commissioner";
}

export async function searchInviteTargets(input: {
  recUserId: string;
  query?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const q = input.query?.trim() ?? "";
  const params: unknown[] = [input.recUserId];
  let filter = "";
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    filter = `and (
      lower(coalesce(u.username, '')) like $${params.length}
      or lower(coalesce(u.display_name, '')) like $${params.length}
    )`;
  }
  params.push(limit);
  const result = await getPgPool().query(
    `
      select u.id, u.username, u.display_name
      from rec_users u
      where u.id <> $1
        and u.username is not null
        ${filter}
      order by lower(u.username) asc
      limit $${params.length}
    `,
    params,
  );
  return {
    users: (result.rows as Array<{ id: string; username: string; display_name: string | null }>)
      .map((row) => ({
        userId: row.id,
        username: row.username,
        displayName: row.username ?? row.display_name,
      })),
  };
}

function orderedDmPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function sendInviteInboxMessage(input: {
  inviterUserId: string;
  inviteeUserId: string;
  leagueId: string;
  leagueName: string;
  message?: string | null;
}) {
  const [low, high] = orderedDmPair(input.inviterUserId, input.inviteeUserId);
  const existing = await getPgPool().query(
    `
      select id
      from rec_site_conversations
      where kind = 'dm'
        and dm_user_low_id = $1
        and dm_user_high_id = $2
      limit 1
    `,
    [low, high],
  );
  let conversationId = existing.rows[0]?.id as string | undefined;
  if (!conversationId) {
    const created = await getPgPool().query(
      `
        insert into rec_site_conversations (
          kind, created_by_user_id, dm_user_low_id, dm_user_high_id
        )
        values ('dm', $1, $2, $3)
        returning id
      `,
      [input.inviterUserId, low, high],
    );
    conversationId = String(created.rows[0].id);
  }
  for (const userId of [input.inviterUserId, input.inviteeUserId]) {
    await getPgPool().query(
      `
        insert into rec_site_conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
        values ($1, $2, 'member', now(), null)
        on conflict (conversation_id, user_id) do update
          set hidden_at = null
      `,
      [conversationId, userId],
    );
  }
  const body = `You've been invited to join ${input.leagueName}!${
    input.message ? `\n\n${input.message}` : ""
  }\n\nAccept from the league page.`;
  const inserted = await getPgPool().query(
    `
      insert into rec_site_messages (conversation_id, author_user_id, body)
      values ($1, $2, $3)
      returning id
    `,
    [conversationId, input.inviterUserId, body],
  );
  await getPgPool().query(
    `
      update rec_site_conversations
      set last_message_at = now(), updated_at = now()
      where id = $1
    `,
    [conversationId],
  );
  return { conversationId, messageId: String(inserted.rows[0].id) };
}

export async function sendLeagueInvite(input: {
  recUserId: string;
  leagueId: string;
  userId?: string;
  username?: string;
  teamId?: string;
  message?: string | null;
}) {
  const canInvite = await isLeagueOwnerOrCommissioner(input.recUserId, input.leagueId);
  if (!canInvite) {
    throw new ApiError(403, "Only the league creator or a commissioner can send invites.");
  }
  const target = await resolveTargetUser({
    userId: input.userId,
    username: input.username,
  });
  if (target.id === input.recUserId) {
    throw new ApiError(400, "You cannot invite yourself.");
  }

  // Team-scoped invites (Manage League dropdown): the team must exist, belong to this
  // league, and be unlinked — inviting someone to a taken team would dead-end on accept.
  let teamId: string | null = null;
  if (input.teamId) {
    const team = await getPgPool().query(
      `select t.id from rec_teams t
         where t.id = $1 and t.league_id = $2
           and not exists (
             select 1 from rec_team_assignments a
              where a.team_id = t.id and a.league_id = $2
                and a.assignment_status = 'active' and a.ended_at is null
           )`,
      [input.teamId, input.leagueId],
    );
    if (!team.rows[0]) throw new ApiError(409, "That team is not available to invite to.");
    teamId = input.teamId;
  }

  const league = await getPgPool().query(
    `select name from rec_leagues where id = $1 limit 1`,
    [input.leagueId],
  );
  const leagueName = String(league.rows[0]?.name ?? "a league");

  const memberCheck = await getPgPool().query(
    `
      select exists (
        select 1 from rec_league_memberships
        where league_id = $1 and user_id = $2 and status = 'active'
      ) as is_member
    `,
    [input.leagueId, target.id],
  );
  if (Boolean(memberCheck.rows[0]?.is_member)) {
    throw new ApiError(409, "This user is already a member of the league.");
  }

  const existing = await getPgPool().query(
    `
      select id, status
      from rec_league_invites
      where league_id = $1 and invitee_user_id = $2
      order by created_at desc
      limit 1
    `,
    [input.leagueId, target.id],
  );
  const row = existing.rows[0] as { id: string; status: string } | undefined;
  if (row?.status === "pending") {
    throw new ApiError(409, "This user already has a pending invite to this league.");
  }

  const inserted = await getPgPool().query(
    `
      insert into rec_league_invites (
        league_id, inviter_user_id, invitee_user_id, status, message, team_id
      )
      values ($1, $2, $3, 'pending', $4, $5)
      returning id, created_at::text
    `,
    [input.leagueId, input.recUserId, target.id, input.message ?? null, teamId],
  );
  const invite = inserted.rows[0] as { id: string; created_at: string };

  await createSiteNotification({
    userId: target.id,
    leagueId: input.leagueId,
    kind: "league_invite",
    title: "League invitation",
    body: `${leagueName} — ${input.message ?? "Join the league!"}`,
    href: "/leagues",
  });

  await sendInviteInboxMessage({
    inviterUserId: input.recUserId,
    inviteeUserId: target.id,
    leagueId: input.leagueId,
    leagueName,
    message: input.message,
  });

  return {
    inviteId: invite.id,
    status: "pending" as const,
    createdAt: invite.created_at,
    peer: target,
  };
}

export async function listLeagueInvites(input: {
  recUserId: string;
  leagueId: string;
}) {
  const canView = await isLeagueOwnerOrCommissioner(input.recUserId, input.leagueId);
  if (!canView) {
    throw new ApiError(403, "Only the league creator or a commissioner can view invites.");
  }
  const result = await getPgPool().query(
    `
      select
        i.id,
        i.status,
        i.message,
        i.created_at::text,
        i.responded_at::text,
        u.id as invitee_user_id,
        u.username as invitee_username,
        u.display_name as invitee_display_name
      from rec_league_invites i
      inner join rec_users u on u.id = i.invitee_user_id
      where i.league_id = $1
        and i.inviter_user_id = $2
      order by i.created_at desc
    `,
    [input.leagueId, input.recUserId],
  );
  return {
    invites: result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        inviteId: String(r.id),
        status: String(r.status),
        message: r.message ? String(r.message) : null,
        createdAt: String(r.created_at),
        respondedAt: r.responded_at ? String(r.responded_at) : null,
        invitee: {
          userId: String(r.invitee_user_id),
          username: String(r.invitee_username),
          displayName: String(r.invitee_username ?? r.invitee_display_name),
        },
      };
    }),
  };
}

export async function listPendingInvitesForUser(input: {
  recUserId: string;
}): Promise<{ invites: Array<{
  inviteId: string;
  leagueId: string;
  leagueName: string;
  message: string | null;
  createdAt: string;
  inviter: { userId: string; username: string; displayName: string };
}> }> {
  const result = await getPgPool().query(
    `
      select
        i.id,
        i.league_id,
        i.message,
        i.created_at::text,
        l.name as league_name,
        u.id as inviter_user_id,
        u.username as inviter_username,
        u.display_name as inviter_display_name
      from rec_league_invites i
      inner join rec_leagues l on l.id = i.league_id
      inner join rec_users u on u.id = i.inviter_user_id
      where i.invitee_user_id = $1
        and i.status = 'pending'
      order by i.created_at desc
    `,
    [input.recUserId],
  );
  return {
    invites: result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        inviteId: String(r.id),
        leagueId: String(r.league_id),
        leagueName: String(r.league_name),
        message: r.message ? String(r.message) : null,
        createdAt: String(r.created_at),
        inviter: {
          userId: String(r.inviter_user_id),
          username: String(r.inviter_username),
          displayName: String(r.inviter_username ?? r.inviter_display_name),
        },
      };
    }),
  };
}

export async function respondToLeagueInvite(input: {
  recUserId: string;
  inviteId: string;
  action: "accept" | "decline";
}) {
  const result = await getPgPool().query(
    `
      select
        i.id,
        i.status,
        i.league_id,
        i.inviter_user_id,
        l.name as league_name
      from rec_league_invites i
      inner join rec_leagues l on l.id = i.league_id
      where i.id = $1
      limit 1
    `,
    [input.inviteId],
  );
  const row = result.rows[0] as
    | { id: string; status: string; league_id: string; inviter_user_id: string; league_name: string }
    | undefined;
  if (!row) throw new ApiError(404, "Invite not found.");
  if (row.status !== "pending") {
    throw new ApiError(409, "This invite has already been responded to.");
  }

  const inviteeCheck = await getPgPool().query(
    `
      select invitee_user_id
      from rec_league_invites
      where id = $1
      limit 1
    `,
    [input.inviteId],
  );
  const inviteeUserId = String(inviteeCheck.rows[0]?.invitee_user_id ?? "");
  if (inviteeUserId !== input.recUserId) {
    throw new ApiError(403, "Only the invited user can respond to this invite.");
  }

  if (input.action === "accept") {
    await getPgPool().query(
      `
        insert into rec_league_memberships (
          id, league_id, user_id, status, role, app_access_required, app_access_verified, created_at, updated_at
        )
        values (gen_random_uuid(), $1, $2, 'active', 'member', false, false, now(), now())
        on conflict (league_id, user_id) do update
          set status = 'active', updated_at = now()
      `,
      [row.league_id, input.recUserId],
    );

    // Team-scoped invite: link the accepter to the invited team when it is still open.
    const inviteTeam = await getPgPool().query<{ team_id: string | null }>(
      `select team_id from rec_league_invites where id = $1 limit 1`,
      [input.inviteId],
    );
    const teamId = inviteTeam.rows[0]?.team_id;
    if (teamId) {
      const teamTaken = await getPgPool().query(
        `select 1 from rec_team_assignments
          where team_id = $2 and league_id = $1
            and assignment_status = 'active' and ended_at is null`,
        [row.league_id, teamId],
      );
      if (!teamTaken.rows[0]) {
        await getPgPool().query(
          `update rec_team_assignments set assignment_status = 'replaced', ended_at = now()
            where league_id = $1 and user_id = $2 and ended_at is null and assignment_status = 'active'`,
          [row.league_id, input.recUserId],
        );
        await getPgPool().query(
          `insert into rec_team_assignments
             (league_id, team_id, user_id, assignment_status, source, notes)
           values ($1, $2, $3, 'active', 'site_invite', 'Accepted team invite')`,
          [row.league_id, teamId, input.recUserId],
        );
      }
    }
  }

  await getPgPool().query(
    `
      update rec_league_invites
      set status = $2, responded_at = now()
      where id = $1
    `,
    [input.inviteId, input.action === "accept" ? "accepted" : "declined"],
  );

  await createSiteNotification({
    userId: row.inviter_user_id,
    leagueId: row.league_id,
    kind: "league_invite",
    title: input.action === "accept" ? "Invite accepted" : "Invite declined",
    body: `${row.league_name} — ${input.action === "accept" ? "your invite was accepted" : "your invite was declined"}.`,
    href: `/l/${row.league_id}`,
  });

  return { ok: true as const, status: input.action === "accept" ? "accepted" : "declined" };
}
