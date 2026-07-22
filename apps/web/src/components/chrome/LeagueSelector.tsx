import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useHubChrome } from "../../lib/hub-chrome-context.js";

export function LeagueSelector() {
  const hub = useHubChrome();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const label =
    hub.scope.kind === "league" && hub.currentLeague
      ? `${hub.currentLeague.name} (${hub.currentLeague.gameLabel})`
      : "Main Hub";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="hub-chrome-league-selector" ref={rootRef}>
      <button
        type="button"
        className="hub-chrome-league-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hub-chrome-league-selector-label">{label}</span>
        <ChevronDown className={open ? "is-open" : undefined} size={16} />
      </button>
      {open ? (
        <ul
          id={listId}
          className="hub-chrome-league-selector-menu"
          role="listbox"
          aria-label="League scope"
        >
          <li role="option" aria-selected={hub.scope.kind === "main"}>
            <button
              type="button"
              className={hub.scope.kind === "main" ? "is-active" : undefined}
              onClick={() => {
                setOpen(false);
                hub.selectMainHub();
              }}
            >
              Main Hub
            </button>
          </li>
          {hub.currentLeague ? (
            <li role="option" aria-selected={hub.scope.kind === "league"}>
              <button
                type="button"
                className={hub.scope.kind === "league" ? "is-active" : undefined}
                onClick={() => {
                  setOpen(false);
                  hub.selectLeague();
                }}
              >
                {hub.currentLeague.name} ({hub.currentLeague.gameLabel})
              </button>
            </li>
          ) : hub.leagueLoading ? (
            <li className="hub-chrome-league-selector-empty">Loading league…</li>
          ) : (
            <li className="hub-chrome-league-selector-empty">No active league</li>
          )}
          {/* Phase 1: Discord session is one guild at a time. Multi-league expansion:
              add POST /v1/hub/my-leagues listing active team-assignment leagues for this
              discord user across servers, then render those options here. */}
        </ul>
      ) : null}
    </div>
  );
}
