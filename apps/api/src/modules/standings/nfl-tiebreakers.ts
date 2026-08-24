// Pure NFL playoff-seeding tiebreaker chain. No DB/Supabase imports -- callers assemble
// TeamStanding/TeamGameFact from rec_game_results (see team-game-log.ts) and hand them in.
//
// Simplifications vs. the real NFL rulebook, both deliberate:
//  1. Head-to-head is just "win% among the tied teams' games against each other" -- we don't
//     require a full round-robin sweep, since Madden league schedules routinely produce
//     incomplete head-to-head sets among tied teams.
//  2. Common-games win% requires the real 4-opponent minimum; with fewer than 4 shared
//     opponents among the tied group it's a no-op passthrough (Madden CPU schedules can't
//     reliably guarantee 4 common opponents across every possible tie).
// Every step still narrows to the still-tied subset from the previous step, and the chain
// always terminates in a strict order via point differential then a deterministic teamId sort.

export type TeamGameFact = {
  teamId: string;
  opponentTeamId: string;
  weekNumber: number;
  isHome: boolean;
  pointsFor: number;
  pointsAgainst: number;
  isTie: boolean;
  won: boolean;
  opponentConference: string;
  opponentDivision: string;
};

export type TeamStanding = {
  teamId: string;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  gamesPlayed: number;
  winPct: number;
};

export type TiebreakerContext = {
  /** true for a division tiebreak (division record step applies); false for a wildcard/
   *  conference-wide tiebreak (division record step is skipped). */
  sameDivision: boolean;
};

function winPctOf(games: TeamGameFact[]): number {
  if (!games.length) return 0;
  const wins = games.filter((g) => g.won).length;
  const ties = games.filter((g) => g.isTie).length;
  return (wins + ties * 0.5) / games.length;
}

function pointDifferential(standing: TeamStanding): number {
  return standing.pf - standing.pa;
}

/** Narrows `candidates` to whichever subset ties for the best value of `keyFn`. A single
 *  remaining candidate means the step resolved the tie outright. */
function narrowToBest(candidates: TeamStanding[], keyFn: (teamId: string) => number | null): TeamStanding[] {
  const scored = candidates
    .map((c) => ({ standing: c, score: keyFn(c.teamId) }))
    .filter((row): row is { standing: TeamStanding; score: number } => row.score !== null);
  if (!scored.length) return candidates;
  const best = Math.max(...scored.map((row) => row.score));
  const survivors = scored.filter((row) => row.score === best).map((row) => row.standing);
  // Any candidate the keyFn opted out of (returned null, e.g. no common games) stays tied too --
  // a no-op step must never silently eliminate a team.
  const optedOut = candidates.filter((c) => !scored.some((row) => row.standing.teamId === c.teamId));
  return survivors.length ? [...survivors, ...optedOut] : candidates;
}

export function resolveTiebreaker(
  candidates: TeamStanding[],
  games: Map<string, TeamGameFact[]>,
  allStandings: Map<string, TeamStanding>,
  context: TiebreakerContext,
): string[] {
  if (candidates.length <= 1) return candidates.map((c) => c.teamId);

  const candidateIds = new Set(candidates.map((c) => c.teamId));
  let tied = candidates;

  const steps: Array<(pool: TeamStanding[]) => TeamStanding[]> = [
    // 1. Head-to-head among the tied group only.
    (pool) => {
      const poolIds = new Set(pool.map((c) => c.teamId));
      return narrowToBest(pool, (teamId) => {
        const h2h = (games.get(teamId) ?? []).filter((g) => poolIds.has(g.opponentTeamId));
        if (!h2h.length) return null;
        return winPctOf(h2h);
      });
    },
    // 2. Division record (division tiebreaks only).
    (pool) => {
      if (!context.sameDivision) return pool;
      return narrowToBest(pool, (teamId) => {
        const standing = allStandings.get(teamId);
        if (!standing) return null;
        const divGames = (games.get(teamId) ?? []).filter((g) => g.opponentDivision === standing.division);
        if (!divGames.length) return null;
        return winPctOf(divGames);
      });
    },
    // 3. Common games win% (min 4 shared opponents; no-op passthrough otherwise).
    (pool) => {
      const poolIds = Array.from(new Set(pool.map((c) => c.teamId)));
      const opponentSets = new Map<string, Set<string>>(
        poolIds.map((teamId) => [teamId, new Set((games.get(teamId) ?? []).map((g) => g.opponentTeamId))]),
      );
      let commonOpponents = poolIds.length ? opponentSets.get(poolIds[0])! : new Set<string>();
      for (const teamId of poolIds.slice(1)) {
        const next = opponentSets.get(teamId) ?? new Set<string>();
        commonOpponents = new Set([...commonOpponents].filter((id) => next.has(id)));
      }
      if (commonOpponents.size < 4) return pool;
      return narrowToBest(pool, (teamId) => {
        const commonGames = (games.get(teamId) ?? []).filter((g) => commonOpponents.has(g.opponentTeamId));
        if (!commonGames.length) return null;
        return winPctOf(commonGames);
      });
    },
    // 4. Conference record.
    (pool) => {
      return narrowToBest(pool, (teamId) => {
        const standing = allStandings.get(teamId);
        if (!standing) return null;
        const confGames = (games.get(teamId) ?? []).filter((g) => g.opponentConference === standing.conference);
        if (!confGames.length) return null;
        return winPctOf(confGames);
      });
    },
    // 5. Strength of victory: win% of all opponents this team beat.
    (pool) => {
      return narrowToBest(pool, (teamId) => {
        const beatenOpponents = (games.get(teamId) ?? []).filter((g) => g.won).map((g) => g.opponentTeamId);
        if (!beatenOpponents.length) return null;
        const oppWinPcts = beatenOpponents
          .map((oppId) => allStandings.get(oppId)?.winPct)
          .filter((v): v is number => v !== undefined);
        if (!oppWinPcts.length) return null;
        return oppWinPcts.reduce((a, b) => a + b, 0) / oppWinPcts.length;
      });
    },
    // 6. Strength of schedule: win% of all opponents played.
    (pool) => {
      return narrowToBest(pool, (teamId) => {
        const opponents = (games.get(teamId) ?? []).map((g) => g.opponentTeamId);
        if (!opponents.length) return null;
        const oppWinPcts = opponents
          .map((oppId) => allStandings.get(oppId)?.winPct)
          .filter((v): v is number => v !== undefined);
        if (!oppWinPcts.length) return null;
        return oppWinPcts.reduce((a, b) => a + b, 0) / oppWinPcts.length;
      });
    },
    // 7. Point differential -- always a real number, always fully resolves.
    (pool) =>
      narrowToBest(pool, (teamId) => {
        const standing = allStandings.get(teamId);
        return standing ? pointDifferential(standing) : null;
      }),
  ];

  for (const step of steps) {
    if (tied.length <= 1) break;
    tied = step(tied);
  }

  // 8. Deterministic teamId sort -- guarantees a strict, unambiguous order even if every
  // rulebook step above ends in an exact tie.
  const ordered = [...tied].sort((a, b) => a.teamId.localeCompare(b.teamId));
  const resolvedIds = ordered.map((c) => c.teamId);
  const remaining = candidates.filter((c) => !resolvedIds.includes(c.teamId) && candidateIds.has(c.teamId));
  return [...resolvedIds, ...remaining.map((c) => c.teamId)];
}

/** Sorts a full pool of standings using resolveTiebreaker for any group tied on winPct. */
export function sortStandingsWithTiebreakers(
  pool: TeamStanding[],
  games: Map<string, TeamGameFact[]>,
  allStandings: Map<string, TeamStanding>,
  context: TiebreakerContext,
): TeamStanding[] {
  const byWinPct = new Map<number, TeamStanding[]>();
  for (const standing of pool) {
    const group = byWinPct.get(standing.winPct) ?? [];
    group.push(standing);
    byWinPct.set(standing.winPct, group);
  }
  const winPcts = Array.from(byWinPct.keys()).sort((a, b) => b - a);
  const result: TeamStanding[] = [];
  const byId = new Map(pool.map((s) => [s.teamId, s]));
  for (const winPct of winPcts) {
    const group = byWinPct.get(winPct)!;
    const orderedIds = resolveTiebreaker(group, games, allStandings, context);
    for (const teamId of orderedIds) {
      const standing = byId.get(teamId);
      if (standing) result.push(standing);
    }
  }
  return result;
}
