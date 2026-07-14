import type { ReactNode } from "react";

type IconWellProps = {
  icon: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "gold" | "neutral" | "status";
  glow?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** Recessed icon housing — replaces bare Lucide icons sitting next to text with a small
 * inlaid well (inner shadow, fine rim, optional glow). */
export function IconWell({ icon, size = "md", tone = "gold", glow, className, ...rest }: IconWellProps) {
  return (
    <span className={["icon-well", `icon-well--${size}`, `icon-well--${tone}`, glow && "icon-well--glow", className].filter(Boolean).join(" ")} {...rest}>
      {icon}
    </span>
  );
}
