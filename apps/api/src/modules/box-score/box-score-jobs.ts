// Background OCR jobs for box-score submissions.
//
// OCR runs many serialized Tesseract passes per screenshot (and queues behind a
// global OCR lock when several land at once), so it can take a minute or more —
// far longer than a Discord bot wants to hold an HTTP request open. Instead of
// running the parse inline, `/v1/box-score/submit` starts a job here, returns a
// jobId immediately, and the bot polls `/v1/box-score/job` until it finishes.
//
// Jobs live in memory. That matches the API's single-instance design (one global
// Tesseract worker + OCR lock in box-score.parser.ts), so a poll always reaches
// the instance that owns the job. If the process restarts mid-job the entry is
// lost and the poll sees "not_found" — the bot treats that as a soft failure and
// asks the user to re-upload.

import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import {
  createBoxScoreSubmission,
  type CreateSubmissionInput,
  type CreateSubmissionResult,
} from "./box-score.service.js";

type BoxScoreJob =
  | { status: "processing"; startedAt: number }
  | { status: "done"; result: CreateSubmissionResult; finishedAt: number }
  | { status: "failed"; error: string; statusCode: number; finishedAt: number };

const jobs = new Map<string, BoxScoreJob>();

// Keep finished jobs long enough for the bot to poll the result, then drop them
// so the map can't grow unbounded. A "processing" job that outlives any realistic
// OCR run (e.g. an unhandled hang) is also swept so it can't leak.
const FINISHED_JOB_TTL = 5 * 60 * 1000;
const PROCESSING_JOB_MAX = 10 * 60 * 1000;

function sweepJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === "processing") {
      if (now - job.startedAt > PROCESSING_JOB_MAX) jobs.delete(id);
    } else if (now - job.finishedAt > FINISHED_JOB_TTL) {
      jobs.delete(id);
    }
  }
}

export type StartBoxScoreJobResult = { jobId: string; status: "processing" };

export function startBoxScoreSubmissionJob(input: CreateSubmissionInput): StartBoxScoreJobResult {
  sweepJobs();
  const jobId = randomUUID();
  jobs.set(jobId, { status: "processing", startedAt: Date.now() });

  void createBoxScoreSubmission(input)
    .then((result) => {
      jobs.set(jobId, { status: "done", result, finishedAt: Date.now() });
    })
    .catch((err: unknown) => {
      const statusCode = err instanceof ApiError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : String(err);
      // ApiErrors carry a user-facing message by design; log anything unexpected.
      if (!(err instanceof ApiError)) console.error("[box-score] OCR job failed:", err);
      jobs.set(jobId, { status: "failed", error: message, statusCode, finishedAt: Date.now() });
    });

  return { jobId, status: "processing" };
}

export type BoxScoreJobStatus =
  | { status: "processing" }
  | { status: "done"; result: CreateSubmissionResult }
  | { status: "failed"; error: string; statusCode: number }
  | { status: "not_found" };

export function getBoxScoreSubmissionJob(jobId: string): BoxScoreJobStatus {
  sweepJobs();
  const job = jobs.get(jobId);
  if (!job) return { status: "not_found" };
  if (job.status === "processing") return { status: "processing" };
  if (job.status === "done") return { status: "done", result: job.result };
  return { status: "failed", error: job.error, statusCode: job.statusCode };
}
