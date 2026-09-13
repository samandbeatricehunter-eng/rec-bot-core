import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { useAdvanceStatus } from "../../lib/advance-status-context.js";

// Modeled directly on ImportStatusDrawer.tsx: polls advance progress (now keyed by leagueId
// server-side, see advance-progress.service.ts) so a commissioner who starts an advance and
// navigates away still sees it land, instead of losing all feedback the moment AdvanceHome
// unmounts.
const POLL_MS_RUNNING = 2000;
const POLL_MS_IDLE = 15_000;

type AdvanceProgress = { runId: string | null; stage: string; completed: string[]; status: "running" | "complete" | "error"; error?: string };

export function AdvanceStatusDrawer() {
  const { guildId } = useReadyAuth();
  const chrome = useHubChrome();
  const advanceStatus = useAdvanceStatus();
  const eligible = Boolean(chrome.currentLeague?.isCommissioner);

  const [progress, setProgress] = useState<AdvanceProgress | null>(null);
  const [seenRunning, setSeenRunning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!eligible || !guildId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        timer = setTimeout(poll, POLL_MS_IDLE);
        return;
      }
      let nextDelay = POLL_MS_IDLE;
      try {
        const response = await recApi.getAdvanceProgress({ guildId });
        if (cancelled) return;
        setProgress(response.progress);
        nextDelay = response.progress?.status === "running" ? POLL_MS_RUNNING : POLL_MS_IDLE;
      } catch {
        /* drawer is best-effort */
      }
      if (!cancelled) timer = setTimeout(poll, nextDelay);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eligible, guildId]);

  const modalOpen = advanceStatus?.modalOpen ?? false;
  useEffect(() => {
    if (progress?.status === "running" && !modalOpen) setSeenRunning(true);
  }, [progress?.status, modalOpen]);

  useEffect(() => {
    if (progress?.status === "running") setDismissed(false);
  }, [progress?.status]);

  if (!eligible || modalOpen || !seenRunning || dismissed || !progress) return null;

  const finished = progress.status !== "running";
  const title = finished
    ? progress.status === "error" ? "Advance — Failed" : "Advance — Complete"
    : `Advance — ${progress.stage}`;

  return createPortal(
    <div className={`import-status-drawer${expanded ? " is-expanded" : ""}`} role="status" aria-live="polite">
      <button
        type="button"
        className="import-status-drawer-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="import-status-drawer-title">{title}</span>
        {!finished ? <span className="import-status-drawer-action">In progress…</span> : null}
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {expanded ? (
        <div className="import-status-drawer-body">
          <div className="import-progress-lines">
            {progress.completed.map((step) => (
              <div key={step} className="import-progress-line"><span className="import-progress-line-icon">✓</span><span>{step}</span></div>
            ))}
            {!finished ? (
              <div className="import-progress-line"><span className="import-progress-line-icon">●</span><span>{progress.stage}</span></div>
            ) : null}
            {progress.status === "error" ? (
              <div className="import-progress-line is-error"><span className="import-progress-line-icon">✕</span><span>{progress.error ?? "Advance failed."}</span></div>
            ) : null}
          </div>
          {finished ? (
            <button type="button" className="import-status-drawer-dismiss" onClick={() => setDismissed(true)}>
              <X size={14} /> Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
