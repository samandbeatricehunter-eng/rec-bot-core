import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
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

function mapFriendshipRow(row: Record<string, unknown>, viewerUserId: string) {
  const requesterUserId = String(row.requester_user_id);
  const addresseeUserId = String(row.addressee_user_id);
  const peerIsRequester = requesterUserId !== viewerUserId;
  return {
    friendshipId: String(row.id),
    status: String(row.status),
    createdAt: String(row.created_at),
    respondedAt: row.responded_at ? String(row.responded_at) : null,
    direction:
      requesterUserId === viewerUserId
        ? ("outgoing" as const)
        : ("incoming" as const),
    peer: {
      userId: peerIsRequester ? requesterUserId : addresseeUserId,
      username: String(
        peerIsRequester ? row.requester_username : row.addressee_username,
      ),
      displayName: String(
        peerIsRequester
          ? row.requester_display_name ?? row.requester_username
          : row.addressee_display_name ?? row.addressee_username,
      ),
    },
  };
}

export async function listFriendships(input: { recUserId: string }) {
  const result = await getPgPool().query(
    `
      select
        f.id,
        f.requester_user_id,
        f.addressee_user_id,
        f.status,
        f.created_at::text,
        f.responded_at::text,
        req.username as requester_username,
        req.display_name as requester_display_name,
        addr.username as addressee_username,
        addr.display_name as addressee_display_name
      from rec_site_friendships f
      inner join rec_users req on req.id = f.requester_user_id
      inner join rec_users addr on addr.id = f.addressee_user_id
      where (f.requester_user_id = $1 or f.addressee_user_id = $1)
        and f.status in ('pending', 'accepted')
      order by
        case f.status when 'pending' then 0 else 1 end,
        f.created_at desc
    `,
    [input.recUserId],
  );

  type FriendshipView = ReturnType<typeof mapFriendshipRow>;
  const accepted: FriendshipView[] = [];
  const pendingIncoming: FriendshipView[] = [];
  const pendingOutgoing: FriendshipView[] = [];
  for (const row of result.rows) {
    const mapped = mapFriendshipRow(row as Record<string, unknown>, input.recUserId);
    if (mapped.status === "accepted") {
      accepted.push(mapped);
    } else if (mapped.direction === "incoming") {
      pendingIncoming.push(mapped);
    } else {
      pendingOutgoing.push(mapped);
    }
  }
  return { accepted, pendingIncoming, pendingOutgoing };
}

export async function requestFriendship(input: {
  recUserId: string;
  userId?: string;
  username?: string;
}) {
  const target = await resolveTargetUser({
    userId: input.userId,
    username: input.username,
  });
  if (target.id === input.recUserId) {
    throw new ApiError(400, "You cannot friend yourself.");
  }

  const existing = await getPgPool().query(
    `
      select id, requester_user_id, addressee_user_id, status
      from rec_site_friendships
      where least(requester_user_id, addressee_user_id) = least($1::uuid, $2::uuid)
        and greatest(requester_user_id, addressee_user_id) = greatest($1::uuid, $2::uuid)
      limit 1
    `,
    [input.recUserId, target.id],
  );
  const row = existing.rows[0] as
    | {
        id: string;
        requester_user_id: string;
        addressee_user_id: string;
        status: string;
      }
    | undefined;

  if (row?.status === "accepted") {
    throw new ApiError(409, "You are already friends with this user.");
  }
  if (row?.status === "pending") {
    if (row.addressee_user_id === input.recUserId) {
      const accepted = await getPgPool().query(
        `
          update rec_site_friendships
          set status = 'accepted', responded_at = now()
          where id = $1
          returning id
        `,
        [row.id],
      );
      return {
        friendshipId: String(accepted.rows[0].id),
        status: "accepted" as const,
        autoAccepted: true,
        peer: target,
      };
    }
    throw new ApiError(409, "Friend request already pending.");
  }

  if (row?.status === "declined") {
    const updated = await getPgPool().query(
      `
        update rec_site_friendships
        set
          requester_user_id = $2,
          addressee_user_id = $3,
          status = 'pending',
          created_at = now(),
          responded_at = null
        where id = $1
        returning id
      `,
      [row.id, input.recUserId, target.id],
    );
    return {
      friendshipId: String(updated.rows[0].id),
      status: "pending" as const,
      autoAccepted: false,
      peer: target,
    };
  }

  const created = await getPgPool().query(
    `
      insert into rec_site_friendships (
        requester_user_id, addressee_user_id, status
      )
      values ($1, $2, 'pending')
      returning id
    `,
    [input.recUserId, target.id],
  );
  return {
    friendshipId: String(created.rows[0].id),
    status: "pending" as const,
    autoAccepted: false,
    peer: target,
  };
}

export async function respondFriendship(input: {
  recUserId: string;
  friendshipId: string;
  action: "accept" | "decline";
}) {
  const existing = await getPgPool().query(
    `
      select id, requester_user_id, addressee_user_id, status
      from rec_site_friendships
      where id = $1
      limit 1
    `,
    [input.friendshipId],
  );
  const row = existing.rows[0] as
    | {
        id: string;
        requester_user_id: string;
        addressee_user_id: string;
        status: string;
      }
    | undefined;
  if (!row) throw new ApiError(404, "Friend request not found.");
  if (row.addressee_user_id !== input.recUserId) {
    throw new ApiError(403, "Only the addressee can respond to this request.");
  }
  if (row.status !== "pending") {
    throw new ApiError(409, "This friend request is no longer pending.");
  }

  const status = input.action === "accept" ? "accepted" : "declined";
  await getPgPool().query(
    `
      update rec_site_friendships
      set status = $2, responded_at = now()
      where id = $1
    `,
    [input.friendshipId, status],
  );
  return { friendshipId: input.friendshipId, status };
}

export async function removeFriendship(input: {
  recUserId: string;
  friendshipId?: string;
  userId?: string;
}) {
  let friendshipId = input.friendshipId;
  if (!friendshipId && input.userId) {
    const found = await getPgPool().query(
      `
        select id
        from rec_site_friendships
        where least(requester_user_id, addressee_user_id) = least($1::uuid, $2::uuid)
          and greatest(requester_user_id, addressee_user_id) = greatest($1::uuid, $2::uuid)
        limit 1
      `,
      [input.recUserId, input.userId],
    );
    friendshipId = found.rows[0]?.id as string | undefined;
  }
  if (!friendshipId) {
    throw new ApiError(400, "friendshipId or userId is required.");
  }

  const existing = await getPgPool().query(
    `
      select id, requester_user_id, addressee_user_id
      from rec_site_friendships
      where id = $1
      limit 1
    `,
    [friendshipId],
  );
  const row = existing.rows[0] as
    | { id: string; requester_user_id: string; addressee_user_id: string }
    | undefined;
  if (!row) throw new ApiError(404, "Friendship not found.");
  if (
    row.requester_user_id !== input.recUserId &&
    row.addressee_user_id !== input.recUserId
  ) {
    throw new ApiError(403, "You are not a party to this friendship.");
  }

  await getPgPool().query(`delete from rec_site_friendships where id = $1`, [
    friendshipId,
  ]);
  return { ok: true as const, friendshipId };
}
