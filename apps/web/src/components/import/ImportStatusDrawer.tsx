import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { recApi, type EaImportProgressEvent } from "../../lib/rec-api-client.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { useImportStatus } from "../../lib/import-status-context.js";
import { summarizeImportProgress } from "../../lib/import-progress.js";
import { ImportProgressLines } from "./ImportProgressLines.js";

// 2s while an import is actively running (progress lines update fast enough that a
// commissioner watching it needs that cadence); backs off to 15s otherwise, since imports
// don't start spontaneously -- polling every 2s indefinitely regardless of whether anything is
// running, and regardless of tab visibility, was needlessly hammering the API for every
// eligible commissioner with any page open in the league.
const POLL_MS_RUNNING = 2000;
const POLL_MS_IDLE = 15_000;

export function ImportStatusDrawer() {
  const { guildId } = useReadyAuth();
  const chrome = useHubChrome();
  const importStatus = useImportStatus();
  const leagueId = chrome.currentLeague?.id ?? null;
  const eligible =
    Boolean(chrome.currentLeague?.isCommissioner) &&
    Boolean(chrome.currentLeague?.game?.startsWith("madden")) &&
    chrome.currentLeague?.dataMode === "import";

  const [events, setEvents] = useState<EaImportProgressEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<"manual" | "auto" | null>(null);
  const [seenRunning, setSeenRunning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!eligible || !guildId || !leagueId) return;
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
        const progress = await recApi.getImportProgress({ guildId, leagueId: leagueId! });
        if (cancelled) return;
        setEvents(progress.events);
        setRunning(progress.running);
        setSource(progress.source ?? null);
        nextDelay = progress.running ? POLL_MS_RUNNING : POLL_MS_IDLE;
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
  }, [eligible, guildId, leagueId]);

  const modalOpen = importStatus?.modalOpen ?? false;
  useEffect(() => {
    if (running && source === "manual" && !modalOpen) setSeenRunning(true);
  }, [running, source, modalOpen]);

  useEffect(() => {
    if (running) setDismissed(false);
  }, [running]);

  if (!eligible || modalOpen || source !== "manual" || !seenRunning || dismissed) return null;
  if (!events.length && !running) return null;

  const summary = summarizeImportProgress(events);
  const weekPart = summary.weekLabel ? `, ${summary.weekLabel}` : "";
  const title = summary.finished
    ? summary.failed
      ? `Import Status — Failed${weekPart}`
      : `Import Status — Complete${weekPart}`
    : `Import Status — Step ${summary.step} of ${summary.total}${weekPart}`;

  return createPortal(
    <div className={`import-status-drawer${expanded ? " is-expanded" : ""}`} role="status" aria-live="polite">
      <button
        type="button"
        className="import-status-drawer-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="import-status-drawer-title">{title}</span>
        {!summary.finished ? <span className="import-status-drawer-action">{summary.currentAction}</span> : null}
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {expanded ? (
        <div className="import-status-drawer-body">
          <ImportProgressLines events={events} />
          {(summary.finished || !running) ? (
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
