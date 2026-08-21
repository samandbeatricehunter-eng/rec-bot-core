import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

type Scope = "game" | "season" | "career";
type RecordsResponse = Awaited<ReturnType<typeof recApi.getLeagueRecords>>;

const SCOPE_LABELS: Record<Scope, string> = { game: "Game", season: "Season", career: "Career" };

export function LeagueRecordsHome({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { guildId } = useReadyAuth();
  const { currentLeague } = useHubChrome();
  const [scope, setScope] = useState<Scope>("game");
  const [postseason, setPostseason] = useState(false);
  const [category, setCategory] = useState<string>("passing");
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    recApi.getLeagueRecords({ guildId, scope, postseason, category })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league records."));
  }, [guildId, scope, postseason, category]);

  const backAction = currentLeague?.id ? <Button variant="ghost" size="compact" onClick={() => navigate(-1)}>← Back</Button> : undefined;

  return (
    <div className="hub-page">
      {!embedded && <PageHeader title="League Records" subtitle="Statistical bests, by game, season, or career." actions={backAction} />}

      <div className="hub-history-season-tabs">
        {(["game", "season", "career"] as Scope[]).map((s) => (
          <button key={s} type="button" className={s === scope ? "active" : ""} onClick={() => setScope(s)}>{SCOPE_LABELS[s]}</button>
        ))}
      </div>

      <div className="hub-modal-pill-row" style={{ marginTop: "var(--space-3)" }}>
        <button type="button" className={!postseason ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => setPostseason(false)}>Regular Season</button>
        <button type="button" className={postseason ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => setPostseason(true)}>Postseason</button>
      </div>

      <label className="form-field" style={{ maxWidth: 280, marginTop: "var(--space-3)" }}>
        <span className="form-label">Category</span>
        <select className="form-input" value={category} onChange={(event) => setCategory(event.target.value)}>
          {(data?.categories ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>

      {error && <ErrorState message={error} />}
      {!error && !data && <LoadingState />}
      {data && !data.records.length && <p className="hub-empty">No {category} records tracked for this category yet.</p>}
      {data && data.records.length > 0 && (
        <div className="hub-history-season">
          {data.records.map((record) => (
            <Card key={record.statKey} className="hub-history-category">
              <h3>{record.label}</h3>
              <div className="hub-history-table">
                <div className="hub-history-table-row hub-history-table-head">
                  <span>Player</span><span>Team</span><span>Value</span>
                  {scope === "game" && <span>When</span>}
                </div>
                {record.leaders.map((leader) => (
                  <div key={leader.playerId} className="hub-history-table-row">
                    <span>#{leader.rank} {leader.playerName}{leader.position ? ` (${leader.position})` : ""}</span>
                    <span>{leader.teamAbbreviation ?? leader.teamName ?? "—"}</span>
                    <span>{leader.value.toLocaleString()}</span>
                    {scope === "game" && <span>{leader.seasonNumber != null ? `S${leader.seasonNumber} ` : ""}{leader.weekNumber != null ? `Wk ${leader.weekNumber}` : "—"}</span>}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
