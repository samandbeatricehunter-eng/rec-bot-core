import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stageLabel, type LeagueGame } from "@rec/shared";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { AdvanceWeekGames } from "../../../../../web/src/types/api.js";
import { useLeagueTheme, useReadyAuth } from "@rec/hub-ui";

export type MgmtNavId =
  | "games"
  | "advance"
  | "pending"
  | "users"
  | "teams"
  | "league"
  | "media";

/** Compact stage chip for the mgmt rail: `S2, W1` or `S1, Free Agency`. */
export function formatMgmtStageChip(
  seasonNumber: number,
  currentStage: string,
  currentWeek: number,
  game: LeagueGame,
): string {
  const season = `S${seasonNumber}`;
  if (currentStage === "regular_season" || currentStage === "preseason") {
    return `${season}, W${currentWeek}`;
  }
  if (currentStage === "preseason_training_camp") {
    return `${season}, Training Camp`;
  }
  const label = stageLabel(currentStage, currentWeek, game);
  return `${season}, ${label}`;
}

/** League Mgmt chassis — two snapshot rows:
 *  Top: Stage (read-only) · Games · Advance · Pending
 *  Bottom: Manage Users · Manage Teams · Manage League · Manage Media */
export function MgmtStatusStrip({ leagueId, active }: { leagueId: string; active: MgmtNavId }) {
  const { guildId, discordId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const [advance, setAdvance] = useState<AdvanceWeekGames | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getAdvanceWeekGames(guildId)
      .then((res) => { if (!cancelled) setAdvance(res); })
      .catch(() => { if (!cancelled) setAdvance(null); });
    recApi.getCommissionerPendingSummary(guildId, discordId, leagueId)
      .then((res) => { if (!cancelled) setPendingCount(res.summary?.pendingCount ?? 0); })
      .catch(() => { if (!cancelled) setPendingCount(null); });
    return () => { cancelled = true; };
  }, [guildId, discordId, leagueId]);

  const stage = advance
    ? formatMgmtStageChip(advance.seasonNumber, advance.currentStage, advance.currentWeek, game as LeagueGame)
    : "—";

  const scoredCount = advance ? advance.games.length - advance.gamesNeedingInput.length : 0;
  const scoredTotal = advance?.games.length ?? 0;
  const advanceReady = advance ? advance.gamesNeedingInput.length === 0 && advance.games.length > 0 : false;
  const advanceBlocked = advance ? advance.gamesNeedingInput.length > 0 : false;
  const advanceLabel = !advance
    ? "—"
    : advance.games.length === 0
      ? "No games"
      : advanceReady
        ? "Ready"
        : "Scores Needed";

  const base = `/l/${leagueId}/mgmt`;
  const navItem = (
    id: MgmtNavId,
    top: string,
    bottom: string,
    to: string,
    extraClass?: string,
  ) => (
    <Link
      key={id}
      className={[active === id ? "is-active" : undefined, extraClass].filter(Boolean).join(" ") || undefined}
      to={to}
    >
      <span>{top}</span>
      <strong>{bottom}</strong>
    </Link>
  );

  return (
    <div className="hub-season-snapshot-box">
      <div className="hub-season-snapshot-grid" aria-label="League Mgmt status">
        <article title="Current season stage">
          <span>Stage</span>
          <strong>{stage}</strong>
        </article>
        {navItem("games", "Games", scoredTotal ? `${scoredCount}/${scoredTotal}` : "—", `${base}/games`)}
        {navItem(
          "advance",
          "Advance",
          advanceLabel,
          `${base}/advance`,
          advanceReady ? "is-advance-ready" : advanceBlocked ? "is-advance-blocked" : undefined,
        )}
        {navItem("pending", "Pending", pendingCount == null ? "—" : String(pendingCount), `${base}/pending`)}
      </div>
      <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="League Mgmt views">
        {navItem("users", "Manage", "Users", `${base}/users`)}
        {navItem("teams", "Manage", "Teams", `${base}/teams`)}
        {navItem("league", "Manage", "League", `${base}/league`)}
        {navItem("media", "Manage", "Media", `${base}/media`)}
      </div>
    </div>
  );
}
