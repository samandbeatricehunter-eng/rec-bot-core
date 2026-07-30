import { getPgPool } from "../../db/client.js";

// node-postgres parses a `date` column as a JS Date at local-server midnight for that calendar
// day — .toISOString() would shift it to the wrong day whenever the server's UTC offset is
// negative (e.g. US timezones). Read the calendar fields back out in local time instead.
function dateOnlyString(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const RANKED_GAMES = ["madden_26", "madden_27", "cfb_27"] as const;
export type RankedGame = (typeof RANKED_GAMES)[number];

const GAME_LABELS: Record<string, string> = {
  madden_26: "Madden 26",
  madden_27: "Madden 27",
  cfb_27: "CFB 27",
};

export function dynastyLabelForGame(game: string): string {
  return game.startsWith("madden") ? "Franchise" : "Dynasty";
}

export function listRankedGames(): Array<{ game: string; label: string; dynastyLabel: string }> {
  return RANKED_GAMES.map((game) => ({
    game,
    label: GAME_LABELS[game] ?? game,
    dynastyLabel: dynastyLabelForGame(game),
  }));
}

/**
 * v1 composite score, loosely following the 35/20/15/15/10/5 weighting (winning+championships /
 * playoffs / offense / defense / badges / reliability) — built from what's already reliably
 * aggregated globally (rec_global_user_game_records + career badge counts) rather than a full
 * per-stat breakdown. Expect this to get more precise once finer-grained global stat aggregates
 * exist; documented here so the next pass has a clear place to extend rather than guess.
 */
async function computeDynastyScoresForGame(game: string): Promise<
  Array<{ userId: string; score: number }>
> {
  const result = await getPgPool().query(
    `
      with records as (
        select
          p.user_id,
          count(*) filter (where p.result = 'win')::int as wins,
          count(*) filter (where p.result = 'loss')::int as losses,
          count(*) filter (where p.result = 'tie')::int as ties,
          count(*) filter (where p.is_playoff and p.result = 'win')::int as playoff_wins,
          count(*) filter (where p.is_playoff and p.result = 'loss')::int as playoff_losses,
          count(*) filter (where p.is_super_bowl and p.result = 'win')::int as superbowl_wins,
          sum(p.points_for)::int as points_for,
          sum(p.points_against)::int as points_against,
          count(*)::int as games_played
        from (
          select g.home_user_id as user_id,
            case when g.is_tie then 'tie' when g.winning_user_id = g.home_user_id then 'win' else 'loss' end as result,
            g.home_score as points_for, g.away_score as points_against,
            g.is_playoff, g.is_super_bowl
          from rec_game_results g
          join rec_leagues l on l.id = g.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = $1 and g.home_user_id is not null
            and (case when l.game='cfb_27' then coalesce(c.cfb_difficulty,case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty end) in ('all_american','heisman') else c.difficulty in ('all_pro','all_madden') end)
          union all
          select g.away_user_id,
            case when g.is_tie then 'tie' when g.winning_user_id = g.away_user_id then 'win' else 'loss' end,
            g.away_score, g.home_score, g.is_playoff, g.is_super_bowl
          from rec_game_results g
          join rec_leagues l on l.id = g.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = $1 and g.away_user_id is not null
            and (case when l.game='cfb_27' then coalesce(c.cfb_difficulty,case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty end) in ('all_american','heisman') else c.difficulty in ('all_pro','all_madden') end)
        ) p
        join rec_users registered on registered.id = p.user_id
          and registered.supabase_auth_user_id is not null
        group by p.user_id
      ),
      opponent_quality as (
        select p.user_id,
          avg(case when o.games_played > 0
            then (o.wins + o.ties * 0.5) / o.games_played::numeric else 0 end) as opponent_win_pct
        from (
          select g.home_user_id as user_id, g.away_user_id as opponent_user_id
          from rec_game_results g join rec_leagues l on l.id = g.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = $1 and (case when l.game='cfb_27' then coalesce(c.cfb_difficulty,case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty end) in ('all_american','heisman') else c.difficulty in ('all_pro','all_madden') end)
            and g.home_user_id is not null and g.away_user_id is not null
          union all
          select g.away_user_id, g.home_user_id
          from rec_game_results g join rec_leagues l on l.id = g.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = $1 and (case when l.game='cfb_27' then coalesce(c.cfb_difficulty,case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty end) in ('all_american','heisman') else c.difficulty in ('all_pro','all_madden') end)
            and g.home_user_id is not null and g.away_user_id is not null
        ) p
        join records o on o.user_id = p.opponent_user_id
        group by p.user_id
      ),
      badge_counts as (
        select b.user_id, count(distinct b.badge_key)::int as badge_count
        from rec_badge_ownership b
        where coalesce(b.game, $1) = $1 and coalesce(b.mode, 'dynasty') = 'dynasty'
          and b.badge_scope = 'career' and coalesce(b.is_active, true)
        group by b.user_id
      )
      select
        r.user_id,
        r.wins, r.losses, r.ties, r.playoff_wins, r.playoff_losses, r.superbowl_wins,
        r.points_for, r.points_against, r.games_played,
        coalesce(bc.badge_count, 0) as badge_count,
        coalesce(oq.opponent_win_pct, 0) as opponent_win_pct
      from records r
      left join badge_counts bc on bc.user_id = r.user_id
      left join opponent_quality oq on oq.user_id = r.user_id
    `,
    [game],
  );

  return result.rows.map((row: any) => {
    const gamesPlayed = Number(row.games_played) || 0;
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const ties = Number(row.ties) || 0;
    const played = wins + losses + ties;
    const winPct = played > 0 ? (wins + ties * 0.5) / played : 0;

    const playoffGames = (Number(row.playoff_wins) || 0) + (Number(row.playoff_losses) || 0);
    const playoffWinPct = playoffGames > 0 ? Number(row.playoff_wins) / playoffGames : 0;
    const superbowlWins = Number(row.superbowl_wins) || 0;

    const pointsForPerGame = gamesPlayed > 0 ? Number(row.points_for) / gamesPlayed : 0;
    const pointsAgainstPerGame = gamesPlayed > 0 ? Number(row.points_against) / gamesPlayed : 0;
    const offenseComponent = Math.min(pointsForPerGame / 35, 1);
    const defenseComponent = 1 - Math.min(pointsAgainstPerGame / 35, 1);

    const badgeComponent = Math.min(Number(row.badge_count) / 20, 1);
    const reliabilityComponent = Math.min(gamesPlayed / 50, 1);

    const score =
      20 * winPct +
      10 * Number(row.opponent_win_pct ?? 0) +
      Math.min(5 * superbowlWins, 5) +
      20 * playoffWinPct +
      15 * offenseComponent +
      15 * defenseComponent +
      10 * badgeComponent +
      5 * reliabilityComponent;

    return { userId: String(row.user_id), score: Math.round(score * 100) / 100 };
  });
}

async function computeCompScoresForGame(game: string): Promise<Array<{ userId: string; score: number }>> {
  const result = await getPgPool().query(
    `
      with records as (
        select s.user_id, count(*)::int as games,
          count(*) filter (where s.won)::int as wins,
          avg((s.points_for - s.points_against)::numeric) as avg_pd
        from rec_comp_game_stats s
        join rec_users u on u.id = s.user_id and u.supabase_auth_user_id is not null
        where s.game = $1
        group by s.user_id
      ),
      opponent_quality as (
        select s.user_id,
          avg(case when opp.games > 0 then opp.wins::numeric / opp.games else 0 end) as oq
        from rec_comp_game_stats s join records opp on opp.user_id = s.opponent_user_id
        where s.game = $1 group by s.user_id
      ),
      badges as (
        select user_id, count(*)::int as badge_count
        from rec_badge_ownership
        where game = $1 and mode = 'comp' and is_active = true
        group by user_id
      )
      select r.*, coalesce(o.oq, 0) as oq, coalesce(b.badge_count, 0) as badge_count
      from records r
      left join opponent_quality o on o.user_id = r.user_id
      left join badges b on b.user_id = r.user_id
    `,
    [game],
  );
  return result.rows.map((row: any) => {
    const games = Number(row.games) || 1;
    const pd = Math.max(-1, Math.min(1, Number(row.avg_pd ?? 0) / 21));
    const score =
      40 * (Number(row.wins) / games) +
      15 * Number(row.oq ?? 0) +
      20 * ((pd + 1) / 2) +
      15 * Math.min(games / 25, 1) +
      10 * Math.min(Number(row.badge_count ?? 0) / 20, 1);
    return { userId: String(row.user_id), score: Math.round(score * 100) / 100 };
  });
}

async function upsertRankingSnapshot(input: {
  game: string;
  scope: "dynasty" | "comp";
  scored: Array<{ userId: string; score: number }>;
}): Promise<{ ranked: number }> {
  const ranked = [...input.scored].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  await getPgPool().query(
    `delete from rec_global_power_rankings where game = $1 and scope = $2 and computed_date = current_date`,
    [input.game, input.scope],
  );
  if (!ranked.length) return { ranked: 0 };

  const values: unknown[] = [];
  const tuples = ranked.map((row, index) => {
    const rank = index + 1;
    values.push(input.game, input.scope, row.userId, rank, row.score);
    const base = values.length - 5;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, current_date)`;
  });

  await getPgPool().query(
    `
      insert into rec_global_power_rankings (game, scope, user_id, rank, score, computed_date)
      values ${tuples.join(", ")}
      on conflict (game, scope, user_id, computed_date)
      do update set rank = excluded.rank, score = excluded.score
    `,
    values,
  );
  return { ranked: ranked.length };
}

export async function refreshAllPowerRankings(): Promise<Record<string, { ranked: number }>> {
  const results: Record<string, { ranked: number }> = {};
  for (const game of RANKED_GAMES) {
    const scored = await computeDynastyScoresForGame(game);
    results[`${game}:dynasty`] = await upsertRankingSnapshot({ game, scope: "dynasty", scored });
    const comp = await computeCompScoresForGame(game);
    results[`${game}:comp`] = await upsertRankingSnapshot({ game, scope: "comp", scored: comp });
  }
  return results;
}

export type PowerRankingRow = {
  rank: number;
  previousRank: number | null;
  userId: string;
  username: string | null;
  displayName: string;
  score: number;
};

export async function listPowerRankings(input: {
  game: string;
  scope: "dynasty" | "comp";
  limit?: number;
}): Promise<{ rankings: PowerRankingRow[]; asOf: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const latestDateResult = await getPgPool().query(
    `select max(computed_date) as d from rec_global_power_rankings where game = $1 and scope = $2`,
    [input.game, input.scope],
  );
  const asOf = latestDateResult.rows[0]?.d ?? null;
  if (!asOf) return { rankings: [], asOf: null };

  const previousDateResult = await getPgPool().query(
    `select max(computed_date) as d from rec_global_power_rankings where game = $1 and scope = $2 and computed_date < $3`,
    [input.game, input.scope, asOf],
  );
  const previousDate = previousDateResult.rows[0]?.d ?? null;

  const result = await getPgPool().query(
    `
      with current_registered as (
        select cur.*,
          row_number() over (order by cur.score desc, cur.user_id asc)::int as display_rank
        from rec_global_power_rankings cur
        join rec_users registered on registered.id = cur.user_id
          and registered.supabase_auth_user_id is not null
        where cur.game = $1 and cur.scope = $2 and cur.computed_date = $3
      ),
      previous_registered as (
        select prev.*,
          row_number() over (order by prev.score desc, prev.user_id asc)::int as display_rank
        from rec_global_power_rankings prev
        join rec_users registered on registered.id = prev.user_id
          and registered.supabase_auth_user_id is not null
        where prev.game = $1 and prev.scope = $2 and prev.computed_date = $4
      )
      select
        cur.display_rank as rank, cur.score, cur.user_id,
        u.username, u.display_name,
        prev.display_rank as previous_rank
      from current_registered cur
      join rec_users u on u.id = cur.user_id
      left join previous_registered prev on prev.user_id = cur.user_id
      order by cur.display_rank asc
      limit $5
    `,
    [input.game, input.scope, asOf, previousDate, limit],
  );

  return {
    asOf: dateOnlyString(asOf),
    rankings: result.rows.map((row: any) => ({
      rank: Number(row.rank),
      previousRank: row.previous_rank != null ? Number(row.previous_rank) : null,
      userId: String(row.user_id),
      username: row.username,
      displayName: row.username ?? row.display_name ?? "REC Member",
      score: Number(row.score),
    })),
  };
}

export async function getUserPowerRank(input: {
  game: string | null;
  scope: "dynasty" | "comp";
  userId: string;
}): Promise<{ rank: number; of: number; previousRank: number | null } | null> {
  if (!input.game) return null;
  const latestDateResult = await getPgPool().query(
    `select max(computed_date) as d from rec_global_power_rankings where game = $1 and scope = $2`,
    [input.game, input.scope],
  );
  const asOf = latestDateResult.rows[0]?.d;
  if (!asOf) return null;

  const result = await getPgPool().query(
    `
      with current_registered as (
        select cur.*,
          row_number() over (order by cur.score desc, cur.user_id asc)::int as display_rank,
          count(*) over ()::int as registered_total
        from rec_global_power_rankings cur
        join rec_users registered on registered.id = cur.user_id
          and registered.supabase_auth_user_id is not null
        where cur.game = $1 and cur.scope = $2 and cur.computed_date = $3
      ),
      previous_registered as (
        select prev.*,
          row_number() over (order by prev.score desc, prev.user_id asc)::int as display_rank
        from rec_global_power_rankings prev
        join rec_users registered on registered.id = prev.user_id
          and registered.supabase_auth_user_id is not null
        where prev.game = $1 and prev.scope = $2
          and prev.computed_date = (
            select max(computed_date) from rec_global_power_rankings
            where game = $1 and scope = $2 and computed_date < $3
          )
      )
      select
        cur.display_rank as rank,
        cur.registered_total as total,
        prev.display_rank as previous_rank
      from current_registered cur
      left join previous_registered prev on prev.user_id = cur.user_id
      where cur.user_id = $4
    `,
    [input.game, input.scope, asOf, input.userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    rank: Number(row.rank),
    of: Number(row.total),
    previousRank: row.previous_rank != null ? Number(row.previous_rank) : null,
  };
}
