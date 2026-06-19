import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { CoreImportEndpoint, ImportProfile } from "./import.schemas.js";

export const CORE_IMPORT_ENDPOINT_KEYS = [
  "league_metadata",
  "teams",
  "standings",
  "weekly_stats",
  "rosters"
] as const satisfies readonly CoreImportEndpoint[];

export const OFFSEASON_ROSTER_SYNC_ENDPOINT_KEYS = [
  "league_metadata",
  "teams",
  "rosters"
] as const satisfies readonly CoreImportEndpoint[];

export const SEASON_START_ENDPOINT_KEYS = [
  "league_metadata",
  "teams",
  "standings",
  "weekly_stats",
  "rosters"
] as const satisfies readonly CoreImportEndpoint[];

const COMPETITIVE_STAGES = new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl"]);
const OFFSEASON_STAGES = new Set(["coach_hiring", "final_resigning", "free_agency", "draft", "preseason_training_camp", "offseason"]);

export type ResolvedImportProfile = {
  profile: ImportProfile;
  importScope: "current_week" | "single_week" | "full_regular_season_schedule" | "catch_up_auto";
  selectedEndpointKeys: CoreImportEndpoint[];
  selectedWeeks: number[] | null;
  weekFrom: number | null;
  weekTo: number | null;
  reason: string;
  fullScheduleAlreadyImported: boolean;
};

function leagueSeasonNumber(league: any) {
  return Number(league?.season_number ?? league?.display_season_number ?? 1) || 1;
}

function leagueWeek(league: any) {
  return Number(league?.current_week ?? 1) || 1;
}

function leagueStage(league: any) {
  return String(league?.season_stage ?? league?.current_phase ?? "regular_season");
}

export async function loadSeasonSyncState(leagueId: string, seasonNumber: number) {
  const result = await supabase
    .from("rec_season_sync_state")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load season sync state.", result.error);
  return result.data ?? null;
}

export async function resolveImportProfile(input: {
  league: any;
  requestedProfile?: ImportProfile | null;
}): Promise<ResolvedImportProfile> {
  const league = input.league;
  const leagueId = String(league.id);
  const seasonNumber = leagueSeasonNumber(league);
  const week = leagueWeek(league);
  const stage = leagueStage(league);
  const syncState = await loadSeasonSyncState(leagueId, seasonNumber);
  const fullScheduleAlreadyImported = Boolean(syncState?.full_schedule_imported_at);

  const canSeasonStart = stage === "preseason_training_camp" && !fullScheduleAlreadyImported;
  const requestedProfile = input.requestedProfile ?? null;
  let profile: ImportProfile =
    requestedProfile && requestedProfile !== "manual_review_only"
      ? requestedProfile
      : COMPETITIVE_STAGES.has(stage)
        ? "weekly_competitive"
        : OFFSEASON_STAGES.has(stage)
          ? "offseason_roster_sync"
          : "manual_review_only";

  if (profile === "season_start_schedule" && !canSeasonStart) {
    profile = fullScheduleAlreadyImported ? "offseason_roster_sync" : "manual_review_only";
  }

  // A training-camp league whose full schedule is already imported is a catch-up: the commissioner
  // has been playing weeks even though REC hasn't advanced out of camp. Auto-detect the in-game week
  // from live standings and import every played week (the executor fills in the actual weeks), so the
  // commissioner never has to know or pick the number.
  if (stage === "preseason_training_camp" && fullScheduleAlreadyImported) {
    return {
      profile: "weekly_competitive",
      importScope: "catch_up_auto",
      selectedEndpointKeys: [...CORE_IMPORT_ENDPOINT_KEYS],
      selectedWeeks: null,
      weekFrom: 1,
      weekTo: null,
      reason: "Catch-up: auto-detect your in-game week from standings and import every played week.",
      fullScheduleAlreadyImported
    };
  }

  if (profile === "season_start_schedule") {
    return {
      profile,
      importScope: "full_regular_season_schedule",
      selectedEndpointKeys: [...SEASON_START_ENDPOINT_KEYS],
      selectedWeeks: Array.from({ length: 18 }, (_, index) => index + 1),
      weekFrom: 1,
      weekTo: 18,
      reason: "Season start import: Training Camp into regular-season Week 1. Full schedule is imported once for this season.",
      fullScheduleAlreadyImported
    };
  }

  if (profile === "weekly_competitive") {
    return {
      profile,
      importScope: "single_week",
      selectedEndpointKeys: [...CORE_IMPORT_ENDPOINT_KEYS],
      selectedWeeks: [week],
      weekFrom: week,
      weekTo: week,
      reason: "Competitive week import: standings, weekly games/stats, teams, and rosters.",
      fullScheduleAlreadyImported
    };
  }

  if (profile === "offseason_roster_sync") {
    return {
      profile,
      importScope: "single_week",
      selectedEndpointKeys: [...OFFSEASON_ROSTER_SYNC_ENDPOINT_KEYS],
      selectedWeeks: [week],
      weekFrom: week,
      weekTo: week,
      reason: "Offseason roster sync: teams and rosters only, with roster diffs used for transactions/player changes.",
      fullScheduleAlreadyImported
    };
  }

  return {
    profile: "manual_review_only",
    importScope: "single_week",
    selectedEndpointKeys: [],
    selectedWeeks: [week],
    weekFrom: week,
    weekTo: week,
    reason: `REC does not have a safe import profile for stage "${stage}".`,
    fullScheduleAlreadyImported
  };
}

export async function updateImportSyncState(input: {
  leagueId: string;
  seasonNumber: number;
  importJobId: string;
  importProfile?: string | null;
  importScope?: string | null;
  selectedEndpointKeys?: string[] | null;
  weekNumber?: number | null;
}) {
  const now = new Date().toISOString();
  const endpoints = new Set(input.selectedEndpointKeys ?? []);
  const patch: Record<string, unknown> = {
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    updated_at: now
  };

  if (input.importProfile === "season_start_schedule" || input.importScope === "full_regular_season_schedule") {
    patch.full_schedule_imported_at = now;
    patch.full_schedule_import_job_id = input.importJobId;
  }
  if (endpoints.has("rosters")) {
    patch.last_roster_sync_at = now;
    patch.last_roster_sync_import_job_id = input.importJobId;
  }
  if (endpoints.has("weekly_stats") && input.importScope !== "full_regular_season_schedule") {
    patch.last_weekly_import_week = input.weekNumber ?? null;
    patch.last_weekly_import_at = now;
    patch.last_weekly_import_job_id = input.importJobId;
  }

  const result = await supabase
    .from("rec_season_sync_state")
    .upsert(patch, { onConflict: "league_id,season_number" });
  if (result.error) throw new ApiError(500, "Failed to update season sync state.", result.error);
}
