import type { PoolClient } from "pg";
import { canonicalizeStatPayload, normalizeMaddenDevTrait } from "@rec/shared";
import type { MaddenEndpointKey } from "./madden-companion.service.js";
import type { NormalizedCompanionRecord } from "./madden-companion.adapters.js";
import { mapEaTeamWeeklyStats } from "./team-stats-map.js";
import { abbreviationMatchValues, preferredRecAbbreviation } from "./team-identity.js";
import { eaScheduleExternalId } from "../madden-ea/ea-weeks.js";
import { normalizeImportedEaUsername } from "../madden-ea/ea-datasets.js";

type Json = Record<string, unknown>;

function value(row: Json, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return null;
}
function text(row: Json, keys: string[]) {
  const found = value(row, keys);
  return found === null ? null : String(found).trim() || null;
}
function integer(row: Json, keys: string[]) {
  const found = value(row, keys);
  const parsed = Number(found);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
function bool(row: Json, keys: string[]) {
  const found = value(row, keys);
  if (typeof found === "boolean") return found;
  if (found === 1 || String(found).toLowerCase() === "true") return true;
  if (found === 0 || String(found).toLowerCase() === "false") return false;
  return null;
}

const STAT_METADATA_KEYS = new Set([
  "id", "statid", "stat_id", "leagueid", "league_id", "seasonid", "season_id", "seasonyear", "season_year",
  "week", "weekindex", "week_index", "weeklabel", "week_label", "stage", "stageindex", "stage_index",
  "seasonindex", "season_index", "seasonstage", "season_stage", "teamid", "team_id", "maddenteamid",
  "madden_team_id", "playerid", "player_id", "maddenplayerid", "madden_player_id", "rosterid", "roster_id", "gameid",
  "game_id", "scheduleid", "schedule_id", "firstname", "first_name", "lastname", "last_name", "fullname", "full_name",
  "displayname", "display_name", "playername", "player_name", "teamname", "team_name", "position", "positionname",
  "positionabbr", "statcategory", "stat_category", "category", "createdat", "created_at", "updatedat", "updated_at",
  "isplayoff", "is_playoff", "seed", "totalwins", "totallosses", "totalties",
]);

function isNonAdditiveStatKey(key: string) {
  const lower = key.toLowerCase();
  if (STAT_METADATA_KEYS.has(lower)) return true;
  if (/(per(game|att|play|rush|pass)|convpct|comppct|topct)$/.test(lower)) return true;
  return false;
}

function statPayload(row: Json): Json {
  const raw: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isNonAdditiveStatKey(key)) continue;
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (Number.isFinite(number)) raw[key] = number;
  }
  // Every downstream reader (League Stats, League Records, season/career totals, badges)
  // looks up by canonical key — store canonical, not EA's raw field names, or those reads
  // silently find nothing.
  return canonicalizeStatPayload(raw);
}

async function teamId(client: PoolClient, leagueId: string, sourceTeamId: string | null) {
  if (!sourceTeamId) return null;
  return (await client.query<{ id: string }>("select id from rec_teams where league_id=$1 and madden_team_id=$2 limit 1", [leagueId, sourceTeamId])).rows[0]?.id ?? null;
}

async function applyTeam(client: PoolClient, leagueId: string, record: NormalizedCompanionRecord) {
  const row = record.rawData;
  const sourceId = record.sourceTeamId ?? text(row, ["teamId", "team_id"]);
  if (!sourceId) return;
  const name = text(row, ["displayName", "display_name", "fullName", "full_name", "name", "teamName", "team_name"]);
  const abbreviation = text(row, ["abbrName", "abbr_name", "abbreviation", "abbr", "teamAbbr"]);
  const nickName = text(row, ["nickName", "nick_name", "nick"]);
  const cityName = text(row, ["cityName", "city_name", "city", "displayCity", "display_city"]);
  const cityNick = cityName && (nickName || name) ? `${cityName} ${nickName || name}` : null;
  const abbrAliases = abbreviationMatchValues(abbreviation);
  const storedAbbr = preferredRecAbbreviation(abbreviation);
  const existing = await client.query<{ id: string }>(
    `select id from rec_teams
      where league_id=$1 and (
        madden_team_id=$2
        or ($3::text is not null and upper(abbreviation) = any($6::text[]))
        or ($4::text is not null and lower(name) = lower($4))
        or ($5::text is not null and (
             lower(name) = lower($5)
             or lower(name) like '% ' || lower($5)
             or lower(coalesce(display_nick, '')) = lower($5)
           ))
        or ($7::text is not null and lower(name) = lower($7))
      )
      order by (madden_team_id=$2) desc
      limit 1`,
    [leagueId, sourceId, abbreviation, name, nickName || name, abbrAliases, cityNick],
  );
  if (existing.rows[0]) {
    const eaUsername = normalizeImportedEaUsername(text(row, ["userName", "user_name", "gamertag", "gamerTag"]));
    await client.query(
      `update rec_teams set madden_team_id=$3,
       abbreviation=coalesce(abbreviation, $4),
       conference=coalesce($5,conference), division=coalesce($6,division), ea_username=$7, updated_at=now() where id=$1 and league_id=$2`,
      [existing.rows[0].id, leagueId, sourceId, storedAbbr, text(row, ["conference", "conferenceName"]), text(row, ["division", "divName"]), eaUsername],
    );
  }
}

async function applyRosterPlayer(client: PoolClient, leagueId: string, record: NormalizedCompanionRecord) {
  const row = record.rawData;
  const playerId = record.sourcePlayerId;
  if (!playerId) return;
  const first = text(row, ["firstName", "first_name", "first"]);
  const last = text(row, ["lastName", "last_name", "last"]);
  const full = text(row, ["fullName", "full_name", "displayName", "playerName"]) ?? ([first, last].filter(Boolean).join(" ") || `Player ${playerId}`);
  const resolvedTeamId = await teamId(client, leagueId, record.sourceTeamId);

  // Same placeholder-adoption ea-direct-writer.ts's directWriteRoster does: a baseline-seeded
  // or legend/custom-player row carries a synthetic madden_player_id ("madden27:...", or a
  // "legend:<catalogId>:<buildId>" style id) that never conflicts with EA's real numeric roster
  // id below, so without this a companion-app import (or the applyPlayerStats fallback that
  // calls this function) silently inserts a brand-new duplicate row instead of adopting the
  // identity of the player it's actually supposed to represent — leaving the real legend row
  // stuck roster_status='removed' with the height/weight/attributes only the duplicate has.
  if (resolvedTeamId) {
    const taken = await client.query<{ id: string }>(
      `select id from rec_players where league_id=$1 and madden_player_id=$2 limit 1`,
      [leagueId, playerId],
    );
    if (!taken.rows[0]) {
      const placeholder = await client.query<{ id: string }>(
        `select id from rec_players
         where league_id=$1 and team_id=$2 and lower(full_name)=lower($3)
           and (madden_player_id is null or madden_player_id !~ '^[0-9]+$')
         order by (player_source in ('legend','custom_player')) desc, created_at asc
         limit 1`,
        [leagueId, resolvedTeamId, full],
      );
      if (placeholder.rows[0]) {
        await client.query(
          `update rec_players set madden_player_id=$2, updated_at=now()
           where id=$1
             and not exists (
               select 1 from rec_players other
                where other.league_id = rec_players.league_id
                  and other.madden_player_id = $2
                  and other.id <> rec_players.id
             )`,
          [placeholder.rows[0].id, playerId],
        );
      }
    }
  }

  await client.query(
    `insert into rec_players
       (league_id,madden_player_id,first_name,last_name,full_name,position,team_id,overall_rating,dev_trait,
        jersey_number,years_pro,age,contract_years_left,attributes,raw_payload,player_source,roster_status,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,'madden_companion','active',now())
     on conflict (league_id,madden_player_id) do update set
       first_name=coalesce(excluded.first_name,rec_players.first_name), last_name=coalesce(excluded.last_name,rec_players.last_name),
       full_name=excluded.full_name, position=coalesce(excluded.position,rec_players.position), team_id=coalesce(excluded.team_id,rec_players.team_id),
       overall_rating=coalesce(excluded.overall_rating,rec_players.overall_rating), dev_trait=coalesce(excluded.dev_trait,rec_players.dev_trait),
       jersey_number=coalesce(excluded.jersey_number,rec_players.jersey_number), years_pro=coalesce(excluded.years_pro,rec_players.years_pro),
       age=coalesce(excluded.age,rec_players.age),
       contract_years_left=coalesce(excluded.contract_years_left,rec_players.contract_years_left),
       attributes=case when excluded.attributes='{}'::jsonb then rec_players.attributes else excluded.attributes end,
       raw_payload=excluded.raw_payload, roster_status='active', updated_at=now()`,
    [leagueId, playerId, first, last, full, text(row, ["position", "positionName", "positionAbbr"]), resolvedTeamId,
      integer(row, ["overallRating", "overall", "ovrRating", "ovr"]),
      normalizeMaddenDevTrait(value(row, ["devTrait", "developmentTrait", "dev_trait", "signature", "playerBest"]))
        ?? normalizeMaddenDevTrait(integer(row, ["devTrait", "developmentTrait", "dev_trait"])),
      integer(row, ["jerseyNum", "jerseyNumber", "jersey_number"]), integer(row, ["yearsPro", "experience"]),
      integer(row, ["age", "playerAge", "player_age"]),
      integer(row, ["contractYearsLeft", "contract_years_left"]), JSON.stringify(value(row, ["attributes", "ratings"]) ?? {}), JSON.stringify(row)],
  );
}

async function applySchedule(client: PoolClient, leagueId: string, record: NormalizedCompanionRecord) {
  const row = record.rawData;
  const rawScheduleId = record.sourceGameId ?? record.recordKey;
  const weekNumber = record.weekNumber;
  const externalId = weekNumber != null && record.sourceGameId
    ? eaScheduleExternalId(weekNumber, record.sourceGameId)
    : rawScheduleId;
  const homeSource = text(row, ["homeTeamId", "home_team_id"]);
  const awaySource = text(row, ["awayTeamId", "away_team_id"]);
  const home = await teamId(client, leagueId, homeSource);
  const away = await teamId(client, leagueId, awaySource);
  const homeScore = integer(row, ["homeScore", "home_score"]);
  const awayScore = integer(row, ["awayScore", "away_score"]);
  // EA sends every scheduled game with scores present but zeroed and status=1 (NOT_PLAYED),
  // so scores alone cannot mean "final" or unplayed games import as 0-0 completed.
  const eaStatus = integer(row, ["status", "gameStatus"]);
  const played = bool(row, ["isGamePlayed", "is_game_played"]);
  const completed = played === true
    || (played === null && eaStatus !== null && eaStatus > 1)
    || (played === null && eaStatus === null && homeScore !== null && awayScore !== null);
  // Null the 0-0 placeholder for an unplayed game instead of writing it through -- readers
  // downstream (e.g. GOTW nomination) reasonably read a null score as "not played yet" and a
  // literal 0-0 broke that for every not-yet-played Madden game (see ea-direct-writer.ts's
  // identical fix).
  const finalHomeScore = completed ? homeScore : null;
  const finalAwayScore = completed ? awayScore : null;
  const gameId = await resolveImportedGameId(client, {
    leagueId, weekNumber, homeTeamId: home, awayTeamId: away,
    scopedExternalId: externalId, legacyExternalId: record.sourceGameId,
  });
  if (gameId) {
    await client.query(
      `update rec_games set week_number=coalesce($2, week_number), phase=$3,
         home_team_id=coalesce($4, home_team_id), away_team_id=coalesce($5, away_team_id),
         home_score=$6, away_score=$7, status=$8, source='madden_companion_export',
         import_verified=true, external_game_id=$9, updated_at=now()
       where id=$1`,
      [gameId, weekNumber, seasonStage(row, record), home, away, finalHomeScore, finalAwayScore, completed ? "completed" : "scheduled", externalId],
    );
    return;
  }
  await client.query(
    `insert into rec_games(league_id,week_number,phase,home_team_id,away_team_id,home_score,away_score,status,source,import_verified,manual_entered,result_payout_eligible,eos_payout_eligible,external_game_id,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'madden_companion_export',true,false,true,true,$9,now())
     on conflict (league_id,external_game_id) where external_game_id is not null do update set
       week_number=excluded.week_number,home_team_id=coalesce(excluded.home_team_id,rec_games.home_team_id),
       away_team_id=coalesce(excluded.away_team_id,rec_games.away_team_id),home_score=excluded.home_score,
       away_score=excluded.away_score,status=excluded.status,source='madden_companion_export',import_verified=true,updated_at=now()`,
    [leagueId, weekNumber, seasonStage(row, record), home, away, finalHomeScore, finalAwayScore, completed ? "completed" : "scheduled", externalId],
  );
}

async function resolveImportedGameId(
  client: PoolClient,
  input: {
    leagueId: string;
    weekNumber: number | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    scopedExternalId: string | null;
    legacyExternalId: string | null;
  },
): Promise<string | null> {
  if (input.homeTeamId && input.awayTeamId && input.weekNumber != null) {
    const matchup = await client.query<{ id: string }>(
      `select id from rec_games
        where league_id=$1 and week_number=$2 and home_team_id=$3 and away_team_id=$4
        limit 1`,
      [input.leagueId, input.weekNumber, input.homeTeamId, input.awayTeamId],
    );
    if (matchup.rows[0]) return matchup.rows[0].id;
  }
  if (input.scopedExternalId) {
    const scoped = await client.query<{ id: string }>(
      `select id from rec_games where league_id=$1 and external_game_id=$2 limit 1`,
      [input.leagueId, input.scopedExternalId],
    );
    if (scoped.rows[0]) return scoped.rows[0].id;
  }
  // Pre-week-scoped imports stored the bare EA scheduleId. Adopt that row only when it already
  // sits on this week — otherwise week 2 would steal week 1's game.
  if (input.legacyExternalId && input.weekNumber != null) {
    const legacy = await client.query<{ id: string }>(
      `select id from rec_games
        where league_id=$1 and external_game_id=$2 and week_number=$3
        limit 1`,
      [input.leagueId, input.legacyExternalId, input.weekNumber],
    );
    if (legacy.rows[0]) return legacy.rows[0].id;
  }
  return null;
}

/**
 * Resolves preseason/regular_season/playoffs for an imported row.
 *
 * EA does not send a phase. It sends stageIndex (0 preseason, 1 everything else) and a week
 * index that keeps counting through the playoffs, so the postseason has to be recognised from
 * the week itself: display weeks 19/20/21 are the playoff rounds and 23 is the Super Bowl
 * (22 is the Pro Bowl, which exports no data).
 */
function seasonStage(row: Json, record: NormalizedCompanionRecord): "preseason" | "regular_season" | "playoffs" {
  const explicit = text(row, ["seasonStage", "season_stage", "phase"]);
  if (explicit === "preseason" || explicit === "regular_season" || explicit === "playoffs") return explicit;
  const stageIndex = integer(row, ["stageIndex", "stage_index"]);
  if (stageIndex === 0) return "preseason";
  if (bool(row, ["isPlayoff", "is_playoff"]) === true) return "playoffs";
  const week = record.weekNumber ?? integer(row, ["week", "weekNumber", "week_number"]);
  if (week !== null && (week === 19 || week === 20 || week === 21 || week === 23)) return "playoffs";
  return "regular_season";
}

function statCategory(row: Json, record: NormalizedCompanionRecord) {
  if (record.statCategory) return record.statCategory.toLowerCase();
  const keys = Object.keys(row).join(" ").toLowerCase();
  // Order matters, and each pattern is anchored to the prefix EA actually uses. Defence is
  // tested before receiving because defensive rows carry `deffumrec`, which contains "rec".
  if (/\bdef[a-z]*|tackle|sack|interception/.test(keys)) return "defense";
  if (/\bpass[a-z]*/.test(keys)) return "passing";
  if (/\brush[a-z]*/.test(keys)) return "rushing";
  if (/\brec[a-z]*|catch/.test(keys)) return "receiving";
  if (/\bpunt[a-z]*/.test(keys)) return "punting";
  if (/\bkick[a-z]*|fieldgoal|\bfg|\bxp/.test(keys)) return "kicking";
  return "all";
}

async function applyPlayerStats(client: PoolClient, leagueId: string, canonicalRecordId: string, seasonKey: string, record: NormalizedCompanionRecord) {
  if (!record.sourcePlayerId) return;
  let player = (await client.query<{ id: string; full_name: string; position: string | null }>(
    "select id,full_name,position from rec_players where league_id=$1 and madden_player_id=$2 limit 1", [leagueId, record.sourcePlayerId],
  )).rows[0];
  if (!player) {
    await applyRosterPlayer(client, leagueId, record);
    player = (await client.query("select id,full_name,position from rec_players where league_id=$1 and madden_player_id=$2 limit 1", [leagueId, record.sourcePlayerId])).rows[0];
  }
  if (!player) return;
  const resolvedTeamId = await teamId(client, leagueId, record.sourceTeamId);
  const team = resolvedTeamId ? (await client.query<{ name: string }>("select name from rec_teams where id=$1", [resolvedTeamId])).rows[0] : null;
  // seasonKey is EA's own companion-API season identifier (0-indexed, and unrelated to our
  // season numbering) — it's fine as the external dedup key for rec_madden_companion_records,
  // but rec_player_weekly_stats.season_number must always be OUR league's actual season
  // number, or every stat row lands in "season 0" and never matches any real season/career
  // query (League Records, season/career stat totals — all of it silently reads back empty).
  const season = (await client.query<{ season_number: number }>("select season_number from rec_leagues where id=$1", [leagueId])).rows[0].season_number;
  const category = statCategory(record.rawData, record);
  const weekNumber = record.weekNumber ?? 0;
  const sourceWeekIndex = record.sourceWeekIndex ?? (weekNumber > 0 ? weekNumber - 1 : 0);
  const sourceScheduleId = record.sourceGameId && record.weekNumber != null
    ? eaScheduleExternalId(record.weekNumber, record.sourceGameId)
    : (record.sourceGameId ?? `week:${record.weekNumber ?? "season"}`);
  // Two unique indexes can fire here: the business identity
  // (league/season/team/player/category/source_stat/source_schedule) and
  // rec_player_weekly_stats_companion_record_key (one weekly-stats row per companion
  // record). Postgres INSERT can only ON CONFLICT one of them. Re-imports mint a new
  // companion record, so we upsert on identity; if this companion record is already
  // pointed at a different identity (shared scheduleId keys, duplicate payload rows),
  // detach it first so the insert does not bounce off companion_record_key.
  // Two statements on purpose: a data-modifying CTE shares a snapshot with the INSERT
  // and would not see the detach.
  await client.query(
    `update rec_player_weekly_stats
        set source_companion_record_id = null
      where source_companion_record_id = $1`,
    [canonicalRecordId],
  );
  // Key format used to omit week, so the same player+game+category from week 2 would
  // ON CONFLICT onto week 1. Drop any existing row for this player/week/category (including
  // legacy keys) so the insert below is the single source of truth for that line.
  await client.query(
    `delete from rec_player_weekly_stats
      where league_id=$1 and season_number=$2 and madden_player_id=$3
        and stat_category=$4 and week_number=$5`,
    [leagueId, season, record.sourcePlayerId, category, weekNumber],
  );
  await client.query(
    `insert into rec_player_weekly_stats
       (league_id,season_number,season_stage,week_number,player_id,team_id,madden_player_id,madden_team_id,
        player_name,team_name,position,stat_category,stats,raw_payload,source_stat_id,source_schedule_id,
        source_week_index,source_team_id,source_roster_id,source_type,source_companion_record_id,updated_at)
     values ($1,$2,$17,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$18,$7,$6,'madden_companion',$16,now())
     on conflict (league_id,season_number,team_id,player_id,madden_player_id,stat_category,source_stat_id,source_schedule_id) do update set
       season_stage=excluded.season_stage,week_number=excluded.week_number,
       player_name=excluded.player_name,team_name=excluded.team_name,position=excluded.position,
       stats=excluded.stats,raw_payload=excluded.raw_payload,source_companion_record_id=excluded.source_companion_record_id,
       source_week_index=excluded.source_week_index,updated_at=now()`,
    [leagueId, season, weekNumber, player.id, resolvedTeamId, record.sourcePlayerId, record.sourceTeamId,
      player.full_name, team?.name ?? null, player.position, category, JSON.stringify(statPayload(record.rawData)), JSON.stringify(record.rawData),
      record.recordKey, sourceScheduleId, canonicalRecordId,
      seasonStage(record.rawData, record), sourceWeekIndex],
  );
}

async function resolveTeamStatsGame(
  client: PoolClient,
  input: {
    leagueId: string;
    teamId: string;
    weekNumber: number | null;
    scopedExternalId: string | null;
    legacyExternalId: string | null;
  },
): Promise<{ id: string; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; phase: string | null } | null> {
  const columns = "id,home_team_id,away_team_id,home_score,away_score,phase";
  if (input.scopedExternalId) {
    const scoped = await client.query<{ id: string; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; phase: string | null }>(
      `select ${columns} from rec_games where league_id=$1 and external_game_id=$2 limit 1`,
      [input.leagueId, input.scopedExternalId],
    );
    if (scoped.rows[0]) return scoped.rows[0];
  }
  if (input.legacyExternalId && input.weekNumber != null) {
    const legacy = await client.query<{ id: string; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; phase: string | null }>(
      `select ${columns} from rec_games
        where league_id=$1 and external_game_id=$2 and week_number=$3
        limit 1`,
      [input.leagueId, input.legacyExternalId, input.weekNumber],
    );
    if (legacy.rows[0]) return legacy.rows[0];
  }
  if (input.weekNumber != null) {
    const matchup = await client.query<{ id: string; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; phase: string | null }>(
      `select ${columns} from rec_games
        where league_id=$1 and week_number=$2 and (home_team_id=$3 or away_team_id=$3)
        limit 1`,
      [input.leagueId, input.weekNumber, input.teamId],
    );
    if (matchup.rows[0]) return matchup.rows[0];
  }
  return null;
}

async function applyTeamStats(client: PoolClient, leagueId: string, canonicalRecordId: string, seasonKey: string, record: NormalizedCompanionRecord) {
  const row = record.rawData;
  const resolvedTeamId = await teamId(client, leagueId, record.sourceTeamId);
  if (!resolvedTeamId) return;
  const scopedGameId = record.sourceGameId && record.weekNumber != null
    ? eaScheduleExternalId(record.weekNumber, record.sourceGameId)
    : record.sourceGameId;
  const game = await resolveTeamStatsGame(client, {
    leagueId,
    teamId: resolvedTeamId,
    weekNumber: record.weekNumber,
    scopedExternalId: scopedGameId,
    legacyExternalId: record.sourceGameId,
  });
  const opponentTeamId = game ? (game.home_team_id === resolvedTeamId ? game.away_team_id : game.home_team_id) : null;
  const mapped = mapEaTeamWeeklyStats({ payload: row, teamId: resolvedTeamId, game });
  // See applyPlayerStats above — always use the league's real season number, never EA's own
  // 0-indexed seasonKey.
  const season = (await client.query<{ season_number: number }>("select season_number from rec_leagues where id=$1", [leagueId])).rows[0]?.season_number ?? 1;
  const userId = (await client.query<{ user_id: string }>(
    "select user_id from rec_team_assignments where league_id=$1 and team_id=$2 and assignment_status='active' and ended_at is null limit 1",
    [leagueId, resolvedTeamId],
  )).rows[0]?.user_id ?? null;
  const opponentUserId = opponentTeamId ? (await client.query<{ user_id: string }>(
    "select user_id from rec_team_assignments where league_id=$1 and team_id=$2 and assignment_status='active' and ended_at is null limit 1",
    [leagueId, opponentTeamId],
  )).rows[0]?.user_id ?? null : null;
  const result = mapped.result;
  await client.query(
    `update rec_team_game_stats set source_companion_record_id = null where source_companion_record_id = $1`,
    [canonicalRecordId],
  );
  await client.query(
    `delete from rec_team_game_stats
      where league_id=$1 and team_id=$2 and week_number=$3 and source_type='madden_companion'`,
    [leagueId, resolvedTeamId, record.weekNumber ?? 0],
  );
  await client.query(
    `insert into rec_team_game_stats
       (league_id,season_number,week_number,phase,game_id,submission_id,team_id,opponent_team_id,user_id,opponent_user_id,
        is_home,result,points_for,points_against,off_yards_gained,off_rush_yards,off_pass_yards,off_first_down,
        punt_return_yards,kick_return_yards,total_yards_gained,turnovers_committed,red_zone_off_percentage,time_of_possession,
        generated_turnovers,yards_allowed,rush_yards_allowed,pass_yards_allowed,first_downs_allowed,red_zone_def_percentage,
        offensive_stats,defensive_stats,source_type,source_external_id,source_companion_record_id,raw_payload)
     values ($1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,'madden_companion',$32,$33,$34::jsonb)
     on conflict (source_companion_record_id) where source_companion_record_id is not null do update set
       season_number=excluded.season_number,week_number=excluded.week_number,phase=excluded.phase,game_id=excluded.game_id,
       team_id=excluded.team_id,opponent_team_id=excluded.opponent_team_id,user_id=excluded.user_id,opponent_user_id=excluded.opponent_user_id,
       is_home=excluded.is_home,result=excluded.result,points_for=excluded.points_for,points_against=excluded.points_against,
       off_yards_gained=excluded.off_yards_gained,off_rush_yards=excluded.off_rush_yards,off_pass_yards=excluded.off_pass_yards,
       off_first_down=excluded.off_first_down,punt_return_yards=excluded.punt_return_yards,kick_return_yards=excluded.kick_return_yards,
       total_yards_gained=excluded.total_yards_gained,turnovers_committed=excluded.turnovers_committed,
       red_zone_off_percentage=excluded.red_zone_off_percentage,time_of_possession=excluded.time_of_possession,
       generated_turnovers=excluded.generated_turnovers,yards_allowed=excluded.yards_allowed,rush_yards_allowed=excluded.rush_yards_allowed,
       pass_yards_allowed=excluded.pass_yards_allowed,first_downs_allowed=excluded.first_downs_allowed,
       red_zone_def_percentage=excluded.red_zone_def_percentage,offensive_stats=excluded.offensive_stats,
       defensive_stats=excluded.defensive_stats,raw_payload=excluded.raw_payload`,
    [leagueId, season, record.weekNumber ?? 0, game?.phase ?? seasonStage(row, record), game?.id ?? null, resolvedTeamId, opponentTeamId,
      userId, opponentUserId, mapped.is_home, result, mapped.points_for, mapped.points_against,
      mapped.off_yards_gained, mapped.off_rush_yards, mapped.off_pass_yards, mapped.off_first_down,
      mapped.punt_return_yards, mapped.kick_return_yards, mapped.total_yards_gained, mapped.turnovers_committed,
      mapped.red_zone_off_percentage, mapped.time_of_possession, mapped.generated_turnovers, mapped.yards_allowed,
      mapped.rush_yards_allowed, mapped.pass_yards_allowed, mapped.first_downs_allowed, mapped.red_zone_def_percentage,
      JSON.stringify(mapped.offensive_stats), JSON.stringify(mapped.defensive_stats), record.recordKey, canonicalRecordId, JSON.stringify(row)],
  );
}

export async function applyCompanionRecordToCanonical(input: { client: PoolClient; leagueId: string; endpointKey: MaddenEndpointKey; canonicalRecordId: string; seasonKey: string; record: NormalizedCompanionRecord }) {
  if (input.endpointKey === "teams") return applyTeam(input.client, input.leagueId, input.record);
  if (input.endpointKey === "rosters") return applyRosterPlayer(input.client, input.leagueId, input.record);
  if (input.endpointKey === "schedule") return applySchedule(input.client, input.leagueId, input.record);
  if (input.endpointKey === "player_stats") return applyPlayerStats(input.client, input.leagueId, input.canonicalRecordId, input.seasonKey, input.record);
  if (input.endpointKey === "team_stats") return applyTeamStats(input.client, input.leagueId, input.canonicalRecordId, input.seasonKey, input.record);
}
