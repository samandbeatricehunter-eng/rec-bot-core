import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  siteApi,
  type AdminUserSummary,
  type SiteLibraryEaConnection,
  type SiteLibraryEaFranchise,
  type SiteLibraryEaPersona,
  type SiteRosterLibrary,
  type SiteTournamentDetail,
  type SiteTournamentHighlight,
  type SiteTournamentMatchReview,
  type SiteTournamentSummary,
  type SiteTournamentTeamOption,
} from "../lib/site-api.js";
import { CreateTournamentForm, gameLabel, payoutLine, statusLabel } from "./Tournaments.js";

function resultMethodLabel(method: string | null): string {
  if (method === "concede") return "Opponent conceded";
  if (method === "opponent_quit") return "Opponent quit out";
  if (method === "final_screenshot") return "Final score screenshot";
  return "Result";
}

function MatchReviewQueue() {
  const [queue, setQueue] = useState<SiteTournamentMatchReview[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await siteApi.listTournamentMatchReviewQueue();
    setQueue(result.queue);
  }

  useEffect(() => { void reload(); }, []);

  async function act(matchId: string, run: () => Promise<unknown>) {
    setBusyId(matchId);
    setError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!queue.length) return null;

  return (
    <div className="site-tournament-review-queue">
      <h3>Match Results — Awaiting Review ({queue.length})</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <ul className="site-tournament-review-list">
        {queue.map((item) => {
          const winner = item.winnerUserId === item.playerA.userId ? item.playerA : item.playerB;
          const loser = item.winnerUserId === item.playerA.userId ? item.playerB : item.playerA;
          return (
            <li key={item.matchId} className="site-tournament-review-card">
              <div>
                <strong>{item.tournamentTitle}</strong>
                <span className="site-muted"> · {item.playerA.displayName}{item.playerA.teamName ? ` (${item.playerA.teamName})` : ""} vs {item.playerB.displayName}{item.playerB.teamName ? ` (${item.playerB.teamName})` : ""}</span>
              </div>
              <p className="site-muted">
                {resultMethodLabel(item.resultMethod)} — <strong>{winner.displayName}</strong> won
                {item.playerAScore != null && item.playerBScore != null ? ` (${item.playerAScore}–${item.playerBScore})` : ""}
                {item.resultMethod !== "final_screenshot" ? ` · ${loser.displayName} ${item.resultMethod === "concede" ? "conceded" : "quit out"}` : ""}
                {" · submitted "}{new Date(item.submittedAt).toLocaleString()}
              </p>
              {item.screenshotUrl ? (
                <a href={item.screenshotUrl} target="_blank" rel="noreferrer">
                  <img src={item.screenshotUrl} alt="Submitted result screenshot" className="site-tournament-review-screenshot" />
                </a>
              ) : null}
              <div className="site-profile-actions">
                <button
                  className="site-btn site-btn-primary"
                  disabled={busyId === item.matchId}
                  onClick={() => void act(item.matchId, () => siteApi.approveTournamentMatchResult(item.matchId))}
                >
                  Approve
                </button>
                <button
                  className="site-btn site-btn-danger"
                  disabled={busyId === item.matchId}
                  onClick={() => void act(item.matchId, () => siteApi.rejectTournamentMatchResult(item.matchId))}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RosterLibraryEaImport({ libraryId }: { libraryId: string }) {
  const [connection, setConnection] = useState<SiteLibraryEaConnection | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [pendingAuthId, setPendingAuthId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<SiteLibraryEaPersona[]>([]);
  const [franchises, setFranchises] = useState<SiteLibraryEaFranchise[]>([]);
  const [showFranchises, setShowFranchises] = useState(false);
  const [importReport, setImportReport] = useState<{ imported: number; skipped: Array<{ team: string; reason: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await siteApi.getLibraryEaConnectionStatus(libraryId);
    setConnection(result.connection);
  }

  useEffect(() => {
    setLoginUrl(null);
    setPastedCode("");
    setPendingAuthId(null);
    setPersonas([]);
    setFranchises([]);
    setShowFranchises(false);
    setImportReport(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-tournament-roster-import">
      {error ? <p className="site-auth-error">{error}</p> : null}

      {!connection ? (
        <>
          <p className="site-muted">Connect to EA the same way you would for a league, then pick a franchise to pull rosters from.</p>
          {!loginUrl ? (
            <button
              className="site-btn site-btn-primary"
              disabled={busy}
              onClick={() => void act(async () => {
                const result = await siteApi.beginLibraryEaLogin(libraryId);
                setLoginUrl(result.loginUrl);
              })}
            >
              Connect EA account
            </button>
          ) : !pendingAuthId ? (
            <>
              <p>
                <a href={loginUrl} target="_blank" rel="noreferrer">Open EA login</a> — after logging in, EA will
                redirect to a blank/error page. Copy that page's full URL and paste it below.
              </p>
              <label className="site-field">
                <span>Redirect URL</span>
                <input value={pastedCode} onChange={(event) => setPastedCode(event.target.value)} placeholder="http://127.0.0.1/success?code=..." />
              </label>
              <button
                className="site-btn site-btn-primary"
                disabled={busy || pastedCode.trim().length < 5}
                onClick={() => void act(async () => {
                  const result = await siteApi.submitLibraryEaCode({ libraryId, pasted: pastedCode });
                  setPendingAuthId(result.pendingAuthId);
                  setPersonas(result.personas);
                })}
              >
                Submit
              </button>
            </>
          ) : (
            <>
              <p>Pick the gamertag to import from:</p>
              <ul className="site-account-notif-list">
                {personas.map((persona) => (
                  <li key={persona.personaId}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(async () => {
                        const result = await siteApi.selectLibraryEaPersona({ libraryId, pendingAuthId, personaId: persona.personaId });
                        setConnection(result);
                        setLoginUrl(null);
                        setPendingAuthId(null);
                      })}
                    >
                      {persona.displayName} ({persona.console})
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : !connection.eaLeagueId ? (
        <>
          <p className="site-muted">Connected as {connection.personaDisplayName}. Pick a franchise.</p>
          {!showFranchises ? (
            <button
              className="site-btn site-btn-primary"
              disabled={busy}
              onClick={() => void act(async () => {
                const result = await siteApi.listLibraryEaLeagues(libraryId);
                setFranchises(result.leagues);
                setShowFranchises(true);
              })}
            >
              List franchises
            </button>
          ) : (
            <ul className="site-account-notif-list">
              {franchises.map((franchise) => (
                <li key={franchise.leagueId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(async () => {
                      const result = await siteApi.bindLibraryEaLeague({ libraryId, eaLeagueId: franchise.leagueId });
                      setConnection(result);
                      setShowFranchises(false);
                    })}
                  >
                    {franchise.leagueName} — {franchise.userTeamName} ({franchise.seasonText})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="site-muted">
            Connected as {connection.personaDisplayName} → {connection.eaLeagueName ?? connection.eaLeagueId}
            {connection.lastImportAt ? ` · last imported ${new Date(connection.lastImportAt).toLocaleString()}` : ""}
          </p>
          <div className="site-profile-actions">
            <button
              className="site-btn site-btn-primary"
              disabled={busy}
              onClick={() => void act(async () => {
                const result = await siteApi.importLibraryRosters(libraryId);
                setImportReport(result);
              })}
            >
              {busy ? "Importing…" : "Import rosters"}
            </button>
            <button
              className="site-btn site-btn-ghost"
              disabled={busy}
              onClick={() => void act(async () => {
                setShowFranchises(false);
                const result = await siteApi.listLibraryEaLeagues(libraryId);
                setFranchises(result.leagues);
                setShowFranchises(true);
                setConnection({ ...connection, eaLeagueId: null });
              })}
            >
              Change franchise
            </button>
          </div>
          {importReport ? (
            <p className="site-muted">
              Imported {importReport.imported} players.
              {importReport.skipped.length ? ` Skipped teams: ${importReport.skipped.map((s) => `${s.team} (${s.reason})`).join("; ")}` : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function RosterLibraryAdmin() {
  const [libraries, setLibraries] = useState<SiteRosterLibrary[]>([]);
  const [game, setGame] = useState<"madden_26" | "madden_27" | "cfb_27">("madden_27");
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await siteApi.listRosterLibraries();
    setLibraries(result.libraries);
  }

  useEffect(() => { void reload(); }, []);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-tournament-roster-admin">
      <h3>Roster libraries</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <div className="site-account-stat-grid site-tournament-create-grid">
        <label className="site-field">
          <span>Game</span>
          <select className="site-select" value={game} onChange={(event) => setGame(event.target.value as typeof game)}>
            <option value="madden_27">Madden 27</option>
            <option value="cfb_27">CFB 27</option>
            <option value="madden_26">Madden 26</option>
          </select>
        </label>
        <label className="site-field">
          <span>New library name</span>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. M27 Baseline" />
        </label>
      </div>
      <button
        className="site-btn site-btn-primary"
        disabled={busy || newName.trim().length < 2}
        onClick={() => void act(async () => {
          const result = await siteApi.createRosterLibrary({ game, name: newName.trim() });
          setNewName("");
          setSelectedId(result.library.id);
        })}
      >
        Create library
      </button>

      <ul className="site-account-notif-list">
        {libraries.map((library) => (
          <li key={library.id}>
            <button type="button" className={selectedId === library.id ? "is-active" : ""} onClick={() => setSelectedId(library.id)}>
              {library.name}{library.isBaseline ? " ★" : ""} · {gameLabel(library.game)} · {library.playerCount ?? 0} players
            </button>
          </li>
        ))}
      </ul>

      {selectedId ? (
        <>
          <RosterLibraryEaImport libraryId={selectedId} />
          <div className="site-profile-actions">
            <button
              className="site-btn site-btn-ghost"
              disabled={busy}
              onClick={() => void act(() => siteApi.setRosterLibraryBaseline({ libraryId: selectedId, isBaseline: true }))}
            >
              Mark as baseline
            </button>
            <button
              className="site-btn site-btn-danger"
              disabled={busy}
              onClick={() => void act(() => siteApi.deleteRosterLibrary(selectedId))}
            >
              Delete
            </button>
          </div>
          <div className="site-account-stat-grid site-tournament-create-grid">
            <label className="site-field">
              <span>Clone as new library named</span>
              <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} placeholder="e.g. M27 Baseline" />
            </label>
          </div>
          <button
            className="site-btn site-btn-ghost"
            disabled={busy || cloneName.trim().length < 2}
            onClick={() => void act(async () => {
              await siteApi.cloneRosterLibrary({ libraryId: selectedId, newName: cloneName.trim() });
              setCloneName("");
            })}
          >
            Clone library
          </button>
        </>
      ) : null}
    </div>
  );
}

function roundLabel(bracketSide: "winners" | "losers" | "grand_final", round: number): string {
  if (bracketSide === "grand_final") return "Grand Final";
  return `${bracketSide === "winners" ? "Winners" : "Losers"} Round ${round}`;
}

function TournamentRoundScheduler({ tournamentId }: { tournamentId: string }) {
  const [rounds, setRounds] = useState<Array<{ bracketSide: "winners" | "losers" | "grand_final"; round: number; scheduledAt: string | null }>>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await siteApi.listTournamentRounds(tournamentId);
    setRounds(result.rounds);
  }

  useEffect(() => { void reload(); }, [tournamentId]);

  if (!rounds.length) return null;

  const key = (r: { bracketSide: string; round: number }) => `${r.bracketSide}:${r.round}`;

  return (
    <div className="site-tournament-round-scheduler">
      <h3>Round schedule</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <ul className="site-account-notif-list">
        {rounds.map((round) => (
          <li key={key(round)}>
            <span>{roundLabel(round.bracketSide, round.round)}</span>
            {round.scheduledAt ? <span className="site-muted"> · {new Date(round.scheduledAt).toLocaleString()}</span> : null}
            <input
              type="datetime-local"
              value={drafts[key(round)] ?? ""}
              onChange={(event) => setDrafts((prev) => ({ ...prev, [key(round)]: event.target.value }))}
            />
            <button
              className="site-btn site-btn-ghost"
              disabled={busy || !drafts[key(round)]}
              onClick={() => {
                setBusy(true);
                setError(null);
                siteApi.setTournamentRoundSchedule({
                  tournamentId, bracketSide: round.bracketSide, round: round.round,
                  scheduledAt: new Date(drafts[key(round)]).toISOString(),
                })
                  .then((result) => setRounds(result.rounds))
                  .catch((err) => setError(err instanceof Error ? err.message : "Could not save that round's time."))
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TournamentAdminPanel() {
  const navigate = useNavigate();
  const [list, setList] = useState<SiteTournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<SiteTournamentDetail | null>(null);
  const [teams, setTeams] = useState<SiteTournamentTeamOption[]>([]);
  const [claimedTeams, setClaimedTeams] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<SiteTournamentHighlight[]>([]);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addTeam, setAddTeam] = useState("");
  const [addTag, setAddTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadList() {
    const result = await siteApi.listTournaments();
    setList(result.tournaments);
    return result.tournaments;
  }

  async function loadDetail(id: string) {
    const next = await siteApi.getTournament(id);
    setDetail({ tournament: next.tournament, entrants: next.entrants, matches: next.matches, claimedTeams: next.claimedTeams });
    setTeams(next.teams);
    setClaimedTeams(next.claimedTeams ?? []);
    const clips = await siteApi.listTournamentHighlights(id);
    setHighlights(clips.highlights);
  }

  useEffect(() => {
    let active = true;
    loadList()
      .then((rows) => {
        if (!active) return;
        const first = rows.find((row) => row.status === "open" || row.status === "locked") ?? rows[0];
        if (first) setSelectedId(first.id);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load tournaments.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setAddUserId("");
    setAddTeam("");
    setAddTag("");
    loadDetail(selectedId).catch((err) => setError(err instanceof Error ? err.message : "Could not load tournament."));
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      siteApi.searchAdminUsers({ query: query.trim() || undefined, limit: 8 })
        .then((result) => setUsers(result.users.filter((user) => user.hasSiteAccount)))
        .catch(() => setUsers([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  const row = detail?.tournament;
  const pending = detail?.entrants.filter((entrant) => entrant.entryStatus === "pending") ?? [];
  const approved = detail?.entrants.filter((entrant) => entrant.entryStatus === "approved") ?? [];
  const highlightQueue = highlights.filter((item) => item.status === "pending");

  return (
    <div className="site-billing-panel site-tournament-admin">
      <p className="site-muted">Create events here, then approve registrations, fill the field, and control registration / event status.</p>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <MatchReviewQueue />
      <RosterLibraryAdmin />
      <CreateTournamentForm onCreated={(id) => {
        setSelectedId(id);
        navigate(`/tournaments/${id}`);
      }} />
      <label className="site-field">
        <span>Tournament</span>
        <select className="site-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {!list.length ? <option value="">No tournaments</option> : null}
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {statusLabel(item.status)}
            </option>
          ))}
        </select>
      </label>
      {row ? (
        <>
          <div className="site-tournament-admin-header">
            <div className="site-tournament-admin-header-title">
              <Link to={`/tournaments/${row.id}`}>{row.title}</Link>
              <span className="site-tournament-status-badge">{statusLabel(row.status)}</span>
            </div>
            <p className="site-muted" style={{ margin: 0 }}>
              {gameLabel(row.game)} · {row.approvedCount}/{row.bracketSize ?? "—"} approved · {row.pendingCount} pending
            </p>
            <p className="site-muted" style={{ margin: 0 }}>{payoutLine(row)} · {row.countdown.label}</p>
            <div className="site-profile-actions">
              <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentRegistrationOpen(row.id, row.registrationPaused || !row.registrationOpen))}>
                {row.registrationOpen ? "Close registration" : "Reopen registration"}
              </button>
              <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEventOpen(row.id, row.eventPaused))}>
                {row.eventPaused ? "Reopen tournament" : "Close tournament"}
              </button>
              {row.status === "open" ? (
                <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.lockTournament(row.id))}>
                  Lock bracket
                </button>
              ) : null}
              {row.status === "open" || row.status === "locked" ? (
                <button className="site-btn site-btn-danger" disabled={busy} onClick={() => void act(() => siteApi.cancelTournament(row.id))}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          {row.scheduleMode === "per_round" ? <TournamentRoundScheduler tournamentId={row.id} /> : null}

          <div className="site-tournament-admin-section">
            <h3>Pending registration</h3>
            {pending.length ? (
              <ul className="site-tournament-entrant-list">
                {pending.map((entrant) => (
                  <li key={entrant.userId}>
                    <span className="site-tournament-entrant-info">
                      <strong>{entrant.displayName}</strong>
                      {entrant.teamName ? <span className="site-tournament-entrant-team">{entrant.teamName}</span> : null}
                    </span>
                    <div className="site-profile-actions">
                      <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "approved" }))}>
                        Approve
                      </button>
                      <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "removed" }))}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="site-muted">No pending registrations.</p>
            )}
          </div>

          <div className="site-tournament-admin-section">
            <h3>Field</h3>
            {approved.length ? (
              <ul className="site-tournament-entrant-list">
                {approved.map((entrant) => (
                  <li key={entrant.userId}>
                    <span className="site-tournament-entrant-info">
                      <strong>{entrant.seed ? `#${entrant.seed} ` : ""}{entrant.displayName}</strong>
                      {entrant.teamName ? <span className="site-tournament-entrant-team">{entrant.teamName}</span> : null}
                    </span>
                    <div className="site-profile-actions">
                      <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "removed" }))}>
                        Remove from field
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="site-muted">Nobody is approved yet.</p>
            )}
          </div>

          <div className="site-tournament-admin-section">
            <h3>Manually add a user</h3>
            <label className="site-field">
              <span>Search users</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Username" />
            </label>
            <ul className="site-tournament-user-search-results">
              {users.map((user) => (
                <li key={user.id}>
                  <button type="button" className={addUserId === user.id ? "is-active" : ""} onClick={() => setAddUserId(user.id)}>
                    @{user.username || user.displayName}
                  </button>
                </li>
              ))}
            </ul>
            <div className="site-account-stat-grid site-tournament-create-grid">
              <label className="site-field">
                <span>Team</span>
                <select className="site-select" value={addTeam} onChange={(event) => setAddTeam(event.target.value)}>
                  <option value="">Select a team…</option>
                  {teams
                    .filter((team) => row.teamSelectionMode !== "claim_pool" || !claimedTeams.includes(team.abbr) || team.abbr === addTeam)
                    .map((team) => (
                      <option key={team.abbr} value={team.abbr}>{team.name} ({team.abbr})</option>
                    ))}
                </select>
              </label>
              <label className="site-field">
                <span>Gamertag</span>
                <input value={addTag} onChange={(event) => setAddTag(event.target.value)} maxLength={32} />
              </label>
            </div>
            <div className="site-profile-actions">
              <button
                className="site-btn site-btn-ghost"
                disabled={busy || !addUserId || !addTeam || addTag.trim().length < 2}
                onClick={() => void act(() => siteApi.addTournamentUser({ tournamentId: row.id, userId: addUserId, teamAbbr: addTeam, gamerTag: addTag, into: "registration" }))}
              >
                Add to registration
              </button>
              <button
                className="site-btn site-btn-primary"
                disabled={busy || !addUserId || !addTeam || addTag.trim().length < 2}
                onClick={() => void act(() => siteApi.addTournamentUser({ tournamentId: row.id, userId: addUserId, teamAbbr: addTeam, gamerTag: addTag, into: "tournament" }))}
              >
                Add to field
              </button>
            </div>
          </div>

          <div className="site-tournament-admin-section">
            <h3>Highlight queue</h3>
            {highlightQueue.length ? (
            <ul className="site-tournament-highlights">
              {highlightQueue.map((item) => (
                <li key={item.id} className="site-tournament-highlight-card">
                  <strong>{item.label}</strong>
                  <span className="site-muted">{item.displayName} · {item.mediaStatus}</span>
                  {item.iframeUrl && item.mediaStatus === "ready" ? (
                    <iframe title={item.label} src={item.iframeUrl} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  ) : null}
                  <div className="site-profile-actions">
                    <button
                      className="site-btn site-btn-primary"
                      disabled={busy || item.mediaStatus !== "ready"}
                      onClick={() => void act(() => siteApi.reviewTournamentHighlight(item.id, "approved"))}
                    >
                      Approve +250
                    </button>
                    <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.reviewTournamentHighlight(item.id, "rejected"))}>
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
              <p className="site-muted">No pending highlights.</p>
            )}
          </div>
        </>
      ) : (
        <p className="site-muted">Select a tournament to manage the roster.</p>
      )}
    </div>
  );
}
