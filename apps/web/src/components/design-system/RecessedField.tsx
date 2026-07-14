import type { ReactNode } from "react";

/** Recessed form-input wrapper — used by the Players to Watch and Recruiting/Transfer forms. */
export function RecessedField({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["recessed-field", className].filter(Boolean).join(" ")}>{children}</div>;
}
