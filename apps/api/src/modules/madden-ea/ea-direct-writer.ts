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

    await pool.query(
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
         updated_at=now()`,
      [leagueId, displayWeek, phase, homeUuid, awayUuid, homeScore, awayScore,
       completed ? "completed" : "scheduled", externalId],
    );
    written += 1;
  }
  return written;
}

async function resolveTeamId(pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, leagueId: string, maddenTeamId: string): Promise<string | null> {
  const result = await pool.query(
    `select id from rec_teams where league_id=$1 and madden_team_id=$2 limit 1`,
    [leagueId, maddenTeamId],
  );
  return result.rows[0]?.id ?? null;
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

    // Hash-based skip: if the raw data hasn't changed, don't write
    const hash = rowHash(row);
    if (existingHashes.get(String(rosterId)) === hash) {
      skipped += 1;
      continue;
    }

    const firstName = str(row, ["firstName", "first_name"]);
    const lastName = str(row, ["lastName", "last_name"]);
    const fullName = str(row, ["fullName", "full_name", "displayName", "playerName"])
      ?? ([firstName, lastName].filter(Boolean).join(" ") || `Player ${rosterId}`);
    const position = str(row, ["position", "positionName", "positionAbbr"]);
    const teamIdNum = num(row, ["teamId", "team_id"]);
    const teamUuid = teamIdNum != null ? await resolveTeamId(pool, leagueId, String(teamIdNum)) : null;
    const overall = num(row, ["playerBestOvr", "overallRating", "overall", "ovrRating", "ovr"]);
    const devTrait = normalizeDevTrait(row.devTrait ?? row.developmentTrait ?? row.dev_trait);
    const jerseyNum = num(row, ["jerseyNum", "jerseyNumber", "jersey_number"]);
    const yearsPro = num(row, ["yearsPro", "experience"]);
    const age = num(row, ["age", "playerAge"]);
    const contractYearsLeft = num(row, ["contractYearsLeft", "contract_years_left"]);

    const attrs: Record<string, number> = {};
    for (const [key, val] of Object.entries(row)) {
      if ((key.endsWith("Rating") || key.endsWith("rating")) && typeof val === "number") {
        attrs[key] = val;
      }
    }
    const attributes = Object.keys(attrs).length > 0 ? attrs : null;
    const abilities = Array.isArray(row.signatureSlotList) ? row.signatureSlotList : null;

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
         team_id=coalesce(excluded.team_id, rec_players.team_id),
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
