import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

export async function generateImportPreview(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    importJobId,
    previewStatus: "pending_endpoint_execution",
    gamesFound: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    standingsChanges: 0,
    userRecordChanges: 0,
    headToHeadRecordChanges: 0,
    economyTransactions: 0,
    payouts: "Deferred until league advance. Imports do not issue payouts.",
    message: "Preview shell generated. Endpoint execution must complete before production data can be reconciled."
  };

  return updateImportJobStatus({
    importJobId,
    status: "validating",
    previewSummary,
    validationWarnings: [
      {
        code: "endpoint_execution_pending",
        message: "EA endpoint execution is not wired yet. This preview contains the approved structure only."
      }
    ],
    validationErrors: []
  });
}

export async function approveImportPreview(importJobId: string) {
  const details = await getImportJob(importJobId);

  if (!["validating", "completed_with_warnings"].includes(details.job.status)) {
    throw new ApiError(409, "Import must have a generated preview before approval.", {
      currentStatus: details.job.status
    });
  }

  return updateImportJobStatus({
    importJobId,
    status: "reconciling",
    previewSummary: {
      ...(details.job.preview_summary ?? {}),
      approvalStatus: "approved",
      economyTransactions: 0,
      payouts: "Deferred until league advance."
    },
    validationWarnings: details.job.validation_warnings ?? [],
    validationErrors: details.job.validation_errors ?? []
  });
}

export async function cancelImportJob(importJobId: string, reason?: string | null) {
  const result = await supabase
    .from("rec_import_jobs")
    .update({
      status: "cancelled",
      failure_reason: reason ?? "Cancelled by admin before commit."
    })
    .eq("id", importJobId)
    .select("*")
    .single();

  if (result.error) {
    throw new ApiError(500, "Failed to cancel import job.", result.error);
  }

  return getImportJob(importJobId);
}
