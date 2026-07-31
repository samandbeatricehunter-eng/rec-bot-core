// Editorial & Import Master Plan §5 — CFB baseline roster.
// Dataset registry, provider adapters, and league copy flow.

import { supabase } from "../../lib/supabase.js";
import { z } from "zod";
import type { ImportSourceType, ImportTrustLevel } from "@rec/shared";

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
  teamsCreated: number;
  playersCreated: number;
  skipped: { teams: number; players: number };
}> {
  const { league_id, dataset_id, requested_by_user_id } = input;

  // Verify dataset exists and is active + approved
  const dataset = await getCfbDataset(dataset_id);
  if (!dataset) throw new Error("Dataset not found");
  if (!dataset.is_active) throw new Error("Dataset is not active");
  if (dataset.legal_review_status !== "approved") throw new Error("Dataset legal review not approved");

  // Get baseline teams for this dataset
  const baselineTeams = await listCfbBaselineTeams(dataset_id);
  if (!baselineTeams.length) throw new Error("Dataset has no teams");

  // Check which teams already exist in league (by abbreviation match)
  const { data: existingTeams, error: existingError } = await supabase
    .from("rec_teams")
    .select("id, abbreviation")
    .eq("league_id", league_id);
  if (existingError) throw new Error(`Failed to check existing teams: ${existingError.message}`);

  const existingAbbrevs = new Set((existingTeams ?? []).map((t) => t.abbreviation));

  // Insert new teams
  let teamsCreated = 0;
  let teamsSkipped = 0;
  const teamIdMap = new Map<string, string>(); // source_team_id -> new rec_teams.id

  for (const bt of baselineTeams) {
    if (existingAbbrevs.has(bt.abbreviation)) {
      // Find existing team to map
      const existing = existingTeams!.find((t) => t.abbreviation === bt.abbreviation);
      if (existing) teamIdMap.set(bt.source_team_id, existing.id);
      teamsSkipped++;
      continue;
    }

    const { data: newTeam, error } = await supabase
      .from("rec_teams")
      .insert({
        league_id,
        name: bt.name,
        abbreviation: bt.abbreviation,
        display_name: bt.display_name,
        conference: bt.conference,
        color_primary: bt.color_primary,
        color_secondary: bt.color_secondary,
        logo_url: bt.logo_url,
        is_relocated: false,
        source: "cfb_baseline" as ImportSourceType,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to insert team ${bt.abbreviation}: ${error.message}`);
    teamIdMap.set(bt.source_team_id, newTeam.id);
    teamsCreated++;
  }

  // Insert players for newly created teams (and optionally for skipped teams if they have no players)
  const baselinePlayers = await listCfbBaselinePlayers(dataset_id);
  let playersCreated = 0;
  let playersSkipped = 0;

  for (const bp of baselinePlayers) {
    const leagueTeamId = teamIdMap.get(bp.team_id);
    if (!leagueTeamId) {
      // Team wasn't created/copied (maybe user skipped it) — skip player
      playersSkipped++;
      continue;
    }

    // Check if player already exists on this team (by source_player_id + team)
    const { data: existingPlayer } = await supabase
      .from("rec_players")
      .select("id")
      .eq("team_id", leagueTeamId)
      .eq("source_player_id", bp.source_player_id)
      .maybeSingle();

    if (existingPlayer) {
      playersSkipped++;
      continue;
    }

    const { error } = await supabase.from("rec_players").insert({
      team_id: leagueTeamId,
      league_id,
      source_player_id: bp.source_player_id,
      first_name: bp.first_name,
      last_name: bp.last_name,
      jersey_number: bp.jersey_number,
      position: bp.position,
      year: bp.year,
      height_inches: bp.height_inches,
      weight_lbs: bp.weight_lbs,
      hometown_city: bp.hometown_city,
      hometown_state: bp.hometown_state,
      overall_rating: bp.overall_rating,
      source: "cfb_baseline" as ImportSourceType,
    });
    if (error) throw new Error(`Failed to insert player ${bp.first_name} ${bp.last_name}: ${error.message}`);
    playersCreated++;
  }

  return { teamsCreated, playersCreated, skipped: { teams: teamsSkipped, players: playersSkipped } };
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