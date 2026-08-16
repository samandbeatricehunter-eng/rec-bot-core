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
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  getStatLabel,
  isRegularSeasonWeek,
  maxSeasonWeek,
  statKeysForPageCategory,
  STAT_PAGE_CATEGORIES,
  type LeagueGame,
  type StatPageCategoryKey,
} from "@rec/shared";

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
  return getLeagueRecordsForLeagueId(context.leagueId, input);
}
