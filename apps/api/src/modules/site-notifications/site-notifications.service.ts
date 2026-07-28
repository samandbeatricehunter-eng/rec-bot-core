import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import {
  listMySiteLeagues,
  requireLinkedRecUser,
} from "../site-leagues/site-leagues.service.js";
import {
  getCommissionerPendingSummaries,
  markCommissionerLeaguesViewed,
  summaryTitle,
} from "../notifications/commissioner-pending-summary.js";

export { requireLinkedRecUser };

export async function markSiteCommissionerLeaguesViewed(input: {
  recUserId: string;
  leagueIds: string[];
}): Promise<{ ok: true }> {
  await markCommissionerLeaguesViewed(input.recUserId, input.leagueIds);
  return { ok: true };
}

export type SiteNotificationItem = {
  id: string;
  title: string;
  body: string | null;
  href: string;
  read: boolean;
  createdAt: string;
  /** Section discriminator for the site bell. */
  kind: "regular" | "commissioner";
  leagueId?: string | null;
  leagueName?: string | null;
};

/** node-pg returns timestamps as Date; always normalize before string APIs. */
function asIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

export async function listSiteNotifications(input: {
  recUserId: string;
}): Promise<{
  regular: SiteNotificationItem[];
  commissioner: SiteNotificationItem[];
  unreadCount: number;
}> {
  const regularResult = await getPgPool().query(
    `
      select
        n.id,
        n.kind,
        n.title,
        n.body,
        n.href,
        n.league_id,
        n.created_at,
        n.read_at,
        l.name as league_name
      from rec_site_notifications n
      left join rec_leagues l on l.id = n.league_id
      where n.user_id = $1
      order by n.created_at desc
      limit 50
    `,
    [input.recUserId],
  );

  const regular: SiteNotificationItem[] = (
    regularResult.rows as Array<{
      id: string;
      kind: string;
      title: string;
      body: string | null;
      href: string;
      league_id: string | null;
      created_at: string;
      read_at: string | null;
      league_name: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    kind: "regular" as const,
    title: row.title,
    body: row.body,
    href: row.href,
    leagueId: row.league_id,
    leagueName: row.league_name,
    createdAt: asIsoTimestamp(row.created_at),
    read: row.read_at != null,
  }));

  const { leagues } = await listMySiteLeagues({ recUserId: input.recUserId });
  const commissionerLeagueIds = leagues.filter((league) => league.isCommissioner).map((league) => league.id);

  // One aggregate row per league ("You have N pending items in {league}"), not one row per
  // rec_commissioners_inbox item — item-level review now lives in the Commissioner Chat
  // window's Payouts tab (League Mgmt), so the bell only needs to say where to look.
  const summaries = await getCommissionerPendingSummaries(input.recUserId, commissionerLeagueIds);
  const commissioner: SiteNotificationItem[] = summaries.map((item) => ({
    id: `pending-summary:${item.leagueId}`,
    kind: "commissioner",
    title: summaryTitle(item),
    body: `${item.gameLabel} · Open the commissioner inbox to review.`,
    href: `/l/${item.leagueId}/mgmt/inbox`,
    leagueId: item.leagueId,
    leagueName: item.leagueName,
    createdAt: item.latestCreatedAt,
    read: !item.unread,
  }));

  commissioner.sort((a, b) => asIsoTimestamp(b.createdAt).localeCompare(asIsoTimestamp(a.createdAt)));

  const unreadCount =
    regular.filter((item) => !item.read).length +
    commissioner.filter((item) => !item.read).length;

  return { regular, commissioner, unreadCount };
}

export type SiteActivityCounts = {
  unreadNotifications: number;
  unreadMessages: number;
  unreadCommissionerItems: number;
};

// Lightweight companion to listSiteNotifications/listConversations — counts only, no joined
// labels/previews/peer names, so the site's polling components (MessagesLink,
// NotificationsBell) can check "did anything change" every couple of minutes without pulling
// full datasets on every tick. Full lists still load once the user actually opens a panel.
export async function getSiteActivityCounts(input: { recUserId: string }): Promise<SiteActivityCounts> {
  const [notifResult, messagesResult, { leagues }] = await Promise.all([
    getPgPool().query(
      `select count(*)::int as c from rec_site_notifications where user_id = $1 and read_at is null`,
      [input.recUserId],
    ),
    getPgPool().query(
      `
        select count(*)::int as c
        from rec_site_conversation_members m
        inner join rec_site_conversations c on c.id = m.conversation_id
        left join lateral (
          select msg.author_user_id
          from rec_site_messages msg
          where msg.conversation_id = c.id
          order by msg.created_at desc
          limit 1
        ) preview on true
        where m.user_id = $1
          and m.hidden_at is null
          and c.last_message_at is not null
          and preview.author_user_id is distinct from $1
          and (m.last_read_at is null or c.last_message_at > m.last_read_at)
      `,
      [input.recUserId],
    ),
    listMySiteLeagues({ recUserId: input.recUserId }),
  ]);

  const commissionerLeagueIds = leagues.filter((league) => league.isCommissioner).map((league) => league.id);
  const summaries = commissionerLeagueIds.length
    ? await getCommissionerPendingSummaries(input.recUserId, commissionerLeagueIds)
    : [];

  return {
    unreadNotifications: Number(notifResult.rows[0]?.c ?? 0),
    unreadMessages: Number(messagesResult.rows[0]?.c ?? 0),
    unreadCommissionerItems: summaries.filter((item) => item.unread).length,
  };
}

export async function markSiteNotificationsRead(input: {
  recUserId: string;
  ids: string[];
}): Promise<{ ok: true; updated: number }> {
  // Commissioner inbox summaries + synthetic inbox links are navigation-only;
  // mark-read only applies to UUID rows in rec_site_notifications.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const realIds = input.ids.filter((id) => uuidRe.test(id));
  if (!realIds.length) return { ok: true, updated: 0 };

  const result = await getPgPool().query(
    `
      update rec_site_notifications
      set read_at = coalesce(read_at, now())
      where user_id = $1
        and id = any($2::uuid[])
      returning id
    `,
    [input.recUserId, realIds],
  );
  return { ok: true, updated: result.rowCount ?? 0 };
}

export async function clearSiteNotifications(input: {
  recUserId: string;
}): Promise<{ ok: true; cleared: number }> {
  const result = await getPgPool().query(
    `delete from rec_site_notifications where user_id = $1`,
    [input.recUserId],
  );
  return { ok: true, cleared: result.rowCount ?? 0 };
}

/** Helper for future producers (advance digests, friend requests, etc.). */
export async function createSiteNotification(input: {
  userId: string;
  leagueId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  href: string;
}): Promise<{ id: string }> {
  const result = await getPgPool().query(
    `
      insert into rec_site_notifications (user_id, league_id, kind, title, body, href)
      values ($1, $2, $3, $4, $5, $6)
      returning id
    `,
    [
      input.userId,
      input.leagueId ?? null,
      input.kind,
      input.title,
      input.body ?? null,
      input.href,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new ApiError(500, "Failed to create notification.");
  return { id: String(id) };
}
