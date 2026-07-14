import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "tactical";
type ButtonSize = "default" | "compact" | "mobile";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/** "tactical" is the compact control-panel style for commissioner actions (Advance,
 * Approve, Publish, Review) — visually distinct from primary (main CTA) and secondary
 * (routine action) without needing a parallel component. "mobile" size guarantees the
 * ≥48px thumb-reachable touch target. */
export function Button({ variant = "secondary", size = "default", className, ...rest }: ButtonProps) {
  return <button className={["btn", `btn-${variant}`, size !== "default" && `btn-size-${size}`, className].filter(Boolean).join(" ")} {...rest} />;
}
