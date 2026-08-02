import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";

// Lazy — gotw.service.js's own dependency chain (Discord, economy, notifications) is heavy,
// and bracketDefinition() below is exercised by a pure unit test that shouldn't need it
// module-eval-time.
async function autoAssignGotwForWeek(input: { guildId: string; weekNumber: number; allH2h?: boolean }) {
  const mod = await import("../gotw/gotw.service.js");
  return mod.autoAssignGotwForWeek(input);
}

export type CfpRankingInput = {
  rank: number;
  teamId: string;
  conferenceChampion: boolean;
};

const ROUND_WEEK = {
  first_round: 16,
  quarterfinal: 17,
  semifinal: 18,
  championship: 19,
} as const;

async function recUserIdForDiscord(discordId: string | null): Promise<string | null> {
  if (!discordId) return null;
  const result = await getPgPool().query(
    `select user_id from rec_discord_accounts where discord_id=$1 limit 1`,
    [discordId],
  );
  return result.rows[0]?.user_id ?? null;
}

export async function saveCfpTop25(input: {
  guildId: string;
  seasonNumber?: number | null;
  rankings: CfpRankingInput[];
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") throw new ApiError(400, "CFP rankings are available only for CFB 27 leagues.");
  // The Top 25 poll is an up-to-the-playoffs system: once the league advances past the
  // conference championship week into the CFP first round, the poll is a historical record —
  // seeding/bracket edits from here on go through the separate bracket editor instead.
  const currentWeek = Number(context.rec_leagues.current_week ?? 0);
  if (currentWeek >= ROUND_WEEK.first_round) {
    throw new ApiError(400, "The CFP Top 25 poll is locked — the league has already advanced into the playoffs.");
  }
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  if (input.rankings.length < 12 || input.rankings.length > 25) {
    throw new ApiError(400, "Enter at least the top 12 teams (up to 25) to establish the playoff bracket.");
  }
  const ranks = new Set(input.rankings.map((row) => row.rank));
  const teams = new Set(input.rankings.map((row) => row.teamId));
  if (ranks.size !== input.rankings.length || teams.size !== input.rankings.length) {
    throw new ApiError(400, "Each ranking must use a unique team and a unique rank.");
  }
  if ([...ranks].some((rank) => rank < 1 || rank > 25)) throw new ApiError(400, "CFP ranks must be 1 through 25.");
  // The top-N must be contiguous (#1..#N) — skipping a rank (e.g. leaving #7 blank) would
  // misread which teams are the actual field.
  if (input.rankings.some((row, index) => row.rank !== index + 1)) {
    throw new ApiError(400, "Enter the top teams in order — the first N rankings must be #1 through #N.");
  }

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const valid = await client.query(
      `select count(*)::int as count from rec_teams where league_id=$1 and id=any($2::uuid[])`,
      [context.leagueId, [...teams]],
    );
    if (Number(valid.rows[0]?.count) !== input.rankings.length) throw new ApiError(400, "Every ranked team must belong to this league.");
    const userId = await recUserIdForDiscord(input.requestedByDiscordId ?? null);
    await client.query(`delete from rec_cfp_rankings where league_id=$1 and season_number=$2`, [context.leagueId, seasonNumber]);
    const values: unknown[] = [];
    const rows = input.rankings.map((row, index) => {
      const base = index * 6;
      values.push(context.leagueId, seasonNumber, row.rank, row.teamId, row.conferenceChampion, userId);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
    });
    await client.query(
      `insert into rec_cfp_rankings(league_id,season_number,rank,team_id,conference_champion,updated_by_user_id)
       values ${rows.join(",")}`,
      values,
    );
    await client.query("commit");
    // Saving the poll no longer generates the bracket — that's a distinct step (the
    // seeding editor), which defaults to these top-12 rankings but is independently
    // editable and re-generatable without touching the poll.
    return getCfpPostseasonState({ guildId: input.guildId, seasonNumber });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function bracketDefinition(seedToTeam: Map<number, string>) {
  const firstRound = [
    { slot: 1, homeSeed: 5, awaySeed: 12 },
    { slot: 2, homeSeed: 6, awaySeed: 11 },
    { slot: 3, homeSeed: 7, awaySeed: 10 },
    { slot: 4, homeSeed: 8, awaySeed: 9 },
  ].map((slot) => ({
    ...slot,
    homeTeamId: seedToTeam.get(slot.homeSeed)!,
    awayTeamId: seedToTeam.get(slot.awaySeed)!,
  }));
  return { firstRound };
}

export async function generateCfpBracket(input: {
  guildId: string;
  seasonNumber?: number | null;
  seeds?: Array<{ seed: number; teamId: string }>;
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") throw new ApiError(400, "CFP brackets are available only for CFB 27 leagues.");
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const ranked = await getPgPool().query(
    `select rank,team_id from rec_cfp_rankings where league_id=$1 and season_number=$2 and rank<=12 order by rank`,
    [context.leagueId, seasonNumber],
  );
  const seeds = input.seeds ?? ranked.rows.map((row) => ({ seed: Number(row.rank), teamId: String(row.team_id) }));
  if (seeds.length !== 12 || new Set(seeds.map((row) => row.seed)).size !== 12 || new Set(seeds.map((row) => row.teamId)).size !== 12) {
    throw new ApiError(400, "The CFP bracket requires 12 unique seeds and teams.");
  }
  const seedToTeam = new Map(seeds.map((row) => [row.seed, row.teamId]));
  if (Array.from({ length: 12 }, (_, index) => index + 1).some((seed) => !seedToTeam.has(seed))) {
    throw new ApiError(400, "CFP seeds must be numbered 1 through 12.");
  }
  const definition = bracketDefinition(seedToTeam);
  const actorUserId = await recUserIdForDiscord(input.requestedByDiscordId ?? null);
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`cfp:${context.leagueId}:${seasonNumber}`]);
    const bracket = await client.query(
      `insert into rec_cfp_brackets(league_id,season_number,status,generated_by_user_id)
       values($1,$2,'active',$3)
       on conflict(league_id,season_number) do update set status='active',generated_by_user_id=excluded.generated_by_user_id,generated_at=now(),updated_at=now()
       returning id`,
      [context.leagueId, seasonNumber, actorUserId],
    );
    const bracketId = bracket.rows[0].id as string;

    // A seeded team can already have a stray week-16 game that predates this bracket entirely
    // (e.g. a manually-entered placeholder from before the bracket tool worked, or before this
    // team was even seeded) — regenerating must not leave that sitting alongside the real
    // bracket game as a duplicate. Safe to clear: scoped to this exact week, only unscored
    // games, and never touches a game already tracked by any bracket slot (those are handled
    // by the branches below, including the completed-game lock).
    await client.query(
      `delete from rec_games
       where league_id=$1 and week_number=$2
         and (home_team_id = any($3::uuid[]) or away_team_id = any($3::uuid[]))
         and home_score is null and away_score is null
         and id not in (select game_id from rec_cfp_bracket_slots where game_id is not null)`,
      [context.leagueId, ROUND_WEEK.first_round, [...seedToTeam.values()]],
    );

    const existingCompleted = await client.query(
      `select s.id,s.round,s.slot_number,s.home_team_id,s.away_team_id
       from rec_cfp_bracket_slots s
       join rec_games g on g.id=s.game_id
       where s.bracket_id=$1 and (
         g.status='completed' or g.home_score is not null or g.away_score is not null or
         exists(select 1 from rec_game_results r where r.league_id=g.league_id and r.season_number=$2
           and r.week_number=g.week_number and r.home_team_id=g.home_team_id and r.away_team_id=g.away_team_id)
       )`,
      [bracketId, seasonNumber],
    );
    if (existingCompleted.rowCount) {
      const slots = await client.query(
        `select id,round,slot_number,home_seed,away_seed,home_team_id,away_team_id,game_id
         from rec_cfp_bracket_slots where bracket_id=$1`,
        [bracketId],
      );
      const completedIds = new Set(existingCompleted.rows.map((row) => String(row.id)));
      const assignmentRows = await client.query(
        `select team_id,user_id from rec_team_assignments
         where league_id=$1 and team_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
        [context.leagueId, [...seedToTeam.values()]],
      );
      const userByTeam = new Map(assignmentRows.rows.map((row) => [String(row.team_id), row.user_id]));
      for (const row of definition.firstRound) {
        const slot = slots.rows.find((item) => item.round === "first_round" && Number(item.slot_number) === row.slot);
        if (!slot) throw new ApiError(409, "The saved CFP bracket is incomplete; contact an administrator.");
        if (completedIds.has(String(slot.id))) {
          if (String(slot.home_team_id) !== row.homeTeamId || String(slot.away_team_id) !== row.awayTeamId) {
            throw new ApiError(409, `First-round game ${row.slot} is complete, so its participants cannot be changed.`);
          }
          continue;
        }
        await client.query(
          `update rec_cfp_bracket_slots set home_seed=$2,away_seed=$3,home_team_id=$4,away_team_id=$5,updated_at=now() where id=$1`,
          [slot.id, row.homeSeed, row.awaySeed, row.homeTeamId, row.awayTeamId],
        );
        if (slot.game_id) {
          await client.query(
            `update rec_games set home_team_id=$2,away_team_id=$3,home_user_id=$4,away_user_id=$5,updated_at=now() where id=$1`,
            [slot.game_id, row.homeTeamId, row.awayTeamId, userByTeam.get(row.homeTeamId) ?? null, userByTeam.get(row.awayTeamId) ?? null],
          );
        }
      }
      const quarterByeSeeds = [1, 4, 2, 3];
      for (let index = 0; index < quarterByeSeeds.length; index += 1) {
        const slot = slots.rows.find((item) => item.round === "quarterfinal" && Number(item.slot_number) === index + 1);
        if (!slot) continue;
        const seed = quarterByeSeeds[index];
        const teamId = seedToTeam.get(seed)!;
        if (completedIds.has(String(slot.id))) {
          if (String(slot.home_team_id) !== teamId) {
            throw new ApiError(409, `Quarterfinal game ${index + 1} is complete, so its participants cannot be changed.`);
          }
          continue;
        }
        if (slot.game_id) await client.query(`delete from rec_games where id=$1`, [slot.game_id]);
        await client.query(
          `update rec_cfp_bracket_slots set home_seed=$2,home_team_id=$3,away_team_id=null,game_id=null,updated_at=now() where id=$1`,
          [slot.id, seed, teamId],
        );
      }
      for (const slot of slots.rows.filter((item) => item.round === "semifinal" || item.round === "championship")) {
        if (completedIds.has(String(slot.id))) continue;
        if (slot.game_id) await client.query(`delete from rec_games where id=$1`, [slot.game_id]);
        await client.query(
          `update rec_cfp_bracket_slots set home_team_id=null,away_team_id=null,game_id=null,updated_at=now() where id=$1`,
          [slot.id],
        );
      }
      await client.query(`delete from rec_team_byes where league_id=$1 and season_number=$2 and week_number=16 and bye_type='cfp_first_round'`, [context.leagueId, seasonNumber]);
      for (const seed of [1, 2, 3, 4]) {
        await client.query(
          `insert into rec_team_byes(id,league_id,season_number,team_id,week_number,bye_type,created_at)
           values($1,$2,$3,$4,16,'cfp_first_round',now())
           on conflict(league_id,season_number,team_id,week_number) do update set bye_type='cfp_first_round'`,
          [randomUUID(), context.leagueId, seasonNumber, seedToTeam.get(seed)],
        );
      }
      await client.query("commit");
      const result = await getCfpPostseasonState({ guildId: input.guildId, seasonNumber });
      await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: 16, allH2h: true }).catch((err) => {
        console.error("[ERROR] autoAssignGotwForWeek failed after regenerating the CFP bracket (non-fatal):", err);
      });
      return result;
    }
    await client.query(`delete from rec_games where id in (select game_id from rec_cfp_bracket_slots where bracket_id=$1 and game_id is not null)`, [bracketId]);
    await client.query(`delete from rec_cfp_bracket_slots where bracket_id=$1`, [bracketId]);

    const firstRoundSlotIds: string[] = [];
    for (const row of definition.firstRound) {
      const gameId = randomUUID();
      const users = await client.query(
        `select team_id,user_id from rec_team_assignments
         where league_id=$1 and team_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
        [context.leagueId, [row.homeTeamId, row.awayTeamId]],
      );
      const userByTeam = new Map(users.rows.map((user) => [String(user.team_id), user.user_id]));
      await client.query(
        `insert into rec_games(id,league_id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,source,external_game_id,is_bowl_game,postseason_round,created_at,updated_at)
         values($1,$2,$3,16,'playoffs',$4,$5,$6,$7,'scheduled','cfp_bracket',$8,false,'cfp_first_round',now(),now())`,
        [gameId, context.leagueId, seasonId, row.homeTeamId, row.awayTeamId, userByTeam.get(row.homeTeamId) ?? null, userByTeam.get(row.awayTeamId) ?? null, `cfp:${context.leagueId}:${seasonNumber}:first_round:${row.slot}`],
      );
      const slot = await client.query(
        `insert into rec_cfp_bracket_slots(bracket_id,round,slot_number,home_seed,away_seed,home_team_id,away_team_id,game_id)
         values($1,'first_round',$2,$3,$4,$5,$6,$7) returning id`,
        [bracketId, row.slot, row.homeSeed, row.awaySeed, row.homeTeamId, row.awayTeamId, gameId],
      );
      firstRoundSlotIds.push(String(slot.rows[0].id));
    }

    const quarterfinals = [
      { slot: 1, byeSeed: 1, source: firstRoundSlotIds[3] },
      { slot: 2, byeSeed: 4, source: firstRoundSlotIds[0] },
      { slot: 3, byeSeed: 2, source: firstRoundSlotIds[2] },
      { slot: 4, byeSeed: 3, source: firstRoundSlotIds[1] },
    ];
    const quarterIds: string[] = [];
    for (const row of quarterfinals) {
      const inserted = await client.query(
        `insert into rec_cfp_bracket_slots(bracket_id,round,slot_number,home_seed,home_team_id,source_away_slot_id)
         values($1,'quarterfinal',$2,$3,$4,$5) returning id`,
        [bracketId, row.slot, row.byeSeed, seedToTeam.get(row.byeSeed), row.source],
      );
      quarterIds.push(String(inserted.rows[0].id));
    }
    const semifinalIds: string[] = [];
    for (const row of [{ slot: 1, home: quarterIds[0], away: quarterIds[1] }, { slot: 2, home: quarterIds[2], away: quarterIds[3] }]) {
      const inserted = await client.query(
        `insert into rec_cfp_bracket_slots(bracket_id,round,slot_number,source_home_slot_id,source_away_slot_id)
         values($1,'semifinal',$2,$3,$4) returning id`,
        [bracketId, row.slot, row.home, row.away],
      );
      semifinalIds.push(String(inserted.rows[0].id));
    }
    await client.query(
      `insert into rec_cfp_bracket_slots(bracket_id,round,slot_number,source_home_slot_id,source_away_slot_id)
       values($1,'championship',1,$2,$3)`,
      [bracketId, semifinalIds[0], semifinalIds[1]],
    );
    await client.query(`delete from rec_team_byes where league_id=$1 and season_number=$2 and week_number=16 and bye_type='cfp_first_round'`, [context.leagueId, seasonNumber]);
    for (const seed of [1, 2, 3, 4]) {
      await client.query(
        `insert into rec_team_byes(id,league_id,season_number,team_id,week_number,bye_type,created_at)
         values($1,$2,$3,$4,16,'cfp_first_round',now())
         on conflict(league_id,season_number,team_id,week_number) do update set bye_type='cfp_first_round'`,
        [randomUUID(), context.leagueId, seasonNumber, seedToTeam.get(seed)],
      );
    }
    await client.query("commit");
    const result = await getCfpPostseasonState({ guildId: input.guildId, seasonNumber });
    await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: 16, allH2h: true }).catch((err) => {
      console.error("[ERROR] autoAssignGotwForWeek failed after generating the CFP bracket (non-fatal):", err);
    });
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCfpPostseasonState(input: { guildId: string; seasonNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const newlyScheduledWeeks = await synchronizeCfpBracket(context.leagueId, seasonId, seasonNumber);
  for (const week of newlyScheduledWeeks) {
    await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: week, allH2h: true }).catch((err) => {
      console.error("[ERROR] autoAssignGotwForWeek failed after the CFP bracket advanced a round (non-fatal):", err);
    });
  }
  const [rankings, bracket] = await Promise.all([
    getPgPool().query(
      `select r.rank,r.team_id,r.conference_champion,t.name,t.abbreviation,t.conference
       from rec_cfp_rankings r join rec_teams t on t.id=r.team_id
       where r.league_id=$1 and r.season_number=$2 order by r.rank`,
      [context.leagueId, seasonNumber],
    ),
    getPgPool().query(
      `select b.id,b.status,s.id as slot_id,s.round,s.slot_number,s.home_seed,s.away_seed,
              s.home_team_id,s.away_team_id,s.source_home_slot_id,s.source_away_slot_id,s.game_id,s.bowl_name,
              ht.name as home_team_name,at.name as away_team_name,g.status as game_status,g.home_score,g.away_score
       from rec_cfp_brackets b left join rec_cfp_bracket_slots s on s.bracket_id=b.id
       left join rec_teams ht on ht.id=s.home_team_id left join rec_teams at on at.id=s.away_team_id
       left join rec_games g on g.id=s.game_id
       where b.league_id=$1 and b.season_number=$2
       order by case s.round when 'first_round' then 1 when 'quarterfinal' then 2 when 'semifinal' then 3 else 4 end,s.slot_number`,
      [context.leagueId, seasonNumber],
    ),
  ]);
  const currentWeek = Number(context.rec_leagues.current_week ?? 0);
  return { seasonNumber, currentWeek, top25Locked: currentWeek >= ROUND_WEEK.first_round, rankings: rankings.rows, bracket: bracket.rows };
}

export { ROUND_WEEK };

async function synchronizeCfpBracket(leagueId: string, seasonId: string, seasonNumber: number): Promise<number[]> {
  const bracket = await getPgPool().query(`select id from rec_cfp_brackets where league_id=$1 and season_number=$2`, [leagueId, seasonNumber]);
  if (!bracket.rows[0]) return [];
  const bracketId = String(bracket.rows[0].id);
  const client = await getPgPool().connect();
  const newlyScheduledWeeks = new Set<number>();
  const defaultBowls: Record<string, string[]> = {
    quarterfinal: ["Vrbo Fiesta Bowl", "Chick-fil-A Peach Bowl", "Goodyear Cotton Bowl", "Rose Bowl Game"],
    semifinal: ["Capital One Orange Bowl", "Allstate Sugar Bowl"],
    championship: ["CFP National Championship"],
  };
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`cfp-sync:${bracketId}`]);
    for (const round of ["quarterfinal", "semifinal", "championship"] as const) {
      const slots = await client.query(
        `select s.*,hs.home_team_id as source_home_team,hs.away_team_id as source_home_away,hs.game_id as source_home_game,
                aas.home_team_id as source_away_team,aas.away_team_id as source_away_away,aas.game_id as source_away_game
         from rec_cfp_bracket_slots s
         left join rec_cfp_bracket_slots hs on hs.id=s.source_home_slot_id
         left join rec_cfp_bracket_slots aas on aas.id=s.source_away_slot_id
         where s.bracket_id=$1 and s.round=$2 order by s.slot_number`,
        [bracketId, round],
      );
      for (const slot of slots.rows) {
        const winner = async (gameId: string | null, home: string | null, away: string | null) => {
          if (!gameId || !home || !away) return null;
          const result = await client.query(
            `select coalesce(g.home_score,r.home_score) home_score,coalesce(g.away_score,r.away_score) away_score
             from rec_games g left join rec_game_results r on r.league_id=g.league_id and r.season_number=$2
               and r.week_number=g.week_number and r.home_team_id=g.home_team_id and r.away_team_id=g.away_team_id
             where g.id=$1`,
            [gameId, seasonNumber],
          );
          const scores = result.rows[0];
          if (scores?.home_score == null || scores?.away_score == null || Number(scores.home_score) === Number(scores.away_score)) return null;
          return Number(scores.home_score) > Number(scores.away_score) ? home : away;
        };
        const sourcedHome = slot.source_home_slot_id ? await winner(slot.source_home_game, slot.source_home_team, slot.source_home_away) : null;
        const sourcedAway = slot.source_away_slot_id ? await winner(slot.source_away_game, slot.source_away_team, slot.source_away_away) : null;
        const homeTeamId = slot.home_team_id ?? sourcedHome;
        const awayTeamId = slot.away_team_id ?? sourcedAway;
        if ((sourcedHome && !slot.home_team_id) || (sourcedAway && !slot.away_team_id)) {
          await client.query(`update rec_cfp_bracket_slots set home_team_id=coalesce(home_team_id,$2),away_team_id=coalesce(away_team_id,$3),updated_at=now() where id=$1`, [slot.id, sourcedHome, sourcedAway]);
        }
        if (!slot.game_id && homeTeamId && awayTeamId) {
          const gameId = randomUUID();
          const week = ROUND_WEEK[round];
          const bowlName = slot.bowl_name || defaultBowls[round][Number(slot.slot_number) - 1] || null;
          const assignments = await client.query(
            `select team_id,user_id from rec_team_assignments where league_id=$1 and team_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
            [leagueId, [homeTeamId, awayTeamId]],
          );
          const userByTeam = new Map(assignments.rows.map((row) => [String(row.team_id), row.user_id]));
          await client.query(
            `insert into rec_games(id,league_id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,source,external_game_id,is_bowl_game,is_national_championship,postseason_round,bowl_name,created_at,updated_at)
             values($1,$2,$3,$4,'playoffs',$5,$6,$7,$8,'scheduled','cfp_bracket',$9,false,$10,$11,$12,now(),now())`,
            [gameId, leagueId, seasonId, week, homeTeamId, awayTeamId, userByTeam.get(homeTeamId) ?? null, userByTeam.get(awayTeamId) ?? null,
              `cfp:${leagueId}:${seasonNumber}:${round}:${slot.slot_number}`, round === "championship", round === "quarterfinal" ? "cfp_quarterfinals" : round === "semifinal" ? "cfp_semifinals" : "national_championship", bowlName],
          );
          await client.query(`update rec_cfp_bracket_slots set game_id=$2,bowl_name=$3,updated_at=now() where id=$1`, [slot.id, gameId, bowlName]);
          newlyScheduledWeeks.add(week);
        }
      }
    }
    await client.query("commit");
    return [...newlyScheduledWeeks];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
