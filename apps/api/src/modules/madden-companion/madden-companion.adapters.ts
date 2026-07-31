// Madden Companion endpoint adapters — §6.2
// Each adapter parses a specific Companion export endpoint and produces
// normalized rec_import_records for the import pipeline.

import { supabase } from "../../lib/supabase.js";
import { z } from "zod";
import crypto from "crypto";
import type { ImportTrustLevel } from "@rec/shared";

export type CompanionEndpointAdapter = {
  endpointKey: string;
  parse: (payload: unknown) => CompanionParseResult;
};

export type CompanionParseResult = {
  records: CompanionRecordInput[];
  conflicts: CompanionConflictInput[];
};

export type CompanionRecordInput = {
  record_type: string;
  entity_key: string;
  trust_level: ImportTrustLevel;
  fields: Record<string, { extracted_value: unknown; confidence?: number; source_path?: string }>;
};

export type CompanionConflictInput = {
  record_type: string;
  entity_key: string;
  field_key: string;
  incoming_value: unknown;
  existing_value: unknown;
  existing_source: string;
};

const TRUST_LEVEL: ImportTrustLevel = "trusted_automated_import";

/**
 * league_metadata adapter
 * Expected: { league_name, season, week, stage, settings... }
 */
export function parseLeagueMetadata(payload: unknown): CompanionParseResult {
  const data = z
    .object({
      league_name: z.string().optional(),
      season: z.number().optional(),
      current_week: z.number().optional(),
      stage: z.string().optional(),
      settings: z.record(z.unknown()).optional(),
    })
    .passthrough()
    .parse(payload);

  return {
    records: [
      {
        record_type: "league_metadata",
        entity_key: "league_metadata",
        trust_level: TRUST_LEVEL,
        fields: {
          league_name: { extracted_value: data.league_name ?? null, source_path: "league_name" },
          season: { extracted_value: data.season ?? null, source_path: "season" },
          current_week: { extracted_value: data.current_week ?? null, source_path: "current_week" },
          stage: { extracted_value: data.stage ?? null, source_path: "stage" },
          settings: { extracted_value: data.settings ?? {}, source_path: "settings" },
        },
      },
    ],
    conflicts: [],
  };
}

/**
 * teams adapter
 * Expected: array of { team_id, name, abbreviation, owner_id, division, conference, ... }
 */
export function parseTeams(payload: unknown): CompanionParseResult {
  const teams = z
    .array(
      z.object({
        team_id: z.string(),
        name: z.string(),
        abbreviation: z.string(),
        owner_id: z.string().nullable().optional(),
        division: z.string().optional(),
        conference: z.string().optional(),
        overall_rating: z.number().optional(),
        stadium: z.string().optional(),
        colors: z.record(z.string()).optional(),
      })
    )
    .parse(payload);

  const records = teams.map((t) => ({
    record_type: "team",
    entity_key: `team:${t.team_id}`,
    trust_level: TRUST_LEVEL,
    fields: {
      source_team_id: { extracted_value: t.team_id, source_path: "team_id", confidence: 1 },
      name: { extracted_value: t.name, source_path: "name", confidence: 1 },
      abbreviation: { extracted_value: t.abbreviation, source_path: "abbreviation", confidence: 1 },
      owner_id: { extracted_value: t.owner_id ?? null, source_path: "owner_id" },
      division: { extracted_value: t.division ?? null, source_path: "division" },
      conference: { extracted_value: t.conference ?? null, source_path: "conference" },
      overall_rating: { extracted_value: t.overall_rating ?? null, source_path: "overall_rating" },
      stadium: { extracted_value: t.stadium ?? null, source_path: "stadium" },
      colors: { extracted_value: t.colors ?? {}, source_path: "colors" },
    },
  }));

  return { records, conflicts: [] };
}

/**
 * standings adapter
 * Expected: array of { team_id, wins, losses, ties, division_wins, ... }
 */
export function parseStandings(payload: unknown): CompanionParseResult {
  const standings = z
    .array(
      z.object({
        team_id: z.string(),
        wins: z.number(),
        losses: z.number(),
        ties: z.number().optional(),
        division_wins: z.number().optional(),
        division_losses: z.number().optional(),
        conference_wins: z.number().optional(),
        conference_losses: z.number().optional(),
        points_for: z.number().optional(),
        points_against: z.number().optional(),
        streak: z.string().optional(),
        playoff_seed: z.number().optional(),
        clinched_playoffs: z.boolean().optional(),
      })
    )
    .parse(payload);

  const records = standings.map((s) => ({
    record_type: "standing",
    entity_key: `standing:${s.team_id}`,
    trust_level: TRUST_LEVEL,
    fields: {
      team_id: { extracted_value: s.team_id, source_path: "team_id", confidence: 1 },
      wins: { extracted_value: s.wins, source_path: "wins", confidence: 1 },
      losses: { extracted_value: s.losses, source_path: "losses", confidence: 1 },
      ties: { extracted_value: s.ties ?? 0, source_path: "ties" },
      division_wins: { extracted_value: s.division_wins ?? null, source_path: "division_wins" },
      division_losses: { extracted_value: s.division_losses ?? null, source_path: "division_losses" },
      conference_wins: { extracted_value: s.conference_wins ?? null, source_path: "conference_wins" },
      conference_losses: { extracted_value: s.conference_losses ?? null, source_path: "conference_losses" },
      points_for: { extracted_value: s.points_for ?? null, source_path: "points_for" },
      points_against: { extracted_value: s.points_against ?? null, source_path: "points_against" },
      streak: { extracted_value: s.streak ?? null, source_path: "streak" },
      playoff_seed: { extracted_value: s.playoff_seed ?? null, source_path: "playoff_seed" },
      clinched_playoffs: { extracted_value: s.clinched_playoffs ?? false, source_path: "clinched_playoffs" },
    },
  }));

  return { records, conflicts: [] };
}

/**
 * schedule adapter
 * Expected: array of { game_id, week, home_team_id, away_team_id, home_score, away_score, status, ... }
 */
export function parseSchedule(payload: unknown): CompanionParseResult {
  const schedule = z
    .array(
      z.object({
        game_id: z.string(),
        week: z.number(),
        season: z.number().optional(),
        stage: z.string().optional(),
        home_team_id: z.string(),
        away_team_id: z.string(),
        home_score: z.number().nullable().optional(),
        away_score: z.number().nullable().optional(),
        status: z.string().optional(), // scheduled, final, postponed
        is_playoff: z.boolean().optional(),
        is_super_bowl: z.boolean().optional(),
        start_time: z.string().optional(),
      })
    )
    .parse(payload);

  const records = schedule.map((g) => ({
    record_type: "game",
    entity_key: `game:${g.game_id}`,
    trust_level: TRUST_LEVEL,
    fields: {
      source_game_id: { extracted_value: g.game_id, source_path: "game_id", confidence: 1 },
      week: { extracted_value: g.week, source_path: "week", confidence: 1 },
      season: { extracted_value: g.season ?? null, source_path: "season" },
      stage: { extracted_value: g.stage ?? "regular_season", source_path: "stage" },
      home_team_id: { extracted_value: g.home_team_id, source_path: "home_team_id", confidence: 1 },
      away_team_id: { extracted_value: g.away_team_id, source_path: "away_team_id", confidence: 1 },
      home_score: { extracted_value: g.home_score ?? null, source_path: "home_score" },
      away_score: { extracted_value: g.away_score ?? null, source_path: "away_score" },
      status: { extracted_value: g.status ?? "scheduled", source_path: "status" },
      is_playoff: { extracted_value: g.is_playoff ?? false, source_path: "is_playoff" },
      is_super_bowl: { extracted_value: g.is_super_bowl ?? false, source_path: "is_super_bowl" },
      start_time: { extracted_value: g.start_time ?? null, source_path: "start_time" },
    },
  }));

  return { records, conflicts: [] };
}

/**
 * rosters adapter
 * Expected: array of { player_id, team_id, first_name, last_name, position, jersey, ratings... }
 */
export function parseRosters(payload: unknown): CompanionParseResult {
  const rosters = z
    .array(
      z.object({
        player_id: z.string(),
        team_id: z.string(),
        first_name: z.string(),
        last_name: z.string(),
        position: z.string().optional(),
        jersey_number: z.number().optional(),
        overall_rating: z.number().optional(),
        age: z.number().optional(),
        experience: z.number().optional(),
        development_trait: z.string().optional(),
        contract: z.record(z.unknown()).optional(),
        injury: z.record(z.unknown()).optional(),
      })
    )
    .parse(payload);

  const records = rosters.map((p) => ({
    record_type: "player",
    entity_key: `player:${p.player_id}`,
    trust_level: TRUST_LEVEL,
    fields: {
      source_player_id: { extracted_value: p.player_id, source_path: "player_id", confidence: 1 },
      team_id: { extracted_value: p.team_id, source_path: "team_id", confidence: 1 },
      first_name: { extracted_value: p.first_name, source_path: "first_name", confidence: 1 },
      last_name: { extracted_value: p.last_name, source_path: "last_name", confidence: 1 },
      position: { extracted_value: p.position ?? null, source_path: "position" },
      jersey_number: { extracted_value: p.jersey_number ?? null, source_path: "jersey_number" },
      overall_rating: { extracted_value: p.overall_rating ?? null, source_path: "overall_rating" },
      age: { extracted_value: p.age ?? null, source_path: "age" },
      experience: { extracted_value: p.experience ?? null, source_path: "experience" },
      development_trait: { extracted_value: p.development_trait ?? null, source_path: "development_trait" },
      contract: { extracted_value: p.contract ?? {}, source_path: "contract" },
      injury: { extracted_value: p.injury ?? {}, source_path: "injury" },
    },
  }));

  return { records, conflicts: [] };
}

/**
 * player_stats adapter
 * Expected: array of { player_id, team_id, game_id, week, passing, rushing, receiving, defense... }
 */
export function parsePlayerStats(payload: unknown): CompanionParseResult {
  const stats = z
    .array(
      z.object({
        player_id: z.string(),
        team_id: z.string(),
        game_id: z.string().optional(),
        week: z.number().optional(),
        season: z.number().optional(),
        passing: z
          .object({
            attempts: z.number().optional(),
            completions: z.number().optional(),
            yards: z.number().optional(),
            touchdowns: z.number().optional(),
            interceptions: z.number().optional(),
          })
          .optional(),
        rushing: z
          .object({
            attempts: z.number().optional(),
            yards: z.number().optional(),
            touchdowns: z.number().optional(),
          })
          .optional(),
        receiving: z
          .object({
            receptions: z.number().optional(),
            yards: z.number().optional(),
            touchdowns: z.number().optional(),
          })
          .optional(),
        defense: z
          .object({
            tackles: z.number().optional(),
            sacks: z.number().optional(),
            interceptions: z.number().optional(),
            forced_fumbles: z.number().optional(),
          })
          .optional(),
        kicking: z
          .object({
            fg_made: z.number().optional(),
            fg_attempted: z.number().optional(),
            xp_made: z.number().optional(),
            xp_attempted: z.number().optional(),
          })
          .optional(),
      })
    )
    .parse(payload);

  const records = stats.map((s) => {
    const entityKey = `player_stat:${s.player_id}:${s.week ?? "unknown"}:${s.game_id ?? "unknown"}`;
    return {
      record_type: "player_stat",
      entity_key: entityKey,
      trust_level: TRUST_LEVEL,
      fields: {
        player_id: { extracted_value: s.player_id, source_path: "player_id", confidence: 1 },
        team_id: { extracted_value: s.team_id, source_path: "team_id", confidence: 1 },
        game_id: { extracted_value: s.game_id ?? null, source_path: "game_id" },
        week: { extracted_value: s.week ?? null, source_path: "week" },
        season: { extracted_value: s.season ?? null, source_path: "season" },
        passing: { extracted_value: s.passing ?? {}, source_path: "passing" },
        rushing: { extracted_value: s.rushing ?? {}, source_path: "rushing" },
        receiving: { extracted_value: s.receiving ?? {}, source_path: "receiving" },
        defense: { extracted_value: s.defense ?? {}, source_path: "defense" },
        kicking: { extracted_value: s.kicking ?? {}, source_path: "kicking" },
      },
    };
  });

  return { records, conflicts: [] };
}

/**
 * team_stats adapter
 * Expected: array of { team_id, game_id, week, offense, defense, special_teams... }
 */
export function parseTeamStats(payload: unknown): CompanionParseResult {
  const stats = z
    .array(
      z.object({
        team_id: z.string(),
        game_id: z.string().optional(),
        week: z.number().optional(),
        season: z.number().optional(),
        offense: z
          .object({
            total_yards: z.number().optional(),
            passing_yards: z.number().optional(),
            rushing_yards: z.number().optional(),
            first_downs: z.number().optional(),
            third_down_conv: z.number().optional(),
            third_down_att: z.number().optional(),
            fourth_down_conv: z.number().optional(),
            fourth_down_att: z.number().optional(),
            red_zone_td: z.number().optional(),
            red_zone_att: z.number().optional(),
            turnovers: z.number().optional(),
            penalties: z.number().optional(),
            penalty_yards: z.number().optional(),
            time_of_possession: z.string().optional(),
          })
          .optional(),
        defense: z
          .object({
            total_yards: z.number().optional(),
            passing_yards: z.number().optional(),
            rushing_yards: z.number().optional(),
            first_downs: z.number().optional(),
            third_down_conv: z.number().optional(),
            third_down_att: z.number().optional(),
            fourth_down_conv: z.number().optional(),
            fourth_down_att: z.number().optional(),
            red_zone_td: z.number().optional(),
            red_zone_att: z.number().optional(),
            turnovers_forced: z.number().optional(),
            sacks: z.number().optional(),
          })
          .optional(),
      })
    )
    .parse(payload);

  const records = stats.map((s) => {
    const entityKey = `team_stat:${s.team_id}:${s.week ?? "unknown"}:${s.game_id ?? "unknown"}`;
    return {
      record_type: "team_stat",
      entity_key: entityKey,
      trust_level: TRUST_LEVEL,
      fields: {
        team_id: { extracted_value: s.team_id, source_path: "team_id", confidence: 1 },
        game_id: { extracted_value: s.game_id ?? null, source_path: "game_id" },
        week: { extracted_value: s.week ?? null, source_path: "week" },
        season: { extracted_value: s.season ?? null, source_path: "season" },
        offense: { extracted_value: s.offense ?? {}, source_path: "offense" },
        defense: { extracted_value: s.defense ?? {}, source_path: "defense" },
      },
    };
  });

  return { records, conflicts: [] };
}

/**
 * Map endpoint key to adapter function.
 */
export const COMPANION_ADAPTERS: Record<string, (payload: unknown) => CompanionParseResult> = {
  league_metadata: parseLeagueMetadata,
  teams: parseTeams,
  standings: parseStandings,
  schedule: parseSchedule,
  rosters: parseRosters,
  player_stats: parsePlayerStats,
  team_stats: parseTeamStats,
};

/**
 * Process a Companion payload through the appropriate adapter and
 * write staged import records via the import pipeline service.
 */
export async function processCompanionPayload(
  importJobId: string,
  leagueId: string,
  endpointKey: string,
  payload: unknown
): Promise<{ recordsCreated: number; conflictsDetected: number }> {
  const adapter = COMPANION_ADAPTERS[endpointKey];
  if (!adapter) throw new Error(`No adapter for endpoint: ${endpointKey}`);

  const { records, conflicts } = adapter(payload);
  let recordsCreated = 0;
  let conflictsDetected = 0;

  // Create import records
  for (const record of records) {
    const { error } = await supabase.from("rec_import_records").insert({
      import_job_id: importJobId,
      league_id: leagueId,
      record_type: record.record_type,
      entity_key: record.entity_key,
      status: "pending_review",
      trust_level: record.trust_level,
    });
    if (error) throw new Error(`Failed to create import record: ${error.message}`);
    recordsCreated++;
  }

  // Create conflicts (if any - for now just log, future: compare with existing canonical data)
  for (const conflict of conflicts) {
    const { error } = await supabase.from("rec_import_conflicts").insert({
      import_record_id: null, // would link after record created
      field_key: conflict.field_key,
      incoming_value: conflict.incoming_value,
      existing_value: conflict.existing_value,
      existing_source: conflict.existing_source,
      resolution: "pending",
    });
    if (!error) conflictsDetected++;
  }

  return { recordsCreated, conflictsDetected };
}