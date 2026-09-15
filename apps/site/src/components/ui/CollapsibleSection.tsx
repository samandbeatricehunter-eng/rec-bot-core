import { useState, type ReactNode } from "react";
import { Card } from "./Card.js";

export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon,
}: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; icon?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        className={`collapsible-header ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {icon && <span style={{ color: "var(--text-secondary)" }}>{icon}</span>}
          {title}
        </span>
        <span
          style={{
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          ▼
        </span>
      </button>
      <div
        className="collapsible-content"
        style={{
          overflow: "hidden",
          maxHeight: open ? "none" : "0",
          opacity: open ? 1 : 0,
          transition: "max-height 0.25s ease, opacity 0.2s ease",
          marginTop: open ? "var(--space-3)" : 0,
        }}
      >
        {open && children}
      </div>
    </Card>
  );
}
