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

/** EA's own computed seed per team for this season, if a Companion App standings import has
 * ever landed (see applyStandings in madden-companion.canonical.ts) -- kept in its own table so
 * it never races with this function's own recompute. */
async function loadEaSeedOverrides(leagueId: string, seasonNumber: number): Promise<Map<string, { seed: number; isPlayoff: boolean }>> {
  const result = await getPgPool().query<{ team_id: string; ea_seed: number; ea_is_playoff: boolean | null }>(
    `select team_id, ea_seed, ea_is_playoff from rec_season_team_ea_seeds where league_id=$1 and season_number=$2 and ea_seed is not null`,
    [leagueId, seasonNumber],
  );
  return new Map(result.rows.map((row) => [String(row.team_id), { seed: Number(row.ea_seed), isPlayoff: Boolean(row.ea_is_playoff) }]));
}

async function computeNflStandingsUncached(leagueId: string, seasonNumber: number): Promise<NflStandingsResult> {
  const { standings, games } = await loadTeamGameLog(leagueId, seasonNumber);
  const allStandings = standings;
  const byConference = groupBy(Array.from(standings.values()), (s) => s.conference);
  const eaOverrides = await loadEaSeedOverrides(leagueId, seasonNumber);

  const conferences: ConferenceSeeding[] = [];
  const teamRows: NflStandingsTeamRow[] = [];

  for (const [conference, confTeams] of byConference) {
    if (!conference) continue;
    const byDivision = groupBy(confTeams, (s) => s.division);
    const divisions: ConferenceSeeding["divisions"] = [];

    for (const [division, divTeams] of byDivision) {
      if (!division) continue;
      const sorted = sortStandingsWithTiebreakers(divTeams, games, allStandings, { sameDivision: true });
      divisions.push({ division, standings: sorted });
    }

    // Sort divisions for stable display order.
    divisions.sort((a, b) => a.division.localeCompare(b.division));

    // Madden's own in-game seeding can genuinely diverge from a real-NFL-style tiebreaker chain
    // (confirmed live: it ranked a team ahead of one that had beaten it head-to-head, which real
    // NFL rules would never produce) -- when a complete, valid 1-7 seed set has actually been
    // imported for this conference, that's the source of truth and our own recomputation below
    // never runs for it. Falls back to the tiebreaker chain otherwise (no standings import yet,
    // a non-Madden game, or a partial/incomplete import).
    const eaEntries = confTeams
      .map((s) => ({ teamId: s.teamId, override: eaOverrides.get(s.teamId) }))
      .filter((row): row is { teamId: string; override: { seed: number; isPlayoff: boolean } } => Boolean(row.override?.isPlayoff));
    const eaSeedNumbers = new Set(eaEntries.map((row) => row.override.seed));
    const hasCompleteEaSeeding = eaEntries.length === 7 && [1, 2, 3, 4, 5, 6, 7].every((n) => eaSeedNumbers.has(n));

    let seeds: ConferenceSeeding["seeds"];
    if (hasCompleteEaSeeding) {
      seeds = eaEntries
        .sort((a, b) => a.override.seed - b.override.seed)
        .map((row) => ({ seed: row.override.seed, teamId: row.teamId, isDivisionWinner: row.override.seed <= 4 }));
    } else {
      const divisionWinners = divisions.map((d) => d.standings[0]).filter((s): s is TeamStanding => Boolean(s));
      const seededDivisionWinners = sortStandingsWithTiebreakers(divisionWinners, games, allStandings, { sameDivision: false });
      const divisionWinnerIds = new Set(seededDivisionWinners.map((s) => s.teamId));
      const wildcardPool = confTeams.filter((s) => !divisionWinnerIds.has(s.teamId));
      const seededWildcards = sortStandingsWithTiebreakers(wildcardPool, games, allStandings, { sameDivision: false }).slice(0, 3);
      seeds = [
        ...seededDivisionWinners.map((s, i) => ({ seed: i + 1, teamId: s.teamId, isDivisionWinner: true })),
        ...seededWildcards.map((s, i) => ({ seed: 5 + i, teamId: s.teamId, isDivisionWinner: false })),
      ];
    }
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

/** Same sync, triggered directly off an EA import instead of only the Advance flow -- a
 * standings import mid-postseason (a corrected seed, a newly-decided Wild Card result) should
 * update the live bracket right away, not sit until the next Advance. No-ops for non-Madden
 * leagues and leagues with no season row yet. */
export async function syncNflStandingsAfterImport(leagueId: string): Promise<void> {
  const league = await getPgPool().query<{ game: string; season_number: number; season_stage: string }>(
    `select game,season_number,season_stage from rec_leagues where id=$1`,
    [leagueId],
  );
  const row = league.rows[0];
  if (!row || !String(row.game ?? "").startsWith("madden")) return;
  const seasonNumber = Number(row.season_number ?? 1);
  const { resolveSeasonId } = await import("../league-context/season.service.js");
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  await syncMaddenStandingsAndBracket({ leagueId, seasonNumber, seasonId, seasonStage: String(row.season_stage ?? "") });
}
