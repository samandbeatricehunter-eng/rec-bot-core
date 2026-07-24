import { useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

async function readVideoDurationSeconds(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(Number(video.duration) || 0);
      video.onerror = () => reject(new Error(`Could not read duration for ${file.name}.`));
      video.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Direct-to-Cloudflare-Stream upload — same flow as MatchupDetail.tsx's
// uploadHighlightFile/uploadHighlightFiles and apps/site's LeagueMatchupsPage, extracted here
// as the third call site (game chat) rather than duplicated a third time.
export function HighlightUploadModal({ guildId, gameId, onClose, onSubmitted }: { guildId: string; gameId: string; onClose: () => void; onSubmitted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadOne(file: File): Promise<void> {
    const duration = await readVideoDurationSeconds(file);
    if (duration > 45) {
      throw new Error(`${file.name} is ${Math.ceil(duration)}s. Crop to 45 seconds or less and try again.`);
    }
    const direct = await recApi.createHighlightDirectUpload({ guildId, gameId, fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    const uploaded = await fetch(direct.uploadURL, { method: "POST", body: form });
    if (!uploaded.ok) throw new Error(`Cloudflare upload failed for ${file.name} (${uploaded.status}).`);
    await recApi.markHighlightUploadReceived({ guildId, highlightId: direct.highlightId });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await recApi.getHighlightUploadStatus({ guildId, highlightId: direct.highlightId });
      if (status.mediaStatus === "ready") return;
      if (status.mediaStatus === "failed") {
        throw new Error(status.failureReason ?? `${file.name} was rejected. Crop to 45 seconds or less and try again.`);
      }
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).slice(0, 2);
    setBusy(true);
    setError(null);
    setNotice(files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} highlights…`);
    const failures: string[] = [];
    let succeeded = 0;
    for (const file of files) {
      try {
        setNotice(`Uploading ${file.name}…`);
        await uploadOne(file);
        succeeded += 1;
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : `Upload failed for ${file.name}.`);
      }
    }
    setBusy(false);
    if (failures.length) setError(failures.join(" "));
    if (succeeded > 0) {
      setNotice(
        succeeded === 1
          ? "Uploaded — encoding to 720p. Commissioner approval publishes it and issues payout when a paid slot is available."
          : `${succeeded} clips uploaded — encoding to 720p. Approve in commissioner inbox publishes + pays (when slots remain).`,
      );
      onSubmitted();
    } else {
      setNotice(null);
    }
  }

  return (
    <Modal title="Upload Highlight(s)" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {notice && <p className="hub-transfer-status">{notice}</p>}
      <label className="form-field">
        <span className="form-label">Highlight clips (up to 2 videos, ≤45s each)</span>
        <input
          type="file"
          accept="video/*"
          multiple
          disabled={busy}
          onChange={(event) => {
            void onFilesSelected(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {busy && <p className="hub-muted">Working…</p>}
    </Modal>
  );
}
