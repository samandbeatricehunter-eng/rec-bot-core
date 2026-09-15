import type { ReactNode } from "react";
import { FootballPanel } from "./FootballPanel.js";
import { BroadcastLabel } from "./BroadcastLabel.js";

type SectionFrameProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  beforeHeading?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Section heading + eyebrow + optional action slot, wrapped in a FootballPanel. Replaces
 * .hub-section-heading + .hub-section pairs. */
export function SectionFrame({ eyebrow, title, subtitle, beforeHeading, action, children, className }: SectionFrameProps) {
  return (
    <FootballPanel className={className}>
      {beforeHeading}
      <div className="section-frame-heading">
        <div>
          {eyebrow && <BroadcastLabel>{eyebrow}</BroadcastLabel>}
          <h2 className="section-frame-title">{title}</h2>
          {subtitle ? <p className="section-frame-subtitle">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </FootballPanel>
  );
}
