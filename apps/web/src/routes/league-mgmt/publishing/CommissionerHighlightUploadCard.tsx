import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

function uploadFileWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(); return; }
      reject(new Error(`Cloudflare upload failed for ${file.name} (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Upload failed for ${file.name}.`));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

// Commissioner direct-post to the Highlight Reel / REC Network Clips feed -- same Cloudflare
// Stream direct-upload pipeline the member matchup-clip flow uses (highlight-upload-context.tsx),
// just posted with no matchup/review requirement since the commissioner posting it is the
// approval. Self-fetches rosterType (same pattern as ChannelSettings.tsx/RiseSettings.tsx) so
// the label can swap to "REC Network Clips" for Rise to Immortality leagues.
export function CommissionerHighlightUploadCard() {
  const { guildId } = useReadyAuth();
  const [isRise, setIsRise] = useState(false);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "encoding" | "ready" | "failed">("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi.getLeagueHeaderSummary(guildId).then((summary) => setIsRise(summary.league.rosterType === "rise_to_immortality")).catch(() => undefined);
  }, [guildId]);

  const feedLabel = isRise ? "REC Network Clips" : "Highlight Reel";

  async function handleFile(file: File) {
    setError(null); setPhase("uploading"); setPercent(1);
    try {
      const direct = await recApi.createCommissionerHighlightUpload({ guildId, fileName: file.name, title: title.trim() || null });
      await uploadFileWithProgress(direct.uploadURL, file, (value) => setPercent(value));
      await recApi.markHighlightUploadReceived({ guildId, highlightId: direct.highlightId });
      setPhase("encoding"); setPercent(100);
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await recApi.getHighlightUploadStatus({ guildId, highlightId: direct.highlightId });
        if (status.mediaStatus === "ready") { setPhase("ready"); ready = true; break; }
        if (status.mediaStatus === "failed") throw new Error(status.failureReason ?? `${file.name} was rejected.`);
      }
      if (!ready) setError("Still encoding — check back in a minute, it'll post to Discord and the hub automatically once ready.");
    } catch (cause) {
      setPhase("failed");
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    }
  }

  return (
    <Card>
      <h2>Post to {feedLabel}</h2>
      <p className="form-hint">
        Upload a video directly to the {feedLabel} feed and Discord Highlights channel — up to 3 minutes, no member
        matchup or review step required since you're posting it as the commissioner.
      </p>
      {error && <ErrorState message={error} />}
      <label className="form-field">
        <span className="form-label">Title (optional)</span>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. "Week 4 Recap"`} disabled={phase === "uploading" || phase === "encoding"} />
      </label>
      <label className="form-field" style={{ marginTop: "var(--space-2)" }}>
        <span className="form-label">Video file</span>
        <input
          className="form-input"
          type="file"
          accept="video/*"
          disabled={phase === "uploading" || phase === "encoding"}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleFile(file); e.target.value = ""; }}
        />
      </label>
      {phase === "uploading" && <p className="form-hint" style={{ margin: "var(--space-2) 0 0" }}>Uploading… {percent}%</p>}
      {phase === "encoding" && <p className="form-hint" style={{ margin: "var(--space-2) 0 0" }}>Encoding on Cloudflare Stream…</p>}
      {phase === "ready" && <p className="form-hint" style={{ margin: "var(--space-2) 0 0", color: "var(--success)" }}>Posted to {feedLabel} and Discord.</p>}
    </Card>
  );
}
