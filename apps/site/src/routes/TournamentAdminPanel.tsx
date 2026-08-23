import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  siteApi,
  type AdminUserSummary,
  type SiteRosterLibrary,
  type SiteTournamentDetail,
  type SiteTournamentHighlight,
  type SiteTournamentSummary,
} from "../lib/site-api.js";
import { CreateTournamentForm, gameLabel, payoutLine, statusLabel } from "./Tournaments.js";

function RosterLibraryAdmin() {
  const [libraries, setLibraries] = useState<SiteRosterLibrary[]>([]);
  const [game, setGame] = useState<"madden_26" | "madden_27" | "cfb_27">("madden_27");
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [importReport, setImportReport] = useState<{ imported: number; skipped: Array<{ row: number; reason: string }> } | null>(null);
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
        <div className="site-tournament-roster-import">
          <label className="site-field">
            <span>Paste CSV (Team, Name, Position, Jersey, OVR + any other columns)</span>
            <textarea rows={6} value={csvText} onChange={(event) => setCsvText(event.target.value)} />
          </label>
          <div className="site-profile-actions">
            <button
              className="site-btn site-btn-primary"
              disabled={busy || csvText.trim().length < 2}
              onClick={() => void act(async () => {
                const result = await siteApi.importRosterLibraryCsv({ libraryId: selectedId, csvText });
                setImportReport(result);
                setCsvText("");
              })}
            >
              Import CSV
            </button>
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
          {importReport ? (
            <p className="site-muted">
              Imported {importReport.imported} players.
              {importReport.skipped.length ? ` Skipped ${importReport.skipped.length}: ${importReport.skipped.slice(0, 5).map((s) => `row ${s.row} (${s.reason})`).join("; ")}${importReport.skipped.length > 5 ? "…" : ""}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TournamentAdminPanel() {
  const navigate = useNavigate();
  const [list, setList] = useState<SiteTournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<SiteTournamentDetail | null>(null);
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
    setDetail({ tournament: next.tournament, entrants: next.entrants, matches: next.matches });
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
          <p>
            <Link to={`/tournaments/${row.id}`}>{row.title}</Link>
            <span className="site-muted"> · {gameLabel(row.game)} · {row.approvedCount}/{row.bracketSize ?? "—"} approved · {row.pendingCount} pending</span>
          </p>
          <p className="site-muted">{payoutLine(row)} · {row.countdown.label}</p>
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

          <h3>Pending registration</h3>
          {pending.length ? (
            <ul className="site-tournament-entrants">
              {pending.map((entrant) => (
                <li key={entrant.userId}>
                  {entrant.displayName}{entrant.teamName ? ` · ${entrant.teamName}` : ""}
                  <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "approved" }))}>
                    Approve
                  </button>
                  <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "removed" }))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">No pending registrations.</p>
          )}

          <h3>Field</h3>
          {approved.length ? (
            <ul className="site-tournament-entrants">
              {approved.map((entrant) => (
                <li key={entrant.userId}>
                  {entrant.seed ? `#${entrant.seed} ` : ""}
                  {entrant.displayName}{entrant.teamName ? ` · ${entrant.teamName}` : ""}
                  <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEntryStatus({ tournamentId: row.id, userId: entrant.userId, entryStatus: "removed" }))}>
                    Remove from field
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">Nobody is approved yet.</p>
          )}

          <h3>Manually add a user</h3>
          <label className="site-field">
            <span>Search users</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Username" />
          </label>
          <ul className="site-account-notif-list">
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
              <span>Team abbr</span>
              <input value={addTeam} onChange={(event) => setAddTeam(event.target.value.toUpperCase())} maxLength={8} />
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
        </>
      ) : (
        <p className="site-muted">Select a tournament to manage the roster.</p>
      )}
    </div>
  );
}
