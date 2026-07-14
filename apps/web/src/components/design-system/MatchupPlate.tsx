import type { ReactNode } from "react";

type MatchupPlateProps = {
  homeTeam: string;
  awayTeam: string;
  reactionSlot?: ReactNode;
  className?: string;
};

/** Compact "Team A at Team B" row for lists (e.g. Weekly H2H matchups). */
export function MatchupPlate({ homeTeam, awayTeam, reactionSlot, className }: MatchupPlateProps) {
  return (
    <div className={["matchup-plate", className].filter(Boolean).join(" ")}>
      <span className="matchup-plate-teams">
        {awayTeam} <em>at</em> {homeTeam}
      </span>
      {reactionSlot}
    </div>
  );
}
