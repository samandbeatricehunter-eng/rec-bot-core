// Madden roster pre-seed — apply-to-league flow. See docs/madden-fantasy-draft-plan.md.
//
// Mirrors apps/api/src/modules/cfb-baseline/cfb-baseline.service.ts's
// applyCfbBaselineToLeague, writing into the same shared rec_players table CFB already
// uses (see plan doc §2's "Corrected 2026-08-07" note for why there's no separate Madden
// roster table). team_abbreviation on rec_madden_baseline_players actually stores the full
// team name (e.g. "Buffalo Bills"), matching rec_teams.name — not rec_teams.abbreviation.
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";

export type MaddenBaselinePlayer = {
  id: string;
  source_slug: string;
  name: string;
  team_abbreviation: string | null; // actually the full team name — see header note
  position: string;
  position_full: string | null;
  jersey_number: number | null;
  archetype: string | null;
  overall_rating: number | null;
  age: number | null;
  date_of_birth: string | null;
  nationality: string | null;
  college: string | null;
  years_pro: number | null;
  photo_url: string | null;
  abilities_raw: string | null;
  data_quality: "rated" | "backfilled_prior_year" | "placeholder";
  [attributeColumn: string]: unknown;
};

const ATTRIBUTE_DB_COLUMNS = [
  "speed", "acceleration", "strength", "agility", "awareness", "jumping", "injury", "stamina", "toughness",
  "throw_power", "throw_under_pressure", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "play_action",
  "catching", "spectacular_catch", "catch_in_traffic", "route_running_short", "route_running_medium", "route_running_deep", "release",
  "carrying", "break_tackle", "trucking", "change_of_direction", "bc_vision", "stiff_arm", "spin_move", "juke_move", "break_sack",
  "tackle", "power_moves", "finesse_moves", "block_shedding", "pursuit", "play_recognition", "man_coverage", "zone_coverage", "hit_power", "press",
  "run_block", "pass_block", "impact_blocking", "run_block_power", "run_block_finesse", "pass_block_power", "pass_block_finesse", "lead_block",
  "kick_power", "kick_accuracy", "kick_return",
] as const;

export async function getActiveMaddenDataset(): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("rec_madden_roster_datasets")
    .select("id")
    .eq("game_title", "madden_27")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to resolve the active Madden baseline dataset", error);
  return data;
}

async function listMaddenBaselinePlayers(datasetId: string): Promise<MaddenBaselinePlayer[]> {
  const pageSize = 1000;
  const rows: MaddenBaselinePlayer[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("rec_madden_baseline_players")
      .select("*")
      .eq("dataset_id", datasetId)
      .range(offset, offset + pageSize - 1);
    if (error) throw new ApiError(500, "Failed to load Madden baseline players", error);
    rows.push(...((data ?? []) as MaddenBaselinePlayer[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export type ApplyMaddenBaselineInput = {
  league_id: string;
  dataset_id: string;
  /** true = every player's team_id is set to null (fantasy_draft pool / undrafted).
   *  false = real-life team assignment (regular_rosters, or custom_rosters that opted in). */
  fantasyDraftMode: boolean;
};

export async function applyMaddenBaselineToLeague(input: ApplyMaddenBaselineInput): Promise<{
  playersCreated: number;
  teamsMatched: number;
  skippedNoTeamMatch: number;
}> {
  const { league_id, dataset_id, fantasyDraftMode } = input;

  const { data: leagueTeams, error: teamsError } = await supabase
    .from("rec_teams")
    .select("id, name")
    .eq("league_id", league_id);
  if (teamsError) throw new ApiError(500, "Failed to load league teams", teamsError);
  const teamIdByName = new Map<string, string>((leagueTeams ?? []).map((t: any) => [String(t.name ?? "").trim().toUpperCase(), t.id as string]));

  const baselinePlayers = await listMaddenBaselinePlayers(dataset_id);
  if (!baselinePlayers.length) throw new ApiError(500, "Madden baseline dataset has no players");

  // Idempotency: re-applying (e.g. a retried request) must not duplicate players.
  // madden_player_id carries 'madden27:' + source_slug as the stable dedupe key.
  const existing = await supabase.from("rec_players").select("madden_player_id").eq("league_id", league_id).not("madden_player_id", "is", null);
  if (existing.error) throw new ApiError(500, "Failed to check existing players", existing.error);
  const existingIds = new Set((existing.data ?? []).map((r: any) => r.madden_player_id as string));

  let teamsMatched = 0;
  let skippedNoTeamMatch = 0;
  const rows: Record<string, unknown>[] = [];

  for (const p of baselinePlayers) {
    const maddenPlayerId = `madden27:${p.source_slug}`;
    if (existingIds.has(maddenPlayerId)) continue;

    let teamId: string | null = null;
    if (!fantasyDraftMode && p.team_abbreviation) {
      teamId = teamIdByName.get(p.team_abbreviation.trim().toUpperCase()) ?? null;
      if (teamId) teamsMatched++;
      else skippedNoTeamMatch++;
    }

    const nameParts = p.name.trim().split(/\s+/);
    const firstName = nameParts[0] ?? p.name;
    const lastName = nameParts.slice(1).join(" ") || p.name;

    const attributes: Record<string, number | null> = {};
    for (const col of ATTRIBUTE_DB_COLUMNS) attributes[col] = (p[col] as number | null) ?? null;

    rows.push({
      league_id,
      team_id: teamId,
      madden_player_id: maddenPlayerId,
      first_name: firstName,
      last_name: lastName,
      full_name: p.name,
      position: p.position,
      overall_rating: p.overall_rating,
      jersey_number: p.jersey_number,
      archetype: p.archetype,
      attributes,
      college: p.college,
      birth_year: p.date_of_birth ? Number(p.date_of_birth.slice(0, 4)) : null,
      years_pro: p.years_pro,
      photo_url: p.photo_url ?? null,
      is_free_agent: !teamId,
      // roster_status's check constraint only allows CFB-dynasty values (active/drafted/
      // transferred_out/transferred_in/retired/graduated) — none of those fit Madden
      // cleanly, so every Madden row just stays 'active' and team_id/is_free_agent alone
      // represent roster state. See plan doc §2's open issue note.
      roster_status: "active",
      is_default_player: true,
      player_source: "imported",
    });
  }

  if (rows.length) {
    const batchSize = 250;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await supabase.from("rec_players").insert(rows.slice(i, i + batchSize));
      if (error) throw new ApiError(500, `Failed to insert Madden players [${i}-${i + batchSize}]`, error);
    }
  }

  return { playersCreated: rows.length, teamsMatched, skippedNoTeamMatch };
}
