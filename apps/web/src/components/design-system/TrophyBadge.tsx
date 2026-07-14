import { Trophy } from "lucide-react";

type TrophyBadgeProps = {
  label: string;
  tier?: "normal" | "bronze" | "silver" | "gold" | "xf";
  earnedCount?: number;
  className?: string;
};

/** Award/badge shelf item — physical medal/patch treatment instead of a plain bordered row. */
export function TrophyBadge({ label, tier = "normal", earnedCount, className }: TrophyBadgeProps) {
  return (
    <div className={["trophy-badge", `trophy-badge--${tier}`, className].filter(Boolean).join(" ")}>
      <Trophy size={18} />
      <span>
        {label}
        {earnedCount != null && earnedCount > 1 ? ` ×${earnedCount}` : ""}
      </span>
    </div>
  );
}
