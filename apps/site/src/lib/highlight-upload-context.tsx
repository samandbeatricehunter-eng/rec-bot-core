import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { recApi } from "./rec-api-client.js";

export type HighlightUploadJob = {
  id: string;
  fileName: string;
  phase: "queued" | "uploading" | "encoding" | "ready" | "failed";
  percent: number;
  error: string | null;
};

type HighlightUploadContextValue = {
  jobs: HighlightUploadJob[];
  dismissed: boolean;
  startUploads: (input: { guildId: string; gameId: string; files: File[]; onComplete?: () => void }) => void;
  dismiss: () => void;
};

const HighlightUploadContext = createContext<HighlightUploadContextValue | null>(null);

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

function uploadFileWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`Cloudflare upload failed for ${file.name} (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Upload failed for ${file.name}.`));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export function HighlightUploadProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<HighlightUploadJob[]>([]);
  const [dismissed, setDismissed] = useState(true);

  const patchJob = useCallback((id: string, patch: Partial<HighlightUploadJob>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));
  }, []);

  const startUploads = useCallback((input: { guildId: string; gameId: string; files: File[]; onComplete?: () => void }) => {
    const files = input.files.slice(0, 2);
    if (!files.length) return;
    const nextJobs: HighlightUploadJob[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      fileName: file.name,
      phase: "queued",
      percent: 0,
      error: null,
    }));
    setJobs(nextJobs);
    setDismissed(false);

    void (async () => {
      let succeeded = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const jobId = nextJobs[index]!.id;
        try {
          const duration = await readVideoDurationSeconds(file);
          if (duration > 45) {
            throw new Error(`${file.name} is ${Math.ceil(duration)}s. Crop to 45 seconds or less and try again.`);
          }
          patchJob(jobId, { phase: "uploading", percent: 1 });
          const direct = await recApi.createHighlightDirectUpload({ guildId: input.guildId, gameId: input.gameId, fileName: file.name });
          await uploadFileWithProgress(direct.uploadURL, file, (percent) => patchJob(jobId, { percent, phase: "uploading" }));
          await recApi.markHighlightUploadReceived({ guildId: input.guildId, highlightId: direct.highlightId });
          patchJob(jobId, { phase: "encoding", percent: 100 });
          let ready = false;
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const status = await recApi.getHighlightUploadStatus({ guildId: input.guildId, highlightId: direct.highlightId });
            if (status.mediaStatus === "ready") {
              patchJob(jobId, { phase: "ready", percent: 100, error: null });
              ready = true;
              succeeded += 1;
              break;
            }
            if (status.mediaStatus === "failed") {
              throw new Error(status.failureReason ?? `${file.name} was rejected. Crop to 45 seconds or less and try again.`);
            }
          }
          if (!ready) {
            patchJob(jobId, { phase: "encoding", percent: 100, error: "Still encoding — check Highlights in a minute." });
            succeeded += 1;
          }
        } catch (cause) {
          patchJob(jobId, {
            phase: "failed",
            error: cause instanceof Error ? cause.message : `Upload failed for ${file.name}.`,
          });
        }
      }
      if (succeeded > 0) input.onComplete?.();
    })();
  }, [patchJob]);

  const dismiss = useCallback(() => setDismissed(true), []);
  const value = useMemo(() => ({ jobs, dismissed, startUploads, dismiss }), [jobs, dismissed, startUploads, dismiss]);
  return <HighlightUploadContext.Provider value={value}>{children}</HighlightUploadContext.Provider>;
}

export function useHighlightUpload() {
  const value = useContext(HighlightUploadContext);
  if (!value) throw new Error("useHighlightUpload must be used within HighlightUploadProvider");
  return value;
}
