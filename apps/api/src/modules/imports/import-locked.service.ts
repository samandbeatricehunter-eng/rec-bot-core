import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueForGuild } from "../team-ownership/team-ownership.service.js";
import type { CreateImportJobInput } from "./import.schemas.js";
import { createImportJob as createBaseImportJob } from "./import.service.js";

const ACTIVE_IMPORT_STATUSES = ["created", "queued", "running", "validating", "reconciling"];

const CORE_ENDPOINT_KEYS = [
  "league_metadata",
  "teams",
  "standings",
  "schedule",
  "rosters",
  "players",
  "player_stats",
  "team_stats"
] as const;

function selectedEndpointKeys(input: CreateImportJobInput) {
  if (input.importScope === "full_regular_season_schedule") return ["schedule"];
  if (input.selectedEndpointKeys.length > 0) return input.selectedEndpointKeys;
  return [...CORE_ENDPOINT_KEYS];
}

function normalizedWeekTo(input: CreateImportJobInput) {
  if (input.importScope === "single_week") return input.weekFrom ?? null;
  if (input.importScope === "selected_weeks") return input.weekTo ?? null;
  return null;
}

export async function createImportJob(input: CreateImportJobInput) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);

  const activeJob = await supabase
    .from("rec_import_jobs")
    .select("id, import_mode, status, import_label, created_at")
    .eq("server_id", server.id)
    .eq("league_id", league.id)
    .in("status", ACTIVE_IMPORT_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeJob.error) {
    throw new ApiError(500, "Failed to check active import jobs.", activeJob.error);
  }

  if (activeJob.data) {
    throw new ApiError(409, "An import is already active for this league.", {
      activeImportJob: activeJob.data
    });
  }

  const keys = selectedEndpointKeys(input);
  const created = await createBaseImportJob(input);
  const importJobId = created.job.id;

  const updated = await supabase
    .from("rec_import_jobs")
    .update({
      ea_external_league_id: input.eaExternalLeagueId ?? null,
      ea_external_league_name: input.eaExternalLeagueName ?? null,
      import_scope: input.importScope,
      week_from: input.importScope === "full_regular_season_schedule" ? null : input.weekFrom ?? null,
      week_to: normalizedWeekTo(input),
      selected_endpoint_keys: keys,
      payouts_deferred_until_advance: true,
      preview_summary: {
        ...(created.job.preview_summary ?? {}),
        importScope: input.importScope,
        weekFrom: input.importScope === "full_regular_season_schedule" ? null : input.weekFrom ?? null,
        weekTo: normalizedWeekTo(input),
        eaExternalLeagueId: input.eaExternalLeagueId ?? null,
        eaExternalLeagueName: input.eaExternalLeagueName ?? null,
        selectedEndpointKeys: keys,
        payouts: "Deferred until league advance. Imports never issue economy payouts directly."
      },
      payload: {
        ...(created.job.payload ?? {}),
        importScope: input.importScope,
        weekFrom: input.importScope === "full_regular_season_schedule" ? null : input.weekFrom ?? null,
        weekTo: normalizedWeekTo(input),
        eaExternalLeagueId: input.eaExternalLeagueId ?? null,
        eaExternalLeagueName: input.eaExternalLeagueName ?? null,
        selectedEndpointKeys: keys
      }
    })
    .eq("id", importJobId)
    .select("*")
    .single();

  if (updated.error) {
    throw new ApiError(500, "Failed to persist import selections.", updated.error);
  }

  const removeAttempts = await supabase
    .from("rec_import_endpoint_attempts")
    .delete()
    .eq("import_job_id", importJobId)
    .not("endpoint_key", "in", `(${keys.join(",")})`);

  if (removeAttempts.error) {
    throw new ApiError(500, "Failed to prune unselected endpoint attempts.", removeAttempts.error);
  }

  return {
    ...created,
    job: updated.data,
    endpointAttempts: (created.endpointAttempts ?? []).filter((attempt: any) => keys.includes(attempt.endpoint_key))
  };
}
