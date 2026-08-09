import { randomUUID } from "node:crypto";
import { isRegularSeasonWeek } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";

// Lazy for the same reason as cfp-bracket.service.ts — keeps gotw.service.js's heavier
// dependency chain out of this module's static import graph.
async function autoAssignGotwForWeek(input: { guildId: string; weekNumber: number; allH2h?: boolean }) {
  const mod = await import("../gotw/gotw.service.js");
  return mod.autoAssignGotwForWeek(input);
}

type Decision = {
  weekNumber: number;
  opponentTeamId: string;
  homeAway: "home" | "away";
  postseasonRound?: string | null;
  bowlName?: string | null;
  isBowlGame?: boolean;
  isNationalChampionship?: boolean;
};

/** Atomic replacement of one team's editable schedule and byes. */
export async function commitTeamScheduleDecisionsTransactional(input: {
  guildId: string;
  teamId: string;
  seasonNumber?: number | null;
  decisions: Decision[];
  byeWeeks?: number[];
  firstRoundByeWeeks?: number[];
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const firstRoundByes = new Set(input.firstRoundByeWeeks ?? []);
  const desiredByes = [...new Set([...(input.byeWeeks ?? []), ...firstRoundByes])];
  const weekNumbers = [...new Set([...input.decisions.map((row) => row.weekNumber), ...desiredByes])];
  const involvedTeamIds = [...new Set([input.teamId, ...input.decisions.map((row) => row.opponentTeamId)])];
  const client = await getPgPool().connect();

  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`schedule:${leagueId}:${seasonNumber}`]);

    const teams = await client.query(
      `select id,is_schedule_placeholder from rec_teams where league_id=$1 and id=any($2::uuid[])`,
      [leagueId, involvedTeamIds],
    );
    if (teams.rowCount !== involvedTeamIds.length) throw new ApiError(400, "Every schedule team must belong to the current league.");
    const placeholderIds = new Set(teams.rows.filter((row) => row.is_schedule_placeholder).map((row) => String(row.id)));
    for (const decision of input.decisions) {
      if (placeholderIds.has(input.teamId) && placeholderIds.has(decision.opponentTeamId)) {
        throw new ApiError(400, `Week ${decision.weekNumber}: a schedule placeholder needs a real opponent.`);
      }
    }

    const existing = weekNumbers.length ? await client.query(
      `select g.id,g.week_number,g.home_team_id,g.away_team_id,g.external_game_id,
              exists(select 1 from rec_game_results r where r.league_id=g.league_id and r.season_number=$3
                and r.week_number=g.week_number and r.home_team_id=g.home_team_id and r.away_team_id=g.away_team_id) as has_result,
              exists(select 1 from rec_box_score_submissions b where b.game_id=g.id and b.status in ('pending','approved')) as has_box_score
       from rec_games g
       where g.league_id=$1 and g.season_id=$2 and g.week_number=any($4::int[])
         and (g.home_team_id=any($5::uuid[]) or g.away_team_id=any($5::uuid[]))`,
      [leagueId, seasonId, seasonNumber, weekNumbers, involvedTeamIds],
    ) : { rows: [] as Array<Record<string, unknown>> };

    const desiredByWeek = new Map(input.decisions.map((decision) => {
      const homeTeamId = decision.homeAway === "home" ? input.teamId : decision.opponentTeamId;
      const awayTeamId = decision.homeAway === "away" ? input.teamId : decision.opponentTeamId;
      return [decision.weekNumber, { decision, homeTeamId, awayTeamId }];
    }));
    const relevantExisting = existing.rows.filter((game) => {
      const desired = desiredByWeek.get(Number(game.week_number));
      if (!desired) return false;
      return game.home_team_id === input.teamId
        || game.away_team_id === input.teamId
        || game.home_team_id === desired.decision.opponentTeamId
        || game.away_team_id === desired.decision.opponentTeamId;
    });
    const preserveIds = new Set<string>();
    const deleteIds: string[] = [];
    for (const game of relevantExisting) {
      const desired = desiredByWeek.get(Number(game.week_number));
      const exact = desired && game.home_team_id === desired.homeTeamId && game.away_team_id === desired.awayTeamId;
      const locked = Boolean(game.has_result || game.has_box_score);
      if (locked && !exact) {
        throw new ApiError(409, `Week ${game.week_number} already has a recorded result or box score; its participants cannot be changed.`);
      }
      if (locked && exact) preserveIds.add(String(game.id));
      else deleteIds.push(String(game.id));
    }
    if (deleteIds.length) await client.query(`delete from rec_games where id=any($1::uuid[])`, [deleteIds]);

    await client.query(
      `delete from rec_team_byes where league_id=$1 and season_number=$2 and team_id=$3`,
      [leagueId, seasonNumber, input.teamId],
    );
    if (desiredByes.length) {
      const values: unknown[] = [];
      const sqlRows = desiredByes.map((week, index) => {
        const base = index * 7;
        values.push(randomUUID(), leagueId, seasonNumber, input.teamId, week, firstRoundByes.has(week) ? "cfp_first_round" : "regular_season", new Date().toISOString());
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      });
      await client.query(
        `insert into rec_team_byes(id,league_id,season_number,team_id,week_number,bye_type,created_at) values ${sqlRows.join(",")}`,
        values,
      );
    }

    const assignments = await client.query(
      `select team_id,user_id from rec_team_assignments
       where league_id=$1 and assignment_status='active' and ended_at is null and team_id=any($2::uuid[])`,
      [leagueId, involvedTeamIds],
    );
    const userByTeam = new Map(assignments.rows.map((row) => [String(row.team_id), row.user_id]));
    const inserts = [...desiredByWeek.values()].filter(({ decision }) => {
      const preserved = relevantExisting.find((game) => preserveIds.has(String(game.id)) && Number(game.week_number) === decision.weekNumber);
      return !preserved;
    });
    if (inserts.length) {
      const values: unknown[] = [];
      const sqlRows = inserts.map(({ decision, homeTeamId, awayTeamId }, index) => {
        const base = index * 17;
        values.push(
          randomUUID(), leagueId, seasonId, decision.weekNumber, homeTeamId, awayTeamId,
          userByTeam.get(homeTeamId) ?? null, userByTeam.get(awayTeamId) ?? null,
          `manual:${leagueId}:${seasonNumber}:${decision.weekNumber}:${input.teamId}`,
          decision.postseasonRound ?? null, decision.bowlName?.trim() || null,
          Boolean(decision.isBowlGame), Boolean(decision.isNationalChampionship),
          "scheduled", decision.weekNumber >= 15 ? "playoffs" : "regular_season",
          new Date().toISOString(), new Date().toISOString(),
        );
        return `(${Array.from({ length: 17 }, (_, offset) => `$${base + offset + 1}`).join(",")})`;
      });
      await client.query(
        `insert into rec_games(id,league_id,season_id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,external_game_id,postseason_round,bowl_name,is_bowl_game,is_national_championship,status,phase,created_at,updated_at)
         values ${sqlRows.join(",")}`,
        values,
      );
    }
    for (const gameId of preserveIds) {
      const game = relevantExisting.find((row) => String(row.id) === gameId)!;
      const desired = desiredByWeek.get(Number(game.week_number))!;
      await client.query(
        `update rec_games set postseason_round=$2,bowl_name=$3,is_bowl_game=$4,is_national_championship=$5,updated_at=now() where id=$1`,
        [gameId, desired.decision.postseasonRound ?? null, desired.decision.bowlName?.trim() || null, Boolean(desired.decision.isBowlGame), Boolean(desired.decision.isNationalChampionship)],
      );
    }
    await client.query("commit");

    // Every H2H game from Conference Championship / Wild Card forward is an automatic GOTW
    // game, so schedule edits that place a postseason matchup need to trigger poll creation
    // too — not just the commissioner-advance flow (a commissioner filling in the CFP bracket
    // via this editor never touches completeAdvanceWeek for that week).
    const postseasonWeeks = [...new Set(
      input.decisions.map((decision) => decision.weekNumber).filter((week) => !isRegularSeasonWeek(week, context.rec_leagues.game)),
    )];
    for (const week of postseasonWeeks) {
      await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: week, allH2h: true }).catch((err) => {
        console.error("[ERROR] autoAssignGotwForWeek failed after a manual postseason schedule save (non-fatal):", err);
      });
    }

    return { saved: input.decisions.map((decision) => ({ weekNumber: decision.weekNumber, skipped: false })) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Clears a mistakenly-entered confirmed matchup for one team's week — deletes the shared
 * rec_games row outright (it's the same row both teams' schedule views read), only when
 * nothing depends on it yet. Once a result or box score exists, the game is locked; use the
 * ordinary re-pick flow (commitTeamScheduleDecisionsTransactional) to correct participants
 * on a still-unlocked game instead of a hard delete. */
export async function removeTeamScheduleGame(input: {
  guildId: string;
  teamId: string;
  weekNumber: number;
  seasonNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`schedule:${leagueId}:${seasonNumber}`]);

    const existing = await client.query(
      `select g.id,
              exists(select 1 from rec_game_results r where r.league_id=g.league_id and r.season_number=$3
                and r.week_number=g.week_number and r.home_team_id=g.home_team_id and r.away_team_id=g.away_team_id) as has_result,
              exists(select 1 from rec_box_score_submissions b where b.game_id=g.id and b.status in ('pending','approved')) as has_box_score
       from rec_games g
       where g.league_id=$1 and g.season_id=$2 and g.week_number=$4 and (g.home_team_id=$5 or g.away_team_id=$5)`,
      [leagueId, seasonId, seasonNumber, input.weekNumber, input.teamId],
    );
    const game = existing.rows[0];
    if (!game) throw new ApiError(404, "No scheduled game found for that week.");
    if (game.has_result || game.has_box_score) {
      throw new ApiError(409, "This game already has a recorded result or box score — reverse that first before removing it.");
    }
    await client.query(`delete from rec_games where id=$1`, [game.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return { removed: true as const };
}
