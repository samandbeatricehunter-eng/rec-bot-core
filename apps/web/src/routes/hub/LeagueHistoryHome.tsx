import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LeagueHistoryResponse, LeagueHistorySeason } from "../../types/api.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Card } from "../../components/ui/Card.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

function isCfbGame(game: string | null) {
  return (game ?? "").startsWith("cfb");
}

export function SeasonHistoryDetail({ season, game }: { season: LeagueHistorySeason; game: string | null }) {
  const cfb = isCfbGame(game);
  const championshipLabel = cfb ? "National Championship" : "Super Bowl";

  return (
    <div className="hub-history-season">
      <Card className="hub-history-category">
        <h3>Team Records</h3>
        {season.teamRecords.length === 0 ? <p className="hub-empty">No recorded games this season.</p> : (
          <div className="hub-history-table">
            <div className="hub-history-table-row hub-history-table-head">
              <span>Coach</span><span>Team</span><span>Record</span><span>PF</span><span>PA</span>
            </div>
            {season.teamRecords.map((row) => (
              <div key={row.userId} className="hub-history-table-row">
                <span>{row.coachName}</span>
                <span>{row.teamName}{row.abbr ? ` (${row.abbr})` : ""}</span>
                <span>{row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`}</span>
                <span>{row.pointsFor}</span>
                <span>{row.pointsAgainst}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {season.championship && (
        <Card className="hub-history-category">
          <h3>{championshipLabel}</h3>
          <p><strong>{season.championship.winner ?? "—"}</strong> defeated <strong>{season.championship.runnerUp ?? "—"}</strong>{season.championship.score ? ` (${season.championship.score})` : ""}</p>
        </Card>
      )}

      {cfb && season.bowlWinners.length > 0 && (
        <Card className="hub-history-category">
          <h3>Bowl Winners</h3>
          <div className="hub-history-table">
            {season.bowlWinners.map((bowl, i) => (
              <div key={`${bowl.bowlName}-${i}`} className="hub-history-table-row hub-history-bowl-row">
                <span>{bowl.bowlName ?? "Bowl Game"}</span>
                <span>{bowl.winner ?? "—"} def. {bowl.loser ?? "—"}{bowl.score ? ` (${bowl.score})` : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {season.postseasonGames.length > 0 && (
        <Card className="hub-history-category">
          <h3>Postseason Results</h3>
          <div className="hub-history-table">
            {season.postseasonGames.map((g, i) => (
              <div key={i} className="hub-history-table-row hub-history-bowl-row">
                <span>{g.weekNumber != null ? `Week ${g.weekNumber}` : "—"}{g.bowlName ? ` · ${g.bowlName}` : g.postseasonRound ? ` · ${g.postseasonRound}` : ""}</span>
                <span>{g.awayTeam} {g.awayScore ?? "—"} @ {g.homeTeam} {g.homeScore ?? "—"}{g.winner ? ` — ${g.winner} won` : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {cfb && season.finalTop25.length > 0 && (
        <Card className="hub-history-category">
          <h3>Final Top 25</h3>
          <div className="hub-history-table">
            {season.finalTop25.map((row) => (
              <div key={row.rank} className="hub-history-table-row hub-history-top25-row">
                <span>#{row.rank}</span>
                <span>{row.teamName}{row.conferenceChampion ? " · Conf. Champion" : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="hub-history-category">
        <h3>Power Rankings</h3>
        <div className="hub-history-rankings-grid">
          {([
            { label: season.powerRankings.startWeek != null ? `Week ${season.powerRankings.startWeek}` : "Start", rows: season.powerRankings.start },
            { label: season.powerRankings.midWeek != null ? `Week ${season.powerRankings.midWeek}` : "Midseason", rows: season.powerRankings.mid },
            { label: season.powerRankings.endWeek != null ? `Week ${season.powerRankings.endWeek}` : "Final", rows: season.powerRankings.end },
          ] as const).map((col) => (
            <div key={col.label} className="hub-history-rankings-col">
              <h4>{col.label}</h4>
              {col.rows.length === 0 ? <p className="hub-empty">No snapshot.</p> : col.rows.slice(0, 10).map((row) => (
                <div key={row.rank} className="hub-history-rankings-row"><span>#{row.rank}</span><span>{row.teamName}</span></div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function LeagueHistoryHome() {
  const { guildId } = useReadyAuth();
  const [history, setHistory] = useState<LeagueHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);

  useEffect(() => {
    recApi.getLeagueHistory(guildId)
      .then((res) => { setHistory(res); setActiveSeason(res.seasons[0]?.seasonNumber ?? null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league history."));
  }, [guildId]);

  if (error && !history) {
    return (
      <div className="hub-page">
        <PageHeader title="League History" subtitle="Every completed season, one tab each." />
        <ErrorState message={error} />
      </div>
    );
  }
  if (!history) return <LoadingState />;

  const season = history.seasons.find((s) => s.seasonNumber === activeSeason) ?? null;

  return (
    <div className="hub-page">
      <PageHeader title="League History" subtitle={history.league.name} />
      {history.seasons.length === 0 ? (
        <p className="hub-empty">No completed seasons yet — check back after Season {history.currentSeason} wraps up.</p>
      ) : (
        <>
          <div className="hub-history-season-tabs">
            {history.seasons.map((s) => (
              <button
                key={s.seasonNumber}
                type="button"
                className={s.seasonNumber === activeSeason ? "active" : ""}
                onClick={() => setActiveSeason(s.seasonNumber)}
              >
                Season {s.seasonNumber}
              </button>
            ))}
          </div>
          {season && <SeasonHistoryDetail season={season} game={history.league.game} />}
        </>
      )}
    </div>
  );
}
