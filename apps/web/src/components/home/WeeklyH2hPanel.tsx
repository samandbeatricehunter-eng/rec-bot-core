import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Coins, FastForward, ListChecks, PenSquare, Trophy } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
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

// Left-to-right order follows the real advance protocol: build/adjust the schedule, enter
// this week's scores, complete the advance, settle division winners, schedule the next one,
// then (once the season's over) run EOS payouts. Most shortcuts land on /league-mgmt/advance
// (it isn't sub-routed into sections today — framed as separate actions for discoverability
// rather than actually deep-linking); "Edit Schedules" and "Run EOS Payouts" go to their own
// real destinations. Game-channel creation, GOTW polls, and EOS award polls stay Discord-only
// (they need a live bot session for native Discord channel/poll operations) — not modeled
// here as shortcuts since there's no working web equivalent to send them to yet.
const ADVANCE_SHORTCUTS = [
  { icon: ListChecks, label: "Edit Schedules", kind: "link", to: "/league-mgmt/manage-league" },
  { icon: PenSquare, label: "Enter Scores", kind: "link", to: "/league-mgmt/advance" },
  { icon: FastForward, label: "Complete Advance", kind: "link", to: "/league-mgmt/advance" },
  { icon: Trophy, label: "Division Winners", kind: "link", to: "/league-mgmt/advance" },
  { icon: CalendarClock, label: "Schedule Next Advance", kind: "link", to: "/league-mgmt/advance" },
  { icon: Coins, label: "Run EOS Payouts", kind: "eos-payouts" },
] as const;

// Home page's right column — this week's H2H games at a glance, plus shortcuts into the
// Advance page (which isn't sub-routed into sections today, so all shortcuts land on the
// same /league-mgmt/advance page — framed as separate actions for discoverability).
export function WeeklyH2hPanel() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ weekLabel: string; games: WeeklyH2hGame[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparingEos, setPreparingEos] = useState(false);

  useEffect(() => {
    recApi
      .getWeeklyH2hGames(guildId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }, [guildId]);

  async function handleRunEosPayouts() {
    setPreparingEos(true);
    setError(null);
    try {
      await recApi.prepareEosPayouts({ guildId });
      navigate("/league-mgmt/notifications");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run EOS payouts.");
    } finally {
      setPreparingEos(false);
    }
  }

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
              <div key={g.gameId} style={{ padding: "var(--space-2) 0 var(--space-3)", borderBottom: "1px solid var(--border)" }}>
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

      <div className="advance-shortcut-row">
        {ADVANCE_SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          if (shortcut.kind === "eos-payouts") {
            return (
              <button key={shortcut.label} className="advance-shortcut-btn" onClick={handleRunEosPayouts} disabled={preparingEos}>
                <Icon size={20} />
                <span>{preparingEos ? "Running…" : shortcut.label}</span>
              </button>
            );
          }
          return (
            <button key={shortcut.label} className="advance-shortcut-btn" onClick={() => navigate(shortcut.to)}>
              <Icon size={20} />
              <span>{shortcut.label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
