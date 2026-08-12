import assert from "node:assert/strict";
import test from "node:test";
import { createFakeSupabase } from "../../lib/__testsupport__/fake-supabase.js";
import { leagueSeasonGamesQuery, leagueWeekGamesQuery } from "./league-games.query.js";

// Multi-season fixture: the same league across three seasons, each with a Week 4 (and a Week 5),
// reusing the same teams. This is exactly the shape that produced the cross-season leakage bug —
// a query scoped only by (league_id, week_number) would return games from all three seasons.
const LEAGUE = "league-1";
const S1 = "season-1-id";
const S2 = "season-2-id";
const S3 = "season-3-id";
const TEAM_A = "team-a";
const TEAM_B = "team-b";

function game(id: string, seasonId: string, weekNumber: number, extra: Record<string, any> = {}) {
  return {
    id,
    league_id: LEAGUE,
    season_id: seasonId,
    week_number: weekNumber,
    home_team_id: TEAM_A,
    away_team_id: TEAM_B,
    home_user_id: "user-a",
    away_user_id: "user-b",
    status: "scheduled",
    ...extra,
  };
}

function fixture() {
  return createFakeSupabase({
    rec_games: [
      game("s1-w4", S1, 4),
      game("s1-w5", S1, 5),
      game("s2-w4", S2, 4),
      game("s2-w5", S2, 5),
      game("s3-w4", S3, 4),
      game("s3-w5", S3, 5),
      // A different league's Week 4 must never leak either.
      { ...game("other-w4", S2, 4), league_id: "league-2" },
    ],
  }) as any;
}

test("leagueWeekGamesQuery returns only the requested season's week", async () => {
  const client = fixture();
  const { data, error } = await leagueWeekGamesQuery(client, { leagueId: LEAGUE, seasonId: S2, weekNumber: 4 });
  assert.equal(error, null);
  assert.deepEqual((data as any[]).map((row) => row.id), ["s2-w4"]);
});

test("leagueWeekGamesQuery isolates each season at the same week number", async () => {
  const client = fixture();
  for (const [seasonId, expected] of [[S1, "s1-w4"], [S2, "s2-w4"], [S3, "s3-w4"]] as const) {
    const { data } = await leagueWeekGamesQuery(client, { leagueId: LEAGUE, seasonId, weekNumber: 4 });
    assert.deepEqual((data as any[]).map((row) => row.id), [expected], `season ${seasonId}`);
  }
});

test("leagueWeekGamesQuery never crosses league boundaries", async () => {
  const client = fixture();
  const { data } = await leagueWeekGamesQuery(client, { leagueId: LEAGUE, seasonId: S2, weekNumber: 4 });
  assert.ok((data as any[]).every((row) => row.league_id === LEAGUE));
  assert.ok(!(data as any[]).some((row) => row.id === "other-w4"));
});

test("leagueSeasonGamesQuery returns every week of one season only", async () => {
  const client = fixture();
  const { data } = await leagueSeasonGamesQuery(client, { leagueId: LEAGUE, seasonId: S3 });
  assert.deepEqual((data as any[]).map((row) => row.id).sort(), ["s3-w4", "s3-w5"]);
});

test("chained filters still respect the season scope (e.g. team filter via or())", async () => {
  const client = fixture();
  const { data } = await leagueWeekGamesQuery(client, { leagueId: LEAGUE, seasonId: S1, weekNumber: 4 })
    .or(`home_team_id.eq.${TEAM_A},away_team_id.eq.${TEAM_A}`);
  assert.deepEqual((data as any[]).map((row) => row.id), ["s1-w4"]);
});

test("maybeSingle on a season-scoped week returns exactly one row (no cross-season duplicate)", async () => {
  const client = fixture();
  const { data, error } = await leagueWeekGamesQuery(client, { leagueId: LEAGUE, seasonId: S2, weekNumber: 5 }).maybeSingle();
  // Without season scoping this would match s1-w5/s2-w5/s3-w5 and error as a non-unique result.
  assert.equal(error, null);
  assert.equal((data as any).id, "s2-w5");
});
