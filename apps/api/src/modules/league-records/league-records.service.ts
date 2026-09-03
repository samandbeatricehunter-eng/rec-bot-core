// League Records: statistical bests (most passing yards in a game, most rushing TDs in a
// season, most career interceptions, etc.) computed live from rec_player_weekly_stats — the
// same per-week per-player stat cells LeagueStatsHome reads (see league-stats.service.ts's
// numeric_stats CTE, which this mirrors). Three scopes:
//   game    — the single best individual week for each stat key.
//   season  — summed across the current season's qualifying weeks, ranked per player.
//   career  — summed across every season on record, ranked per player.
// "Postseason" toggles between regular-season and postseason weeks, using the same
// isRegularSeasonWeek/maxSeasonWeek helpers the rest of the app uses for week-type gating —
// there's no separate "is this week postseason" column to duplicate in SQL.
import { getPgPool } from "../../db/client.js";
import { invalidateLeagueComputeCaches, withComputeCache } from "../../lib/compute-cache.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague, getCurrentLeagueContext, siteOnlyGuildId } from "../league-context/league-context.service.js";
import { invalidateLeagueStatsCache } from "../league-stats/league-stats.service.js";
import {
  getStatLabel,
  isRegularSeasonWeek,
  maxSeasonWeek,
  statKeysForPageCategory,
  STAT_PAGE_CATEGORIES,
  type LeagueGame,
  type StatPageCategoryKey,
} from "@rec/shared";

export { importedStatsNeedFinalize } from "./league-records.finalize.js";

export type LeagueRecordsScope = "game" | "season" | "career";

export type LeagueRecordsResult = {
  league: { id: string; name: string; game: string; season_number: number };
  categories: Array<{ key: string; label: string }>;
  records: Array<{
    statKey: string;
    label: string;
    leaders: Array<{
      playerId: string;
      playerName: string;
      position: string | null;
      teamName: string | null;
      teamAbbreviation: string | null;
      value: number;
      weekNumber: number | null;
      seasonNumber: number | null;
      rank: number;
    }>;
  }>;
};

function qualifyingWeeks(game: LeagueGame, postseason: boolean): number[] {
  const weeks: number[] = [];
  for (let week = 1; week <= maxSeasonWeek(game); week++) {
    if (isRegularSeasonWeek(week, game) !== postseason) weeks.push(week);
  }
  return weeks;
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

  const statKeys = statKeysForPageCategory(input.category);
  const categories = STAT_PAGE_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
  if (!statKeys.length) return { league, categories, records: [] };

  const weeks = qualifyingWeeks(league.game as LeagueGame, input.postseason);
  if (!weeks.length) return { league, categories, records: [] };

  const params: unknown[] = [leagueId, weeks];
  let seasonFilter = "";
  if (input.scope !== "career") {
    params.push(league.season_number);
    seasonFilter = ` and s.season_number = $${params.length}`;
  }
  params.push(statKeys);
  const keyFilter = `e.key = any($${params.length})`;

  // "game" scope ranks individual player-weeks directly (no aggregation); "season"/"career"
  // sum each player's qualifying weeks first, then rank the totals.
  const query = input.scope === "game"
    ? `
      with weekly as (
        select s.player_id, s.week_number, s.season_number, e.key, e.value::numeric as value
        from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
        where s.league_id = $1 and s.week_number = any($2::int[]) and ${keyFilter}
          and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'${seasonFilter}
      ), ranked as (
        select key, player_id, week_number, season_number, value,
               row_number() over (partition by key order by value desc) as rank
        from weekly
      )
      select r.key, r.value, r.week_number, r.season_number, r.rank,
             p.full_name as player_name, p.position, t.name as team_name, t.abbreviation as team_abbreviation, p.id as player_id
      from ranked r join rec_players p on p.id = r.player_id left join rec_teams t on t.id = p.team_id
      where r.rank <= 10
      order by r.key, r.rank
    `
    : `
      with weekly as (
        select s.player_id, e.key, e.value::numeric as value
        from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
        where s.league_id = $1 and s.week_number = any($2::int[]) and ${keyFilter}
          and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'${seasonFilter}
      ), totals as (
        select key, player_id, sum(value) as value from weekly group by key, player_id
      ), ranked as (
        select key, player_id, value,
               row_number() over (partition by key order by value desc) as rank
        from totals
      )
      select r.key, r.value, null::int as week_number, null::int as season_number, r.rank,
             p.full_name as player_name, p.position, t.name as team_name, t.abbreviation as team_abbreviation, p.id as player_id
      from ranked r join rec_players p on p.id = r.player_id left join rec_teams t on t.id = p.team_id
      where r.rank <= 10
      order by r.key, r.rank
    `;

  const result = await getPgPool().query(query, params);
  const byKey = new Map<string, LeagueRecordsResult["records"][number]["leaders"]>();
  for (const row of result.rows as any[]) {
    const list = byKey.get(row.key) ?? [];
    list.push({
      playerId: row.player_id,
      playerName: row.player_name,
      position: row.position,
      teamName: row.team_name,
      teamAbbreviation: row.team_abbreviation,
      value: Number(row.value),
      weekNumber: row.week_number,
      seasonNumber: row.season_number,
      rank: Number(row.rank),
    });
    byKey.set(row.key, list);
  }

  const records = statKeys
    .filter((key) => byKey.has(key))
    .map((key) => ({ statKey: key, label: getStatLabel(key), leaders: byKey.get(key)! }));

  return { league, categories, records };
}

export async function getLeagueRecords(guildId: string, input: { scope: LeagueRecordsScope; postseason: boolean; category: StatPageCategoryKey }) {
  const context = await getCurrentLeagueContext(guildId);
  return withComputeCache(
    `league-records:${guildId}:${input.scope}:${input.postseason}:${input.category}`,
    60_000,
    () => getLeagueRecordsForLeagueId(context.leagueId, input),
  );
}

const ALL_STAT_KEYS = [...new Set(STAT_PAGE_CATEGORIES.flatMap((c) => statKeysForPageCategory(c.key)))];

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

  for (const scope of ["game", "season", "career"] as LeagueRecordsScope[]) {
    for (const postseason of [false, true]) {
      const weeks = qualifyingWeeks(league.game as LeagueGame, postseason);
      if (!weeks.length) continue;

      const params: unknown[] = [leagueId, weeks, ALL_STAT_KEYS];
      let seasonFilter = "";
      if (scope !== "career") {
        params.push(league.season_number);
        seasonFilter = ` and s.season_number = $${params.length}`;
      }
      const query = scope === "game"
        ? `
          with weekly as (
            select s.player_id, s.week_number, s.season_number, e.key, e.value::numeric as value
            from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
            where s.league_id = $1 and s.week_number = any($2::int[]) and e.key = any($3)
              and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'${seasonFilter}
          ), top as (
            select distinct on (key) key, player_id, week_number, season_number, value
            from weekly order by key, value desc
          )
          select t.key, t.value, t.week_number, t.season_number, t.player_id, p.team_id,
                 (select ta.user_id from rec_team_assignments ta where ta.team_id = p.team_id and ta.assignment_status = 'active' and ta.ended_at is null limit 1) as user_id
          from top t join rec_players p on p.id = t.player_id
        `
        : `
          with weekly as (
            select s.player_id, e.key, e.value::numeric as value
            from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
            where s.league_id = $1 and s.week_number = any($2::int[]) and e.key = any($3)
              and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'${seasonFilter}
          ), totals as (
            select key, player_id, sum(value) as value from weekly group by key, player_id
          ), top as (
            select distinct on (key) key, player_id, value from totals order by key, value desc
          )
          select t.key, t.value, null::int as week_number, null::int as season_number, t.player_id, p.team_id,
                 (select ta.user_id from rec_team_assignments ta where ta.team_id = p.team_id and ta.assignment_status = 'active' and ta.ended_at is null limit 1) as user_id
          from top t join rec_players p on p.id = t.player_id
        `;
      const result = await getPgPool().query(query, params);
      for (const row of result.rows as any[]) {
        await getPgPool().query(
          `insert into rec_league_record_holders
             (league_id, scope, postseason, stat_key, player_id, user_id, team_id, value, season_number, week_number, set_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
           on conflict (league_id, scope, postseason, stat_key) do update
             set player_id = excluded.player_id, user_id = excluded.user_id, team_id = excluded.team_id,
                 value = excluded.value, season_number = excluded.season_number, week_number = excluded.week_number,
                 set_at = now(), updated_at = now()
           where excluded.value > rec_league_record_holders.value`,
          [leagueId, scope, postseason, row.key, row.player_id, row.user_id, row.team_id, row.value, row.season_number, row.week_number],
        );
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
