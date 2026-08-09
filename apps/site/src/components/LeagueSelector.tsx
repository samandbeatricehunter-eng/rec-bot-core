import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHub } from "../lib/hub-context.js";
import { IconCaret } from "./icons.js";

export function LeagueSelector() {
  const hub = useHub();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !drawerRef.current?.contains(target)) {
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
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="site-league-selector-label">My Leagues</span>
        <IconCaret className={open ? "is-open" : undefined} />
      </button>
      {open
        ? createPortal(
            <>
              <button
                type="button"
                className="site-league-selector-backdrop"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
              <div className="site-league-selector-drawer" role="dialog" aria-label="My Leagues" ref={drawerRef}>
                <p className="site-league-selector-drawer-title">My Leagues</p>
                <ul id={listId} className="site-league-selector-menu" role="listbox" aria-label="Your leagues">
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
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
