// Direct EA data writer — bypasses the companion adapter pipeline.
//
// The companion adapter was designed for the Madden Companion App's data format, which uses
// different field names than EA's Blaze exports. Instead of mapping EA fields → companion
// fields → adapter → canonical → database, this writes EA data directly to rec_games and
// rec_players using EA's own field names.
//
// Hash-based write optimization: before writing, we hash the incoming row and compare with
// the existing row's stored hash. Only rows that have actually changed get written, which
// cuts import time significantly for large rosters (most players don't change between imports).

import { createHash } from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { gameResultsApplyKey } from "../official-records/official-records.service.js";

type Json = Record<string, unknown>;

// ── Helpers ──

function num(row: Json, keys: string[]): number | null {
  for (const key of keys) {
    const val = row[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

function str(row: Json, keys: string[]): string | null {
  for (const key of keys) {
    const val = row[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function rowHash(row: Json): string {
  return createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 16);
}

/** Extract rows from EA's export envelope (e.g. { gameScheduleInfoList: [...] }). */
function extractRows(raw: unknown, envelopeKey: string): Json[] {
  if (!raw || typeof raw !== "object") return [];
  const container = raw as Json;
  const direct = container[envelopeKey];
  if (Array.isArray(direct)) return direct.filter((r): r is Json => Boolean(r) && typeof r === "object");
  // Fallback: find the first array value
  const arrays = Object.values(container).filter((v): v is unknown[] => Array.isArray(v));
  if (arrays.length === 1) return arrays[0].filter((r): r is Json => Boolean(r) && typeof r === "object");
  return [];
}

// ── Schedule ──

export async function directWriteSchedule(
  leagueId: string,
  rawEaData: unknown,
  displayWeek: number,
  phase: "preseason" | "regular_season" | "playoffs",
): Promise<number> {
  const rawRows = extractRows(rawEaData, "gameScheduleInfoList");
  const pool = getPgPool();
  let written = 0;

  for (const row of rawRows) {
    const homeTeamId = num(row, ["homeTeamId", "home_team_id"]);
    const awayTeamId = num(row, ["awayTeamId", "away_team_id"]);
    const homeScore = num(row, ["homeScore", "home_score"]);
    const awayScore = num(row, ["awayScore", "away_score"]);
    const status = num(row, ["status", "gameStatus"]);
    const played = row.isGamePlayed === true || row.is_game_played === true;
    const scheduleId = num(row, ["scheduleId", "schedule_id"]);

    // Determine if game is completed
    const completed = played || (status !== null && status > 1);

    // Resolve team UUIDs from EA numeric IDs
    const homeUuid = homeTeamId != null ? await resolveTeamId(pool, leagueId, String(homeTeamId)) : null;
    const awayUuid = awayTeamId != null ? await resolveTeamId(pool, leagueId, String(awayTeamId)) : null;

    const externalId = scheduleId != null ? String(scheduleId) : null;

    // A league's default/manually-seeded schedule (source != 'madden_companion_export', its own
    // synthetic external_game_id) never matches the EA scheduleId on (league_id,
    // external_game_id) — the upsert below would just create a second, permanently-orphaned
    // row for the same real matchup, its own external_game_id colliding with nothing. Every
    // wager, GOTW entry, game channel, etc. from before the first EA import points at that
    // original row, so adopt it (repoint its external_game_id onto the EA one) instead of
    // leaving the two to drift as parallel, un-scored duplicates of the same game.
    let gameId: string | null = null;
    if (homeUuid && awayUuid) {
      const existing = await pool.query<{ id: string }>(
        `select id from rec_games
           where league_id=$1 and week_number=$2 and home_team_id=$3 and away_team_id=$4
             and source <> 'madden_companion_export'
           limit 1`,
        [leagueId, displayWeek, homeUuid, awayUuid],
      );
      if (existing.rows[0]) {
        gameId = existing.rows[0].id;
        await pool.query(
          `update rec_games set home_score=$2, away_score=$3, status=$4, source='madden_companion_export',
             import_verified=true, external_game_id=$5, updated_at=now()
           where id=$1`,
          [gameId, homeScore, awayScore, completed ? "completed" : "scheduled", externalId],
        );
      }
    }
    if (!gameId) {
      const gameRow = await pool.query<{ id: string }>(
        `insert into rec_games
           (league_id, week_number, phase, home_team_id, away_team_id, home_score, away_score,
            status, source, import_verified, manual_entered, result_payout_eligible,
            eos_payout_eligible, external_game_id, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'madden_companion_export',true,false,true,true,$9,now())
         on conflict (league_id, external_game_id) where external_game_id is not null do update set
           week_number=excluded.week_number,
           home_team_id=coalesce(excluded.home_team_id, rec_games.home_team_id),
           away_team_id=coalesce(excluded.away_team_id, rec_games.away_team_id),
           home_score=excluded.home_score,
           away_score=excluded.away_score,
           status=excluded.status,
           source='madden_companion_export',
           import_verified=true,
           updated_at=now()
         returning id`,
        [leagueId, displayWeek, phase, homeUuid, awayUuid, homeScore, awayScore,
         completed ? "completed" : "scheduled", externalId],
      );
      gameId = gameRow.rows[0]?.id ?? null;
    }

    // For completed games with valid team IDs, also write directly to rec_game_results
    // so wagers and advance readiness pick up the scores immediately.
    if (completed && homeUuid && awayUuid && homeScore != null && awayScore != null) {
      const isTie = homeScore === awayScore;
      const homeWon = homeScore > awayScore;
      // Shared dedup key (also used by box score, manual entry, and week-advance) so this
      // same game never gets double-counted in official records if it's later re-confirmed
      // through a different source — an EA-only ad hoc key here used to let that happen.
      const applyKey = gameResultsApplyKey({
        gameId, leagueId, seasonNumber: 0, weekNumber: displayWeek, homeTeamId: homeUuid, awayTeamId: awayUuid,
      });
      await pool.query(
        `insert into rec_game_results
           (league_id, game_id, season_number, week_number, game_type, home_team_id, away_team_id,
            home_score, away_score, winning_team_id, losing_team_id, is_tie, is_playoff, source,
            records_apply_key, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'madden_companion_import',$14,now(),now())
         on conflict (records_apply_key) do update set
           home_score=excluded.home_score, away_score=excluded.away_score,
           winning_team_id=excluded.winning_team_id, losing_team_id=excluded.losing_team_id,
           is_tie=excluded.is_tie, source='madden_companion_import', updated_at=now()`,
        [
          leagueId, gameId, null, displayWeek, phase === "playoffs" ? "postseason" : "regular_season",
          homeUuid, awayUuid, homeScore, awayScore,
          isTie ? null : homeWon ? homeUuid : awayUuid,
          isTie ? null : homeWon ? awayUuid : homeUuid,
          isTie, phase === "playoffs", applyKey,
        ],
      );
    }
    written += 1;
  }
  return written;
}

async function resolveTeamId(pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, leagueId: string, maddenTeamId: string): Promise<string | null> {
  // Try exact madden_team_id match first
  const result = await pool.query(
    `select id from rec_teams where league_id=$1 and madden_team_id=$2 limit 1`,
    [leagueId, maddenTeamId],
  );
  if (result.rows[0]) return result.rows[0].id;

  // Fallback: try matching by the numeric ID cast to text (in case madden_team_id is stored differently)
  const fallback = await pool.query(
    `select id from rec_teams where league_id=$1 and (madden_team_id::text = $2 or madden_team_id::text = $2::int::text) limit 1`,
    [leagueId, maddenTeamId],
  );
  return fallback.rows[0]?.id ?? null;
}

// ── Roster ──

export async function directWriteRoster(
  leagueId: string,
  rawEaData: unknown,
  isFreeAgent: boolean = false,
): Promise<number> {
  const rawRows = extractRows(rawEaData, "rosterInfoList");
  const pool = getPgPool();
  let written = 0;
  let skipped = 0;

  // Pre-fetch existing player hashes so we can skip unchanged rows
  const existingHashes = new Map<string, string>();
  const existing = await pool.query<{ madden_player_id: string; raw_hash: string }>(
    `select madden_player_id, raw_hash from rec_players where league_id=$1 and madden_player_id is not null`,
    [leagueId],
  );
  for (const row of existing.rows) {
    if (row.raw_hash) existingHashes.set(row.madden_player_id, row.raw_hash);
  }

  for (const row of rawRows) {
    const rosterId = num(row, ["rosterId", "roster_id", "playerId", "player_id"]);
    if (rosterId == null) continue;

    // Hash-based skip: if the raw data hasn't changed, don't rewrite the whole row — but
    // wipeBaselineRoster() marks every existing player 'removed' before this import runs, so
    // skipping the row entirely left every unchanged player (the vast majority, since most
    // players' EA data doesn't move week to week) stuck at roster_status='removed' forever,
    // never reactivated. Still touch roster_status/is_free_agent/updated_at on a hash match.
    const hash = rowHash(row);
    if (existingHashes.get(String(rosterId)) === hash) {
      skipped += 1;
      await pool.query(
        `update rec_players set roster_status='active', is_free_agent=$3, updated_at=now()
         where league_id=$1 and madden_player_id=$2`,
        [leagueId, String(rosterId), isFreeAgent],
      );
      continue;
    }

    const firstName = str(row, ["firstName", "first_name"]);
    const lastName = str(row, ["lastName", "last_name"]);
    const fullName = str(row, ["fullName", "full_name", "displayName", "playerName"])
      ?? ([firstName, lastName].filter(Boolean).join(" ") || `Player ${rosterId}`);
    const position = str(row, ["position", "positionName", "positionAbbr"]);
    const teamIdNum = num(row, ["teamId", "team_id"]);
    // A free_agents-dataset row has no team by definition, even if EA's payload carries a
    // stale teamId from before the player was cut — never resolve one for a free agent.
    const teamUuid = !isFreeAgent && teamIdNum != null ? await resolveTeamId(pool, leagueId, String(teamIdNum)) : null;
    const overall = num(row, ["playerBestOvr", "overallRating", "overall", "ovrRating", "ovr"]);
    const devTrait = normalizeDevTrait(row.devTrait ?? row.developmentTrait ?? row.dev_trait);
    const jerseyNum = num(row, ["jerseyNum", "jerseyNumber", "jersey_number"]);
    const yearsPro = num(row, ["yearsPro", "experience"]);
    const age = num(row, ["age", "playerAge"]);
    const contractYearsLeft = num(row, ["contractYearsLeft", "contract_years_left"]);

    // Map EA's camelCase rating fields to the snake_case keys the roster page expects
    const EA_RATING_TO_SNAKE: Record<string, string> = {
      speedRating: "speed", accelerationRating: "acceleration", strengthRating: "strength",
      agilityRating: "agility", awarenessRating: "awareness", jumpingRating: "jumping",
      injuryRating: "injury", staminaRating: "stamina", toughnessRating: "toughness",
      throwPowerRating: "throw_power", throwUnderPressureRating: "throw_under_pressure",
      throwAccShortRating: "throw_accuracy_short", throwAccMidRating: "throw_accuracy_mid",
      throwAccDeepRating: "throw_accuracy_deep", throwOnRunRating: "throw_on_the_run",
      playActionRating: "play_action", catchingRating: "catching", specCatchRating: "spectacular_catch",
      cITRating: "catch_in_traffic", routeRunShortRating: "route_running_short",
      routeRunMedRating: "route_running_medium", routeRunDeepRating: "route_running_deep",
      releaseRating: "release", carryRating: "carrying", breakTackleRating: "break_tackle",
      truckRating: "trucking", changeOfDirectionRating: "change_of_direction",
      bCVRating: "bc_vision", stiffArmRating: "stiff_arm", spinMoveRating: "spin_move",
      jukeMoveRating: "juke_move", breakSackRating: "break_sack", tackleRating: "tackle",
      powerMovesRating: "power_moves", finesseMovesRating: "finesse_moves",
      blockShedRating: "block_shedding", pursuitRating: "pursuit",
      playRecRating: "play_recognition", manCoverRating: "man_coverage",
      zoneCoverRating: "zone_coverage", hitPowerRating: "hit_power", pressRating: "press",
      runBlockRating: "run_block", passBlockRating: "pass_block", impactBlockRating: "impact_blocking",
      runBlockPowerRating: "run_block_power", runBlockFinesseRating: "run_block_finesse",
      passBlockPowerRating: "pass_block_power", passBlockFinesseRating: "pass_block_finesse",
      leadBlockRating: "lead_block", kickPowerRating: "kick_power",
      kickAccRating: "kick_accuracy", kickRetRating: "kick_return",
    };
    const attrs: Record<string, number> = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "number" && EA_RATING_TO_SNAKE[key]) {
        attrs[EA_RATING_TO_SNAKE[key]] = val;
      }
    }
    const attributes = Object.keys(attrs).length > 0 ? attrs : null;
    const abilities = Array.isArray(row.signatureSlotList) ? row.signatureSlotList : null;

    // Match to a pre-existing baseline-seeded or legend/custom-player placeholder row before
    // falling through to insert: those rows carry a synthetic madden_player_id ("madden27:...",
    // or none at all for a not-yet-installed legend) that never conflicts with EA's real
    // numeric roster id, so without this the row would silently insert as a brand-new
    // duplicate player instead of adopting the real identity of the player it's supposed to
    // represent — exactly what happened to every baseline-seeded player and every approved
    // legend purchase once real EA data arrived. Match narrowly (same team, same full name)
    // and only against rows that don't already have a real numeric EA id.
    if (teamUuid) {
      const placeholder = await pool.query<{ id: string }>(
        `select id from rec_players
         where league_id=$1 and team_id=$2 and lower(full_name)=lower($3)
           and (madden_player_id is null or madden_player_id !~ '^[0-9]+$')
         order by (player_source='legend') desc, created_at asc
         limit 1`,
        [leagueId, teamUuid, fullName],
      );
      if (placeholder.rows[0]) {
        await pool.query(`update rec_players set madden_player_id=$2, updated_at=now() where id=$1`, [placeholder.rows[0].id, String(rosterId)]);
      }
    }

    await pool.query(
      `insert into rec_players
         (league_id, madden_player_id, first_name, last_name, full_name, position, team_id,
          overall_rating, dev_trait, jersey_number, years_pro, age, contract_years_left,
          attributes, abilities, raw_payload, raw_hash, player_source, roster_status, is_free_agent, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$18,'madden_companion','active',$17,now())
       on conflict (league_id, madden_player_id) do update set
         first_name=coalesce(excluded.first_name, rec_players.first_name),
         last_name=coalesce(excluded.last_name, rec_players.last_name),
         full_name=excluded.full_name,
         position=coalesce(excluded.position, rec_players.position),
         -- A free_agents-dataset row has no team by definition — force team_id to null
         -- instead of coalescing onto the old value, or a cut player keeps showing on their
         -- former team's roster (team_id stale) while also flagged is_free_agent=true.
         team_id=case when excluded.is_free_agent then null else coalesce(excluded.team_id, rec_players.team_id) end,
         overall_rating=coalesce(excluded.overall_rating, rec_players.overall_rating),
         dev_trait=coalesce(excluded.dev_trait, rec_players.dev_trait),
         jersey_number=coalesce(excluded.jersey_number, rec_players.jersey_number),
         years_pro=coalesce(excluded.years_pro, rec_players.years_pro),
         age=coalesce(excluded.age, rec_players.age),
         contract_years_left=coalesce(excluded.contract_years_left, rec_players.contract_years_left),
         attributes=case when excluded.attributes is null then rec_players.attributes else excluded.attributes end,
         abilities=case when excluded.abilities is null then rec_players.abilities else excluded.abilities end,
         raw_payload=excluded.raw_payload,
         raw_hash=excluded.raw_hash,
         roster_status='active',
         is_free_agent=excluded.is_free_agent,
         updated_at=now()`,
      [
        leagueId, String(rosterId), firstName, lastName, fullName, position, teamUuid,
        overall, devTrait, jerseyNum, yearsPro, age, contractYearsLeft,
        attributes ? JSON.stringify(attributes) : null,
        abilities ? JSON.stringify(abilities) : null,
        JSON.stringify(row),
        isFreeAgent,
        hash,
      ],
    );
    written += 1;
  }
  if (skipped > 0) console.log(`[EA] Roster: ${written} written, ${skipped} skipped (unchanged)`);
  return written;
}

function normalizeDevTrait(value: unknown): string | null {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower.includes("xfactor") || lower === "xfactor") return "xfactor";
    if (lower.includes("superstar")) return "superstar";
    if (lower.includes("star")) return "star";
    if (lower.includes("normal") || lower === "standard") return "normal";
    return value;
  }
  if (typeof value === "number") {
    // EA enum: 0=Normal, 1=Star, 2=Superstar, 3=X-Factor
    const map: Record<number, string> = { 0: "normal", 1: "star", 2: "superstar", 3: "xfactor" };
    return map[value] ?? null;
  }
  return null;
}
