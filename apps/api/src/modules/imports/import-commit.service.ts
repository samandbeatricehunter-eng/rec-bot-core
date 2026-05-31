import { ApiError } from "../../lib/errors.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

export async function commitApprovedImport(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;

  if (job.status !== "reconciling") {
    throw new ApiError(409, "Import must be approved and reconciling before commit.", {
      currentStatus: job.status
    });
  }

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    commitStatus: "completed_placeholder",
    gameReconciliation: {
      gamesAdded: 0,
      gamesUpdated: 0,
      gamesSkipped: 0
    },
    standingsUpdate: {
      importedStandingsApplied: false,
      recalculationRequiredOnAdvance: true
    },
    recordUpdates: {
      userRecordsUpdated: 0,
      headToHeadRecordsUpdated: 0
    },
    recalculationFlags: {
      strengthOfSchedule: true,
      competitorRatings: true
    },
    deferredSystems: {
      coinPayouts: "advance_engine_only",
      badgeChanges: "advance_engine_only",
      trainerProgress: "advance_engine_only",
      scoutProgress: "advance_engine_only"
    },
    message: "Commit pipeline placeholder completed. Endpoint execution and reconciliation logic will populate these values later."
  };

  return updateImportJobStatus({
    importJobId,
    status: "completed_with_warnings",
    previewSummary,
    validationWarnings: [
      ...((job.validation_warnings ?? []) as unknown[]),
      {
        code: "commit_pipeline_placeholder",
        message: "Import commit pipeline foundation completed without live endpoint reconciliation."
      }
    ],
    validationErrors: job.validation_errors ?? []
  });
}
