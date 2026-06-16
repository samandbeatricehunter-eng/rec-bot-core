import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueForGuild } from "../team-ownership/team-ownership.service.js";
import type { CreateImportJobInput, ImportProfile } from "./import.schemas.js";
import { resolveImportProfile } from "./import-profile.service.js";
import { createImportJob as createBaseImportJob } from "./import.service.js";

const ACTIVE_IMPORT_STATUSES = ["created", "queued", "running", "validating", "reconciling"];
const RESUMABLE_IMPORT_STATUSES = ["created", "queued", "running", "validating", "reconciling", "completed_with_warnings"];

function normalizedWeeks(input: { importScope: string; selectedWeeks?: number[] | null; weekFrom?: number | null }) {
  if (input.importScope !== "single_week") return null;
  const weeks = [...new Set(input.selectedWeeks?.length ? input.selectedWeeks : input.weekFrom ? [input.weekFrom] : [])].sort((a, b) => a - b);
  return weeks.length ? weeks : null;
}

export async function createImportJob(input: CreateImportJobInput) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);
  const resolvedProfile = await resolveImportProfile({ league, requestedProfile: input.importProfile ?? null });
  if (resolvedProfile.profile === "manual_review_only") {
    throw new ApiError(409, "This league stage needs commissioner review before importing.", {
      importProfile: resolvedProfile.profile,
      reason: resolvedProfile.reason
    });
  }

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

  const keys = resolvedProfile.selectedEndpointKeys;
  const resolvedInput = {
    ...input,
    importScope: resolvedProfile.importScope,
    weekFrom: resolvedProfile.weekFrom ?? undefined,
    weekTo: resolvedProfile.weekTo ?? undefined,
    selectedWeeks: resolvedProfile.selectedWeeks ?? undefined,
    selectedEndpointKeys: keys
  };
  let eaExternalLeagueId = input.eaExternalLeagueId ?? null;
  let eaExternalLeagueName = input.eaExternalLeagueName ?? null;

  if (input.importMode === "ea_import" && !eaExternalLeagueId) {
    const activeLink = await supabase
      .from("rec_league_ea_franchise_links")
      .select("franchise:rec_ea_franchises(external_league_id,league_name,raw_payload)")
      .eq("league_id", league.id)
      .eq("server_id", server.id)
      .eq("is_active", true)
      .maybeSingle();

    if (activeLink.error) {
      throw new ApiError(500, "Failed to load selected EA franchise for this league.", activeLink.error);
    }

    const franchise = (activeLink.data as any)?.franchise;
    eaExternalLeagueId = franchise?.external_league_id ? String(franchise.external_league_id) : null;
    eaExternalLeagueName = franchise?.league_name ?? franchise?.raw_payload?.leagueName ?? franchise?.raw_payload?.name ?? eaExternalLeagueName;
  }

  const created = await createBaseImportJob(resolvedInput);
  const importJobId = created.job.id;

  const updated = await supabase
    .from("rec_import_jobs")
    .update({
      ea_external_league_id: eaExternalLeagueId,
      ea_external_league_name: eaExternalLeagueName,
      import_profile: resolvedProfile.profile,
      import_scope: resolvedProfile.importScope,
      week_from: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekFrom,
      week_to: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekTo,
      selected_weeks: resolvedProfile.importScope === "full_regular_season_schedule" ? resolvedProfile.selectedWeeks : normalizedWeeks(resolvedInput),
      selected_endpoint_keys: keys,
      payouts_deferred_until_advance: true,
      preview_summary: {
        ...(created.job.preview_summary ?? {}),
        importProfile: resolvedProfile.profile,
        importProfileReason: resolvedProfile.reason,
        fullScheduleAlreadyImported: resolvedProfile.fullScheduleAlreadyImported,
        importScope: resolvedProfile.importScope,
        weekFrom: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekFrom,
        weekTo: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekTo,
        selectedWeeks: resolvedProfile.importScope === "full_regular_season_schedule" ? resolvedProfile.selectedWeeks : normalizedWeeks(resolvedInput),
        eaExternalLeagueId,
        eaExternalLeagueName,
        selectedEndpointKeys: keys,
        payouts: "Deferred until league advance. Imports never issue economy payouts directly."
      },
      payload: {
        ...(created.job.payload ?? {}),
        importProfile: resolvedProfile.profile,
        importProfileReason: resolvedProfile.reason,
        fullScheduleAlreadyImported: resolvedProfile.fullScheduleAlreadyImported,
        importScope: resolvedProfile.importScope,
        weekFrom: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekFrom,
        weekTo: resolvedProfile.importScope === "full_regular_season_schedule" ? null : resolvedProfile.weekTo,
        selectedWeeks: resolvedProfile.importScope === "full_regular_season_schedule" ? resolvedProfile.selectedWeeks : normalizedWeeks(resolvedInput),
        eaExternalLeagueId,
        eaExternalLeagueName,
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

export async function getActiveImportJobForGuild(guildId: string) {
  const { server, league } = await getCurrentLeagueForGuild(guildId);
  const activeJob = await supabase
    .from("rec_import_jobs")
    .select("id, import_mode, status, import_label, created_at, week_from, week_to, import_scope, import_profile, selected_endpoint_keys")
    .eq("server_id", server.id)
    .eq("league_id", league.id)
    .in("status", ACTIVE_IMPORT_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeJob.error) {
    throw new ApiError(500, "Failed to check active import jobs.", activeJob.error);
  }

  return { server, league, job: activeJob.data ?? null };
}

export async function resolveImportProfileForGuild(input: { guildId: string; requestedProfile?: ImportProfile | null }) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);
  const importProfile = await resolveImportProfile({
    league,
    requestedProfile: input.requestedProfile ?? null
  });
  return { server, league, importProfile };
}

export async function cancelActiveImportForGuild(input: { guildId: string; reason?: string | null }) {
  const active = await getActiveImportJobForGuild(input.guildId);
  if (!active.job?.id) return { ...active, cancelled: false };
  const cancelled = await supabase
    .from("rec_import_jobs")
    .update({
      status: "cancelled",
      failure_reason: input.reason ?? "Cancelled before starting a new import.",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", active.job.id)
    .select("*")
    .single();
  if (cancelled.error) throw new ApiError(500, "Failed to cancel active import job.", cancelled.error);
  return { server: active.server, league: active.league, job: cancelled.data, cancelled: true };
}
