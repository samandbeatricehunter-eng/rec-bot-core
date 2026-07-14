import type { ReactNode } from "react";
import { FootballPanel } from "./FootballPanel.js";
import { BroadcastLabel } from "./BroadcastLabel.js";

type SectionFrameProps = {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Section heading + eyebrow + optional action slot, wrapped in a FootballPanel. Replaces
 * .hub-section-heading + .hub-section pairs. */
export function SectionFrame({ eyebrow, title, action, children, className }: SectionFrameProps) {
  return (
    <FootballPanel className={className}>
      <div className="section-frame-heading">
        <div>
          {eyebrow && <BroadcastLabel>{eyebrow}</BroadcastLabel>}
          <h2 className="section-frame-title">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </FootballPanel>
  );
}
