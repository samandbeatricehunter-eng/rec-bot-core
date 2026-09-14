import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useReadyAuth } from "@rec/hub-ui";
import { DiscordServerSettings } from "../../../components/DiscordServerSettings.js";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { HubMatchupGame, HubMatchupSchedule } from "../../../../../web/src/types/api.js";
import { Button } from "../../../../../web/src/components/ui/Button.js";
import { Modal } from "../../../../../web/src/components/ui/Modal.js";
import { LoadingState } from "../../../../../web/src/components/ui/LoadingState.js";
import { ErrorState } from "../../../../../web/src/components/ui/ErrorState.js";
import { SettingsHome } from "./settings/SettingsHome.js";

type ForceChoice = "clear" | "home" | "away";
type ForceStatus = "home_win" | "away_win" | "cleared" | null;
type ManageLeagueView = "schedule" | "discord" | "league" | "gameplay";

type ForceableMeta = {
  lastForceStatus: ForceStatus;
  lastForceAt: string | null;
};

const HEADER_VIEWS: Array<{ id: Exclude<ManageLeagueView, "schedule">; top: string; bottom: string }> = [
  { id: "discord", top: "Discord", bottom: "Settings" },
  { id: "league", top: "League", bottom: "Settings" },
  { id: "gameplay", top: "Gameplay", bottom: "Settings" },
];

const MATCHUP_SORT: Record<HubMatchupGame["matchupType"], number> = {
  h2h: 0,
  human_cpu: 1,
  cpu: 2,
};

function parseView(raw: string | null): ManageLeagueView {
  if (raw === "discord" || raw === "league" || raw === "gameplay") return raw;
  return "schedule";
}

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
    || (lower.includes("connect") && lower.includes("ea"))
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

function ManageLeagueHeader({
  active,
  onSelect,
}: {
  active: ManageLeagueView;
  onSelect: (view: ManageLeagueView) => void;
}) {
  return (
    <header className="page-header mgmt-league-title-block">
      <div className="page-header-copy">
        <h1>Manage League</h1>
      </div>
      <nav className="mgmt-league-header-nav" aria-label="Manage League sections">
        {HEADER_VIEWS.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={selected ? "is-selected" : undefined}
              aria-pressed={selected}
              onClick={() => onSelect(selected ? "schedule" : item.id)}
            >
              <span>{item.top}</span>
              <strong>{item.bottom}</strong>
            </button>
          );
        })}
      </nav>
    </header>
  );
}

function ManageLeagueScheduleBody({
  leagueId,
  guildId,
}: {
  leagueId: string;
  guildId: string;
}) {
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
      recApi.eaAdminListForceableMatches({ guildId, leagueId }).catch(() => ({
        matches: [] as Array<{
          gameId: string;
          lastForceStatus: ForceStatus;
          lastForceAt: string | null;
        }>,
      })),
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

  if (error && !schedule) return <ErrorState message={error} />;
  if (!schedule) return <LoadingState label="Loading week schedule…" />;

  const weekLabel = `Week ${schedule.selectedWeek}`;

  return (
    <>
      <p className="mgmt-league-schedule-lead">{weekLabel} — user games, then human vs CPU, then CPU vs CPU.</p>
      {rowError ? <p className="mgmt-league-schedule-error">{rowError}</p> : null}
      {games.length === 0 ? (
        <p className="hub-empty">No games scheduled for this week.</p>
      ) : (
        <div className="mgmt-league-schedule" role="list" aria-label={`${weekLabel} matchups`}>
          {games.map((game) => {
            const force = forceByGameId[game.gameId];
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
                  <span className="sr-only">Set game result</span>
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
    </>
  );
}

/** Manage League — schedule by default; Discord / League / Gameplay settings via header buttons. */
export function ManageLeaguePage() {
  const { leagueId = "" } = useParams();
  const { guildId } = useReadyAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));

  function setView(next: ManageLeagueView) {
    const params = new URLSearchParams(searchParams);
    if (next === "schedule") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <ManageLeagueHeader active={view} onSelect={setView} />
      {view === "schedule" ? (
        <ManageLeagueScheduleBody leagueId={leagueId} guildId={guildId} />
      ) : view === "discord" ? (
        <>
          <DiscordServerSettings leagueId={leagueId} />
          <SettingsHome mode="discord" />
        </>
      ) : (
        <SettingsHome mode={view} />
      )}
    </div>
  );
}
