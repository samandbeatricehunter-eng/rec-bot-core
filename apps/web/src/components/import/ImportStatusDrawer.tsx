import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { recApi, type EaImportProgressEvent } from "../../lib/rec-api-client.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { useImportStatus } from "../../lib/import-status-context.js";
import { summarizeImportProgress } from "../../lib/import-progress.js";
import { ImportProgressLines } from "./ImportProgressLines.js";

const POLL_MS = 2000;

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
    async function poll() {
      try {
        const progress = await recApi.getImportProgress({ guildId, leagueId: leagueId! });
        if (cancelled) return;
        setEvents(progress.events);
        setRunning(progress.running);
        setSource(progress.source ?? null);
      } catch {
        /* drawer is best-effort */
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
