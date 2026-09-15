import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button.js";

export type ModalSize = "sm" | "md" | "lg";

/**
 * Canonical REC popup chrome. All feature modals should use this component so overlay,
 * panel surface, header, and action chrome stay consistent. Size only changes max-width;
 * colors come from the shared `.modal-*` tokens in surfaces.css.
 */
export function Modal({
  title,
  onClose,
  children,
  panelClassName = "",
  hideHeader = false,
  /** When false, no X control — use explicit Cancel/Save actions instead. */
  showClose = true,
  size = "md",
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  hideHeader?: boolean;
  showClose?: boolean;
  size?: ModalSize;
  footer?: ReactNode;
}) {
  const sizeClass = size === "sm" ? "modal-panel--sm" : size === "lg" ? "modal-panel--lg" : "modal-panel--md";

  return createPortal(
    <div className={`modal-overlay ${panelClassName ? `${panelClassName}-overlay` : ""}`.trim()}>
      <div
        className={["modal-panel", sizeClass, panelClassName].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {hideHeader ? (
          showClose ? (
            <Button className="modal-panel-floating-close" variant="ghost" onClick={onClose} aria-label={`Close ${title}`}>
              <X size={18} />
            </Button>
          ) : null
        ) : (
          <div className="modal-panel-header">
            <h2 className="modal-panel-title">{title}</h2>
            {showClose ? (
              <Button variant="ghost" size="compact" onClick={onClose} aria-label="Close">
                <X size={18} />
              </Button>
            ) : null}
          </div>
        )}
        <div className="modal-panel-body">{children}</div>
        {footer ? <div className="modal-panel-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
