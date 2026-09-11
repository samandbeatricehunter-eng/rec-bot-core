import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

type MenuPosition = { top?: number; bottom?: number; left?: number; right?: number };

// Module-level so every chrome dropdown (header + footer) shares one "only one open at a time" slot.
let activeMenuId: object | null = null;
let activeMenuClose: (() => void) | null = null;

export type HeaderMenuOptions = {
  /** Open the panel above the trigger (footer More sheet) instead of below. */
  anchor?: "below" | "above";
};

/** Shared open/position state for header + footer chrome menus. Panels portal into document.body
 * and anchor to the trigger's live bounding rect so overflow parents cannot clip them. */
export function useHeaderMenu<T extends HTMLElement = HTMLButtonElement>(options: HeaderMenuOptions = {}) {
  const anchor = options.anchor ?? "below";
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
      if (anchor === "above") {
        setPos(
          anchorRight
            ? { bottom: Math.max(12, window.innerHeight - box.top + gap), right: Math.max(12, window.innerWidth - box.right) }
            : { bottom: Math.max(12, window.innerHeight - box.top + gap), left: Math.max(12, box.left) },
        );
        return;
      }
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
  }, [open, anchor]);

  function Panel({ children, className, role, ariaLabel }: { children: ReactNode; className?: string; role?: string; ariaLabel?: string }) {
    if (!open || !pos) return null;
    return createPortal(
      <>
        <button type="button" className="site-header-panel-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
        <div
          className={className}
          role={role}
          aria-label={ariaLabel}
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
        >
          {children}
        </div>
      </>,
      document.body,
    );
  }

  return { triggerRef, open, setOpen, Panel };
}
