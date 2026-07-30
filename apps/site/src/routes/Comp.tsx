import { useEffect, useRef, useState } from "react";
import { badgeAsset, badgeTooltip } from "../lib/badge-display.js";
import {
  siteApi,
  type CompUserDetail,
  type CompUserSummary,
  type PowerRankingRow,
} from "../lib/site-api.js";

type CompTab = "rankings" | "queue" | "tournaments" | "live" | "users";

const TABS: Array<{ id: CompTab; label: string }> = [
  { id: "rankings", label: "Rankings" },
  { id: "queue", label: "Matchup Queue" },
  { id: "tournaments", label: "Tournaments" },
  { id: "live", label: "Live Games" },
  { id: "users", label: "Users" },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="site-page-card">
      <h2>{title}</h2>
      <p className="site-muted">Coming soon — this ships with the H2H Comp matchmaking queue.</p>
    </div>
  );
}

function movementLabel(row: PowerRankingRow): string {
  if (row.previousRank == null) return "NEW";
  const delta = row.previousRank - row.rank;
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${Math.abs(delta)}`;
  return "—";
}

function RankingsTab() {
  const [games, setGames] = useState<Array<{ game: string; label: string; dynastyLabel: string }>>([]);
  const [game, setGame] = useState("");
  const [scope, setScope] = useState<"dynasty" | "comp">("dynasty");
  const [rankings, setRankings] = useState<PowerRankingRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    siteApi
      .listRankedGames()
      .then((res) => setGames(res.games))
      .catch(() => setGames([]));
  }, []);

  useEffect(() => {
    if (!game) {
      setRankings([]);
      setAsOf(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    siteApi
      .listPowerRankings({ game, scope })
      .then((res) => {
        if (!active) return;
        setRankings(res.rankings);
        setAsOf(res.asOf);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load rankings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [game, scope]);

  const selectedGame = games.find((g) => g.game === game);

  return (
    <div className="site-page-card">
      <div className="site-comp-game-picker">
        <select
          className="site-select"
          value={game}
          onChange={(e) => setGame(e.target.value)}
        >
          <option value="">Select a game…</option>
          {games.map((g) => (
            <option key={g.game} value={g.game}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {game ? (
        <div className="site-billing-panel">
          <div className="site-hero-switcher" role="tablist" aria-label="Ranking scope" style={{ margin: "0 auto var(--space-4)" }}>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "dynasty"}
              className={scope === "dynasty" ? "is-active" : ""}
              onClick={() => setScope("dynasty")}
            >
              {selectedGame?.dynastyLabel ?? "Dynasty"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "comp"}
              className={scope === "comp" ? "is-active" : ""}
              onClick={() => setScope("comp")}
            >
              H2H Comp
            </button>
          </div>

          {error && <p className="site-auth-error">{error}</p>}
          {loading ? (
            <p className="site-muted">Loading rankings…</p>
          ) : rankings.length === 0 ? (
            <p className="site-muted">
              {scope === "comp"
                ? "No H2H Comp games have been logged yet — rankings appear once the matchmaking queue is live."
                : "No rankings computed yet."}
            </p>
          ) : (
            <>
              {asOf ? <p className="site-muted">As of {new Date(asOf).toLocaleDateString()}</p> : null}
              <ol className="site-account-notif-list" style={{ listStyle: "none", paddingLeft: 0 }}>
                {rankings.map((row) => (
                  <li key={row.userId}>
                    <strong>
                      #{row.rank} @{row.username ?? row.displayName}
                    </strong>
                    <span>
                      Score {row.score.toFixed(1)} · {movementLabel(row)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : (
        <p className="site-muted" style={{ textAlign: "center" }}>
          Pick a game above to view its global rankings.
        </p>
      )}
    </div>
  );
}

function MatchupQueueTab() {
  const [game, setGame] = useState("cfb_27");
  const [state, setState] = useState<any>(null);
  const [consoleName, setConsoleName] = useState<"xbox" | "ps5" | "pc">("xbox");
  const [gamerTag, setGamerTag] = useState("");
  const [crossPlay, setCrossPlay] = useState(false);
  const [rosterMode, setRosterMode] = useState<"default" | "cut">("default");
  const [quarterLength, setQuarterLength] = useState("");
  const [acceleratedClock, setAcceleratedClock] = useState("");
  const [minimumClock, setMinimumClock] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  const [boxFiles, setBoxFiles] = useState<File[]>([]);
  const [parsedText, setParsedText] = useState("");
  const [boxUrls, setBoxUrls] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const profileInitialized = useRef(false);

  async function reload() {
    try {
      const next = await siteApi.getCompState(game);
      setState(next);
      if (next.profile?.console) setConsoleName(next.profile.console);
      if (next.profile?.gamer_tag) setGamerTag(next.profile.gamer_tag);
      if (!profileInitialized.current && next.profile?.preferred_game) setGame(next.profile.preferred_game);
      setCrossPlay(Boolean(next.profile?.cross_play_enabled));
      if (!profileInitialized.current) {
        setSettingsOpen(!(next.profile?.console && next.profile?.gamer_tag));
        profileInitialized.current = true;
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load matchmaking.");
    }
  }
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [game]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function parseBoxScore() {
    if (!match || boxFiles.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await Promise.all(boxFiles.slice(0, 2).map((file) => siteApi.uploadCompImage(file)));
      const urls = uploaded.map((row) => row.url);
      const parsed = await siteApi.parseCompBoxScore({ game, imageUrls: urls });
      setBoxUrls(urls);
      setParsedText(JSON.stringify(parsed.parsed ?? parsed, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the box score.");
    } finally {
      setBusy(false);
    }
  }

  async function submitParsedBoxScore() {
    if (!match || !parsedText || boxUrls.length < 2) return;
    let corrected: unknown;
    try {
      corrected = JSON.parse(parsedText);
    } catch {
      setError("Corrected box-score data must remain valid JSON.");
      return;
    }
    await act(() => siteApi.submitCompBoxScore({
      matchId: match.id,
      imageUrls: boxUrls,
      parsedPayload: corrected,
      correctedPayload: corrected,
    }));
    setBoxScoreOpen(false);
  }

  const match = state?.match;
  const incoming = match?.status === "requested" && match?.opponent_user_id === state?.currentUserId;
  const peerName = match
    ? match.requester_user_id === state.currentUserId
      ? match.opponent_username
      : match.requester_username
    : null;
  const peerTag = match
    ? match.requester_user_id === state.currentUserId
      ? match.opponent_gamer_tag
      : match.requester_gamer_tag
    : null;

  return (
    <div className="site-page-card site-comp-queue">
      <header className="site-section-heading">
        <h2>H2H Comp Matchmaking</h2>
        <p>Default-roster games use Play a Friend. CUT games use Play a Friend through CUT. Add your opponent as a friend to send the invite; you can remove them after the game.</p>
      </header>
      {settingsOpen ? (
        <section className="site-comp-player-settings">
          <div className="site-account-stat-grid site-comp-profile-grid">
            <label className="site-field"><span>Game</span><select className="site-select" value={game} onChange={(e) => setGame(e.target.value)}><option value="cfb_27">CFB 27</option><option value="madden_26">Madden 26</option><option value="madden_27">Madden 27</option></select></label>
            <label className="site-field"><span>Console</span><select className="site-select" value={consoleName} onChange={(e) => setConsoleName(e.target.value as any)}><option value="xbox">Xbox</option><option value="ps5">PS5</option><option value="pc">PC</option></select></label>
            <label className="site-field"><span>Gamertag / PSN</span><input value={gamerTag} onChange={(e) => setGamerTag(e.target.value)} /></label>
            <label className="site-check-row"><input type="checkbox" checked={crossPlay} onChange={(e) => setCrossPlay(e.target.checked)} /><span>Cross-Play Enabled</span></label>
          </div>
          <button className="site-btn site-btn-primary" type="button" disabled={busy || gamerTag.trim().length < 2} onClick={() => void act(async () => { await siteApi.saveCompProfile({ console: consoleName, gamerTag, crossPlayEnabled: crossPlay, preferredGame: game as "madden_26" | "madden_27" | "cfb_27" }); setSettingsOpen(false); })}>Save player settings</button>
        </section>
      ) : (
        <section className="site-comp-player-summary">
          <div>
            <strong>{game === "cfb_27" ? "CFB 27" : game === "madden_26" ? "Madden 26" : "Madden 27"}</strong>
            <span>{consoleName.toUpperCase()} · {gamerTag} · Cross-play {crossPlay ? "on" : "off"}</span>
          </div>
          <button type="button" className="site-btn site-btn-ghost" onClick={() => setSettingsOpen(true)}>Change player settings</button>
        </section>
      )}

      {match ? (
        <section className="site-comp-match-room">
          <h3>{match.status === "requested" ? `Match request with @${peerName}` : `Private matchup: @${peerName}`}</h3>
          {incoming ? (
            <div className="site-profile-actions">
              <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.respondCompMatch(match.id, true))}>Accept</button>
              <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.respondCompMatch(match.id, false))}>Decline</button>
            </div>
          ) : match.status === "requested" ? <p>Waiting for your opponent to respond.</p> : (
            <>
              <p><strong>Opponent ID:</strong> {peerTag}. Send a friend request and game invite. Be prepared to capture a screenshot if your opponent quits.</p>
              <div className="site-comp-chat-log">
                {(state.messages ?? []).map((row: any) => <p key={row.id}><strong>@{row.username ?? row.display_name}:</strong> {row.body}</p>)}
              </div>
              <div className="site-comp-chat-compose"><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message your opponent…" /><button className="site-btn site-btn-primary" disabled={!message.trim() || busy} onClick={() => void act(async () => { await siteApi.sendCompMessage(match.id, message); setMessage(""); })}>Send</button></div>
              {state.submission ? (
                <div className="site-comp-submission-review">
                  <h4>Box score awaiting review</h4>
                  <pre>{JSON.stringify(state.submission.corrected_payload ?? state.submission.parsed_payload, null, 2)}</pre>
                  <div className="site-profile-actions">
                    <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.reviewCompBoxScore({ submissionId: state.submission.id, action: "approve" }))}>Confirm Result</button>
                    <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => {
                      const raw = window.prompt("Paste the corrected JSON to return to the submitter.", JSON.stringify(state.submission.corrected_payload ?? state.submission.parsed_payload, null, 2));
                      if (!raw) return;
                      try {
                        const correctedPayload = JSON.parse(raw);
                        void act(() => siteApi.reviewCompBoxScore({ submissionId: state.submission.id, action: "correct", correctedPayload, note: "Opponent supplied corrections." }));
                      } catch {
                        setError("Corrections must be valid JSON.");
                      }
                    }}>Correct & Return</button>
                    <button className="site-btn site-btn-danger" disabled={busy} onClick={() => {
                      const note = window.prompt("Explain why this result still cannot be approved.");
                      if (note) void act(() => siteApi.reviewCompBoxScore({ submissionId: state.submission.id, action: "deny", note }));
                    }}>Flag for Admin</button>
                  </div>
                </div>
              ) : null}
              <div className="site-profile-actions">
                <button className="site-btn site-btn-ghost" onClick={() => { const url = window.prompt("Stream URL"); if (url) void act(() => siteApi.shareCompStream(match.id, url)); }}>Share Stream</button>
                <button className="site-btn site-btn-ghost" onClick={() => setBoxScoreOpen(true)}>Upload Box Score</button>
                <button className="site-btn site-btn-ghost" onClick={() => { const details = window.prompt("Describe the issue. Evidence can be uploaded with the report; reports without evidence may be invalidated."); if (details) void act(() => siteApi.createCompReport({ matchId: match.id, type: "other", details, evidenceUrls: [] })); }}>Report Issue</button>
                <button className="site-btn site-btn-danger" onClick={() => void act(() => siteApi.concedeCompMatch(match.id))}>Concede Defeat</button>
                <button className="site-btn site-btn-ghost" onClick={() => void act(() => siteApi.cancelCompMatch(match.id))}>Cancel Matchup</button>
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="site-comp-queue-controls">
            <label className="site-field"><span>Roster mode</span><select className="site-select" value={rosterMode} onChange={(e) => setRosterMode(e.target.value as any)}><option value="default">Play a Friend — default rosters</option><option value="cut">Play a Friend — CUT</option></select></label>
            <label className="site-field"><span>Quarter length (optional)</span><input type="number" min="4" max="8" value={quarterLength} onChange={(e) => setQuarterLength(e.target.value)} /></label>
            <label className="site-field"><span>Accelerated clock (optional)</span><select className="site-select" value={acceleratedClock} onChange={(e) => setAcceleratedClock(e.target.value)}><option value="">Any</option><option value="on">On</option><option value="off">Off</option></select></label>
            <label className="site-field"><span>Minimum clock (15–25s)</span><input type="number" min="15" max="25" disabled={acceleratedClock !== "on"} value={minimumClock} onChange={(e) => setMinimumClock(e.target.value)} /></label>
          </section>
          <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => state?.ownQueue ? siteApi.leaveCompQueue() : siteApi.joinCompQueue({ game, rosterMode, quarterLength: quarterLength ? Number(quarterLength) : null, acceleratedClock: acceleratedClock ? acceleratedClock === "on" : null, acceleratedClockMinimum: acceleratedClock === "on" && minimumClock ? Number(minimumClock) : null }))}>{state?.ownQueue ? "Leave Queue" : "Join Queue"}</button>
          <h3 className="site-comp-lobby-title">Matchmaking Lobby</h3>
          <div className="site-comp-candidates">
            {state?.ownQueue ? (
              <article className="is-current-user">
                <div><strong>You · @{gamerTag}</strong><span>{consoleName.toUpperCase()} · {state.ownQueue.roster_mode} · waiting for a matchup</span></div>
                <em>In queue</em>
              </article>
            ) : null}
            {(state?.queue ?? []).map((candidate: any) => (
              <article key={candidate.user_id}>
                <div><strong>@{candidate.username ?? candidate.display_name}</strong><span>{candidate.console} · {candidate.roster_mode} · matchup {Math.round(candidate.matchupStrength)}%</span>{candidate.connection_issue ? <em>Connection issues reported</em> : null}{candidate.dasher ? <em>Dasher</em> : null}</div>
                <button className="site-btn site-btn-primary" disabled={!state?.ownQueue || busy} onClick={() => void act(() => siteApi.requestCompMatch(candidate.user_id))}>Request Match</button>
              </article>
            ))}
            {state?.ownQueue && !(state?.queue ?? []).length ? (
              <p className="site-muted site-comp-empty-lobby">You are in the lobby. No compatible opponents are queued right now; this list refreshes automatically.</p>
            ) : !state?.ownQueue ? (
              <p className="site-muted site-comp-empty-lobby">Join the queue to enter the lobby and request a matchup.</p>
            ) : null}
          </div>
        </>
      )}
      {error ? <p className="site-auth-error">{error}</p> : null}
      {boxScoreOpen ? (
        <div className="site-modal-backdrop" onMouseDown={() => !busy && setBoxScoreOpen(false)}>
          <section className="site-modal site-comp-box-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="site-modal-close" onClick={() => setBoxScoreOpen(false)}>×</button>
            <h3>Submit H2H Comp Box Score</h3>
            <div className="site-comp-shot-examples">
              <div><strong>1. Top screenshot</strong><span>Show the final score, teams, and scoring summary.</span></div>
              <div><strong>2. Bottom screenshot</strong><span>Show the complete team statistics through the last row.</span></div>
            </div>
            <p>Upload both screenshots. You must review and correct every parsed field before submission.</p>
            <input type="file" accept="image/*" multiple onChange={(event) => setBoxFiles(Array.from(event.target.files ?? []).slice(0, 2))} />
            {!parsedText ? (
              <button className="site-btn site-btn-primary" disabled={busy || boxFiles.length < 2} onClick={() => void parseBoxScore()}>{busy ? "Parsing…" : "Parse screenshots"}</button>
            ) : (
              <>
                <label className="site-field"><span>Review and correct parsed result</span><textarea rows={18} value={parsedText} onChange={(event) => setParsedText(event.target.value)} /></label>
                <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void submitParsedBoxScore()}>Submit for opponent confirmation</button>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CompUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    siteApi
      .getCompUserDetail(userId)
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load user.");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <div className="site-modal" role="dialog" aria-modal="true">
      <button type="button" className="site-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="site-modal-panel site-comp-user-modal">
        <div className="site-modal-actions" style={{ justifyContent: "flex-end", marginTop: 0 }}>
          <button type="button" className="site-btn site-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <p className="site-auth-error">{error}</p>
        ) : !detail ? (
          <p className="site-muted">Loading…</p>
        ) : (
          <>
            <h2>@{detail.username ?? detail.displayName}</h2>
            <p className="site-muted">
              Member since{" "}
              {detail.memberSince ? new Date(detail.memberSince).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "—"}
            </p>
            <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <article>
                <span>All-time record</span>
                <strong>{detail.globalRecord.wins}-{detail.globalRecord.losses}</strong>
              </article>
              <article>
                <span>Playoff record</span>
                <strong>{detail.globalRecord.playoffWins}-{detail.globalRecord.playoffLosses}</strong>
              </article>
              <article>
                <span>Championship record</span>
                <strong>{detail.globalRecord.superbowlWins}-{detail.globalRecord.superbowlLosses}</strong>
              </article>
              <article>
                <span>Games played</span>
                <strong>{detail.globalRecord.gamesPlayed}</strong>
              </article>
              <article>
                <span>Point differential</span>
                <strong>{detail.globalRecord.pointDifferential > 0 ? "+" : ""}{detail.globalRecord.pointDifferential}</strong>
              </article>
            </div>

            <h3>Stats by game</h3>
            {detail.careerStats.length ? (
              <div className="site-account-game-stats">
                {detail.careerStats.map((game) => (
                  <details key={game.game} className="site-account-game-block">
                    <summary>{game.gameLabel}</summary>
                    <div className="site-account-stat-grid">
                      {Object.entries(game)
                        .filter(([key, value]) => !["game", "gameLabel", "activeStreak"].includes(key) && typeof value === "number")
                        .map(([key, value]) => (
                          <article key={key}>
                            <span>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</span>
                            <strong>{Number(value).toLocaleString()}</strong>
                          </article>
                        ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="site-muted">No box-score stats logged yet.</p>
            )}

            <h3>Badges ({detail.badges.length})</h3>
            {detail.badges.length ? (
              <ul className="site-account-badge-list">
                {detail.badges.map((badge) => {
                  const label = badge.badge_label ?? badge.badge_key.replaceAll("_", " ");
                  return (
                    <li
                      key={badge.badge_key + "-" + badge.badge_scope}
                      title={badgeTooltip(badge)}
                      className="site-account-badge-render"
                      style={{ backgroundImage: `url("${badgeAsset(badge.badge_key, label, badge.tier)}")` }}
                    >
                      <span className="sr-only">{label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="site-muted">No badges yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<CompUserSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    siteApi
      .listCompUsers({ page })
      .then((res) => {
        if (!active) return;
        setUsers(res.users);
        setTotal(res.total);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="site-page-card">
      {loading ? (
        <p className="site-muted">Loading users…</p>
      ) : (
        <>
          <ul className="site-account-notif-list">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="site-text-link"
                  onClick={() => setSelectedUserId(user.id)}
                  style={{ fontSize: 16, fontWeight: 700 }}
                >
                  @{user.username ?? user.displayName}
                </button>
                <span>View career profile</span>
              </li>
            ))}
          </ul>
          <div className="site-profile-actions">
            <button className="site-btn site-btn-ghost" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="site-muted">
              Page {page} of {totalPages}
            </span>
            <button className="site-btn site-btn-ghost" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
      {selectedUserId ? <UserDetailModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} /> : null}
    </div>
  );
}

export function CompPage() {
  const [tab, setTab] = useState<CompTab>("rankings");

  return (
    <div className="site-page">
      <div className="site-hero-switcher" role="tablist" aria-label="Comp sections" style={{ margin: "0 auto var(--space-4)" }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "rankings" ? <RankingsTab /> : null}
      {tab === "queue" ? <MatchupQueueTab /> : null}
      {tab === "tournaments" ? <ComingSoon title="Tournaments" /> : null}
      {tab === "live" ? <ComingSoon title="Live Games" /> : null}
      {tab === "users" ? <UsersTab /> : null}
    </div>
  );
}
