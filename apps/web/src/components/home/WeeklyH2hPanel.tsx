import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FastForward, PenSquare, Trophy } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { WeeklyH2hGame } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";
import { Tooltip } from "../ui/Tooltip.js";

const STATUS_BADGE: Record<WeeklyH2hGame["status"], { status: "denied" | "pending" | "approved"; label: string }> = {
  missing: { status: "denied", label: "Missing" },
  awaiting_review: { status: "pending", label: "Awaiting Review" },
  final: { status: "approved", label: "Final" },
};

// Home page's right column — this week's H2H games at a glance, plus shortcuts into the
// Advance page (which isn't sub-routed into sections today, so all shortcuts land on the
// same /league-mgmt/advance page — framed as separate actions for discoverability).
export function WeeklyH2hPanel() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ weekLabel: string; games: WeeklyH2hGame[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getWeeklyH2hGames(guildId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }, [guildId]);

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>{data ? data.weekLabel : "This Week"}</h2>
      {error && <ErrorState message={error} />}
      {!data && !error && <LoadingState />}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 420, overflowY: "auto", marginBottom: "var(--space-4)" }}>
          {data.games.map((g) => {
            const badge = STATUS_BADGE[g.status];
            return (
              <div key={g.gameId} style={{ paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
                  <span>
                    <span style={{ fontWeight: g.result && g.result.winnerTeamName === g.awayTeamName ? 700 : 400 }}>{g.awayTeamName}</span>
                    {" @ "}
                    <span style={{ fontWeight: g.result && g.result.winnerTeamName === g.homeTeamName ? 700 : 400 }}>{g.homeTeamName}</span>
                  </span>
                  <Badge status={badge.status}>{badge.label}</Badge>
                </div>
                {g.result && (
                  <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>
                    {g.result.isTie
                      ? `Tie ${g.result.awayScore}-${g.result.homeScore}`
                      : `${g.result.awayScore}-${g.result.homeScore}`}
                  </div>
                )}
              </div>
            );
          })}
          {data.games.length === 0 && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No H2H games scheduled this week.</p>}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Tooltip text="Enter scores, division winners, and complete the advance">
          <button className="btn btn-secondary" onClick={() => navigate("/league-mgmt/advance")} aria-label="Enter Scores">
            <PenSquare size={16} />
          </button>
        </Tooltip>
        <Tooltip text="Complete this week's advance">
          <button className="btn btn-secondary" onClick={() => navigate("/league-mgmt/advance")} aria-label="Complete Advance">
            <FastForward size={16} />
          </button>
        </Tooltip>
        <Tooltip text="Division winners">
          <button className="btn btn-secondary" onClick={() => navigate("/league-mgmt/advance")} aria-label="Division Winners">
            <Trophy size={16} />
          </button>
        </Tooltip>
        <Tooltip text="Schedule next advance">
          <button className="btn btn-secondary" onClick={() => navigate("/league-mgmt/advance")} aria-label="Schedule Next Advance">
            <CalendarClock size={16} />
          </button>
        </Tooltip>
      </div>
    </Card>
  );
}
