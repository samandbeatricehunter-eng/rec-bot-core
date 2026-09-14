import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stageLabel, type LeagueGame } from "@rec/shared";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { AdvanceWeekGames } from "../../../../../web/src/types/api.js";
import { useLeagueTheme, useReadyAuth } from "@rec/hub-ui";

export type MgmtNavId = "inbox" | "teams" | "advance" | "tools";

type SchedulingStatus = Awaited<ReturnType<typeof recApi.getWeekSchedulingStatus>>;
type ImportHealth = Awaited<ReturnType<typeof recApi.getLeagueImportHealth>>;

const SCHEDULED_STATUSES = new Set(["confirmed", "live"]);

/** League Mgmt's whole nav chassis: ONE box (exactly League Home's own
 * .hub-season-snapshot-box/-grid, two rows, same classes) -- top row is three read-only info
 * tiles (Stage / Games / League Health) plus the one real Media action; bottom row is the
 * actual Inbox/Teams/Advance/Tools nav. */
export function MgmtStatusStrip({ leagueId, active }: { leagueId: string; active: MgmtNavId }) {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const [advance, setAdvance] = useState<AdvanceWeekGames | null>(null);
  const [scheduling, setScheduling] = useState<SchedulingStatus | null>(null);
  const [health, setHealth] = useState<ImportHealth | null>(null);

  useEffect(() => {
    recApi.getAdvanceWeekGames(guildId).then(setAdvance).catch(() => setAdvance(null));
    recApi.getWeekSchedulingStatus(guildId).then(setScheduling).catch(() => setScheduling(null));
    recApi.getLeagueImportHealth({ guildId, leagueId }).then(setHealth).catch(() => setHealth(null));
  }, [guildId, leagueId]);

  const stage = advance
    ? (advance.currentStage === "preseason_training_camp" ? "Training Camp" : stageLabel(advance.currentStage, advance.currentWeek, game as LeagueGame))
    : "—";

  const scheduledGames = scheduling?.games ?? [];
  const scheduledCount = scheduledGames.filter((g) => SCHEDULED_STATUSES.has(g.status)).length;
  const scheduledTotal = scheduledGames.length;
  const completedCount = advance ? advance.games.length - advance.gamesNeedingInput.length : 0;
  const completedTotal = advance?.games.length ?? 0;

  const gamesTitle = [
    scheduledGames.length ? `Scheduled (${scheduledCount}/${scheduledTotal}):` : null,
    ...scheduledGames.filter((g) => SCHEDULED_STATUSES.has(g.status)).map((g) => `  ${g.awayTeamName} @ ${g.homeTeamName}`),
    scheduledGames.length ? "Not yet scheduled:" : null,
    ...scheduledGames.filter((g) => !SCHEDULED_STATUSES.has(g.status)).map((g) => `  ${g.awayTeamName} @ ${g.homeTeamName}`),
    advance?.games.length ? `\nCompleted via import (${completedCount}/${completedTotal}):` : null,
    ...(advance?.games.filter((g) => !g.needsInput).map((g) => `  ${g.awayTeamName} @ ${g.homeTeamName}`) ?? []),
    advance?.gamesNeedingInput.length ? "Not yet completed:" : null,
    ...(advance?.gamesNeedingInput.map((g) => `  ${g.awayTeamName} @ ${g.homeTeamName}`) ?? []),
  ].filter((line): line is string => line != null).join("\n");

  const healthTitle = health ? [
    `${health.weeksClean} of ${health.weeksTotal} weeks imported cleanly.`,
    ...(health.gaps.length ? ["", "Gaps:", ...health.gaps.map((gap) => `  Week ${gap.weekNumber}: missing ${gap.missingDatasets.join(", ")}`)] : []),
    ...(health.balance ? [
      "",
      `Wallet spread: ${health.balance.walletLow.toLocaleString()} - ${health.balance.walletHigh.toLocaleString()} (avg ${health.balance.walletAvg.toLocaleString()})`,
      `Team XP spread: ${health.balance.teamXpLow} - ${health.balance.teamXpHigh}`,
    ] : []),
  ].join("\n") : undefined;

  const base = `/l/${leagueId}/mgmt`;
  const navItem = (id: MgmtNavId, top: string, bottom: string, to: string) => (
    <Link key={id} className={active === id ? "is-active" : undefined} to={to}><span>{top}</span><strong>{bottom}</strong></Link>
  );

  return (
    <div className="hub-season-snapshot-box">
      <div className="hub-season-snapshot-grid" aria-label="League Mgmt status">
        <article><span>Stage</span><strong>{stage}</strong></article>
        <article title={gamesTitle || undefined}><span>Games</span><strong>{scheduledCount}/{scheduledTotal || "—"} · {completedCount}/{completedTotal || "—"}</strong></article>
        <article title={healthTitle}><span>League Health</span><strong>{health ? `${health.percent}%` : "—"}</strong></article>
        <Link to={`/l/${leagueId}/mgmt/publishing`}><span>Media</span><strong>Create</strong></Link>
      </div>
      <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="League Mgmt views">
        {navItem("inbox", "Pending", "Inbox", `${base}/inbox`)}
        {navItem("teams", "View", "Teams", `${base}/teams`)}
        {navItem("advance", "Advance", "Week", `${base}/advance`)}
        {navItem("tools", "League", "Tools", `${base}/tools`)}
      </div>
    </div>
  );
}