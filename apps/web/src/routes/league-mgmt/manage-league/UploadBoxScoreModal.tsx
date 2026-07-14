import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Commissioner upload from the schedule builder — still lands as a "pending" submission
// (commissionerSubmission only skips the self-serve "is this your own game" check), so
// on success this hands off the new submissionId to the caller, which opens
// ReviewBoxScoreModal right away rather than leaving the commissioner to hunt for it.
export function UploadBoxScoreModal({
  guildId,
  discordId,
  weekNumber,
  seasonNumber,
  gameId,
  onClose,
  onSubmitted,
}: {
  guildId: string;
  discordId: string;
  weekNumber: number;
  seasonNumber: number;
  gameId: string;
  onClose: () => void;
  onSubmitted: (submissionId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [secondFile, setSecondFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "parsing">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    try {
      const uploaded = await Promise.all(
        [file, secondFile].filter((f): f is File => !!f).map((f) => recApi.uploadBoxScoreImage(guildId, f)),
      );
      const { jobId } = await recApi.submitBoxScore({
        guildId,
        discordId,
        imageUrls: uploaded.map((u) => u.url),
        weekNumber,
        seasonNumber,
        expectedGameId: gameId,
        commissionerSubmission: true,
      });
      setStatus("parsing");
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await sleep(POLL_INTERVAL_MS);
        const job = await recApi.pollBoxScoreJob(jobId);
        if (job.status === "processing") continue;
        if (job.status === "done") {
          onSubmitted(job.result.submissionId);
          return;
        }
        if (job.status === "failed") throw new Error(job.error);
        throw new Error("The upload job could not be found — try uploading again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload box score.");
      setStatus("idle");
    }
  }

  const busy = status !== "idle";

  return (
    <Modal title="Upload Box Score" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="form-field">
        <label className="form-label" htmlFor="box-score-file">Screenshot (top or bottom of the stats page)</label>
        <input
          id="box-score-file"
          className="form-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="form-hint">
          {status === "uploading" && "Uploading screenshot…"}
          {status === "parsing" && "Reading stats from the screenshot — this can take a minute…"}
          {status === "idle" && "PNG, JPEG, or WebP."}
        </p>
      </div>
      <div className="form-field">
        <label className="form-label" htmlFor="box-score-file-2">Second screenshot (optional)</label>
        <input
          id="box-score-file-2"
          className="form-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => setSecondFile(e.target.files?.[0] ?? null)}
        />
        <p className="form-hint">Add the other half of the stats page now, or add it later from the review screen.</p>
      </div>
      <Button variant="primary" onClick={handleSubmit} disabled={!file || busy}>
        {busy ? "Submitting…" : "Submit"}
      </Button>
    </Modal>
  );
}
