import { shuffle } from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { sendPushToUsers } from "../push/push.service.js";
import { addTournamentUser } from "./tournaments.service.js";

const PICK_WINDOW_MS = 2 * 60 * 60 * 1000;
const OPEN_POOL_WINDOW_MS = 60 * 60 * 1000;

type LotteryRow = {
  tournament_id: string;
  status: "not_scheduled" | "scheduled" | "drawing" | "picking" | "open_pool" | "completed";
  scheduled_at: string | null;
  notified_30min_at: string | null;
  notified_10min_at: string | null;
  notified_1min_at: string | null;
  draw_order: string[] | null;
  current_position: number | null;
  current_pick_deadline_at: string | null;
  open_pool_started_at: string | null;
  open_pool_deadline_at: string | null;
};

async function loadLottery(tournamentId: string): Promise<LotteryRow | null> {
  const result = await getPgPool().query(`select * from rec_site_tournament_lotteries where tournament_id = $1`, [tournamentId]);
  return (result.rows[0] as LotteryRow | undefined) ?? null;
}

async function loadTournamentForLottery(tournamentId: string) {
  const result = await getPgPool().query(
    `select id, title, status, claim_order_mode, team_selection_mode from rec_site_tournaments where id = $1`,
    [tournamentId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "Tournament not found.");
  if (row.claim_order_mode !== "lottery") throw new ApiError(400, "This tournament is not using the lottery draft.");
  return row as { id: string; title: string; status: string; claim_order_mode: string; team_selection_mode: string };
}

async function notify(userIds: string[], title: string, body: string, href: string) {
  await Promise.all(userIds.map((userId) => createSiteNotification({ userId, kind: "tournament_lottery", title, body, href })));
  await sendPushToUsers(userIds, { title, body, url: href }).catch(() => undefined);
}

async function approvedEntrantUserIds(tournamentId: string): Promise<string[]> {
  const result = await getPgPool().query(
    `select user_id from rec_site_tournament_entrants where tournament_id = $1 and entry_status = 'approved' and team_abbr is null`,
    [tournamentId],
  );
  return result.rows.map((r) => String(r.user_id));
}

export async function getTournamentLottery(input: { tournamentId: string }) {
  const tournament = await loadTournamentForLottery(input.tournamentId);
  const lottery = await loadLottery(input.tournamentId);
  if (!lottery) {
    return { status: "not_scheduled" as const, tournamentTitle: tournament.title };
  }
  const userIds = lottery.draw_order ?? [];
  const users = userIds.length
    ? await getPgPool().query(
        `select id, username, display_name from rec_users where id = any($1::uuid[])`,
        [userIds],
      )
    : { rows: [] as Array<{ id: string; username: string | null; display_name: string | null }> };
  const nameById = new Map(users.rows.map((u): [string, string] => [String(u.id), u.display_name || u.username || "Unknown"]));
  const skips = await getPgPool().query(
    `select user_id, resolved_at from rec_site_tournament_lottery_skips where tournament_id = $1`,
    [input.tournamentId],
  );
  return {
    status: lottery.status,
    tournamentTitle: tournament.title,
    scheduledAt: lottery.scheduled_at,
    drawOrder: userIds.map((id) => ({ userId: id, displayName: nameById.get(id) ?? "Unknown" })),
    currentPosition: lottery.current_position,
    currentUserId: lottery.current_position && userIds.length ? userIds[lottery.current_position - 1] ?? null : null,
    currentPickDeadlineAt: lottery.current_pick_deadline_at,
    openPoolDeadlineAt: lottery.open_pool_deadline_at,
    skipped: skips.rows.map((r) => ({ userId: String(r.user_id), resolved: Boolean(r.resolved_at) })),
  };
}

export async function scheduleTournamentLottery(input: { tournamentId: string; scheduledAt: string }) {
  await loadTournamentForLottery(input.tournamentId);
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new ApiError(400, "Pick a lottery time in the future.");
  }
  await getPgPool().query(
    `
      insert into rec_site_tournament_lotteries (tournament_id, status, scheduled_at)
      values ($1, 'scheduled', $2)
      on conflict (tournament_id) do update set
        status = 'scheduled', scheduled_at = excluded.scheduled_at,
        notified_30min_at = null, notified_10min_at = null, notified_1min_at = null,
        draw_order = null, current_position = null, current_pick_deadline_at = null,
        open_pool_started_at = null, open_pool_deadline_at = null, updated_at = now()
    `,
    [input.tournamentId, scheduledAt.toISOString()],
  );
  return getTournamentLottery(input);
}

export async function runTournamentLotteryNow(input: { tournamentId: string }) {
  const tournament = await loadTournamentForLottery(input.tournamentId);
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`tournament-lottery:${tournament.id}`]);
    const entrants = await client.query(
      `select user_id from rec_site_tournament_entrants where tournament_id = $1 and entry_status = 'approved' order by joined_at`,
      [tournament.id],
    );
    const userIds = entrants.rows.map((r) => String(r.user_id));
    if (!userIds.length) throw new ApiError(409, "No approved entrants to draw.");
    const order = shuffle(userIds);
    await client.query(
      `
        insert into rec_site_tournament_lotteries
          (tournament_id, status, draw_order, current_position, current_pick_deadline_at, updated_at)
        values ($1, 'picking', $2, 1, $3, now())
        on conflict (tournament_id) do update set
          status = 'picking', draw_order = excluded.draw_order, current_position = 1,
          current_pick_deadline_at = excluded.current_pick_deadline_at, updated_at = now()
      `,
      [tournament.id, order, new Date(Date.now() + PICK_WINDOW_MS).toISOString()],
    );
    await client.query("commit");
    await notify(
      [order[0]],
      `You're on the clock: ${tournament.title}`,
      "The lottery order is set — pick your team within 2 hours.",
      `/tournaments/${tournament.id}`,
    );
    return getTournamentLottery(input);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function advanceToNextPicker(tournamentId: string, tournamentTitle: string, lottery: LotteryRow) {
  const order = lottery.draw_order ?? [];
  const nextPosition = (lottery.current_position ?? 0) + 1;
  if (nextPosition > order.length) {
    await getPgPool().query(
      `
        update rec_site_tournament_lotteries
        set status = 'open_pool', current_position = null, current_pick_deadline_at = null,
            open_pool_started_at = now(), open_pool_deadline_at = $2, updated_at = now()
        where tournament_id = $1
      `,
      [tournamentId, new Date(Date.now() + OPEN_POOL_WINDOW_MS).toISOString()],
    );
    const skipped = await getPgPool().query(
      `select user_id from rec_site_tournament_lottery_skips where tournament_id = $1 and resolved_at is null`,
      [tournamentId],
    );
    const skippedUserIds = skipped.rows.map((r) => String(r.user_id));
    if (skippedUserIds.length) {
      await notify(
        skippedUserIds,
        `Open pool: ${tournamentTitle}`,
        "Pick order is done. Grab any remaining team within 1 hour before we auto-assign.",
        `/tournaments/${tournamentId}`,
      );
    }
    return;
  }
  await getPgPool().query(
    `
      update rec_site_tournament_lotteries
      set current_position = $2, current_pick_deadline_at = $3, updated_at = now()
      where tournament_id = $1
    `,
    [tournamentId, nextPosition, new Date(Date.now() + PICK_WINDOW_MS).toISOString()],
  );
  await notify(
    [order[nextPosition - 1]],
    `You're on the clock: ${tournamentTitle}`,
    "It's your turn to pick a team — you have 2 hours.",
    `/tournaments/${tournamentId}`,
  );
}

export async function assignLotteryTeam(input: {
  tournamentId: string; adminRecUserId: string; userId: string; teamAbbr: string; gamerTag: string;
}) {
  const tournament = await loadTournamentForLottery(input.tournamentId);
  const lottery = await loadLottery(input.tournamentId);
  if (!lottery || (lottery.status !== "picking" && lottery.status !== "open_pool")) {
    throw new ApiError(409, "The lottery isn't currently picking.");
  }
  await addTournamentUser({
    recUserId: input.adminRecUserId, tournamentId: input.tournamentId, userId: input.userId,
    teamAbbr: input.teamAbbr, gamerTag: input.gamerTag, into: "tournament",
  });
  if (lottery.status === "picking") {
    await advanceToNextPicker(input.tournamentId, tournament.title, lottery);
  } else {
    await getPgPool().query(
      `update rec_site_tournament_lottery_skips set resolved_at = now() where tournament_id = $1 and user_id = $2 and resolved_at is null`,
      [input.tournamentId, input.userId],
    );
  }
  return getTournamentLottery(input);
}

export async function pickLotteryTeam(input: { tournamentId: string; recUserId: string; teamAbbr: string; gamerTag: string }) {
  const lottery = await loadLottery(input.tournamentId);
  if (!lottery) throw new ApiError(409, "The lottery hasn't started.");
  const order = lottery.draw_order ?? [];
  const isCurrentPicker = lottery.status === "picking" && lottery.current_position
    ? order[lottery.current_position - 1] === input.recUserId
    : false;
  let isOpenPoolPicker = false;
  if (lottery.status === "open_pool") {
    const skip = await getPgPool().query(
      `select 1 from rec_site_tournament_lottery_skips where tournament_id = $1 and user_id = $2 and resolved_at is null`,
      [input.tournamentId, input.recUserId],
    );
    isOpenPoolPicker = Boolean(skip.rows[0]);
  }
  if (!isCurrentPicker && !isOpenPoolPicker) throw new ApiError(409, "It's not your turn to pick.");
  return assignLotteryTeam({
    tournamentId: input.tournamentId, adminRecUserId: input.recUserId, userId: input.recUserId,
    teamAbbr: input.teamAbbr, gamerTag: input.gamerTag,
  });
}

export async function skipLotteryPick(input: { tournamentId: string }) {
  const tournament = await loadTournamentForLottery(input.tournamentId);
  const lottery = await loadLottery(input.tournamentId);
  if (!lottery || lottery.status !== "picking" || !lottery.current_position || !lottery.draw_order) {
    throw new ApiError(409, "There's no active pick to skip.");
  }
  const userId = lottery.draw_order[lottery.current_position - 1];
  await getPgPool().query(
    `insert into rec_site_tournament_lottery_skips (tournament_id, user_id) values ($1, $2) on conflict (tournament_id, user_id) do nothing`,
    [input.tournamentId, userId],
  );
  await advanceToNextPicker(input.tournamentId, tournament.title, lottery);
  return getTournamentLottery(input);
}

async function concludeLotteryOpenPool(tournamentId: string) {
  await loadTournamentForLottery(tournamentId);
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`tournament-lottery:${tournamentId}`]);
    const unresolved = await client.query(
      `select user_id from rec_site_tournament_lottery_skips where tournament_id = $1 and resolved_at is null`,
      [tournamentId],
    );
    const userIds = unresolved.rows.map((r) => String(r.user_id));
    if (userIds.length) {
      const claimed = await client.query(
        `select team_abbr from rec_site_tournament_entrants where tournament_id = $1 and team_abbr is not null`,
        [tournamentId],
      );
      const claimedAbbrs = new Set(claimed.rows.map((r) => String(r.team_abbr)));
      const { tournamentTeamsForGame } = await import("./tournaments.service.js");
      const tournamentGame = await client.query(`select game from rec_site_tournaments where id = $1`, [tournamentId]);
      const allTeams = tournamentTeamsForGame(String(tournamentGame.rows[0]?.game ?? "madden_27"));
      const openTeams = shuffle(allTeams.filter((t) => !claimedAbbrs.has(t.abbr)));
      const assignCount = Math.min(userIds.length, openTeams.length);
      const shuffledUsers = shuffle(userIds).slice(0, assignCount);
      for (let i = 0; i < assignCount; i += 1) {
        await client.query(
          `
            insert into rec_site_tournament_entrants (tournament_id, user_id, team_abbr, team_name, gamer_tag, entry_status)
            values ($1, $2, $3, $4, 'Assigned by lottery', 'approved')
            on conflict (tournament_id, user_id) do update set team_abbr = excluded.team_abbr, team_name = excluded.team_name, entry_status = 'approved'
          `,
          [tournamentId, shuffledUsers[i], openTeams[i].abbr, openTeams[i].name],
        );
        await client.query(
          `update rec_site_tournament_lottery_skips set resolved_at = now() where tournament_id = $1 and user_id = $2`,
          [tournamentId, shuffledUsers[i]],
        );
      }
    }
    await client.query(
      `update rec_site_tournament_lotteries set status = 'completed', updated_at = now() where tournament_id = $1`,
      [tournamentId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runTournamentLotterySweep() {
  const result = await getPgPool().query(
    `select tournament_id, status, scheduled_at, notified_30min_at, notified_10min_at, notified_1min_at,
            current_pick_deadline_at, open_pool_deadline_at
     from rec_site_tournament_lotteries
     where status not in ('not_scheduled', 'completed')`,
  );
  for (const row of result.rows as Array<{
    tournament_id: string; status: LotteryRow["status"]; scheduled_at: string | null;
    notified_30min_at: string | null; notified_10min_at: string | null; notified_1min_at: string | null;
    current_pick_deadline_at: string | null; open_pool_deadline_at: string | null;
  }>) {
    try {
      if (row.status === "scheduled" && row.scheduled_at) {
        const minutesUntil = (new Date(row.scheduled_at).getTime() - Date.now()) / 60000;
        const tournament = await loadTournamentForLottery(row.tournament_id).catch(() => null);
        if (!tournament) continue;
        const userIds = await approvedEntrantUserIds(row.tournament_id);
        if (minutesUntil <= 30 && !row.notified_30min_at && userIds.length) {
          await notify(userIds, `Lottery starting soon: ${tournament.title}`, "Draw order will be picked in about 30 minutes.", `/tournaments/${row.tournament_id}`);
          await getPgPool().query(`update rec_site_tournament_lotteries set notified_30min_at = now() where tournament_id = $1`, [row.tournament_id]);
        }
        if (minutesUntil <= 10 && !row.notified_10min_at && userIds.length) {
          await notify(userIds, `Lottery starting soon: ${tournament.title}`, "Draw order will be picked in about 10 minutes.", `/tournaments/${row.tournament_id}`);
          await getPgPool().query(`update rec_site_tournament_lotteries set notified_10min_at = now() where tournament_id = $1`, [row.tournament_id]);
        }
        if (minutesUntil <= 1 && !row.notified_1min_at && userIds.length) {
          await notify(userIds, `Lottery starting soon: ${tournament.title}`, "Draw order will be picked in about a minute.", `/tournaments/${row.tournament_id}`);
          await getPgPool().query(`update rec_site_tournament_lotteries set notified_1min_at = now() where tournament_id = $1`, [row.tournament_id]);
        }
        if (minutesUntil <= 0) {
          await runTournamentLotteryNow({ tournamentId: row.tournament_id }).catch((error) =>
            console.error("[ERROR] tournament lottery: failed to auto-run (non-fatal):", error));
        }
        continue;
      }
      if (row.status === "picking" && row.current_pick_deadline_at && new Date(row.current_pick_deadline_at).getTime() <= Date.now()) {
        await skipLotteryPick({ tournamentId: row.tournament_id }).catch((error) =>
          console.error("[ERROR] tournament lottery: failed to auto-skip (non-fatal):", error));
        continue;
      }
      if (row.status === "open_pool" && row.open_pool_deadline_at && new Date(row.open_pool_deadline_at).getTime() <= Date.now()) {
        await concludeLotteryOpenPool(row.tournament_id).catch((error) =>
          console.error("[ERROR] tournament lottery: failed to conclude open pool (non-fatal):", error));
      }
    } catch (error) {
      console.error("[ERROR] tournament lottery sweep: failed for tournament (non-fatal):", row.tournament_id, error);
    }
  }
}
