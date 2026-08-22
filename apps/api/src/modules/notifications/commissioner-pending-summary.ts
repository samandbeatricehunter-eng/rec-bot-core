// Shared aggregation used by both notification bells (apps/web's Discord-activity bell and
// apps/site's public-site bell). Per the "Pending" redesign, the bell no longer lists every
// individual rec_commissioners_inbox row — it shows one line per league: "You have N pending
// items in {league} ({game})". rec_commissioner_inbox_reads tracks, per (user, league), the
// last time that line was opened, so it can stop being flagged as unread until a newer
// pending item shows up.
import { getPgPool } from "../../db/client.js";
import { sendPushToUsers } from "../push/push.service.js";

export type CommissionerPendingSummary = {
  leagueId: string;
  leagueName: string;
  game: string;
  gameLabel: string;
  pendingCount: number;
  latestCreatedAt: string;
  unread: boolean;
};

const GAME_LABELS: Record<string, string> = {
  cfb_27: "CFB 27",
  madden_26: "Madden 26",
  madden_27: "Madden 27",
};

export function gameLabelFor(game: string): string {
  return GAME_LABELS[game] ?? game.replace(/_/g, " ").toUpperCase();
}

export function summaryTitle(input: { pendingCount: number; leagueName: string; gameLabel: string }): string {
  return `You have ${input.pendingCount} pending item${input.pendingCount === 1 ? "" : "s"} in ${input.leagueName} (${input.gameLabel})`;
}

export async function getCommissionerPendingSummaries(
  recUserId: string,
  leagueIds: string[],
): Promise<CommissionerPendingSummary[]> {
  const ids = [...new Set(leagueIds)];
  if (!ids.length) return [];
  const { rows } = await getPgPool().query(
    `
      select
        l.id as league_id,
        l.name as league_name,
        l.game,
        count(i.id) filter (where i.status = 'pending')::int as pending_count,
        max(i.created_at) filter (where i.status = 'pending') as latest_created_at,
        r.viewed_at
      from rec_leagues l
      left join rec_commissioners_inbox i on i.league_id = l.id
      left join rec_commissioner_inbox_reads r on r.league_id = l.id and r.user_id = $1
      where l.id = any($2::uuid[])
      group by l.id, l.name, l.game, r.viewed_at
    `,
    [recUserId, ids],
  );

  return (rows as Array<{
    league_id: string;
    league_name: string;
    game: string;
    pending_count: number;
    latest_created_at: string | Date | null;
    viewed_at: string | Date | null;
  }>)
    .filter((row) => row.pending_count > 0)
    .map((row) => {
      const latest = row.latest_created_at ? new Date(row.latest_created_at) : null;
      const viewed = row.viewed_at ? new Date(row.viewed_at) : null;
      return {
        leagueId: row.league_id,
        leagueName: row.league_name,
        game: row.game,
        gameLabel: gameLabelFor(row.game),
        pendingCount: row.pending_count,
        latestCreatedAt: (latest ?? new Date(0)).toISOString(),
        unread: !viewed || (latest != null && latest > viewed),
      };
    });
}

export async function markCommissionerLeaguesViewed(recUserId: string, leagueIds: string[]): Promise<void> {
  const ids = [...new Set(leagueIds)];
  if (!ids.length) return;
  await getPgPool().query(
    `
      insert into rec_commissioner_inbox_reads (user_id, league_id, viewed_at)
      select $1, x, now() from unnest($2::uuid[]) as x
      on conflict (user_id, league_id) do update set viewed_at = now()
    `,
    [recUserId, ids],
  );
}

export async function resolveRecUserIdForDiscordId(discordId: string): Promise<string | null> {
  const { rows } = await getPgPool().query(
    `select user_id from rec_discord_accounts where discord_id = $1 limit 1`,
    [discordId],
  );
  const row = rows[0] as { user_id: string | null } | undefined;
  return row?.user_id ?? null;
}

export async function listLeagueCommissionerUserIds(leagueId: string): Promise<string[]> {
  const { rows } = await getPgPool().query(
    `
      select user_id from rec_league_memberships
      where league_id = $1 and role in ('commissioner', 'co_commissioner')
      union
      select owner_user_id as user_id from rec_leagues where id = $1 and owner_user_id is not null
    `,
    [leagueId],
  );
  return (rows as Array<{ user_id: string }>).map((row) => row.user_id);
}

/**
 * Fire-and-forget push to every commissioner of a league when a new item lands in their
 * pending queue. Body text matches the bell's aggregate summary exactly (live pending count,
 * not "a new item arrived") so tapping the OS notification and opening the bell tell the same
 * story. Swallows every error internally — a push failure must never break the caller's
 * primary write, so call sites can just `void` this without their own try/catch.
 */
export async function notifyLeagueCommissionersOfPendingItem(leagueId: string): Promise<void> {
  try {
    const { rows } = await getPgPool().query(
      `
        select
          l.name as league_name,
          l.game,
          count(i.id) filter (where i.status = 'pending')::int as pending_count
        from rec_leagues l
        left join rec_commissioners_inbox i on i.league_id = l.id
        where l.id = $1
        group by l.id, l.name, l.game
      `,
      [leagueId],
    );
    const league = rows[0] as { league_name: string; game: string; pending_count: number } | undefined;
    if (!league || league.pending_count <= 0) return;

    const userIds = await listLeagueCommissionerUserIds(leagueId);
    if (!userIds.length) return;

    await sendPushToUsers(userIds, {
      title: summaryTitle({
        pendingCount: league.pending_count,
        leagueName: league.league_name,
        gameLabel: gameLabelFor(league.game),
      }),
      body: "Tap to open League Management → Notifications.",
      url: `/l/${leagueId}/mgmt/notifications`,
    });
  } catch (error) {
    console.error("[WARN] Failed to push-notify league commissioners of pending item (non-fatal):", error);
  }
}
