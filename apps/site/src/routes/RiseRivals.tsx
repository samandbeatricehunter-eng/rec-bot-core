import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityHubResponse } from "../lib/site-api.js";

type Side = "offense" | "defense";
type RivalInfo = { teamId: string; name: string | null; city: string | null; abbreviation: string | null };
type HistoryGame = { weekNumber: number | null; opponentName: string; myScore: number | null; opponentScore: number | null; statLine: Record<string, unknown> | null };

function teamLabel(team: { name: string | null; city: string | null; abbreviation: string | null } | null | undefined) {
  if (!team) return null;
  return `${team.city ?? ""} ${team.name ?? team.abbreviation ?? ""}`.trim();
}

export function RiseRivalsPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [rivals, setRivals] = useState<{ offense: RivalInfo | null; defense: RivalInfo | null } | null>(null);
  const [tab, setTab] = useState<"set" | "history">("set");
  const [historySide, setHistorySide] = useState<Side>("offense");
  const [history, setHistory] = useState<HistoryGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!guildId) return;
    const [nextHub, nextRivals] = await Promise.all([siteApi.immortalityHub(guildId), siteApi.immortalityGetRivals(guildId)]);
    setHub(nextHub);
    setRivals(nextRivals);
  }, [guildId]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    setError(null);
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load rivals."));
  }, [guildId, isRise, reload]);

  useEffect(() => {
    if (!guildId || tab !== "history") return;
    setHistory(null);
    siteApi.immortalityGetRivalHistory({ guildId, side: historySide })
      .then((result) => setHistory(result.games))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load matchup history."));
  }, [guildId, tab, historySide]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Rivals…</div>;

  const teams = hub?.teamIdentities ?? [];

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Rivals</h1>
        <p className="site-muted">
          Pick one rival team per side. Meeting your weekly challenge against your rival grants a 25% Player XP
          bonus — pick the same team for both sides and the bonuses stack.
        </p>
      </header>
      <p><Link to={`/l/${leagueId}/team/upgrades`}>Back to Player XP</Link></p>
      {error ? <p className="site-auth-error">{error}</p> : null}

      <nav className="rise-stage-nav" aria-label="Rivals sections">
        <button type="button" className={tab === "set" ? "is-active" : ""} onClick={() => setTab("set")}>Set Rivals</button>
        <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>History</button>
      </nav>

      {tab === "set" ? (
        <section className="rise-card">
          {(["offense", "defense"] as const).map((side) => (
            <div key={side} className="rise-question">
              <p><strong>{side === "offense" ? "Offense" : "Defense"} rival</strong>{" "}
                {rivals?.[side] ? `— currently ${teamLabel(rivals[side])}` : "— none set"}</p>
              <div className="rise-options">
                {teams.map((team) => {
                  const label = team.display_team_name ?? team.default_team_name ?? team.default_abbreviation;
                  const active = rivals?.[side]?.teamId === team.team_id;
                  return (
                    <button key={team.team_id} type="button" className={`site-btn ${active ? "site-btn-primary" : "site-btn-ghost"}`}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true); setError(null);
                        try { await siteApi.immortalitySetRival({ guildId, side, rivalTeamId: team.team_id }); await reload(); }
                        catch (err) { setError(err instanceof Error ? err.message : "Could not set that rival."); }
                        finally { setBusy(false); }
                      }}>{label}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="rise-card">
          <div className="rise-side-tabs">
            {(["offense", "defense"] as const).map((side) => (
              <button key={side} type="button" className={`wizard-game-card ${historySide === side ? "wizard-game-card-active" : ""}`}
                onClick={() => setHistorySide(side)}>{side === "offense" ? "Offense" : "Defense"}</button>
            ))}
          </div>
          {!history ? <p className="site-muted">Loading…</p> : history.length === 0 ? (
            <p className="site-muted">No logged matchups against this side's rival yet.</p>
          ) : (
            <table className="rise-board">
              <thead><tr><th>Week</th><th>Opponent</th><th>Score</th><th>Stat line</th></tr></thead>
              <tbody>
                {history.map((game, index) => (
                  <tr key={index}>
                    <td>{game.weekNumber ?? "—"}</td>
                    <td>{game.opponentName}</td>
                    <td>{game.myScore ?? "—"}-{game.opponentScore ?? "—"}</td>
                    <td>{game.statLine ? JSON.stringify(game.statLine) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
