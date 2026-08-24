import { getPgPool } from "../../db/client.js";
import { withComputeCache } from "../../lib/compute-cache.js";
import { sortStandingsWithTiebreakers, type TeamStanding } from "./nfl-tiebreakers.js";
import { loadTeamGameLog } from "./team-game-log.js";

const NFL_STANDINGS_CACHE_TTL_MS = 60_000;

export type ConferenceSeeding = {
  conference: string;
  divisions: Array<{ division: string; standings: TeamStanding[] }>;
  seeds: Array<{ seed: number; teamId: string; isDivisionWinner: boolean }>;
};

export type NflStandingsTeamRow = {
  teamId: string;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  seed: number | null;
  isDivisionWinner: boolean;
  madePlayoffs: boolean;
  /** Always false pre-postseason (this is a live projection, not a locked field) -- becomes
   *  true only once the bracket engine (nfl-bracket.service.ts) has locked that seed's round. */
  clinched: boolean;
};

export type NflStandingsResult = {
  conferences: ConferenceSeeding[];
  teamRows: NflStandingsTeamRow[];
};

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

async function computeNflStandingsUncached(leagueId: string, seasonNumber: number): Promise<NflStandingsResult> {
  const { standings, games } = await loadTeamGameLog(leagueId, seasonNumber);
  const allStandings = standings;
  const byConference = groupBy(Array.from(standings.values()), (s) => s.conference);

  const conferences: ConferenceSeeding[] = [];
  const teamRows: NflStandingsTeamRow[] = [];

  for (const [conference, confTeams] of byConference) {
    if (!conference) continue;
    const byDivision = groupBy(confTeams, (s) => s.division);
    const divisionWinners: TeamStanding[] = [];
    const divisions: ConferenceSeeding["divisions"] = [];

    for (const [division, divTeams] of byDivision) {
      if (!division) continue;
      const sorted = sortStandingsWithTiebreakers(divTeams, games, allStandings, { sameDivision: true });
      divisions.push({ division, standings: sorted });
      if (sorted.length) divisionWinners.push(sorted[0]);
    }

    // Sort divisions for stable display order.
    divisions.sort((a, b) => a.division.localeCompare(b.division));

    const seededDivisionWinners = sortStandingsWithTiebreakers(divisionWinners, games, allStandings, { sameDivision: false });
    const divisionWinnerIds = new Set(seededDivisionWinners.map((s) => s.teamId));
    const wildcardPool = confTeams.filter((s) => !divisionWinnerIds.has(s.teamId));
    const seededWildcards = sortStandingsWithTiebreakers(wildcardPool, games, allStandings, { sameDivision: false }).slice(0, 3);

    const seeds: ConferenceSeeding["seeds"] = [
      ...seededDivisionWinners.map((s, i) => ({ seed: i + 1, teamId: s.teamId, isDivisionWinner: true })),
      ...seededWildcards.map((s, i) => ({ seed: 5 + i, teamId: s.teamId, isDivisionWinner: false })),
    ];
    const seedByTeamId = new Map(seeds.map((s) => [s.teamId, s]));

    conferences.push({ conference, divisions, seeds });

    for (const team of confTeams) {
      const seedRow = seedByTeamId.get(team.teamId);
      teamRows.push({
        teamId: team.teamId,
        conference: team.conference,
        division: team.division,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        pf: team.pf,
        pa: team.pa,
        seed: seedRow?.seed ?? null,
        isDivisionWinner: seedRow?.isDivisionWinner ?? false,
        madePlayoffs: seedRow !== undefined,
        clinched: false,
      });
    }
  }

  return { conferences, teamRows };
}

/** Live, on-read NFL standings/seeding computation -- division winners (seeds 1-4) and
 *  wildcards (seeds 5-7) per conference, using real tiebreaker rules. Cheap (<=32 teams, one
 *  query) so it's wrapped in the same short-TTL compute-cache pattern power-rankings uses
 *  instead of a persisted/invalidated snapshot. */
export async function computeNflStandings(leagueId: string, seasonNumber: number): Promise<NflStandingsResult> {
  return withComputeCache(
    `nfl-standings:${leagueId}:${seasonNumber}`,
    NFL_STANDINGS_CACHE_TTL_MS,
    () => computeNflStandingsUncached(leagueId, seasonNumber),
  );
}

const POSTSEASON_STAGES = new Set(["wild_card", "divisional", "conference_championship", "super_bowl"]);

/** Called after every advance for Madden leagues (see completeAdvanceWeek). Always refreshes
 *  the rec_season_team_seeds cache/read-model from the live computation (this is the only
 *  writer of that table); once the league has actually reached the postseason, also syncs
 *  every bracket round so the "always full bracket, live reseeded" view stays current without
 *  a separate cron. */
export async function syncMaddenStandingsAndBracket(input: {
  leagueId: string;
  seasonNumber: number;
  seasonId: string;
  seasonStage: string;
}): Promise<void> {
  const standings = await computeNflStandingsUncached(input.leagueId, input.seasonNumber);

  for (const row of standings.teamRows) {
    await getPgPool().query(
      `insert into rec_season_team_seeds(league_id,season_number,team_id,conference,seed,made_playoffs,division_name,division_winner,created_at,updated_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       on conflict(league_id,season_number,team_id) do update set
         conference=excluded.conference,seed=excluded.seed,made_playoffs=excluded.made_playoffs,
         division_name=excluded.division_name,division_winner=excluded.division_winner,updated_at=now()`,
      [input.leagueId, input.seasonNumber, row.teamId, row.conference, row.seed, row.madePlayoffs, row.division, row.isDivisionWinner],
    );
  }

  if (POSTSEASON_STAGES.has(input.seasonStage)) {
    const { syncAllNflBracketRounds } = await import("./nfl-bracket.service.js");
    await syncAllNflBracketRounds({ leagueId: input.leagueId, seasonNumber: input.seasonNumber, seasonId: input.seasonId });
  }
}
