import { randomUUID } from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { computeNflStandings } from "./nfl-standings.service.js";

export type NflRound = "wild_card" | "divisional" | "conference_championship" | "super_bowl";
export const NFL_ROUNDS: NflRound[] = ["wild_card", "divisional", "conference_championship", "super_bowl"];

const ROUND_WEEK: Record<NflRound, number> = {
  wild_card: 19,
  divisional: 20,
  conference_championship: 21,
  super_bowl: 22,
};

export type AliveSeed = { seed: number; teamId: string; conference: string };

export type RoundMatchup = {
  conference: string; // "AFC" | "NFC" | "SB"
  homeSeed: number;
  awaySeed: number;
  homeTeamId: string;
  awayTeamId: string;
};

/** Pure -- no DB. Seed 1 always gets the wild-card bye (pairs 2v7, 3v6, 4v5). Every later
 *  round reseeds: the lowest surviving seed plays the highest surviving seed, every round --
 *  this is the one thing a static CFP-style bracket definition can't express. */
export function computeRoundMatchups(round: NflRound, aliveSeeds: AliveSeed[]): RoundMatchup[] {
  if (round === "wild_card") {
    const byConf = new Map<string, AliveSeed[]>();
    for (const s of aliveSeeds) {
      const list = byConf.get(s.conference) ?? [];
      list.push(s);
      byConf.set(s.conference, list);
    }
    const matchups: RoundMatchup[] = [];
    for (const [conference, seeds] of byConf) {
      const bySeed = new Map(seeds.map((s) => [s.seed, s]));
      const pairs: Array<[number, number]> = [[2, 7], [3, 6], [4, 5]];
      for (const [homeSeed, awaySeed] of pairs) {
        const home = bySeed.get(homeSeed);
        const away = bySeed.get(awaySeed);
        if (home && away) matchups.push({ conference, homeSeed, awaySeed, homeTeamId: home.teamId, awayTeamId: away.teamId });
      }
    }
    return matchups;
  }

  if (round === "super_bowl") {
    if (aliveSeeds.length !== 2) return [];
    const [a, b] = aliveSeeds;
    const [home, away] = a.seed <= b.seed ? [a, b] : [b, a];
    return [{ conference: "SB", homeSeed: home.seed, awaySeed: away.seed, homeTeamId: home.teamId, awayTeamId: away.teamId }];
  }

  // divisional / conference_championship: reseed within each conference -- lowest surviving
  // seed number (best) plays highest surviving seed number (worst), pairing inward.
  const byConf = new Map<string, AliveSeed[]>();
  for (const s of aliveSeeds) {
    const list = byConf.get(s.conference) ?? [];
    list.push(s);
    byConf.set(s.conference, list);
  }
  const matchups: RoundMatchup[] = [];
  for (const [conference, seedsRaw] of byConf) {
    const seeds = [...seedsRaw].sort((a, b) => a.seed - b.seed);
    for (let i = 0; i < Math.floor(seeds.length / 2); i += 1) {
      const home = seeds[i];
      const away = seeds[seeds.length - 1 - i];
      matchups.push({ conference, homeSeed: home.seed, awaySeed: away.seed, homeTeamId: home.teamId, awayTeamId: away.teamId });
    }
  }
  return matchups;
}

/** Finds/creates the league's rec_nfl_brackets parent row for this season. */
async function ensureBracket(client: import("pg").PoolClient, leagueId: string, seasonNumber: number): Promise<string> {
  const result = await client.query(
    `insert into rec_nfl_brackets(league_id,season_number,status)
     values($1,$2,'active')
     on conflict(league_id,season_number) do update set updated_at=now()
     returning id`,
    [leagueId, seasonNumber],
  );
  return String(result.rows[0].id);
}

/** Seed 1 always advances past wild_card (bye). For every other alive seed at wild_card time,
 *  advancement into the next round depends on that round's game outcome -- resolved by walking
 *  the previous round's rec_nfl_bracket_slots joined to rec_games/rec_game_results. Returns
 *  null if the previous round isn't fully decided yet (so the caller knows not to create real
 *  games for a round whose participants aren't determined). */
async function aliveSeedsForRound(
  client: import("pg").PoolClient,
  bracketId: string,
  leagueId: string,
  round: NflRound,
  seasonNumber: number,
  standingsSeeds: AliveSeed[],
): Promise<AliveSeed[] | null> {
  if (round === "wild_card") return standingsSeeds;

  const priorRound: NflRound = round === "divisional" ? "wild_card" : round === "conference_championship" ? "divisional" : "conference_championship";
  const seedByTeamId = new Map(standingsSeeds.map((s) => [s.teamId, s]));

  const priorSlots = await client.query(
    `select s.conference,s.home_seed,s.away_seed,s.home_team_id,s.away_team_id,
            coalesce(g.home_score,r.home_score) as home_score,coalesce(g.away_score,r.away_score) as away_score
     from rec_nfl_bracket_slots s
     left join rec_games g on g.id=s.game_id
     left join rec_game_results r on r.league_id=$4
       and r.season_number=$2 and r.week_number=${ROUND_WEEK[priorRound]}
       and r.home_team_id=s.home_team_id and r.away_team_id=s.away_team_id
     where s.bracket_id=$1 and s.round=$3`,
    [bracketId, seasonNumber, priorRound, leagueId],
  );
  if (!priorSlots.rowCount) return null;

  const alive: AliveSeed[] = [];
  // Byes: a seed with no wild_card game (seed 1 in each conference) auto-advances into
  // divisional. Detect by diffing standingsSeeds against every seed that appears in a
  // wild_card slot.
  if (priorRound === "wild_card") {
    const seededInWildCard = new Set<number>();
    for (const row of priorSlots.rows) {
      seededInWildCard.add(Number(row.home_seed));
      seededInWildCard.add(Number(row.away_seed));
    }
    for (const seed of standingsSeeds) {
      if (!seededInWildCard.has(seed.seed)) alive.push(seed); // the bye
    }
  }

  for (const row of priorSlots.rows) {
    if (row.home_score == null || row.away_score == null) return null; // round not decided yet
    const homeScore = Number(row.home_score);
    const awayScore = Number(row.away_score);
    if (homeScore === awayScore) return null; // NFL playoff games can't end in a tie; treat as undecided
    const winnerTeamId = homeScore > awayScore ? String(row.home_team_id) : String(row.away_team_id);
    const winnerSeed = seedByTeamId.get(winnerTeamId);
    if (winnerSeed) alive.push(winnerSeed);
  }
  return alive;
}

/** Generates/regenerates real rec_games rows for `round`, safe to call repeatedly (e.g. every
 *  advance) without ever touching a game that already has a result. Returns null if the prior
 *  round isn't decided yet (nothing to create for this round). */
export async function syncNflBracketRound(input: {
  leagueId: string;
  seasonNumber: number;
  seasonId: string;
  round: NflRound;
}): Promise<{ matchups: RoundMatchup[] } | null> {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`nfl-bracket:${input.leagueId}:${input.seasonNumber}`]);
    const bracketId = await ensureBracket(client, input.leagueId, input.seasonNumber);

    const standings = await computeNflStandings(input.leagueId, input.seasonNumber);
    const standingsSeeds: AliveSeed[] = standings.conferences.flatMap((c) =>
      c.seeds.map((s) => ({ seed: s.seed, teamId: s.teamId, conference: c.conference })),
    );

    const aliveSeeds = await aliveSeedsForRound(client, bracketId, input.leagueId, input.round, input.seasonNumber, standingsSeeds);
    if (!aliveSeeds || !aliveSeeds.length) {
      await client.query("commit");
      return null;
    }

    const matchups = computeRoundMatchups(input.round, aliveSeeds);
    const weekNumber = ROUND_WEEK[input.round];

    for (let i = 0; i < matchups.length; i += 1) {
      const matchup = matchups[i];
      const slotNumber = i + 1;
      const existing = await client.query(
        `select s.id,s.game_id,s.home_team_id,s.away_team_id,g.status,g.home_score,g.away_score
         from rec_nfl_bracket_slots s left join rec_games g on g.id=s.game_id
         where s.bracket_id=$1 and s.conference=$2 and s.round=$3 and s.slot_number=$4`,
        [bracketId, matchup.conference, input.round, slotNumber],
      );
      const slot = existing.rows[0];
      const isLocked = slot && (slot.status === "completed" || slot.home_score != null || slot.away_score != null);
      if (isLocked) continue; // never touch a slot whose game already has a result

      if (!slot) {
        const gameId = randomUUID();
        const assignments = await client.query(
          `select team_id,user_id from rec_team_assignments
           where league_id=$1 and team_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
          [input.leagueId, [matchup.homeTeamId, matchup.awayTeamId]],
        );
        const userByTeam = new Map(assignments.rows.map((row) => [String(row.team_id), row.user_id]));
        await client.query(
          `insert into rec_games(id,league_id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,source,external_game_id,postseason_round,created_at,updated_at)
           values($1,$2,$3,$4,'playoffs',$5,$6,$7,$8,'scheduled','nfl_bracket',$9,$10,now(),now())`,
          [
            gameId, input.leagueId, input.seasonId, weekNumber, matchup.homeTeamId, matchup.awayTeamId,
            userByTeam.get(matchup.homeTeamId) ?? null, userByTeam.get(matchup.awayTeamId) ?? null,
            `nfl:${input.leagueId}:${input.seasonNumber}:${input.round}:${matchup.conference}:${slotNumber}`,
            input.round,
          ],
        );
        await client.query(
          `insert into rec_nfl_bracket_slots(bracket_id,conference,round,slot_number,home_seed,away_seed,home_team_id,away_team_id,game_id)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [bracketId, matchup.conference, input.round, slotNumber, matchup.homeSeed, matchup.awaySeed, matchup.homeTeamId, matchup.awayTeamId, gameId],
        );
      } else {
        // Teams can still shift before this round locks (e.g. re-run after a correction to a
        // prior round's score) -- update the slot and its uncompleted game in place.
        if (String(slot.home_team_id) !== matchup.homeTeamId || String(slot.away_team_id) !== matchup.awayTeamId) {
          await client.query(
            `update rec_nfl_bracket_slots set home_seed=$2,away_seed=$3,home_team_id=$4,away_team_id=$5,updated_at=now() where id=$1`,
            [slot.id, matchup.homeSeed, matchup.awaySeed, matchup.homeTeamId, matchup.awayTeamId],
          );
          if (slot.game_id) {
            const assignments = await client.query(
              `select team_id,user_id from rec_team_assignments
               where league_id=$1 and team_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
              [input.leagueId, [matchup.homeTeamId, matchup.awayTeamId]],
            );
            const userByTeam = new Map(assignments.rows.map((row) => [String(row.team_id), row.user_id]));
            await client.query(
              `update rec_games set home_team_id=$2,away_team_id=$3,home_user_id=$4,away_user_id=$5,updated_at=now() where id=$1`,
              [slot.game_id, matchup.homeTeamId, matchup.awayTeamId, userByTeam.get(matchup.homeTeamId) ?? null, userByTeam.get(matchup.awayTeamId) ?? null],
            );
          }
        }
      }
    }

    await client.query("commit");
    return { matchups };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs syncNflBracketRound for every round in order -- cheap and idempotent, called after
 *  every advance once the league has reached the postseason. Each later round naturally
 *  no-ops (aliveSeedsForRound returns null) until its prior round is actually decided. */
export async function syncAllNflBracketRounds(input: { leagueId: string; seasonNumber: number; seasonId: string }): Promise<void> {
  for (const round of NFL_ROUNDS) {
    await syncNflBracketRound({ ...input, round });
  }
}
