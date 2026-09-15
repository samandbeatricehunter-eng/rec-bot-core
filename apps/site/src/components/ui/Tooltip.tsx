import { useState, type ReactNode } from "react";

// Hover/focus-triggered helper text — used on actions/fields that aren't self-explanatory
// to a first-time admin, not sprinkled on every element.
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="tooltip-wrapper"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && <span className="tooltip-bubble" role="tooltip">{text}</span>}
    </span>
  );
}
