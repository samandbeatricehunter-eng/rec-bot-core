// Maps EA export payloads onto REC's existing companion ingest datasets.
//
// EA returns one envelope key per export (e.g. playerPassingStatInfoList) and does not label
// the stat category inside each row. REC's canonical mapper keys player stats off
// stat_category, so we attach the category here rather than guessing from field names later.

import type { MaddenEndpointKey } from "../madden-companion/madden-companion.service.js";
import { describeEaWeek, type EaStage } from "./ea-weeks.js";

/** Every EA dataset a commissioner can individually enable or disable. */
export type EaDataset =
  | "teams"
  | "standings"
  | "schedule"
  | "rosters"
  | "free_agents"
  | "passing"
  | "rushing"
  | "receiving"
  | "defense"
  | "kicking"
  | "punting"
  | "team_stats";

export const EA_DATASETS: EaDataset[] = [
  "teams", "standings", "schedule", "rosters", "free_agents",
  "passing", "rushing", "receiving", "defense", "kicking", "punting", "team_stats",
];

/** Datasets that are per-week; the rest are league-wide snapshots. */
export const WEEKLY_DATASETS: ReadonlySet<EaDataset> = new Set<EaDataset>([
  "schedule", "passing", "rushing", "receiving", "defense", "kicking", "punting", "team_stats",
]);

export const PLAYER_STAT_DATASETS: ReadonlySet<EaDataset> = new Set<EaDataset>([
  "passing", "rushing", "receiving", "defense", "kicking", "punting",
]);

export const EA_DATASET_LABELS: Record<EaDataset, string> = {
  teams: "Teams",
  standings: "Standings",
  schedule: "Schedule & scores",
  rosters: "Team rosters",
  free_agents: "Free agents",
  passing: "Passing stats",
  rushing: "Rushing stats",
  receiving: "Receiving stats",
  defense: "Defensive stats",
  kicking: "Kicking stats",
  punting: "Punting stats",
  team_stats: "Team stats",
};

/** Which REC ingest dataset each EA dataset feeds. */
const DATASET_TO_ENDPOINT: Record<EaDataset, MaddenEndpointKey> = {
  teams: "teams",
  standings: "standings",
  schedule: "schedule",
  rosters: "rosters",
  free_agents: "rosters",
  passing: "player_stats",
  rushing: "player_stats",
  receiving: "player_stats",
  defense: "player_stats",
  kicking: "player_stats",
  punting: "player_stats",
  team_stats: "team_stats",
};

/** EA's envelope key holding the row array for each dataset. */
const DATASET_ENVELOPE: Record<EaDataset, string> = {
  teams: "leagueTeamInfoList",
  standings: "teamStandingInfoList",
  schedule: "gameScheduleInfoList",
  rosters: "rosterInfoList",
  free_agents: "rosterInfoList",
  passing: "playerPassingStatInfoList",
  rushing: "playerRushingStatInfoList",
  receiving: "playerReceivingStatInfoList",
  defense: "playerDefensiveStatInfoList",
  kicking: "playerKickingStatInfoList",
  punting: "playerPuntingStatInfoList",
  team_stats: "teamStatInfoList",
};

/** REC stat_category values, so the UI can group EA stats the same way manual entry does. */
const DATASET_STAT_CATEGORY: Partial<Record<EaDataset, string>> = {
  passing: "passing",
  rushing: "rushing",
  receiving: "receiving",
  defense: "defense",
  kicking: "kicking",
  punting: "punting",
};

export function endpointKeyForDataset(dataset: EaDataset): MaddenEndpointKey {
  return DATASET_TO_ENDPOINT[dataset];
}

export function parseDatasets(input: unknown): EaDataset[] {
  if (!Array.isArray(input) || input.length === 0) return [...EA_DATASETS];
  const requested = new Set(input.map(String));
  const selected = EA_DATASETS.filter((dataset) => requested.has(dataset));
  return selected.length > 0 ? selected : [...EA_DATASETS];
}

type Json = Record<string, unknown>;

export type EaEnvelope = {
  endpointKey: MaddenEndpointKey;
  payload: Json;
  dataset: EaDataset;
  rowCount: number;
};

function rowsFrom(raw: unknown, envelopeKey: string): Json[] {
  if (Array.isArray(raw)) {
    return raw.filter((row): row is Json => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }
  if (!raw || typeof raw !== "object") return [];
  const container = raw as Json;
  const direct = container[envelopeKey];
  if (Array.isArray(direct)) {
    return direct.filter((row): row is Json => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }
  // Tolerate EA renaming an envelope by falling back to the sole array present.
  const arrays = Object.values(container).filter((value): value is unknown[] => Array.isArray(value));
  if (arrays.length === 1) {
    return arrays[0].filter((row): row is Json => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }
  return [];
}

/**
 * Rewrites one EA export into the envelope shape the companion adapters already understand,
 * stamping the identity fields EA omits per row (league, season, week, stat category) so the
 * canonical mapper routes each row to the right table and UI stat field.
 */
export function toIngestEnvelope(input: {
  dataset: EaDataset;
  raw: unknown;
  eaLeagueId: number;
  seasonYear: number;
  stage?: EaStage;
  weekIndex?: number;
  teamId?: number;
}): EaEnvelope {
  const { dataset, raw, eaLeagueId, seasonYear } = input;
  const envelopeKey = DATASET_ENVELOPE[dataset];
  const rows = rowsFrom(raw, envelopeKey);
  const statCategory = DATASET_STAT_CATEGORY[dataset];
  const week =
    input.stage !== undefined && input.weekIndex !== undefined
      ? describeEaWeek(input.stage, input.weekIndex)
      : null;

  let firstScheduleRow = true;
  const stamped = rows.map((row) => {
    const enriched: Json = { ...row, leagueId: String(eaLeagueId), seasonYear };
    if (week) {
      // EA rows carry weekIndex/stageIndex, but not the display week REC stores, and rows from
      // a bye or unplayed game can omit them entirely.
      enriched.week = week.displayWeek;
      enriched.weekIndex = week.weekIndex;
      enriched.stageIndex = week.stageIndex;
      enriched.seasonStage = week.phase;
      enriched.isPlayoff = week.isPlayoff;
      enriched.weekLabel = week.label;
    }
    if (statCategory) enriched.statCategory = statCategory;
    if (dataset === "free_agents") enriched.isFreeAgent = true;
    if (dataset === "rosters" && input.teamId !== undefined && enriched.teamId === undefined) {
      enriched.teamId = input.teamId;
    }
    // EA schedule exports use different field names than the companion adapter expects.
    // Normalize so applySchedule finds homeScore/awayScore/isGamePlayed/status correctly.
    if (dataset === "schedule") {
      // Debug: log first raw row to diagnose score field presence
      if (firstScheduleRow) {
        firstScheduleRow = false;
        console.log("[EA] Raw schedule row keys:", Object.keys(row));
        console.log("[EA] Raw schedule row sample:", JSON.stringify(row).slice(0, 500));
      }
      if (enriched.home_team_id === undefined && enriched.homeTeamId !== undefined) {
        enriched.home_team_id = enriched.homeTeamId;
      }
      if (enriched.away_team_id === undefined && enriched.awayTeamId !== undefined) {
        enriched.away_team_id = enriched.awayTeamId;
      }
      if (enriched.home_score === undefined && enriched.homeScore !== undefined) {
        enriched.home_score = enriched.homeScore;
      }
      if (enriched.away_score === undefined && enriched.awayScore !== undefined) {
        enriched.away_score = enriched.awayScore;
      }
      if (enriched.is_game_played === undefined && enriched.isGamePlayed === undefined) {
        // EA status: 1=NOT_PLAYED, 2=AWAY_WIN, 3=HOME_WIN, 4=TIE
        // The adapter checks isGamePlayed first, then status > 1, then both scores non-null.
        // Map EA's status enum so the adapter's status > 1 check works for completed games.
        const eaStatus = typeof enriched.status === "number" ? enriched.status : null;
        if (eaStatus !== null) {
          enriched.gameStatus = eaStatus;
          // Only set isGamePlayed for clearly completed games (status 2/3/4).
          // For NOT_PLAYED (1), leave it absent — the adapter's status > 1 check handles it.
          if (eaStatus > 1) enriched.isGamePlayed = true;
        }
      }
      // EA sends scheduleId but the adapter expects external_game_id for upsert matching.
      if (enriched.external_game_id === undefined) {
        const scheduleId = enriched.scheduleId ?? enriched.schedule_id;
        if (scheduleId != null) enriched.external_game_id = String(scheduleId);
      }
      // Debug: log enriched schedule row
      if (!firstScheduleRow && rows.indexOf(row) < 2) {
        console.log("[EA] Enriched schedule row:", JSON.stringify({ homeScore: enriched.homeScore, home_score: enriched.home_score, awayScore: enriched.awayScore, away_score: enriched.away_score, status: enriched.status, isGamePlayed: enriched.isGamePlayed, gameStatus: enriched.gameStatus, external_game_id: enriched.external_game_id }));
      }
    }
    return enriched;
  });

  return {
    dataset,
    endpointKey: DATASET_TO_ENDPOINT[dataset],
    rowCount: stamped.length,
    payload: {
      leagueId: String(eaLeagueId),
      seasonYear,
      ...(week
        ? { week: week.displayWeek, weekIndex: week.weekIndex, stageIndex: week.stageIndex, seasonStage: week.phase }
        : {}),
      [envelopeKey]: stamped,
    },
  };
}
