import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { useHighlightUpload, type HighlightUploadJob } from "../../lib/highlight-upload-context.js";

function phaseLabel(job: HighlightUploadJob): string {
  if (job.phase === "queued") return "Waiting…";
  if (job.phase === "uploading") return `Uploading ${job.percent}%`;
  if (job.phase === "encoding") return job.error ?? "Encoding…";
  if (job.phase === "ready") return "Ready";
  return job.error ?? "Failed";
}

function meterPercent(job: HighlightUploadJob): number {
  if (job.phase === "ready") return 100;
  if (job.phase === "encoding") return 100;
  if (job.phase === "failed") return job.percent;
  return job.percent;
}

export function HighlightUploadDrawer() {
  const { jobs, dismissed, dismiss } = useHighlightUpload();
  const [expanded, setExpanded] = useState(true);
  if (dismissed || !jobs.length) return null;

  const active = jobs.filter((job) => job.phase === "queued" || job.phase === "uploading" || job.phase === "encoding");
  const failed = jobs.some((job) => job.phase === "failed");
  const finished = active.length === 0;
  const title = finished
    ? failed ? "Highlight upload — issues" : "Highlight upload — complete"
    : `Uploading highlights (${jobs.length - active.length}/${jobs.length})`;

  return createPortal(
    <div className={`import-status-drawer highlight-upload-drawer${expanded ? " is-expanded" : ""}`} role="status" aria-live="polite">
      <button
        type="button"
        className="import-status-drawer-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="import-status-drawer-title">{title}</span>
        {!finished ? <span className="import-status-drawer-action">{phaseLabel(active[0] ?? jobs[0]!)}</span> : null}
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {expanded ? (
        <div className="import-status-drawer-body">
          <ul className="highlight-upload-job-list">
            {jobs.map((job) => (
              <li key={job.id} className={`highlight-upload-job is-${job.phase}`}>
                <div className="highlight-upload-job-head">
                  <strong>{job.fileName}</strong>
                  <span>{phaseLabel(job)}</span>
                </div>
                <div className="highlight-upload-meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meterPercent(job)} role="progressbar">
                  <div
                    className={`highlight-upload-meter-fill${job.phase === "encoding" ? " is-encoding" : ""}`}
                    style={{ width: `${meterPercent(job)}%` }}
                  />
                </div>
                {job.phase === "failed" && job.error ? <p className="highlight-upload-job-error">{job.error}</p> : null}
              </li>
            ))}
          </ul>
          {finished ? (
            <button type="button" className="import-status-drawer-dismiss" onClick={dismiss}>
              <X size={14} /> Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
