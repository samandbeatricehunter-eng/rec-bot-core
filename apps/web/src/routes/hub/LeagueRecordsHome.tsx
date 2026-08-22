import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatStatValue } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PlayerAvatar } from "../../components/hub/PlayerAvatar.js";

type Scope = "game" | "season" | "career";
type RecordsResponse = Awaited<ReturnType<typeof recApi.getLeagueRecords>>;
type Leader = RecordsResponse["records"][number]["leaders"][number];

const SCOPE_LABELS: Record<Scope, string> = { game: "Game", season: "Season", career: "Career" };

function resultLabel(result: string | null): string | null {
  if (!result) return null;
  const lower = result.toLowerCase();
  if (lower.startsWith("w")) return "W";
  if (lower.startsWith("l")) return "L";
  if (lower.startsWith("t")) return "T";
  return result.toUpperCase();
}

function recordContext(leader: Leader, scope: Scope): string {
  const parts: string[] = [];
  const opp = leader.opponentTeamAbbreviation ?? leader.opponentTeamName;
  if (opp) parts.push(`vs ${opp}${leader.opponentUserName ? ` (${leader.opponentUserName})` : ""}`);
  const outcome = resultLabel(leader.result);
  if (outcome && leader.pointsFor != null && leader.pointsAgainst != null) {
    parts.push(`${outcome} ${leader.pointsFor}–${leader.pointsAgainst}`);
  } else if (outcome) {
    parts.push(outcome);
  }
  if (scope === "game") {
    const when = `${leader.seasonNumber != null ? `S${leader.seasonNumber} ` : ""}${leader.weekNumber != null ? `Wk ${leader.weekNumber}` : ""}`.trim();
    if (when) parts.push(when);
  } else if (scope === "season" && leader.seasonNumber != null) {
    parts.push(`Season ${leader.seasonNumber}`);
  }
  return parts.join(" · ");
}

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
              <div className="rec-record-list">
                {record.leaders.map((leader) => {
                  const context = recordContext(leader, scope);
                  return (
                    <article key={`${leader.playerId}-${leader.rank}-${leader.weekNumber ?? "x"}`} className="rec-record-leader">
                      <span className="rec-record-leader-rank">#{leader.rank}</span>
                      <PlayerAvatar photoUrl={leader.photoUrl} alt="" className="rec-stat-player-card-avatar" />
                      <div className="rec-record-leader-body">
                        <div className="rec-record-leader-name">{leader.playerName}{leader.position ? ` · ${leader.position}` : ""}</div>
                        <div className="rec-record-leader-meta">
                          {leader.teamAbbreviation ?? leader.teamName ?? "—"}
                          {leader.userName ? ` · ${leader.userName}` : ""}
                          {context ? ` · ${context}` : ""}
                        </div>
                      </div>
                      <div className="rec-record-leader-value">{formatStatValue(record.statKey, leader.value)}</div>
                    </article>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
