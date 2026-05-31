import { ApiError } from "../../lib/errors.js";
import { getImportJob, updateEndpointAttempt, updateImportJobStatus } from "./import.service.js";

export type ImportEndpointExecutionResult = {
  endpointKey: string;
  endpointLabel: string;
  status: "success" | "failed" | "skipped";
  recordsFound: number;
  responseSummary?: Record<string, unknown>;
  errorMessage?: string | null;
};

type ExecutorContext = {
  importJobId: string;
  endpointKey: string;
  endpointLabel: string;
};

type EndpointExecutor = (context: ExecutorContext) => Promise<ImportEndpointExecutionResult>;

const pendingLiveEaExecutor: EndpointExecutor = async (context) => ({
  endpointKey: context.endpointKey,
  endpointLabel: context.endpointLabel,
  status: "skipped",
  recordsFound: 0,
  responseSummary: {
    reason: "live_ea_client_not_configured",
    stagingWrites: 0
  },
  errorMessage: "Live EA endpoint client is not configured yet."
});

const EXECUTORS: Record<string, EndpointExecutor> = {
  league_metadata: pendingLiveEaExecutor,
  teams: pendingLiveEaExecutor,
  standings: pendingLiveEaExecutor,
  schedule: pendingLiveEaExecutor,
  rosters: pendingLiveEaExecutor,
  players: pendingLiveEaExecutor,
  player_stats: pendingLiveEaExecutor,
  team_stats: pendingLiveEaExecutor
};

function endpointLabel(endpointKey: string) {
  return endpointKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function executeImportJob(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;

  if (!["created", "queued", "running"].includes(job.status)) {
    throw new ApiError(409, "Import job is not in an executable state.", { currentStatus: job.status });
  }

  const endpointKeys = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length > 0
    ? job.selected_endpoint_keys as string[]
    : ["league_metadata", "teams", "standings", "schedule", "rosters", "players", "player_stats", "team_stats"];

  await updateImportJobStatus({ importJobId, status: "running" });

  const results: ImportEndpointExecutionResult[] = [];

  for (const endpointKey of endpointKeys) {
    const label = endpointLabel(endpointKey);
    const startedAt = Date.now();

    await updateEndpointAttempt({
      importJobId,
      endpointKey,
      endpointLabel: label,
      status: "running",
      attemptNumber: 1
    });

    const executor = EXECUTORS[endpointKey];

    if (!executor) {
      const skipped = {
        endpointKey,
        endpointLabel: label,
        status: "skipped" as const,
        recordsFound: 0,
        responseSummary: { reason: "endpoint_not_registered" },
        errorMessage: "Endpoint is not registered in the execution registry."
      };
      results.push(skipped);
      await updateEndpointAttempt({
        importJobId,
        endpointKey,
        endpointLabel: label,
        status: skipped.status,
        attemptNumber: 1,
        durationMs: Date.now() - startedAt,
        recordsFound: skipped.recordsFound,
        errorMessage: skipped.errorMessage,
        responseSummary: skipped.responseSummary
      });
      continue;
    }

    const result = await executor({ importJobId, endpointKey, endpointLabel: label });
    results.push(result);

    await updateEndpointAttempt({
      importJobId,
      endpointKey,
      endpointLabel: label,
      status: result.status,
      attemptNumber: 1,
      durationMs: Date.now() - startedAt,
      recordsFound: result.recordsFound,
      errorMessage: result.errorMessage ?? null,
      responseSummary: result.responseSummary ?? {}
    });
  }

  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const successful = results.filter((result) => result.status === "success").length;

  return updateImportJobStatus({
    importJobId,
    status: failed > 0 ? "failed" : skipped > 0 ? "completed_with_warnings" : "validating",
    previewSummary: {
      ...(job.preview_summary ?? {}),
      endpointExecution: {
        successful,
        skipped,
        failed,
        results
      },
      stagingWrites: 0,
      payouts: "Deferred until league advance."
    },
    validationWarnings: skipped > 0 ? [{ code: "endpoint_execution_skipped", message: "One or more endpoints were skipped." }] : [],
    validationErrors: failed > 0 ? [{ code: "endpoint_execution_failed", message: "One or more endpoints failed." }] : []
  });
}
