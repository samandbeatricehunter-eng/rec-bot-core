// League Records: statistical bests computed live from the league's data-mode source
// (EA/companion rec_player_weekly_stats for import leagues; rec_game_performance_tags for
// box-score and manual leagues). Three scopes:
//   game    — the single best individual week for each stat key.
//   season  — summed across the current season's qualifying weeks, ranked per player.
//   career  — summed across every season on record, ranked per player.
import { getPgPool } from "../../db/client.js";
import { invalidateLeagueComputeCaches } from "../../lib/compute-cache.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague, getCurrentLeagueContext, siteOnlyGuildId } from "../league-context/league-context.service.js";
import { invalidateLeagueStatsCache } from "../league-stats/league-stats.service.js";
import { PLAYER_CONTEXT_JOINS, PLAYER_CONTEXT_SELECT, playerWeeklyCellsSql } from "../league-stats/player-stat-source.js";
import { getLeagueDataMode, type LeagueDataMode } from "../league-week/data-mode.service.js";
import {
  attachDerivedPlayerStats,
  getStatLabel,
  isRegularSeasonWeek,
  maxSeasonWeek,
  recordStatKeysForPageCategory,
  STAT_PAGE_CATEGORIES,
  type LeagueGame,
  type StatPageCategoryKey,
} from "@rec/shared";

export { importedStatsNeedFinalize } from "./league-records.finalize.js";

export type LeagueRecordsScope = "game" | "season" | "career";

export type LeagueRecordsLeader = {
  playerId: string;
  playerName: string;
  position: string | null;
  photoUrl: string | null;
  teamName: string | null;
  teamAbbreviation: string | null;
  userName: string | null;
  userId: string | null;
  teamId: string | null;
  value: number;
  weekNumber: number | null;
  seasonNumber: number | null;
  rank: number;
  opponentTeamName: string | null;
  opponentTeamAbbreviation: string | null;
  opponentUserName: string | null;
  result: string | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
};

export type LeagueRecordsResult = {
  league: { id: string; name: string; game: string; season_number: number };
  categories: Array<{ key: string; label: string }>;
  records: Array<{
    statKey: string;
    label: string;
    leaders: LeagueRecordsLeader[];
  }>;
};

function qualifyingWeeks(game: LeagueGame, postseason: boolean): number[] {
  const weeks: number[] = [];
  for (let week = 1; week <= maxSeasonWeek(game); week++) {
    if (isRegularSeasonWeek(week, game) !== postseason) weeks.push(week);
  }
  return weeks;
}

function mapLeaderRow(row: any): LeagueRecordsLeader {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    position: row.position ?? null,
    photoUrl: row.photo_url ?? null,
    teamName: row.team_name ?? null,
    teamAbbreviation: row.team_abbreviation ?? null,
    userName: row.user_name ?? null,
    userId: row.user_id ?? null,
    teamId: row.team_id ?? null,
    value: Number(row.value),
    weekNumber: row.week_number ?? null,
    seasonNumber: row.season_number ?? null,
    rank: Number(row.rank),
    opponentTeamName: row.opponent_team_name ?? null,
    opponentTeamAbbreviation: row.opponent_team_abbreviation ?? null,
    opponentUserName: row.opponent_user_name ?? null,
    result: row.result ?? null,
    pointsFor: row.points_for != null ? Number(row.points_for) : null,
    pointsAgainst: row.points_against != null ? Number(row.points_against) : null,
  };
}

const PASSING_QBR_KEYS = [
  "pass_attempts", "pass_completions", "pass_yards", "pass_tds", "interceptions_thrown", "passer_rating",
];

async function loadQbrLeaders(
  leagueId: string,
  dataMode: LeagueDataMode,
  input: { scope: LeagueRecordsScope; weeks: number[]; seasonNumber: number },
): Promise<LeagueRecordsLeader[]> {
  const params: unknown[] = [leagueId, input.weeks];
  let extraWhere = " and s.week_number = any($2::int[])";
  if (input.scope !== "career") {
    params.push(input.seasonNumber);
    extraWhere += ` and s.season_number = $${params.length}`;
  }
  const cells = playerWeeklyCellsSql(dataMode, { leagueParam: "$1", extraWhere });
  const result = await getPgPool().query<{
    player_id: string; team_id: string | null; week_number: number | null; season_number: number | null;
    key: string; value: number;
  }>(
    `select player_id, team_id, week_number, season_number, key, value
       from (${cells}) cells
      where player_id is not null and key = any($${params.length + 1}::text[])`,
    [...params, PASSING_QBR_KEYS],
  );

  type Group = {
    player_id: string; team_id: string | null; week_number: number | null; season_number: number | null;
    latestWeek: number; stats: Record<string, number>;
  };
  const groups = new Map<string, Group>();
  for (const row of result.rows) {
    const groupKey = input.scope === "game"
      ? `${row.player_id}:${row.week_number}:${row.season_number}`
      : row.player_id;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        player_id: row.player_id,
        team_id: row.team_id,
        week_number: input.scope === "game" ? row.week_number : null,
        season_number: input.scope === "game" ? row.season_number : (input.scope === "season" ? input.seasonNumber : null),
        latestWeek: Number(row.week_number ?? 0),
        stats: {},
      };
      groups.set(groupKey, group);
    }
    group.stats[row.key] = (group.stats[row.key] ?? 0) + Number(row.value);
    const week = Number(row.week_number ?? 0);
    if (week >= group.latestWeek && row.team_id) {
      group.latestWeek = week;
      group.team_id = row.team_id;
    }
  }

  const minAttempts = input.scope === "game" ? 1 : 10;
  const scored = [...groups.values()]
    .map((group) => {
      const derived = attachDerivedPlayerStats(group.stats);
      return { ...group, value: derived.qbr ?? null };
    })
    .filter((row): row is Group & { value: number } => row.value != null && Number(row.stats.pass_attempts ?? 0) >= minAttempts)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  if (!scored.length) return [];

  const context = await getPgPool().query(
    `select r.player_id, r.team_id, r.value, r.rank, r.week_number, r.season_number,
            coalesce(tgs.user_id, pa.user_id) as user_id,
            ${PLAYER_CONTEXT_SELECT}
       from (
         select u.player_id, u.team_id, u.value, u.rank, u.week_number, u.season_number
           from unnest($2::uuid[], $3::uuid[], $4::numeric[], $5::int[], $6::int[], $7::int[])
             as u(player_id, team_id, value, rank, week_number, season_number)
       ) r
       ${PLAYER_CONTEXT_JOINS}
      where coalesce(p.full_name, w.player_name) is not null
      order by r.rank`,
    [
      leagueId,
      scored.map((row) => row.player_id),
      scored.map((row) => row.team_id),
      scored.map((row) => row.value),
      scored.map((row) => row.rank),
      scored.map((row) => row.week_number),
      scored.map((row) => row.season_number),
    ],
  );
  return context.rows.map(mapLeaderRow);
}

export async function getLeagueRecordsForLeagueId(
  leagueId: string,
  input: { scope: LeagueRecordsScope; postseason: boolean; category: StatPageCategoryKey },
): Promise<LeagueRecordsResult> {
  const leagueResult = await getPgPool().query<{ id: string; name: string; game: string; season_number: number }>(
    "select id,name,game,season_number from rec_leagues where id=$1", [leagueId],
  );
  const league = leagueResult.rows[0];
  if (!league) throw new ApiError(404, "League not found.");

  const dataMode = await getLeagueDataMode(leagueId);
  const statKeys = recordStatKeysForPageCategory(input.category).filter((key) => key !== "qbr");
  const categories = STAT_PAGE_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
  const weeks = qualifyingWeeks(league.game as LeagueGame, input.postseason);
  if (!weeks.length) return { league, categories, records: [] };

  const params: unknown[] = [leagueId, weeks];
  let extraWhere = " and s.week_number = any($2::int[])";
  if (input.scope !== "career") {
    params.push(league.season_number);
    extraWhere += ` and s.season_number = $${params.length}`;
  }
  params.push(statKeys);
  const keyParam = `$${params.length}`;
  const cells = playerWeeklyCellsSql(dataMode, { leagueParam: "$1", extraWhere });

  const query = input.scope === "game"
    ? `
      with cells as (${cells}),
      weekly as (
        select player_id, team_id, week_number, season_number, key, value
        from cells
        where player_id is not null and key = any(${keyParam}::text[])
      ), ranked as (
        select key, player_id, team_id, week_number, season_number, value,
               row_number() over (partition by key order by value desc) as rank
        from weekly
      )
      select r.key, r.value, r.week_number, r.season_number, r.rank, r.team_id,
             coalesce(tgs.user_id, pa.user_id) as user_id, ${PLAYER_CONTEXT_SELECT}
      from ranked r ${PLAYER_CONTEXT_JOINS}
      where r.rank <= 10 and coalesce(p.full_name, w.player_name) is not null
      order by r.key, r.rank
    `
    : `
      with cells as (${cells}),
      weekly as (
        select player_id, team_id, key, value
        from cells
        where player_id is not null and key = any(${keyParam}::text[])
      ), totals as (
        select key, player_id, (array_agg(team_id))[1] as team_id, sum(value) as value from weekly group by key, player_id
      ), ranked as (
        select key, player_id, team_id, value, null::int as week_number, null::int as season_number,
               row_number() over (partition by key order by value desc) as rank
        from totals
      )
      select r.key, r.value, r.week_number, r.season_number, r.rank, r.team_id,
             coalesce(tgs.user_id, pa.user_id) as user_id, ${PLAYER_CONTEXT_SELECT}
      from ranked r ${PLAYER_CONTEXT_JOINS}
      where r.rank <= 10 and coalesce(p.full_name, w.player_name) is not null
      order by r.key, r.rank
    `;

  const result = statKeys.length
    ? await getPgPool().query(query, params)
    : { rows: [] as any[] };
  const byKey = new Map<string, LeagueRecordsLeader[]>();
  for (const row of result.rows as any[]) {
    const list = byKey.get(row.key) ?? [];
    list.push(mapLeaderRow(row));
    byKey.set(row.key, list);
  }

  if (input.category === "passing") {
    const qbrLeaders = await loadQbrLeaders(leagueId, dataMode, {
      scope: input.scope, weeks, seasonNumber: league.season_number,
    });
    if (qbrLeaders.length) byKey.set("qbr", qbrLeaders);
  }

  const records = recordStatKeysForPageCategory(input.category)
    .filter((key) => byKey.has(key))
    .map((key) => ({ statKey: key, label: getStatLabel(key), leaders: byKey.get(key)! }));

  return { league, categories, records };
}

export async function getLeagueRecords(guildId: string, input: { scope: LeagueRecordsScope; postseason: boolean; category: StatPageCategoryKey }) {
  const context = await getCurrentLeagueContext(guildId);
  return getLeagueRecordsForLeagueId(context.leagueId, input);
}

const ALL_STAT_KEYS = [...new Set(STAT_PAGE_CATEGORIES.flatMap((c) => recordStatKeysForPageCategory(c.key)))]
  .filter((key) => key !== "qbr");

/**
 * After an EA / Companion import that wrote weekly player stats, team stats, or
 * schedule results: recompute who currently holds each league record, then drop
 * the hub's short-TTL power-ranking / SOS / user-rating caches so the hero card
 * and GOTW matchup ranks pick up the new lines immediately.
 *
 * Does not pay record-holding bonuses — those only run at end-of-season via
 * payLeagueRecordHoldingBonuses, and they pay whoever holds the record at that
 * moment (not whoever set it mid-season and later lost it).
 */
export async function finalizeImportedLeagueStats(leagueId: string): Promise<void> {
  await refreshLeagueRecordHolders(leagueId);
  invalidateLeagueStatsCache(leagueId);
  const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
  const guildIds = new Set<string>([siteOnlyGuildId(leagueId)]);
  if (routes?.guildId) guildIds.add(routes.guildId);
  for (const guildId of guildIds) invalidateLeagueComputeCaches(guildId);
}

async function upsertRecordHolder(input: {
  leagueId: string; scope: LeagueRecordsScope; postseason: boolean; statKey: string;
  playerId: string; userId: string | null; teamId: string | null; value: number;
  seasonNumber: number | null; weekNumber: number | null;
}): Promise<void> {
  await getPgPool().query(
    `insert into rec_league_record_holders
       (league_id, scope, postseason, stat_key, player_id, user_id, team_id, value, season_number, week_number, set_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
     on conflict (league_id, scope, postseason, stat_key) do update
       set player_id = excluded.player_id, user_id = excluded.user_id, team_id = excluded.team_id,
           value = excluded.value, season_number = excluded.season_number, week_number = excluded.week_number,
           set_at = now(), updated_at = now()
     where excluded.value > rec_league_record_holders.value`,
    [input.leagueId, input.scope, input.postseason, input.statKey, input.playerId, input.userId, input.teamId, input.value, input.seasonNumber, input.weekNumber],
  );
}

/**
 * Recomputes the #1 leader for every stat key, at game+season+career scope and both
 * regular-season/postseason, and upserts rec_league_record_holders — but only replaces an
 * existing holder when the new value is strictly greater (a real broken record), never on a
 * tie or a lower value. Call this after anything that can change the underlying weekly stats:
 * a Madden EA / Companion import (player_stats, team_stats, or schedule), or a CFB box-score
 * approval. Import callers should use finalizeImportedLeagueStats so hub ranks refresh too.
 */
export async function refreshLeagueRecordHolders(leagueId: string): Promise<void> {
  const leagueResult = await getPgPool().query<{ id: string; game: string; season_number: number }>(
    "select id,game,season_number from rec_leagues where id=$1", [leagueId],
  );
  const league = leagueResult.rows[0];
  if (!league || !ALL_STAT_KEYS.length) return;
  const dataMode = await getLeagueDataMode(leagueId);

  for (const scope of ["game", "season", "career"] as LeagueRecordsScope[]) {
    for (const postseason of [false, true]) {
      const weeks = qualifyingWeeks(league.game as LeagueGame, postseason);
      if (!weeks.length) continue;

      const params: unknown[] = [leagueId, weeks];
      let extraWhere = " and s.week_number = any($2::int[])";
      if (scope !== "career") {
        params.push(league.season_number);
        extraWhere += ` and s.season_number = $${params.length}`;
      }
      params.push(ALL_STAT_KEYS);
      const keyParam = `$${params.length}`;
      const cells = playerWeeklyCellsSql(dataMode, { leagueParam: "$1", extraWhere });
      const query = scope === "game"
        ? `
          with cells as (${cells}),
          weekly as (
            select player_id, week_number, season_number, key, value
            from cells
            where player_id is not null and key = any(${keyParam}::text[])
          ), top as (
            select distinct on (key) key, player_id, week_number, season_number, value
            from weekly order by key, value desc
          )
          select t.key, t.value, t.week_number, t.season_number, t.player_id,
                 p.team_id,
                 (select ta.user_id from rec_team_assignments ta
                   where ta.team_id = p.team_id and ta.assignment_status = 'active' and ta.ended_at is null limit 1) as user_id
          from top t
          join rec_players p on p.id = t.player_id
        `
        : `
          with cells as (${cells}),
          weekly as (
            select player_id, key, value
            from cells
            where player_id is not null and key = any(${keyParam}::text[])
          ), totals as (
            select key, player_id, sum(value) as value from weekly group by key, player_id
          ), top as (
            select distinct on (key) key, player_id, value from totals order by key, value desc
          )
          select t.key, t.value, null::int as week_number, null::int as season_number, t.player_id,
                 p.team_id,
                 (select ta.user_id from rec_team_assignments ta
                   where ta.team_id = p.team_id and ta.assignment_status = 'active' and ta.ended_at is null limit 1) as user_id
          from top t
          join rec_players p on p.id = t.player_id
        `;
      const result = await getPgPool().query(query, params);
      for (const row of result.rows as any[]) {
        await upsertRecordHolder({
          leagueId, scope, postseason, statKey: row.key,
          playerId: row.player_id, userId: row.user_id, teamId: row.team_id,
          value: row.value, seasonNumber: row.season_number, weekNumber: row.week_number,
        });
      }

      const qbrLeaders = await loadQbrLeaders(leagueId, dataMode, {
        scope, weeks, seasonNumber: league.season_number,
      });
      const topQbr = qbrLeaders[0];
      if (topQbr) {
        const roster = await getPgPool().query("select 1 from rec_players where id=$1", [topQbr.playerId]);
        if (roster.rowCount) {
          await upsertRecordHolder({
            leagueId, scope, postseason, statKey: "qbr",
            playerId: topQbr.playerId, userId: topQbr.userId, teamId: topQbr.teamId,
            value: topQbr.value, seasonNumber: topQbr.seasonNumber, weekNumber: topQbr.weekNumber,
          });
        }
      }
    }
  }
}

const RECORD_HOLDING_BONUS_COINS = 500;

/**
 * Season-end only: pays RECORD_HOLDING_BONUS_COINS to whoever currently holds each
 * game/season record. Mid-season imports that set or break a record must not call this —
 * the bonus is issued at EOS to the current holder, not to whoever first set the mark.
 * Career records aren't season-bound, so they're excluded from the recurring bonus.
 * Re-paid every season the same coach still holds a given record, per the confirmed spec:
 * set it in Season 1, still hold it at the end of Season 2, get paid again. Idempotent via
 * rec_league_record_bonus_payouts' unique constraint — safe to call more than once for the
 * same season.
 */
export async function payLeagueRecordHoldingBonuses(leagueId: string, seasonNumber: number): Promise<{ paid: number; totalCoins: number }> {
  const holders = await getPgPool().query<{
    scope: "game" | "season"; postseason: boolean; stat_key: string; user_id: string | null;
  }>(
    `select scope, postseason, stat_key, user_id from rec_league_record_holders
     where league_id = $1 and scope in ('game','season') and user_id is not null`,
    [leagueId],
  );

  let paid = 0;
  let totalCoins = 0;
  for (const holder of holders.rows) {
    const inserted = await getPgPool().query(
      `insert into rec_league_record_bonus_payouts (league_id, season_number, scope, postseason, stat_key, user_id, amount)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (league_id, season_number, scope, postseason, stat_key) do nothing
       returning id`,
      [leagueId, seasonNumber, holder.scope, holder.postseason, holder.stat_key, holder.user_id, RECORD_HOLDING_BONUS_COINS],
    );
    if (!inserted.rowCount) continue;
    const credit = await supabase.rpc("add_to_wallet", {
      p_user_id: holder.user_id,
      p_amount: RECORD_HOLDING_BONUS_COINS,
      p_league_id: leagueId,
      p_description: `League record bonus: ${getStatLabel(holder.stat_key)} (${holder.postseason ? "postseason " : ""}${holder.scope})`,
      p_transaction_type: "record_holding_bonus",
      p_source: "league_record",
      p_source_reference: { leagueId, seasonNumber, statKey: holder.stat_key, scope: holder.scope, postseason: holder.postseason },
    });
    if (credit.error) {
      console.error("[ERROR] Failed to credit league record holding bonus:", credit.error);
      continue;
    }
    paid += 1;
    totalCoins += RECORD_HOLDING_BONUS_COINS;
  }
  return { paid, totalCoins };
}
