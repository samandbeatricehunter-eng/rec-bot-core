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
          r.user_id,
          r.wins, r.losses, r.ties,
          r.playoff_wins, r.playoff_losses,
          r.superbowl_wins,
          r.points_for, r.points_against,
          r.games_played
        from rec_global_user_game_records r
        where r.game = $1 and r.games_played > 0
      ),
      badge_counts as (
        select b.user_id, count(distinct b.badge_key)::int as badge_count
        from rec_badge_ownership b
        inner join rec_leagues l on l.id = b.league_id
        where l.game = $1 and b.badge_scope = 'career'
        group by b.user_id
      )
      select
        r.user_id,
        r.wins, r.losses, r.ties, r.playoff_wins, r.playoff_losses, r.superbowl_wins,
        r.points_for, r.points_against, r.games_played,
        coalesce(bc.badge_count, 0) as badge_count
      from records r
      left join badge_counts bc on bc.user_id = r.user_id
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
      35 * winPct +
      20 * playoffWinPct +
      Math.min(10 * superbowlWins, 10) +
      15 * offenseComponent +
      15 * defenseComponent +
      10 * badgeComponent +
      5 * reliabilityComponent;

    return { userId: String(row.user_id), score: Math.round(score * 100) / 100 };
  });
}

async function upsertRankingSnapshot(input: {
  game: string;
  scope: "dynasty" | "comp";
  scored: Array<{ userId: string; score: number }>;
}): Promise<{ ranked: number }> {
  if (!input.scored.length) return { ranked: 0 };
  const ranked = [...input.scored].sort((a, b) => b.score - a.score);

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
    // Comp scope: no H2H Comp games exist yet — nothing to score. The table stays empty for
    // comp until that system ships; listPowerRankings correctly returns an empty list for it.
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
      select
        cur.rank, cur.score, cur.user_id,
        u.username, u.display_name,
        prev.rank as previous_rank
      from rec_global_power_rankings cur
      inner join rec_users u on u.id = cur.user_id
      left join rec_global_power_rankings prev
        on prev.game = cur.game and prev.scope = cur.scope and prev.user_id = cur.user_id and prev.computed_date = $4
      where cur.game = $1 and cur.scope = $2 and cur.computed_date = $3
      order by cur.rank asc
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
      select
        cur.rank,
        (select count(*)::int from rec_global_power_rankings where game = $1 and scope = $2 and computed_date = $3) as total,
        prev.rank as previous_rank
      from rec_global_power_rankings cur
      left join rec_global_power_rankings prev
        on prev.game = cur.game and prev.scope = cur.scope and prev.user_id = cur.user_id
        and prev.computed_date = (
          select max(computed_date) from rec_global_power_rankings
          where game = $1 and scope = $2 and computed_date < $3
        )
      where cur.game = $1 and cur.scope = $2 and cur.computed_date = $3 and cur.user_id = $4
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
