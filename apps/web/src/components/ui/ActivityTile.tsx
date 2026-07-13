import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./Badge.js";

type ActivityTileProps = {
  to?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badgeCount?: number;
  disabled?: boolean;
};

export function ActivityTile({ to, icon: Icon, title, description, badgeCount, disabled }: ActivityTileProps) {
  const content = (
    <>
      {typeof badgeCount === "number" && badgeCount > 0 && (
        <span className="activity-tile-badge">
          <Badge status="pending">{badgeCount}</Badge>
        </span>
      )}
      <Icon size={32} className="activity-tile-icon" />
      <div>
        <div style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>{title}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
          {disabled ? "Coming soon" : description}
        </div>
      </div>
    </>
  );

  const className = ["activity-tile", disabled ? "activity-tile-disabled" : ""].filter(Boolean).join(" ");

  if (disabled || !to) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link to={to} className={className} style={{ textDecoration: "none", color: "inherit" }}>
      {content}
    </Link>
  );
}
