import { useEffect, useId, useRef, useState } from "react";
import { useHub } from "../lib/hub-context.js";
import { IconCaret } from "./icons.js";

export function LeagueSelector() {
  const hub = useHub();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const label =
    hub.scope.kind === "league" && hub.selectedLeague
      ? `${hub.selectedLeague.name} (${hub.selectedLeague.gameLabel})`
      : "Main Hub";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
    <div className="site-league-selector" ref={rootRef}>
      <button
        type="button"
        className="site-league-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="site-league-selector-label">{label}</span>
        <IconCaret className={open ? "is-open" : undefined} />
      </button>
      {open ? (
        <ul
          id={listId}
          className="site-league-selector-menu"
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
          {hub.leagues.map((league) => {
            const selected =
              hub.scope.kind === "league" && hub.scope.leagueId === league.id;
            return (
              <li key={league.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={selected ? "is-active" : undefined}
                  onClick={() => {
                    setOpen(false);
                    hub.selectLeague(league.id);
                  }}
                >
                  {league.name} ({league.gameLabel})
                </button>
              </li>
            );
          })}
          {!hub.leaguesLoading && hub.leagues.length === 0 ? (
            <li className="site-league-selector-empty">No active leagues</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
