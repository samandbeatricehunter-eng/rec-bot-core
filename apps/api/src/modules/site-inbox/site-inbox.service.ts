import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { assertGuildPermission } from "../../lib/user-auth.js";

const MESSAGE_RETENTION_DAYS = 30;

export type LinkedSiteUser = {
  recUserId: string;
  username: string;
  displayName: string;
};

export type SiteConversationRow = {
  id: string;
  kind: "dm" | "commissioner" | "support";
  league_id: string | null;
  created_by_user_id: string;
  dm_user_low_id: string | null;
  dm_user_high_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export async function requireLinkedSiteUser(authUserId: string): Promise<LinkedSiteUser> {
  const result = await getPgPool().query(
    `
      select id, username, display_name
      from rec_users
      where supabase_auth_user_id = $1
      limit 1
    `,
    [authUserId],
  );
  const row = result.rows[0] as
    | { id: string; username: string | null; display_name: string | null }
    | undefined;
  if (!row) {
    throw new ApiError(403, "Link your REC profile before using messaging.");
  }
  if (!row.username) {
    throw new ApiError(403, "Set a username before using messaging.");
  }
  return {
    recUserId: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
  };
}

export async function shareActiveLeague(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const result = await getPgPool().query(
    `
      select exists (
        select 1
        from rec_team_assignments a
        inner join rec_team_assignments b
          on b.league_id = a.league_id
         and b.user_id = $2
         and b.assignment_status = 'active'
         and b.ended_at is null
        where a.user_id = $1
          and a.assignment_status = 'active'
          and a.ended_at is null
      ) as shared
    `,
    [a, b],
  );
  return Boolean(result.rows[0]?.shared);
}

export async function friendshipAccepted(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const result = await getPgPool().query(
    `
      select exists (
        select 1
        from rec_site_friendships f
        where f.status = 'accepted'
          and (
            (f.requester_user_id = $1 and f.addressee_user_id = $2)
            or (f.requester_user_id = $2 and f.addressee_user_id = $1)
          )
      ) as accepted
    `,
    [a, b],
  );
  return Boolean(result.rows[0]?.accepted);
}

export async function canDm(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  if (await friendshipAccepted(a, b)) return true;
  return shareActiveLeague(a, b);
}

async function resolveLeagueGuildId(leagueId: string): Promise<string | null> {
  const result = await getPgPool().query(
    `
      select ds.guild_id
      from rec_server_league_links sll
      inner join rec_discord_servers ds on ds.id = sll.server_id
      where sll.league_id = $1
      order by sll.is_primary desc, sll.created_at asc
      limit 1
    `,
    [leagueId],
  );
  const guildId = result.rows[0]?.guild_id;
  return guildId ? String(guildId) : null;
}

async function resolveUserDiscordId(recUserId: string): Promise<string | null> {
  const result = await getPgPool().query(
    `
      select discord_id
      from rec_discord_accounts
      where user_id = $1
      order by last_seen_at desc nulls last, created_at desc
      limit 1
    `,
    [recUserId],
  );
  const discordId = result.rows[0]?.discord_id;
  return discordId ? String(discordId) : null;
}

export async function isLeagueCommissioner(
  recUserId: string,
  leagueId: string,
): Promise<boolean> {
  const [discordId, guildId] = await Promise.all([
    resolveUserDiscordId(recUserId),
    resolveLeagueGuildId(leagueId),
  ]);
  if (!discordId || !guildId) return false;
  try {
    await assertGuildPermission(guildId, discordId, "co_commissioner");
    return true;
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 401)) {
      return false;
    }
    throw error;
  }
}

export async function canAccessConversation(
  recUserId: string,
  conversation: SiteConversationRow,
): Promise<boolean> {
  const membership = await getPgPool().query(
    `
      select 1
      from rec_site_conversation_members
      where conversation_id = $1
        and user_id = $2
        and hidden_at is null
      limit 1
    `,
    [conversation.id, recUserId],
  );
  if (membership.rows[0]) return true;

  if (conversation.kind === "commissioner" && conversation.league_id) {
    return isLeagueCommissioner(recUserId, conversation.league_id);
  }
  return false;
}

export async function purgeExpiredSiteMessages(options?: {
  pruneEmptyConversations?: boolean;
}): Promise<{ deletedMessages: number; prunedConversations: number }> {
  const deleted = await getPgPool().query(
    `
      delete from rec_site_messages
      where created_at < now() - make_interval(days => $1)
      returning id
    `,
    [MESSAGE_RETENTION_DAYS],
  );
  let prunedConversations = 0;
  if (options?.pruneEmptyConversations !== false) {
    const pruned = await getPgPool().query(
      `
        delete from rec_site_conversations c
        where not exists (
          select 1 from rec_site_messages m where m.conversation_id = c.id
        )
        and c.last_message_at is not null
        returning c.id
      `,
    );
    prunedConversations = pruned.rowCount ?? 0;
  }
  return {
    deletedMessages: deleted.rowCount ?? 0,
    prunedConversations,
  };
}

function lazyPurgeExpiredMessages(): void {
  void purgeExpiredSiteMessages({ pruneEmptyConversations: true }).catch((error) => {
    console.error("[ERROR] site inbox lazy purge failed (non-fatal):", error);
  });
}

async function loadConversation(conversationId: string): Promise<SiteConversationRow> {
  const result = await getPgPool().query(
    `
      select
        id, kind, league_id, created_by_user_id,
        dm_user_low_id, dm_user_high_id,
        created_at::text, updated_at::text, last_message_at::text
      from rec_site_conversations
      where id = $1
      limit 1
    `,
    [conversationId],
  );
  const row = result.rows[0] as SiteConversationRow | undefined;
  if (!row) throw new ApiError(404, "Conversation not found.");
  return row;
}

async function ensureMemberRow(input: {
  conversationId: string;
  userId: string;
  role: "member" | "commissioner" | "support_agent";
}) {
  await getPgPool().query(
    `
      insert into rec_site_conversation_members (
        conversation_id, user_id, role, joined_at, last_read_at
      )
      values ($1, $2, $3, now(), null)
      on conflict (conversation_id, user_id) do update
        set hidden_at = null
    `,
    [input.conversationId, input.userId, input.role],
  );
}

async function resolveUserByIdOrUsername(input: {
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
      displayName: row.display_name ?? row.username,
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

function orderedDmPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function listConversations(input: { recUserId: string }) {
  lazyPurgeExpiredMessages();

  const memberRows = await getPgPool().query(
    `
      select
        c.id, c.kind, c.league_id, c.created_by_user_id,
        c.dm_user_low_id, c.dm_user_high_id,
        c.created_at::text, c.updated_at::text, c.last_message_at::text,
        m.last_read_at::text as last_read_at,
        l.name as league_name,
        preview.body as last_message_body,
        preview.author_user_id as last_message_author_user_id,
        peer.id as peer_user_id,
        peer.username as peer_username,
        peer.display_name as peer_display_name,
        creator.username as creator_username,
        creator.display_name as creator_display_name
      from rec_site_conversation_members m
      inner join rec_site_conversations c on c.id = m.conversation_id
      left join rec_leagues l on l.id = c.league_id
      left join lateral (
        select msg.body, msg.author_user_id
        from rec_site_messages msg
        where msg.conversation_id = c.id
        order by msg.created_at desc
        limit 1
      ) preview on true
      left join rec_users peer on peer.id = case
        when c.kind = 'dm' and c.dm_user_low_id = $1 then c.dm_user_high_id
        when c.kind = 'dm' and c.dm_user_high_id = $1 then c.dm_user_low_id
        else null
      end
      left join rec_users creator on creator.id = c.created_by_user_id
      where m.user_id = $1
        and m.hidden_at is null
      order by c.last_message_at desc nulls last, c.created_at desc
    `,
    [input.recUserId],
  );

  const seen = new Set(memberRows.rows.map((row) => String((row as { id: string }).id)));

  // Commissioner threads for leagues this user commissions, even without a member row.
  const commissionerCandidates = await getPgPool().query(
    `
      select
        c.id, c.kind, c.league_id, c.created_by_user_id,
        c.dm_user_low_id, c.dm_user_high_id,
        c.created_at::text, c.updated_at::text, c.last_message_at::text,
        null::text as last_read_at,
        l.name as league_name,
        preview.body as last_message_body,
        preview.author_user_id as last_message_author_user_id,
        null::uuid as peer_user_id,
        null::text as peer_username,
        null::text as peer_display_name,
        creator.username as creator_username,
        creator.display_name as creator_display_name
      from rec_site_conversations c
      left join rec_leagues l on l.id = c.league_id
      left join lateral (
        select msg.body, msg.author_user_id
        from rec_site_messages msg
        where msg.conversation_id = c.id
        order by msg.created_at desc
        limit 1
      ) preview on true
      left join rec_users creator on creator.id = c.created_by_user_id
      where c.kind = 'commissioner'
        and c.league_id is not null
        and not exists (
          select 1
          from rec_site_conversation_members m
          where m.conversation_id = c.id
            and m.user_id = $1
            and m.hidden_at is null
        )
      order by c.last_message_at desc nulls last
      limit 100
    `,
    [input.recUserId],
  );

  const commissionerAccessCache = new Map<string, boolean>();
  const extra: typeof memberRows.rows = [];
  for (const row of commissionerCandidates.rows) {
    const leagueId = String((row as { league_id: string }).league_id);
    let allowed = commissionerAccessCache.get(leagueId);
    if (allowed === undefined) {
      allowed = await isLeagueCommissioner(input.recUserId, leagueId);
      commissionerAccessCache.set(leagueId, allowed);
    }
    if (allowed && !seen.has(String((row as { id: string }).id))) {
      extra.push(row);
    }
  }

  const all = [...memberRows.rows, ...extra].sort((a, b) => {
    const aAt = String((a as { last_message_at: string | null }).last_message_at ?? "");
    const bAt = String((b as { last_message_at: string | null }).last_message_at ?? "");
    return bAt.localeCompare(aAt);
  });

  return {
    conversations: all.map((row) => {
      const r = row as Record<string, unknown>;
      const kind = String(r.kind);
      const lastMessageAt = r.last_message_at ? String(r.last_message_at) : null;
      const lastReadAt = r.last_read_at ? String(r.last_read_at) : null;
      const lastAuthor = r.last_message_author_user_id
        ? String(r.last_message_author_user_id)
        : null;
      const unread =
        Boolean(lastMessageAt) &&
        lastAuthor !== input.recUserId &&
        (!lastReadAt || lastMessageAt! > lastReadAt);

      let label = "Conversation";
      if (kind === "dm") {
        const peerUsername = r.peer_username ? String(r.peer_username) : null;
        const peerDisplay = r.peer_display_name ? String(r.peer_display_name) : null;
        label = peerUsername ? `@${peerUsername}` : peerDisplay ?? "Direct message";
      } else if (kind === "commissioner") {
        const leagueName = r.league_name ? String(r.league_name) : "League";
        const creatorUsername = r.creator_username ? String(r.creator_username) : null;
        if (String(r.created_by_user_id) === input.recUserId) {
          label = `${leagueName} commissioners`;
        } else {
          label = creatorUsername
            ? `${leagueName} · @${creatorUsername}`
            : `${leagueName} commissioner thread`;
        }
      }

      return {
        id: String(r.id),
        kind,
        leagueId: r.league_id ? String(r.league_id) : null,
        label,
        peerUserId: r.peer_user_id ? String(r.peer_user_id) : null,
        peerUsername: r.peer_username ? String(r.peer_username) : null,
        lastMessageAt,
        lastMessagePreview: r.last_message_body ? String(r.last_message_body) : null,
        unread,
      };
    }),
  };
}

export async function searchDmTargets(input: {
  recUserId: string;
  query?: string;
  limit: number;
}) {
  const query = String(input.query ?? "").trim();
  const like = query ? `%${query}%` : null;
  const result = await getPgPool().query(
    `
      with friends as (
        select case
          when f.requester_user_id = $1 then f.addressee_user_id
          else f.requester_user_id
        end as user_id
        from rec_site_friendships f
        where f.status = 'accepted'
          and (f.requester_user_id = $1 or f.addressee_user_id = $1)
      ),
      shared as (
        select distinct b.user_id
        from rec_team_assignments a
        inner join rec_team_assignments b
          on b.league_id = a.league_id
         and b.user_id <> $1
         and b.assignment_status = 'active'
         and b.ended_at is null
        where a.user_id = $1
          and a.assignment_status = 'active'
          and a.ended_at is null
      ),
      eligible as (
        select user_id from friends
        union
        select user_id from shared
      )
      select u.id, u.username, u.display_name
      from eligible e
      inner join rec_users u on u.id = e.user_id
      where u.username is not null
        and ($2::text is null or u.username ilike $2::text)
      order by lower(u.username)
      limit $3
    `,
    [input.recUserId, like, input.limit],
  );
  return {
    targets: result.rows.map((row) => ({
      userId: String((row as { id: string }).id),
      username: String((row as { username: string }).username),
      displayName: String(
        (row as { display_name: string | null }).display_name ??
          (row as { username: string }).username,
      ),
    })),
  };
}

export async function openDm(input: {
  recUserId: string;
  userId?: string;
  username?: string;
}) {
  const peer = await resolveUserByIdOrUsername({
    userId: input.userId,
    username: input.username,
  });
  if (peer.id === input.recUserId) {
    throw new ApiError(400, "You cannot message yourself.");
  }
  if (!(await canDm(input.recUserId, peer.id))) {
    throw new ApiError(
      403,
      "You can only DM friends or members who share an active league with you.",
    );
  }

  const [low, high] = orderedDmPair(input.recUserId, peer.id);
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
      [input.recUserId, low, high],
    );
    conversationId = String(created.rows[0].id);
    await ensureMemberRow({
      conversationId,
      userId: input.recUserId,
      role: "member",
    });
    await ensureMemberRow({
      conversationId,
      userId: peer.id,
      role: "member",
    });
  } else {
    await ensureMemberRow({
      conversationId,
      userId: input.recUserId,
      role: "member",
    });
    await ensureMemberRow({
      conversationId,
      userId: peer.id,
      role: "member",
    });
  }

  return {
    conversationId,
    peer: {
      userId: peer.id,
      username: peer.username,
      displayName: peer.displayName,
    },
  };
}

export async function openCommissionerThread(input: {
  recUserId: string;
  leagueId: string;
}) {
  const assignment = await getPgPool().query(
    `
      select 1
      from rec_team_assignments
      where league_id = $1
        and user_id = $2
        and assignment_status = 'active'
        and ended_at is null
      limit 1
    `,
    [input.leagueId, input.recUserId],
  );
  const isCommissioner = await isLeagueCommissioner(input.recUserId, input.leagueId);
  if (!assignment.rows[0] && !isCommissioner) {
    throw new ApiError(
      403,
      "You need an active team in this league or commissioner access to open this thread.",
    );
  }

  const existing = await getPgPool().query(
    `
      select id
      from rec_site_conversations
      where kind = 'commissioner'
        and league_id = $1
        and created_by_user_id = $2
      limit 1
    `,
    [input.leagueId, input.recUserId],
  );
  let conversationId = existing.rows[0]?.id as string | undefined;
  if (!conversationId) {
    const created = await getPgPool().query(
      `
        insert into rec_site_conversations (
          kind, league_id, created_by_user_id
        )
        values ('commissioner', $1, $2)
        returning id
      `,
      [input.leagueId, input.recUserId],
    );
    conversationId = String(created.rows[0].id);
  }

  await ensureMemberRow({
    conversationId,
    userId: input.recUserId,
    role: isCommissioner && !assignment.rows[0] ? "commissioner" : "member",
  });

  return { conversationId };
}

export async function listMessages(input: {
  recUserId: string;
  conversationId: string;
  limit: number;
  before?: string;
}) {
  lazyPurgeExpiredMessages();
  const conversation = await loadConversation(input.conversationId);
  if (!(await canAccessConversation(input.recUserId, conversation))) {
    throw new ApiError(403, "You do not have access to this conversation.");
  }
  if (
    conversation.kind === "commissioner" &&
    conversation.league_id &&
    (await isLeagueCommissioner(input.recUserId, conversation.league_id))
  ) {
    await ensureMemberRow({
      conversationId: conversation.id,
      userId: input.recUserId,
      role: "commissioner",
    });
  }

  const values: unknown[] = [input.conversationId, input.limit];
  let beforeClause = "";
  if (input.before) {
    values.push(input.before);
    beforeClause = `and m.created_at < $3::timestamptz`;
  }

  const result = await getPgPool().query(
    `
      select
        m.id,
        m.conversation_id,
        m.author_user_id,
        m.body,
        m.created_at::text,
        m.reported_at::text,
        u.username as author_username,
        u.display_name as author_display_name
      from rec_site_messages m
      inner join rec_users u on u.id = m.author_user_id
      where m.conversation_id = $1
        ${beforeClause}
      order by m.created_at desc
      limit $2
    `,
    values,
  );

  const messages = result.rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        conversationId: String(r.conversation_id),
        authorUserId: String(r.author_user_id),
        authorUsername: r.author_username ? String(r.author_username) : null,
        authorDisplayName: r.author_display_name
          ? String(r.author_display_name)
          : null,
        body: String(r.body),
        createdAt: String(r.created_at),
        reportedAt: r.reported_at ? String(r.reported_at) : null,
      };
    })
    .reverse();

  return { messages };
}

export async function sendMessage(input: {
  recUserId: string;
  conversationId: string;
  body: string;
}) {
  lazyPurgeExpiredMessages();
  const body = input.body.trim();
  if (!body) throw new ApiError(400, "Message can't be empty.");
  if (body.length > 4000) throw new ApiError(400, "Message is too long (4000 characters max).");

  const conversation = await loadConversation(input.conversationId);
  if (!(await canAccessConversation(input.recUserId, conversation))) {
    throw new ApiError(403, "You do not have access to this conversation.");
  }

  if (conversation.kind === "dm") {
    const peerId =
      conversation.dm_user_low_id === input.recUserId
        ? conversation.dm_user_high_id
        : conversation.dm_user_low_id;
    if (!peerId || !(await canDm(input.recUserId, peerId))) {
      throw new ApiError(
        403,
        "You can only DM friends or members who share an active league with you.",
      );
    }
  } else if (conversation.kind === "commissioner") {
    if (!conversation.league_id) {
      throw new ApiError(500, "Commissioner conversation is missing league_id.");
    }
    const isMember = conversation.created_by_user_id === input.recUserId;
    const isCommissioner = await isLeagueCommissioner(
      input.recUserId,
      conversation.league_id,
    );
    if (!isMember && !isCommissioner) {
      const membership = await getPgPool().query(
        `
          select 1 from rec_site_conversation_members
          where conversation_id = $1 and user_id = $2 and hidden_at is null
          limit 1
        `,
        [conversation.id, input.recUserId],
      );
      if (!membership.rows[0]) {
        throw new ApiError(403, "You do not have access to this conversation.");
      }
    }
    await ensureMemberRow({
      conversationId: conversation.id,
      userId: input.recUserId,
      role: isCommissioner ? "commissioner" : "member",
    });
  } else {
    throw new ApiError(400, "Support conversations are not available yet.");
  }

  const inserted = await getPgPool().query(
    `
      insert into rec_site_messages (conversation_id, author_user_id, body)
      values ($1, $2, $3)
      returning id, conversation_id, author_user_id, body, created_at::text, reported_at::text
    `,
    [conversation.id, input.recUserId, body],
  );
  await getPgPool().query(
    `
      update rec_site_conversations
      set last_message_at = now(), updated_at = now()
      where id = $1
    `,
    [conversation.id],
  );
  await getPgPool().query(
    `
      update rec_site_conversation_members
      set last_read_at = now()
      where conversation_id = $1 and user_id = $2
    `,
    [conversation.id, input.recUserId],
  );

  const row = inserted.rows[0] as Record<string, unknown>;
  return {
    message: {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      authorUserId: String(row.author_user_id),
      body: String(row.body),
      createdAt: String(row.created_at),
      reportedAt: row.reported_at ? String(row.reported_at) : null,
    },
  };
}

export async function markConversationRead(input: {
  recUserId: string;
  conversationId: string;
}) {
  const conversation = await loadConversation(input.conversationId);
  if (!(await canAccessConversation(input.recUserId, conversation))) {
    throw new ApiError(403, "You do not have access to this conversation.");
  }
  const role =
    conversation.kind === "commissioner" &&
    conversation.league_id &&
    (await isLeagueCommissioner(input.recUserId, conversation.league_id))
      ? "commissioner"
      : "member";
  await ensureMemberRow({
    conversationId: conversation.id,
    userId: input.recUserId,
    role,
  });
  await getPgPool().query(
    `
      update rec_site_conversation_members
      set last_read_at = now()
      where conversation_id = $1 and user_id = $2
    `,
    [conversation.id, input.recUserId],
  );
  return { ok: true as const };
}

export async function reportMessage(input: {
  recUserId: string;
  messageId: string;
}) {
  const result = await getPgPool().query(
    `
      select
        m.conversation_id,
        c.id,
        c.kind,
        c.league_id,
        c.created_by_user_id,
        c.dm_user_low_id,
        c.dm_user_high_id,
        c.created_at::text,
        c.updated_at::text,
        c.last_message_at::text
      from rec_site_messages m
      inner join rec_site_conversations c on c.id = m.conversation_id
      where m.id = $1
      limit 1
    `,
    [input.messageId],
  );
  const row = result.rows[0] as SiteConversationRow | undefined;
  if (!row) throw new ApiError(404, "Message not found.");
  if (!(await canAccessConversation(input.recUserId, row))) {
    throw new ApiError(403, "You do not have access to this conversation.");
  }

  await getPgPool().query(
    `
      update rec_site_messages
      set reported_at = coalesce(reported_at, now())
      where id = $1
    `,
    [input.messageId],
  );
  return { ok: true as const };
}
