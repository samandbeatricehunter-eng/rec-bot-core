import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { HubMatchupGame, HubMatchupSchedule } from "../../../../../web/src/types/api.js";
import { Button } from "../../../../../web/src/components/ui/Button.js";
import { Modal } from "../../../../../web/src/components/ui/Modal.js";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { LoadingState } from "../../../../../web/src/components/ui/LoadingState.js";
import { ErrorState } from "../../../../../web/src/components/ui/ErrorState.js";

type ForceChoice = "clear" | "home" | "away";
type ForceStatus = "home_win" | "away_win" | "cleared" | null;

type ForceableMeta = {
  lastForceStatus: ForceStatus;
  lastForceAt: string | null;
};

const MATCHUP_SORT: Record<HubMatchupGame["matchupType"], number> = {
  h2h: 0,
  human_cpu: 1,
  cpu: 2,
};

function teamNick(game: HubMatchupGame, side: "away" | "home"): string {
  if (side === "away") {
    return game.awayTeamMascot?.trim() || game.awayTeamName?.trim() || "Away";
  }
  return game.homeTeamMascot?.trim() || game.homeTeamName?.trim() || "Home";
}

function choiceFromStatus(status: ForceStatus): ForceChoice {
  if (status === "home_win") return "home";
  if (status === "away_win") return "away";
  return "clear";
}

function statusFromChoice(choice: ForceChoice): ForceStatus {
  if (choice === "home") return "home_win";
  if (choice === "away") return "away_win";
  return "cleared";
}

function isEaConnectionBroken(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("isn't connected")
    || lower.includes("not connected")
    || lower.includes("reconnect")
    || lower.includes("expired")
    || lower.includes("import data")
    || lower.includes("connect") && lower.includes("ea")
  );
}

function gameStatusLabel(game: HubMatchupGame, force: ForceableMeta | undefined): string {
  if (game.isFinal && game.awayScore != null && game.homeScore != null) {
    return `Final ${game.awayScore}-${game.homeScore}`;
  }
  const status = force?.lastForceStatus ?? null;
  if (status === "home_win") return `Force win for ${teamNick(game, "home")}`;
  if (status === "away_win") return `Force win for ${teamNick(game, "away")}`;
  return "Fair sim (no force result)";
}

function sortWeekGames(games: HubMatchupGame[]): HubMatchupGame[] {
  return [...games].sort((a, b) => {
    const byType = MATCHUP_SORT[a.matchupType] - MATCHUP_SORT[b.matchupType];
    if (byType !== 0) return byType;
    return `${teamNick(a, "away")} ${teamNick(a, "home")}`.localeCompare(
      `${teamNick(b, "away")} ${teamNick(b, "home")}`,
    );
  });
}

/** Manage League — current-week schedule with per-game EA force-result controls. */
export function ManageLeaguePage() {
  const { leagueId = "" } = useParams();
  const { guildId } = useReadyAuth();
  const [schedule, setSchedule] = useState<HubMatchupSchedule | null>(null);
  const [forceByGameId, setForceByGameId] = useState<Record<string, ForceableMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [eaReconnectOpen, setEaReconnectOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [nextSchedule, forceable] = await Promise.all([
      recApi.getHubMatchupSchedule({ guildId }),
      recApi.eaAdminListForceableMatches({ guildId, leagueId }).catch(() => ({ matches: [] as Array<{
        gameId: string;
        lastForceStatus: ForceStatus;
        lastForceAt: string | null;
      }> })),
    ]);
    setSchedule(nextSchedule);
    const map: Record<string, ForceableMeta> = {};
    for (const match of forceable.matches) {
      map[match.gameId] = {
        lastForceStatus: match.lastForceStatus,
        lastForceAt: match.lastForceAt,
      };
    }
    setForceByGameId(map);
  }, [guildId, leagueId]);

  useEffect(() => {
    let cancelled = false;
    void load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load week schedule.");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const games = useMemo(
    () => sortWeekGames(schedule?.games ?? []),
    [schedule],
  );

  async function applyForce(game: HubMatchupGame, choice: ForceChoice) {
    const previous = forceByGameId[game.gameId];
    const currentChoice = choiceFromStatus(previous?.lastForceStatus ?? null);
    if (choice === currentChoice) return;

    setBusyGameId(game.gameId);
    setRowError(null);
    try {
      if (choice === "home") await recApi.eaAdminForceHomeWin({ guildId, leagueId, gameId: game.gameId });
      else if (choice === "away") await recApi.eaAdminForceAwayWin({ guildId, leagueId, gameId: game.gameId });
      else await recApi.eaAdminClearForcedResult({ guildId, leagueId, gameId: game.gameId });

      setForceByGameId((prev) => ({
        ...prev,
        [game.gameId]: {
          lastForceStatus: statusFromChoice(choice),
          lastForceAt: new Date().toISOString(),
        },
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "EA rejected this action.";
      if (isEaConnectionBroken(message)) {
        setEaReconnectOpen(true);
      } else {
        setRowError(message);
      }
    } finally {
      setBusyGameId(null);
    }
  }

  if (error && !schedule) {
    return (
      <div>
        <PageHeader title="Manage League" subtitle="Current week schedule and force results." />
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!schedule) {
    return (
      <div>
        <PageHeader title="Manage League" subtitle="Current week schedule and force results." />
        <LoadingState label="Loading week schedule…" />
      </div>
    );
  }

  const weekLabel = `Week ${schedule.selectedWeek}`;

  return (
    <div>
      <PageHeader
        title="Manage League"
        subtitle={`${weekLabel} schedule — user games, then human vs CPU, then CPU vs CPU.`}
      />

      {rowError ? <p className="mgmt-league-schedule-error">{rowError}</p> : null}

      {games.length === 0 ? (
        <p className="hub-empty">No games scheduled for this week.</p>
      ) : (
        <div className="mgmt-league-schedule" role="list" aria-label={`${weekLabel} matchups`}>
          {games.map((game) => {
            const force = forceByGameId[game.gameId];
            const forceable = Boolean(force) || game.gameId in forceByGameId;
            // Forceable list only includes EA-imported games; treat missing as not forceable.
            const canForce = Object.prototype.hasOwnProperty.call(forceByGameId, game.gameId);
            const choice = choiceFromStatus(force?.lastForceStatus ?? null);
            const busy = busyGameId === game.gameId;
            const locked = game.isFinal || !canForce || busy;

            return (
              <article key={game.gameId} className="mgmt-league-schedule-row" role="listitem">
                <div className="mgmt-league-schedule-matchup">
                  <strong>
                    {teamNick(game, "away")}
                    <span> VS </span>
                    {teamNick(game, "home")}
                  </strong>
                  <small className={`is-${game.matchupType}`}>
                    {game.matchupType === "h2h"
                      ? "User vs user"
                      : game.matchupType === "human_cpu"
                        ? "Human vs CPU"
                        : "CPU vs CPU"}
                  </small>
                </div>
                <div className="mgmt-league-schedule-status">
                  {gameStatusLabel(game, force)}
                </div>
                <label className="mgmt-league-schedule-control">
                  <span className="visually-hidden">Set game result</span>
                  <select
                    className="form-input"
                    value={choice}
                    disabled={locked}
                    title={
                      game.isFinal
                        ? "Game is final"
                        : !canForce
                          ? "Import this week from EA (Games) before forcing a result"
                          : undefined
                    }
                    onChange={(event) => {
                      void applyForce(game, event.target.value as ForceChoice);
                    }}
                  >
                    <option value="clear">Default (no force) — fair sim</option>
                    <option value="away">Force win for {teamNick(game, "away")}</option>
                    <option value="home">Force win for {teamNick(game, "home")}</option>
                  </select>
                </label>
              </article>
            );
          })}
        </div>
      )}

      {eaReconnectOpen ? (
        <Modal
          title="EA connection broken"
          size="sm"
          onClose={() => setEaReconnectOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEaReconnectOpen(false)}>Close</Button>
              <Link className="site-btn site-btn-primary" to={`/l/${leagueId}/mgmt/games`}>
                Open Games
              </Link>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            The EA connection for this league is broken or expired. Tap{" "}
            <strong>Games</strong> in the top nav to reconnect the league, then try setting the
            game result again.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** @deprecated Prefer ManageLeaguePage — kept for existing import paths. */
export const ManageLeaguePlaceholderPage = ManageLeaguePage;
