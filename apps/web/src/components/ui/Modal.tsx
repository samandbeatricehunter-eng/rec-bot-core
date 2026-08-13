import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button.js";

export function Modal({ title, onClose, children, panelClassName = "", hideHeader = false }: { title: string; onClose: () => void; children: ReactNode; panelClassName?: string; hideHeader?: boolean }) {
  return createPortal(
    <div className={`modal-overlay ${panelClassName ? `${panelClassName}-overlay` : ""}`.trim()} onClick={onClose}>
      <div className={`modal-panel ${panelClassName}`.trim()} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {hideHeader ? (
          <Button className="modal-panel-floating-close" variant="ghost" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} />
          </Button>
        ) : (
          <div className="modal-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>{title}</h2>
            <Button variant="ghost" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
