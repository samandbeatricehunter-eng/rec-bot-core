import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FastForward, GraduationCap, Newspaper, SlidersHorizontal, Users } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { WeeklyH2hGame } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";

const STATUS_BADGE: Record<WeeklyH2hGame["status"], { status: "denied" | "pending" | "approved"; label: string }> = {
  missing: { status: "denied", label: "Missing" },
  awaiting_review: { status: "pending", label: "Awaiting Review" },
  final: { status: "approved", label: "Final" },
};

const SHORTCUTS = [
  { icon: Users, label: "Manage League", detail: "Edit schedules, enter results, and box scores", to: "/league-mgmt/manage-league", cfbOnly: false },
  { icon: FastForward, label: "Advance", detail: "Advance the week", to: "/league-mgmt/advance", cfbOnly: false },
  { icon: SlidersHorizontal, label: "Settings", detail: "Rules and league setup", to: "/league-mgmt/settings", cfbOnly: false },
  { icon: Newspaper, label: "Media", detail: "Headlines and articles", to: "/league-mgmt/publishing", cfbOnly: false },
  { icon: GraduationCap, label: "Recruits", detail: "Recruiting and transfers", to: "/league-mgmt/recruiting", cfbOnly: true },
] as const;

export function WeeklyH2hPanel() {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
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
        <div className="weekly-h2h-list">
          {data.games.map((g) => {
            const badge = STATUS_BADGE[g.status];
            return (
              <div key={g.gameId} className="weekly-h2h-game">
                <div className="weekly-h2h-game-head">
                  <span>
                    <span style={{ fontWeight: g.result && g.result.winnerTeamName === g.awayTeamName ? 700 : 400 }}>{g.awayTeamName}</span>
                    {" @ "}
                    <span style={{ fontWeight: g.result && g.result.winnerTeamName === g.homeTeamName ? 700 : 400 }}>{g.homeTeamName}</span>
                  </span>
                  <Badge status={badge.status}>{badge.label}</Badge>
                </div>
                {g.result && (
                  <div className="weekly-h2h-score">
                    {g.result.isTie ? `Tie ${g.result.awayScore}-${g.result.homeScore}` : `${g.result.awayScore}-${g.result.homeScore}`}
                  </div>
                )}
              </div>
            );
          })}
          {data.games.length === 0 && <p className="weekly-h2h-empty">No H2H games scheduled this week.</p>}
        </div>
      )}

      <div className="advance-shortcut-row">
        {SHORTCUTS.filter((shortcut) => !shortcut.cfbOnly || game === "cfb_27").map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <button key={shortcut.label} className="advance-shortcut-btn" onClick={() => navigate(shortcut.to)}>
              <Icon size={20} />
              <span>{shortcut.label}</span>
              <small>{shortcut.detail}</small>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
