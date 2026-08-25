import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

type MenuPosition = { top: number; left?: number; right?: number };

// Module-level so every header dropdown (row1 gear, row2 switcher, each row3 dropdown) shares
// one "only one open at a time" slot. Without this, opening "Stats" then clicking the "My Team"
// trigger left two independent portaled panels/backdrops stacked over each other, since each
// useHeaderMenu() instance previously tracked its own open state in isolation.
let activeMenuId: object | null = null;
let activeMenuClose: (() => void) | null = null;

/** Shared open/position state for every header dropdown (row1 gear, row2 league switcher,
 * row3 nav dropdowns). The panel portals straight into document.body and is positioned via
 * getBoundingClientRect of the trigger -- this is what NotificationsBell already does (fixed
 * position + full-screen backdrop) and is required here too: these triggers live inside
 * .site-header-row3, which has overflow-x:auto for the mobile button-scroll strip, and any
 * position:absolute panel nested inside it gets clipped/squashed into that scroll container
 * instead of floating over the page. Escaping via a portal sidesteps that entirely. */
export function useHeaderMenu<T extends HTMLElement = HTMLButtonElement>() {
  const idRef = useRef({});
  const triggerRef = useRef<T>(null);
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const location = useLocation();

  function close() {
    setOpenState(false);
  }

  function setOpen(next: boolean | ((current: boolean) => boolean)) {
    setOpenState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value) {
        if (activeMenuId && activeMenuId !== idRef.current) activeMenuClose?.();
        activeMenuId = idRef.current;
        activeMenuClose = close;
      } else if (activeMenuId === idRef.current) {
        activeMenuId = null;
        activeMenuClose = null;
      }
      return value;
    });
  }

  useEffect(() => {
    return () => {
      if (activeMenuId === idRef.current) {
        activeMenuId = null;
        activeMenuClose = null;
      }
    };
  }, []);

  // Close whenever the route changes. A menu item *inside* this panel already calls close()
  // itself before navigating, but a click on a plain sibling NavLink (Overview/Matchups/the
  // brand link) or browser back/forward otherwise leaves this panel open and floating over the
  // newly-navigated-to page, since none of the header components unmount across in-app nav.
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== pathRef.current) {
      pathRef.current = location.pathname;
      if (open) close();
    }
  }, [location.pathname, open]);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const gap = 8;
      const anchorRight = box.left > window.innerWidth / 2;
      setPos(
        anchorRight
          ? { top: box.bottom + gap, right: Math.max(12, window.innerWidth - box.right) }
          : { top: box.bottom + gap, left: Math.max(12, box.left) },
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function Panel({ children, className, role, ariaLabel }: { children: ReactNode; className?: string; role?: string; ariaLabel?: string }) {
    if (!open || !pos) return null;
    return createPortal(
      <>
        <button type="button" className="site-header-panel-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
        <div
          className={className}
          role={role}
          aria-label={ariaLabel}
          style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right }}
        >
          {children}
        </div>
      </>,
      document.body,
    );
  }

  return { triggerRef, open, setOpen, Panel };
}
