import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { StatusChip } from "../design-system/StatusChip.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";

type WeekGame = { gameId: string; awayTeamName: string; homeTeamName: string; status: string; scheduledFor: string | null; fwFlagged: boolean };

const STATUS_LABELS: Record<string, string> = {
  not_scheduled: "Not Scheduled", waiting_on_opponent: "Waiting on Opponent", time_proposed: "Time Proposed",
  confirmed: "Confirmed", reschedule_requested: "Reschedule Requested", no_shared_availability: "No Shared Availability",
  needs_commissioner_help: "Needs Commissioner Help", completed: "Completed",
};

function chipStatus(status: string): "approved" | "pending" | "denied" | "info" {
  if (status === "confirmed" || status === "completed") return "approved";
  if (status === "not_scheduled") return "pending";
  if (status === "no_shared_availability" || status === "needs_commissioner_help") return "denied";
  return "info";
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function WeekSchedulingSection() {
  const { guildId } = useReadyAuth();
  const location = useLocation();
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [games, setGames] = useState<WeekGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leagueMatch = /^\/l\/([^/]+)\/?/.exec(location.pathname);
  const matchupPath = (gameId: string) => (leagueMatch ? `/l/${leagueMatch[1]}/matchups/${gameId}` : `/matchups/${gameId}`);

  useEffect(() => {
    recApi.getWeekSchedulingStatus(guildId)
      .then((res) => { setWeekNumber(res.weekNumber); setGames(res.games); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load week scheduling."));
  }, [guildId]);

  if (error) return <ErrorState message={error} />;
  if (!games) return <LoadingState />;
  if (!games.length) return <p className="hub-empty">No H2H games this week.</p>;

  const confirmed = games.filter((g) => g.status === "confirmed" || g.status === "completed").length;
  const needsAttention = games.filter((g) => g.status === "no_shared_availability" || g.status === "needs_commissioner_help" || g.fwFlagged).length;

  return (
    <div>
      <p className="form-hint">
        Week {weekNumber} — {confirmed} of {games.length} confirmed
        {needsAttention > 0 ? `, ${needsAttention} need${needsAttention === 1 ? "s" : ""} attention` : ""}.
      </p>
      <div className="advance-game-list">
        {games.map((g) => (
          <div key={g.gameId} className="advance-game-row">
            <div className="advance-game-title">
              <strong>{g.awayTeamName} @ {g.homeTeamName}</strong>
              <StatusChip status={chipStatus(g.status)} label={STATUS_LABELS[g.status] ?? g.status} />
              {g.fwFlagged && <StatusChip status="pending" label="FW Requested" />}
              {g.scheduledFor && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginLeft: "var(--space-2)" }}>{fmt(g.scheduledFor)}</span>}
            </div>
            <Link className="site-btn site-btn-ghost" to={matchupPath(g.gameId)}>View Matchup</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
