import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type PublicLeagueHistory, type PublicLeagueHistorySeason, type PublicLeagueSnapshot } from "../lib/site-api.js";
import { SiteFooter } from "../components/SiteFooter.js";

function isCfbGame(game: string | null) {
  return (game ?? "").startsWith("cfb");
}

// Public "Submit Highlight(s)" — non-site users can reach the league page via /viewleague and
// submit clips here without the Discord Activity hub. Same direct-to-Cloudflare-Stream flow the
// hub's HighlightUploadModal uses; uploaded clips enter commissioner review.
function PublicHighlightSubmit({ leagueId, onClose }: { leagueId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<Array<{ gameId: string; weekNumber: number; label: string }> | null>(null);
  const [gameId, setGameId] = useState("");

  useEffect(() => {
    let cancelled = false;
    siteApi.listHighlightGames(leagueId)
      .then((res) => {
        if (cancelled) return;
        setGames(res.games);
        if (res.games[0]) setGameId(res.games[0].gameId);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this week's games."); });
    return () => { cancelled = true; };
  }, [leagueId]);

  async function readVideoDurationSeconds(file: File): Promise<number> {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(Number(video.duration) || 0);
        video.onerror = () => reject(new Error(`Could not read duration for ${file.name}.`));
        video.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadOne(file: File): Promise<void> {
    const duration = await readVideoDurationSeconds(file);
    if (duration > 45) throw new Error(`${file.name} is ${Math.ceil(duration)}s. Crop to 45 seconds or less and try again.`);
    const direct = await siteApi.createHighlightDirectUpload({ leagueId, gameId, fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    const uploaded = await fetch(direct.uploadURL, { method: "POST", body: form });
    if (!uploaded.ok) throw new Error(`Cloudflare upload failed for ${file.name} (${uploaded.status}).`);
    await siteApi.markHighlightUploadReceived({ leagueId, highlightId: direct.highlightId });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await siteApi.getHighlightUploadStatus({ leagueId, highlightId: direct.highlightId });
      if (status.mediaStatus === "ready") return;
      if (status.mediaStatus === "failed") throw new Error(status.failureReason ?? `${file.name} was rejected. Crop to 45 seconds or less and try again.`);
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    if (!gameId) { setError("Choose which game the highlight is from first."); return; }
    const files = Array.from(fileList).slice(0, 2);
    setBusy(true);
    setError(null);
    setNotice(files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} highlights…`);
    const failures: string[] = [];
    let succeeded = 0;
    for (const file of files) {
      try {
        setNotice(`Uploading ${file.name}…`);
        await uploadOne(file);
        succeeded += 1;
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : `Upload failed for ${file.name}.`);
      }
    }
    setBusy(false);
    if (failures.length) setError(failures.join(" "));
    if (succeeded > 0) {
      setNotice(succeeded === 1
        ? "Uploaded — encoding at up to 1080p. Commissioner approval publishes it and issues payout when a paid slot is available."
        : `${succeeded} clips uploaded — encoding at up to 1080p. Commissioner approval publishes and pays (when slots remain).`);
    } else {
      setNotice(null);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,10,16,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#151923", border: "1px solid #2a3142", borderRadius: 12, padding: 24, width: "min(480px, 92vw)", maxHeight: "90vh", overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Submit Highlight(s)</h2>
        {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
        {notice && <p style={{ color: "#4ade80" }}>{notice}</p>}
        {!games && !error && <p className="site-muted">Loading this week's games…</p>}
        {games && games.length === 0 && <p className="site-muted">No games are available to attach highlights to this week.</p>}
        {games && games.length > 0 && (
          <>
            <label className="form-field" style={{ display: "block", marginBottom: 12 }}>
              <span className="form-label" style={{ display: "block", marginBottom: 4 }}>Game</span>
              <select className="form-input" value={gameId} onChange={(event) => setGameId(event.target.value)} style={{ width: "100%", padding: 8 }}>
                {games.map((game) => <option key={game.gameId} value={game.gameId}>{game.label}</option>)}
              </select>
            </label>
            <label className="form-field" style={{ display: "block" }}>
              <span className="form-label" style={{ display: "block", marginBottom: 4 }}>Highlight clips (up to 2 videos, ≤45s each)</span>
              <input type="file" accept="video/*" multiple disabled={busy}
                onChange={(event) => { void onFilesSelected(event.target.files); event.target.value = ""; }} />
            </label>
            {busy && <p className="site-muted">Working…</p>}
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="site-btn site-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}

function shiftLabel(delta: number | null): string {
  if (delta == null) return "new";
  if (delta === 0) return "—";
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
}

function PublicWeeklyResults({ weeklyResults }: { weeklyResults: PublicLeagueHistorySeason["weeklyResults"] }) {
  const [activeWeek, setActiveWeek] = useState<number | null>(weeklyResults[0]?.weekNumber ?? null);
  const week = weeklyResults.find((w) => w.weekNumber === activeWeek) ?? null;
  if (weeklyResults.length === 0) return <p className="site-muted">No weekly results recorded this season.</p>;
  return (
    <>
      <div className="site-public-league-season-tabs">
        {weeklyResults.map((w) => (
          <button key={w.weekNumber} type="button" className={w.weekNumber === activeWeek ? "active" : ""} onClick={() => setActiveWeek(w.weekNumber)}>
            Week {w.weekNumber}
          </button>
        ))}
      </div>
      {week && (
        <>
          <table className="site-public-league-table">
            <thead><tr><th>Away</th><th>Home</th><th>Result</th></tr></thead>
            <tbody>
              {week.matchups.map((m, i) => (
                <tr key={i}>
                  <td>{m.awayTeam}{m.isTie ? "" : m.winner === m.awayTeam ? " ✓" : ""}</td>
                  <td>{m.homeTeam}{m.isTie ? "" : m.winner === m.homeTeam ? " ✓" : ""}</td>
                  <td>{m.awayScore ?? "—"}-{m.homeScore ?? "—"}{m.isTie ? " (T)" : ""}{m.isPlayoff ? " · Playoff" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {week.powerRankingShifts.length > 0 && (
            <ul className="site-public-league-list">
              {week.powerRankingShifts.map((s) => (
                <li key={s.teamName}><span>#{s.newRank} {s.teamName}{s.previousRank != null ? ` (was #${s.previousRank})` : ""}</span><strong>{shiftLabel(s.delta)}</strong></li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function PublicSeasonHistory({ season, game }: { season: PublicLeagueHistorySeason; game: string | null }) {
  const cfb = isCfbGame(game);
  const championshipLabel = cfb ? "National Championship" : "Super Bowl";
  return (
    <>
      <section className="site-public-league-section">
        <h3>Weekly Results</h3>
        <PublicWeeklyResults weeklyResults={season.weeklyResults} />
      </section>

      <section className="site-public-league-section">
        <h3>Team Records</h3>
        <table className="site-public-league-table">
          <thead><tr><th>Coach</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th></tr></thead>
          <tbody>
            {season.teamRecords.map((row) => (
              <tr key={row.userId}>
                <td>{row.coachName}</td>
                <td>{row.teamName}{row.abbr ? ` (${row.abbr})` : ""}</td>
                <td>{row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`}</td>
                <td>{row.pointsFor}</td>
                <td>{row.pointsAgainst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {season.championship && (
        <section className="site-public-league-section">
          <h3>{championshipLabel}</h3>
          <p className="site-muted"><strong>{season.championship.winner ?? "—"}</strong> defeated <strong>{season.championship.runnerUp ?? "—"}</strong>{season.championship.score ? ` (${season.championship.score})` : ""}</p>
        </section>
      )}

      {cfb && season.bowlWinners.length > 0 && (
        <section className="site-public-league-section">
          <h3>Bowl Winners</h3>
          <ul className="site-public-league-list">
            {season.bowlWinners.map((bowl, i) => (
              <li key={`${bowl.bowlName}-${i}`}><span>{bowl.bowlName ?? "Bowl Game"}</span><strong>{bowl.winner ?? "—"} def. {bowl.loser ?? "—"}{bowl.score ? ` (${bowl.score})` : ""}</strong></li>
            ))}
          </ul>
        </section>
      )}

      {season.postseasonGames.length > 0 && (
        <section className="site-public-league-section">
          <h3>Postseason Results</h3>
          <ul className="site-public-league-list">
            {season.postseasonGames.map((g, i) => (
              <li key={i}>
                <span>{g.weekNumber != null ? `Week ${g.weekNumber}` : "—"}{g.bowlName ? ` · ${g.bowlName}` : g.postseasonRound ? ` · ${g.postseasonRound}` : ""}</span>
                <strong>{g.awayTeam} {g.awayScore ?? "—"} @ {g.homeTeam} {g.homeScore ?? "—"}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cfb && season.finalTop25.length > 0 && (
        <section className="site-public-league-section">
          <h3>Final Top 25</h3>
          <ul className="site-public-league-list">
            {season.finalTop25.map((row) => (
              <li key={row.rank}><span>#{row.rank} {row.teamName}</span>{row.conferenceChampion && <strong>Conf. Champion</strong>}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="site-public-league-section">
        <h3>Power Rankings</h3>
        <div className="site-public-league-rankings-grid">
          {([
            { label: season.powerRankings.startWeek != null ? `Week ${season.powerRankings.startWeek}` : "Start", rows: season.powerRankings.start },
            { label: season.powerRankings.midWeek != null ? `Week ${season.powerRankings.midWeek}` : "Midseason", rows: season.powerRankings.mid },
            { label: season.powerRankings.endWeek != null ? `Week ${season.powerRankings.endWeek}` : "Final", rows: season.powerRankings.end },
          ] as const).map((col) => (
            <div key={col.label}>
              <h4>{col.label}</h4>
              <ul className="site-public-league-list">
                {col.rows.slice(0, 10).map((row) => (
                  <li key={row.rank}><span>#{row.rank} {row.teamName}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

type PublicLeagueTab = "this-week" | "linked" | "open" | "history";

// Unauthenticated — /viewleague on Discord links here. No REC account or Discord login
// required to view: status, this week's matchups, linked teams, season standings only.
export function PublicLeague() {
  const auth = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicLeagueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PublicLeagueHistory | null>(null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PublicLeagueTab>("this-week");
  const [highlightOpen, setHighlightOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    // Old links shared before the slug URL existed used the raw Discord guild ID (a 17-20
    // digit snowflake) — keep those working instead of breaking anything already bookmarked.
    const isRawGuildId = /^\d{17,20}$/.test(slug);
    const lookup = isRawGuildId ? siteApi.getPublicLeagueSnapshot(slug) : siteApi.getPublicLeagueSnapshotBySlug(slug);
    lookup.then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load this league."));
    const historyLookup = isRawGuildId ? siteApi.getPublicLeagueHistory(slug) : siteApi.getPublicLeagueHistoryBySlug(slug);
    historyLookup.then((res) => { setHistory(res); setActiveSeason(res.seasons[0]?.seasonNumber ?? null); }).catch(() => undefined);
  }, [slug]);

  const hasOpenTeams = (data?.openTeams.length ?? 0) > 0;
  const hasHistory = (history?.seasons.length ?? 0) > 0;
  const tabs: Array<{ id: PublicLeagueTab; label: string; show: boolean }> = [
    { id: "this-week", label: "This Week", show: true },
    { id: "linked", label: "Linked Teams", show: true },
    { id: "open", label: "Open Teams", show: hasOpenTeams },
    { id: "history", label: "History", show: hasHistory },
  ];

  useEffect(() => {
    if (activeTab === "open" && !hasOpenTeams) setActiveTab("this-week");
    if (activeTab === "history" && !hasHistory) setActiveTab("this-week");
  }, [activeTab, hasOpenTeams, hasHistory]);

  return (
    <div className="site-page site-landing">
      <header className="site-nav site-landing-nav">
        <Link to="/" className="site-landing-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="site-landing-logo" />
          <span className="site-wordmark">REC Leagues eSports</span>
        </Link>
        <nav>
          {auth.status === "signed-in"
            ? <Link className="site-btn site-btn-primary" to="/home">Go to Home</Link>
            : <>
                <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
                <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
              </>}
        </nav>
      </header>

      <main className="site-legal-page site-public-league">
        {error && <p className="site-muted">{error}</p>}
        {!error && !data && <p className="site-muted">Loading league…</p>}
        {data && (
          <>
            <h1>{data.league.name}</h1>
            <p className="site-muted">{data.league.statusLabel}</p>

            <div style={{ display: "flex", gap: 8, margin: "12px 0 4px", flexWrap: "wrap" }}>
              {auth.status === "signed-in"
                ? <button type="button" className="site-btn site-btn-primary" onClick={() => setHighlightOpen(true)}>Submit Highlight(s)</button>
                : <Link className="site-btn site-btn-primary" to="/login">Log In to Submit Highlight(s)</Link>}
            </div>

            <div className="site-public-league-season-tabs" role="tablist" aria-label="League sections">
              {tabs.filter((tab) => tab.show).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === "open"
                    ? ` (${data.openTeams.reduce((sum, g) => sum + g.teams.length, 0)})`
                    : ""}
                </button>
              ))}
            </div>

            {activeTab === "this-week" && (
              <>
                <section className="site-public-league-section">
                  <h2>This Week's Matchups</h2>
                  {data.matchups.length === 0 ? (
                    <p className="site-muted">No games scheduled this week.</p>
                  ) : (
                    <ul className="site-public-league-list">
                      {data.matchups.map((m, i) => (
                        <li key={i}>
                          <span>{m.awayTeam} @ {m.homeTeam}</span>
                          {m.status === "completed" && <strong>{m.awayScore} - {m.homeScore}</strong>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="site-public-league-section">
                  <h2>Season Standings</h2>
                  <table className="site-public-league-table">
                    <thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead>
                    <tbody>
                      {data.standings.map((s) => (
                        <tr key={s.teamId}><td>{s.teamName}</td><td>{s.wins}</td><td>{s.losses}</td><td>{s.ties}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}

            {activeTab === "linked" && (
              <section className="site-public-league-section">
                <h2>Linked Teams</h2>
                {data.linkedTeams.length === 0 ? (
                  <p className="site-muted">No linked teams yet.</p>
                ) : (
                  <ul className="site-public-league-list">
                    {data.linkedTeams.map((t) => (
                      <li key={t.teamId}><span>{t.teamName}</span><strong>{t.coachName}</strong></li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {activeTab === "open" && hasOpenTeams && (
              <section className="site-public-league-section">
                <h2>Open Teams</h2>
                <div className="site-public-league-open-groups">
                  {data.openTeams.map((group) => (
                    <div key={group.conference} className="site-public-league-open-group">
                      <h3>{group.conference}</h3>
                      <ul className="site-public-league-list">
                        {group.teams.map((t) => (
                          <li key={t.teamId}><span>{t.teamName}</span></li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "history" && history && hasHistory && (
              <section className="site-public-league-section">
                <h2>League History</h2>
                <div className="site-public-league-season-tabs">
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
                {(() => {
                  const season = history.seasons.find((s) => s.seasonNumber === activeSeason);
                  return season ? <PublicSeasonHistory season={season} game={history.league.game} /> : null;
                })()}
              </section>
            )}
          </>
        )}
      </main>

      {highlightOpen && <PublicHighlightSubmit leagueId={data!.league.id} onClose={() => setHighlightOpen(false)} />}

      <SiteFooter />
    </div>
  );
}
