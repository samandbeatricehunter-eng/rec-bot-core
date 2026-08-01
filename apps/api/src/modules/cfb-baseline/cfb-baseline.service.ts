// Editorial & Import Master Plan §5 — CFB baseline roster.
// Dataset registry, provider adapters, and league copy flow.

import { supabase } from "../../lib/supabase.js";
import { z } from "zod";
import type { ImportTrustLevel } from "@rec/shared";

export type CfbBaselineDataset = {
  id: string;
  game_title: string;
  provider: string;
  published_date: string;
  source_version: string;
  checksum: string;
  attribution_config: Record<string, unknown>;
  legal_review_status: "pending" | "approved" | "rejected";
  legal_review_notes: string | null;
  is_active: boolean;
  created_at: string;
};

export type CfbBaselineTeam = {
  id: string;
  dataset_id: string;
  source_team_id: string;
  name: string;
  abbreviation: string;
  display_name: string | null;
  conference: string | null;
  division: string;
  color_primary: string | null;
  color_secondary: string | null;
  logo_url: string | null;
  created_at: string;
};

export type CfbBaselinePlayer = {
  id: string;
  dataset_id: string;
  team_id: string;
  source_player_id: string;
  first_name: string;
  last_name: string;
  jersey_number: number | null;
  position: string | null;
  year: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  hometown_city: string | null;
  hometown_state: string | null;
  overall_rating: number | null;
  created_at: string;
};

export type CfbBaselinePlayerAttribute = {
  id: string;
  player_id: string;
  attribute_key: string;
  attribute_value: Record<string, unknown>;
  source_field: string | null;
  created_at: string;
};

export type CfbBaselineSourceRecord = {
  id: string;
  dataset_id: string;
  record_type: "team" | "player" | "attribute";
  source_id: string;
  raw_payload: Record<string, unknown>;
  record_hash: string;
  created_at: string;
};

export type CfbDatasetCreateInput = {
  game_title: string;
  provider: string;
  published_date: string;
  source_version: string;
  checksum: string;
  attribution_config?: Record<string, unknown>;
  legal_review_notes?: string;
};

export type CfbDatasetUpdateInput = Partial<CfbDatasetCreateInput> & {
  legal_review_status?: "pending" | "approved" | "rejected";
  is_active?: boolean;
};

export type ApplyBaselineToLeagueInput = {
  league_id: string;
  dataset_id: string;
  requested_by_user_id: string;
};

export async function listCfbDatasets(): Promise<CfbBaselineDataset[]> {
  const { data, error } = await supabase
    .from("rec_cfb_roster_datasets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list CFB baseline datasets: ${error.message}`);
  return data ?? [];
}

export async function getCfbDataset(datasetId: string): Promise<CfbBaselineDataset | null> {
  const { data, error } = await supabase
    .from("rec_cfb_roster_datasets")
    .select("*")
    .eq("id", datasetId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get CFB baseline dataset: ${error.message}`);
  }
  return data;
}

export async function createCfbDataset(input: CfbDatasetCreateInput): Promise<CfbBaselineDataset> {
  const { data, error } = await supabase
    .from("rec_cfb_roster_datasets")
    .insert({
      ...input,
      attribution_config: input.attribution_config ?? {},
      legal_review_status: "pending",
      is_active: true,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create CFB baseline dataset: ${error.message}`);
  return data;
}

export async function updateCfbDataset(datasetId: string, input: CfbDatasetUpdateInput): Promise<CfbBaselineDataset> {
  const { data, error } = await supabase
    .from("rec_cfb_roster_datasets")
    .update(input)
    .eq("id", datasetId)
    .select()
    .single();
  if (error) throw new Error(`Failed to update CFB baseline dataset: ${error.message}`);
  return data;
}

export async function deleteCfbDataset(datasetId: string): Promise<void> {
  const { error } = await supabase.from("rec_cfb_roster_datasets").delete().eq("id", datasetId);
  if (error) throw new Error(`Failed to delete CFB baseline dataset: ${error.message}`);
}

export async function listCfbBaselineTeams(datasetId: string): Promise<CfbBaselineTeam[]> {
  const { data, error } = await supabase
    .from("rec_cfb_baseline_teams")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("abbreviation");
  if (error) throw new Error(`Failed to list CFB baseline teams: ${error.message}`);
  return data ?? [];
}

export async function listCfbBaselinePlayers(datasetId: string, teamId?: string): Promise<CfbBaselinePlayer[]> {
  let query = supabase
    .from("rec_cfb_baseline_players")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("last_name, first_name");
  if (teamId) query = query.eq("team_id", teamId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list CFB baseline players: ${error.message}`);
  return data ?? [];
}

export async function getCfbBaselinePlayerAttributes(playerId: string): Promise<CfbBaselinePlayerAttribute[]> {
  const { data, error } = await supabase
    .from("rec_cfb_baseline_player_attributes")
    .select("*")
    .eq("player_id", playerId);
  if (error) throw new Error(`Failed to get CFB baseline player attributes: ${error.message}`);
  return data ?? [];
}

/**
 * Apply a CFB baseline dataset to a league — copy teams and players into league-owned tables.
 * Marks provenance as `cfb_baseline` (trust level: external_cfb_baseline).
 * Idempotent: re-running with same dataset_id + league_id skips already-copied records.
 */
export async function applyCfbBaselineToLeague(input: ApplyBaselineToLeagueInput): Promise<{
  teamsUpdated: number;
  playersCreated: number;
  skipped: { teams: number; players: number };
}> {
  const { league_id, dataset_id } = input;

  // Verify dataset exists and is active + approved
  const dataset = await getCfbDataset(dataset_id);
  if (!dataset) throw new Error("Dataset not found");
  if (!dataset.is_active) throw new Error("Dataset is not active");
  if (dataset.legal_review_status !== "approved") throw new Error("Dataset legal review not approved");

  // The league's CFB teams already exist — createDefaultTeamsForGuild() seeds the full
  // CFB_27_TEAMS catalog before baseline apply runs at league creation. Match baseline teams
  // to those rows by abbreviation (the seed script normalizes every provider team into the
  // catalog), stamp the provider team id onto rec_teams.madden_team_id, and skip any baseline
  // team that has no matching league team.
  const { data: leagueTeams, error: teamsError } = await supabase
    .from("rec_teams")
    .select("id, abbreviation")
    .eq("league_id", league_id);
  if (teamsError) throw new Error(`Failed to check existing teams: ${teamsError.message}`);

  const leagueTeamRows = (leagueTeams ?? []) as Array<{ id: string; abbreviation: string | null }>;
  const teamByAbbreviation = new Map<string, { id: string; abbreviation: string | null }>(
    leagueTeamRows.map((t) => [String(t.abbreviation ?? "").toUpperCase(), t] as const),
  );

  const baselineTeams = await listCfbBaselineTeams(dataset_id);
  if (!baselineTeams.length) throw new Error("Dataset has no teams");

  // baseline team id -> league rec_teams.id, plus the school name for rec_players.college.
  const teamIdMap = new Map<string, string>();
  const collegeByBaselineTeamId = new Map<string, string>();
  let teamsUpdated = 0;
  let teamsSkipped = 0;
  for (const bt of baselineTeams) {
    const leagueTeam = teamByAbbreviation.get(bt.abbreviation.toUpperCase());
    if (!leagueTeam) {
      teamsSkipped++;
      continue;
    }
    teamIdMap.set(bt.id, leagueTeam.id);
    collegeByBaselineTeamId.set(bt.id, bt.name);
    if (bt.source_team_id) {
      const { error } = await supabase
        .from("rec_teams")
        .update({ madden_team_id: bt.source_team_id })
        .eq("id", leagueTeam.id);
      if (error) throw new Error(`Failed to update team ${bt.abbreviation}: ${error.message}`);
    }
    teamsUpdated++;
  }

  // Fetch the baseline players (all rows — the REST path used here has no 1000-row cap).
  const baselinePlayers = await listCfbBaselinePlayers(dataset_id);

  // Pull player attributes in player-id batches and collapse them into one map per player.
  // rec_cfb_baseline_player_attributes has no dataset_id column, so chunk by player id.
  const attributeMap = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < baselinePlayers.length; i += 500) {
    const chunk = baselinePlayers.slice(i, i + 500);
    const ids = chunk.map((p) => p.id);
    const { data, error } = await supabase
      .from("rec_cfb_baseline_player_attributes")
      .select("player_id, attribute_key, attribute_value")
      .in("player_id", ids);
    if (error) throw new Error(`Failed to fetch baseline player attributes: ${error.message}`);
    for (const row of data ?? []) {
      const current = attributeMap.get(row.player_id) ?? {};
      current[row.attribute_key] = row.attribute_value;
      attributeMap.set(row.player_id, current);
    }
  }

  // Idempotency: re-running a seed must not duplicate players. rec_players has no
  // source_player_id column — madden_player_id carries the synthetic stable id instead.
  const existingPlayers = await supabase
    .from("rec_players")
    .select("madden_player_id")
    .eq("league_id", league_id);
  if (existingPlayers.error) throw new Error(`Failed to check existing players: ${existingPlayers.error.message}`);
  const existingPlayerIds = new Set<string>((existingPlayers.data ?? []).map((p) => p.madden_player_id));

  const rows: Array<Record<string, unknown>> = [];
  let playersSkipped = 0;
  for (const bp of baselinePlayers) {
    const leagueTeamId = teamIdMap.get(bp.team_id);
    if (!leagueTeamId) {
      playersSkipped++;
      continue;
    }
    const maddenPlayerId = `cfb27:${bp.source_player_id}`;
    if (existingPlayerIds.has(maddenPlayerId)) {
      playersSkipped++;
      continue;
    }
    existingPlayerIds.add(maddenPlayerId);

    const attributes = attributeMap.get(bp.id) ?? {};
    rows.push({
      league_id,
      team_id: leagueTeamId,
      madden_player_id: maddenPlayerId,
      first_name: bp.first_name,
      last_name: bp.last_name,
      full_name: `${bp.first_name} ${bp.last_name}`,
      position: bp.position,
      college: collegeByBaselineTeamId.get(bp.team_id) ?? null,
      height_inches: bp.height_inches,
      weight_lbs: bp.weight_lbs,
      overall_rating: bp.overall_rating,
      // CFB baseline players are rostered (not free agents) and have no dev trait in the
      // baseline attribute set (physicals/mentals/utility + numeric ratings only).
      is_free_agent: false,
      raw_payload: {
        source_player_id: bp.source_player_id,
        jersey_number: bp.jersey_number,
        year: bp.year,
        hometown: { city: bp.hometown_city, state: bp.hometown_state },
        attributes,
      },
    });
  }

  let playersCreated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("rec_players").insert(chunk);
    if (error) throw new Error(`Failed to insert baseline players: ${error.message}`);
    playersCreated += chunk.length;
  }

  return { teamsUpdated, playersCreated, skipped: { teams: teamsSkipped, players: playersSkipped } };
}

/**
 * Adapter for the import pipeline — produces rec_import_records from a CFB baseline dataset.
 * Called by the import pipeline when a cfb_baseline import job is processed.
 */
export async function createImportRecordsFromCfbBaseline(
  importJobId: string,
  leagueId: string,
  datasetId: string
): Promise<{ recordsCreated: number; conflictsDetected: number }> {
  // This is the "staging" step — write normalized records into rec_import_records
  // with trust_level = 'external_cfb_baseline'. The commissioner then reviews/approves.
  const dataset = await getCfbDataset(datasetId);
  if (!dataset) throw new Error("Dataset not found");

  const baselineTeams = await listCfbBaselineTeams(datasetId);
  let recordsCreated = 0;

  for (const bt of baselineTeams) {
    // Check if a league team already exists with this abbreviation
    const { data: existingTeam } = await supabase
      .from("rec_teams")
      .select("id")
      .eq("league_id", leagueId)
      .eq("abbreviation", bt.abbreviation)
      .maybeSingle();

    const entityKey = `team:${bt.source_team_id}`;
    const trustLevel: ImportTrustLevel = "external_cfb_baseline";

    const { error } = await supabase.from("rec_import_records").insert({
      import_job_id: importJobId,
      league_id: leagueId,
      record_type: "team",
      entity_key: entityKey,
      status: "pending_review",
      trust_level: trustLevel,
    });
    if (error) throw new Error(`Failed to create import record for team ${bt.abbreviation}: ${error.message}`);
    recordsCreated++;
  }

  // Could also create player records here, but typically teams are reviewed first
  // and players flow in after team approval. Keeping it simple for Phase 2.

  return { recordsCreated, conflictsDetected: 0 };
}