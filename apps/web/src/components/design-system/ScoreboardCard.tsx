type ScoreboardCardProps = {
  home: string;
  away: string;
  homeScore?: number | null;
  awayScore?: number | null;
  status: string;
  className?: string;
};

/** Broadcast-scorebug-style game result display — replaces plain text score rows. */
export function ScoreboardCard({ home, away, homeScore, awayScore, status, className }: ScoreboardCardProps) {
  const hasScore = homeScore != null && awayScore != null;
  return (
    <div className={["scoreboard-card", className].filter(Boolean).join(" ")}>
      <div className="scoreboard-card-team">
        <span>{away}</span>
        {hasScore && <strong className="tabular-nums">{awayScore}</strong>}
      </div>
      <div className="scoreboard-card-divider" aria-hidden="true">at</div>
      <div className="scoreboard-card-team">
        <span>{home}</span>
        {hasScore && <strong className="tabular-nums">{homeScore}</strong>}
      </div>
      <span className="scoreboard-card-status">{status}</span>
    </div>
  );
}
