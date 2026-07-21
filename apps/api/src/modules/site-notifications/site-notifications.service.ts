import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import {
  listMySiteLeagues,
  requireLinkedRecUser,
} from "../site-leagues/site-leagues.service.js";

export { requireLinkedRecUser };

export type SiteNotificationItem = {
  id: string;
  section: "regular" | "commissioner";
  kind: string;
  title: string;
  body: string | null;
  href: string;
  leagueId: string | null;
  leagueName: string | null;
  createdAt: string;
  read: boolean;
  /** When true, item is a synthetic link into that league's commissioner inbox. */
  isInboxLink?: boolean;
};

function humanizeQueueTitle(input: {
  queueType: string;
  header: string;
  summary: string | null;
  leagueName: string;
  requesterName: string | null;
}): string {
  const requester = input.requesterName?.trim() || "A member";
  switch (input.queueType) {
    case "stream":
      return `${requester} has submitted a stream in ${input.leagueName}`;
    case "highlight":
      return `${requester} has submitted a highlight in ${input.leagueName}`;
    case "box_score":
      return `${requester} submitted a box score in ${input.leagueName}`;
    case "purchase":
      return `${requester} requested a purchase in ${input.leagueName}`;
    case "wager":
      return `Wager review needed in ${input.leagueName}`;
    case "team_request":
      return `Team request pending in ${input.leagueName}`;
    case "weekly_score_review":
      return `Weekly score review pending in ${input.leagueName}`;
    case "game_of_the_year":
      return `Game of the Year item needs review in ${input.leagueName}`;
    case "media":
      return `Media submission pending in ${input.leagueName}`;
    default:
      return input.header?.trim() || `${input.leagueName}: ${input.queueType.replaceAll("_", " ")}`;
  }
}

function hrefForQueueType(leagueId: string, queueType: string): string {
  // Review-queue style items open the league commissioner inbox on site.
  // Member-facing info that isn't a review (future advance digests) goes to matchups.
  if (queueType === "league_advanced" || queueType === "advance") {
    return `/l/${leagueId}/matchups`;
  }
  return `/l/${leagueId}/mgmt/inbox`;
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
    section: "regular",
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    leagueId: row.league_id,
    leagueName: row.league_name,
    createdAt: row.created_at,
    read: row.read_at != null,
  }));

  const { leagues } = await listMySiteLeagues({ recUserId: input.recUserId });
  const commissionerLeagues = leagues.filter((league) => league.isCommissioner);

  const commissioner: SiteNotificationItem[] = [];

  for (const league of commissionerLeagues) {
    // Explicit entry so commissioners can always jump to the review inbox
    // without conflating it with the generic bell item list.
    commissioner.push({
      id: `inbox-link:${league.id}`,
      section: "commissioner",
      kind: "commissioner_inbox_link",
      title: `Open ${league.name} commissioner inbox`,
      body: "Review queue for this league (same inbox as Commissioners Office).",
      href: `/l/${league.id}/mgmt/inbox`,
      leagueId: league.id,
      leagueName: league.name,
      createdAt: new Date(0).toISOString(),
      read: true,
      isInboxLink: true,
    });

    const pending = await getPgPool().query(
      `
        select
          i.id,
          i.queue_type,
          i.header,
          i.summary,
          i.created_at,
          coalesce(u.username, u.display_name, da.username, da.global_name) as requester_name
        from rec_commissioners_inbox i
        left join rec_users u on u.id = i.requester_user_id
        left join rec_discord_accounts da on da.discord_id = i.requester_discord_id
        where i.league_id = $1
          and i.status = 'pending'
        order by i.priority desc, i.created_at desc
        limit 25
      `,
      [league.id],
    );

    for (const row of pending.rows as Array<{
      id: string;
      queue_type: string;
      header: string;
      summary: string | null;
      created_at: string;
      requester_name: string | null;
    }>) {
      commissioner.push({
        id: `commish:${row.id}`,
        section: "commissioner",
        kind: row.queue_type,
        title: humanizeQueueTitle({
          queueType: row.queue_type,
          header: row.header,
          summary: row.summary,
          leagueName: league.name,
          requesterName: row.requester_name,
        }),
        body: row.summary,
        href: hrefForQueueType(league.id, row.queue_type),
        leagueId: league.id,
        leagueName: league.name,
        createdAt: row.created_at,
        read: false,
      });
    }
  }

  // Keep inbox links at top of commissioner section, then newest pending items.
  commissioner.sort((a, b) => {
    if (a.isInboxLink && !b.isInboxLink) return -1;
    if (!a.isInboxLink && b.isInboxLink) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const unreadCount =
    regular.filter((item) => !item.read).length +
    commissioner.filter((item) => !item.read && !item.isInboxLink).length;

  return { regular, commissioner, unreadCount };
}

export async function markSiteNotificationsRead(input: {
  recUserId: string;
  ids: string[];
}): Promise<{ ok: true; updated: number }> {
  const realIds = input.ids.filter((id) => !id.startsWith("commish:") && !id.startsWith("inbox-link:"));
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
