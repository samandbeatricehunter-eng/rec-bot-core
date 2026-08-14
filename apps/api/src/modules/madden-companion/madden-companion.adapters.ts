import crypto from "node:crypto";
import type { MaddenEndpointKey } from "./madden-companion.service.js";

type JsonObject = Record<string, unknown>;

export type NormalizedCompanionRecord = {
  recordKey: string;
  externalLeagueId: string | null;
  externalSeasonKey: string;
  sourceTeamId: string | null;
  sourcePlayerId: string | null;
  sourceGameId: string | null;
  weekNumber: number | null;
  statCategory: string | null;
  normalizedData: JsonObject;
  rawData: JsonObject;
  contentChecksum: string;
};

// Envelope keys are checked in order. The *InfoList names are what EA's own exports use
// (both the Companion App and REC's direct EA client emit them).
const LIST_KEYS: Record<MaddenEndpointKey, string[]> = {
  league_metadata: ["leagueInfo", "league", "leagues", "data"],
  teams: ["teams", "leagueTeamInfoList", "teamInfoList", "teamInfo", "data"],
  standings: ["standings", "teamStandingInfoList", "teamStandings", "data"],
  schedule: ["schedule", "schedules", "gameScheduleInfoList", "games", "data"],
  rosters: ["rosters", "rosterInfoList", "players", "data"],
  player_stats: [
    "playerStats", "playerStatInfoList",
    "playerPassingStatInfoList", "playerRushingStatInfoList", "playerReceivingStatInfoList",
    "playerDefensiveStatInfoList", "playerKickingStatInfoList", "playerPuntingStatInfoList",
    "stats", "data",
  ],
  team_stats: ["teamStats", "teamStatInfoList", "stats", "data"],
};

const EXPLICIT_ENDPOINT_ALIASES: Record<string, MaddenEndpointKey> = {
  league: "league_metadata", league_info: "league_metadata", leagueinfo: "league_metadata",
  teams: "teams", team_info: "teams", teaminfo: "teams",
  standings: "standings", team_standings: "standings",
  schedule: "schedule", schedules: "schedule", games: "schedule",
  rosters: "rosters", roster: "rosters", players: "rosters",
  player_stats: "player_stats", playerstats: "player_stats",
  team_stats: "team_stats", teamstats: "team_stats",
};

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

function first(row: JsonObject, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = objectValue(value);
  if (!record) return JSON.stringify(value) ?? "null";
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function companionChecksum(value: unknown): string {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

function rowsFromPayload(endpointKey: MaddenEndpointKey, payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) return payload.map(objectValue).filter((row): row is JsonObject => row !== null);
  const root = objectValue(payload);
  if (!root) throw new Error("Madden Companion payload must be a JSON object or array.");
  for (const key of LIST_KEYS[endpointKey]) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(objectValue).filter((row): row is JsonObject => row !== null);
    const nested = objectValue(value);
    if (nested && endpointKey === "league_metadata") return [nested];
  }
  // Metadata exports are commonly a single object. For all other endpoints, accepting a
  // singleton object preserves unfamiliar app-version payloads without silently discarding it.
  return [root];
}

function metadata(root: JsonObject, row: JsonObject) {
  const externalLeagueId = scalar(first(row, ["leagueId", "league_id", "franchiseId", "franchise_id", "careerId"]))
    ?? scalar(first(root, ["leagueId", "league_id", "franchiseId", "franchise_id", "careerId"]));
  const season = scalar(first(row, ["seasonId", "season_id", "seasonIndex", "season_index", "seasonYear", "season", "year"]))
    ?? scalar(first(root, ["seasonId", "season_id", "seasonIndex", "season_index", "seasonYear", "season", "year"]))
    ?? "current";
  const sourceTeamId = scalar(first(row, ["teamId", "team_id", "rosterTeamId", "roster_team_id"]));
  const sourcePlayerId = scalar(first(row, ["playerId", "player_id", "rosterId", "roster_id", "personaId"]));
  const sourceGameId = scalar(first(row, ["gameId", "game_id", "scheduleId", "schedule_id"]));
  // `week` is the 1-based display week REC stores. EA rows only carry the 0-based weekIndex,
  // so prefer an explicit week and never fall back to stageIndex, which is a phase (0/1) and
  // would otherwise be silently written as "week 0"/"week 1".
  const weekNumber = numberValue(first(row, ["week", "week_number", "weekNumber"]))
    ?? (() => {
      const index = numberValue(first(row, ["weekIndex", "week_index"]));
      return index === null ? null : index + 1;
    })();
  const statCategory = scalar(first(row, ["statType", "stat_type", "category", "statCategory", "stat_category"]));
  return { externalLeagueId, externalSeasonKey: season, sourceTeamId, sourcePlayerId, sourceGameId, weekNumber, statCategory };
}

function recordKey(endpointKey: MaddenEndpointKey, row: JsonObject, meta: ReturnType<typeof metadata>, index: number): string {
  const explicit = scalar(first(row, ["id", "recordId", "record_id", "scheduleId", "schedule_id", "gameId", "game_id"]));
  if (explicit) return explicit;
  if (endpointKey === "league_metadata") return "league";
  if (endpointKey === "teams" || endpointKey === "standings") return meta.sourceTeamId ?? companionChecksum(row);
  if (endpointKey === "rosters") return meta.sourcePlayerId ?? companionChecksum(row);
  if (endpointKey === "schedule") {
    const home = scalar(first(row, ["homeTeamId", "home_team_id", "homeTeam"]));
    const away = scalar(first(row, ["awayTeamId", "away_team_id", "awayTeam"]));
    return [meta.weekNumber ?? "week", home ?? "home", away ?? "away"].join(":");
  }
  if (endpointKey === "player_stats") return [meta.sourcePlayerId ?? "player", meta.sourceGameId ?? `week-${meta.weekNumber ?? "season"}`, meta.statCategory ?? "all"].join(":");
  if (endpointKey === "team_stats") return [meta.sourceTeamId ?? "team", meta.sourceGameId ?? `week-${meta.weekNumber ?? "season"}`, meta.statCategory ?? "all"].join(":");
  return `${index}:${companionChecksum(row)}`;
}

export function normalizeCompanionPayload(endpointKey: MaddenEndpointKey, payload: unknown): NormalizedCompanionRecord[] {
  const root = objectValue(payload) ?? {};
  return rowsFromPayload(endpointKey, payload).map((row, index) => {
    const meta = metadata(root, row);
    // Every original field is retained. normalizedData adds stable identity aliases consumed by
    // REC, while rawData remains an exact per-record audit copy from the app export.
    const normalizedData: JsonObject = {
      ...row,
      source_league_id: meta.externalLeagueId,
      source_season_key: meta.externalSeasonKey,
      source_team_id: meta.sourceTeamId,
      source_player_id: meta.sourcePlayerId,
      source_game_id: meta.sourceGameId,
      week_number: meta.weekNumber,
      stat_category: meta.statCategory,
    };
    return {
      recordKey: recordKey(endpointKey, row, meta, index),
      ...meta,
      normalizedData,
      rawData: row,
      contentChecksum: companionChecksum(normalizedData),
    };
  });
}

/** Split a full or partial Madden Companion export into its internal datasets. The app only
 * needs one destination URL; top-level envelope names determine where each list is stored. */
export function splitCompanionPayload(payload: unknown): Array<{ endpointKey: MaddenEndpointKey; payload: unknown }> {
  const root = objectValue(payload);
  if (!root) throw new Error("The one-URL Companion receiver requires a JSON export object.");

  const explicit = scalar(first(root, ["endpoint", "endpointKey", "exportType", "export_type", "type"]));
  if (explicit) {
    const endpointKey = EXPLICIT_ENDPOINT_ALIASES[explicit.toLowerCase().replace(/[\s-]+/g, "_")];
    if (endpointKey) return [{ endpointKey, payload: root.data ?? root.payload ?? root }];
  }

  const common = Object.fromEntries(Object.entries(root).filter(([key, value]) => !Array.isArray(value) && !objectValue(value))) as JsonObject;
  const found = new Map<MaddenEndpointKey, unknown>();
  for (const endpointKey of MADDEN_ENDPOINT_KEYS_IN_ORDER) {
    for (const key of LIST_KEYS[endpointKey]) {
      if (key === "data") continue;
      const value = root[key];
      if (value === undefined) continue;
      found.set(endpointKey, { ...common, [key]: value });
      break;
    }
  }
  if (found.size === 0) {
    const looksLikeMetadata = ["leagueId", "league_id", "franchiseId", "leagueName", "league_name"].some((key) => root[key] !== undefined);
    if (looksLikeMetadata) found.set("league_metadata", root);
  }
  if (found.size === 0) throw new Error("REC could not identify any supported Companion datasets in this export.");
  return [...found].map(([endpointKey, itemPayload]) => ({ endpointKey, payload: itemPayload }));
}

const MADDEN_ENDPOINT_KEYS_IN_ORDER: MaddenEndpointKey[] = [
  "league_metadata", "teams", "standings", "schedule", "rosters", "player_stats", "team_stats",
];
