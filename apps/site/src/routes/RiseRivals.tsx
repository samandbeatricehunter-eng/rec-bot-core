import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityHubResponse, type RivalSlotInfo } from "../lib/site-api.js";

type Side = "offense" | "defense";
type HistoryGame = { weekNumber: number | null; opponentName: string; myScore: number | null; opponentScore: number | null; statLine: Record<string, unknown> | null };

function teamLabel(slot: RivalSlotInfo | null | undefined) {
  if (!slot?.teamId) return null;
  return `${slot.city ?? ""} ${slot.name ?? slot.abbreviation ?? ""}`.trim();
}

export function RiseRivalsPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [rivals, setRivals] = useState<{ seasonNumber: number; currentWeek: number; changeWindowWeeks: number; offense: RivalSlotInfo[]; defense: RivalSlotInfo[] } | null>(null);
  const [tab, setTab] = useState<"set" | "history">("set");
  const [historySide, setHistorySide] = useState<Side>("offense");
  const [historySlot, setHistorySlot] = useState<1 | 2>(1);
  const [history, setHistory] = useState<HistoryGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlotKey, setBusySlotKey] = useState<string | null>(null);

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
    siteApi.immortalityGetRivalHistory({ guildId, side: historySide, slot: historySlot })
      .then((result) => setHistory(result.games))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load matchup history."));
  }, [guildId, tab, historySide, historySlot]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Rivals…</div>;

  const teams = hub?.teamIdentities ?? [];
  const changeWindowWeeks = rivals?.changeWindowWeeks ?? 2;
  const inChangeWindow = (rivals?.currentWeek ?? 1) <= changeWindowWeeks;

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Rivals</h1>
        <p className="site-muted">
          Each side (Offense, Defense) can carry up to <strong>2 rival teams</strong> — human or CPU. When your
          rival is your game day opponent, that prospect gets extra game day promotion, a bonus in payouts, and a
          bonus in Player XP with elevated game day challenges. The longer a rivalry stays active, the more the
          rewards stack up.
        </p>
        <p className="site-muted rise-rivals-rules">
          <strong>Rules:</strong> rivals can only be set or changed during the first {changeWindowWeeks} weeks of
          the season. Each rival slot can be <strong>changed once per season</strong> — changing a rivalry{" "}
          <strong>resets its streak</strong> back to the start. Offense and defense pick their rivals separately;
          picking the same team for both sides stacks the bonus.
        </p>
        {!inChangeWindow ? (
          <p className="site-auth-error">
            This season's change window has closed (weeks 1–{changeWindowWeeks} only). Your rivals are locked in
            until next season.
          </p>
        ) : null}
      </header>
      <p><Link to={`/l/${leagueId}/team/upgrades`}>Back to Upgrades</Link></p>
      {error ? <p className="site-auth-error">{error}</p> : null}

      <nav className="rise-stage-nav" aria-label="Rivals sections">
        <button type="button" className={tab === "set" ? "is-active" : ""} onClick={() => setTab("set")}>Set Rivals</button>
        <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>History</button>
      </nav>

      {tab === "set" ? (
        <section className="rise-card">
          {(["offense", "defense"] as const).map((side) => (
            <div key={side} className="rise-rivals-side-block">
              <h3>{side === "offense" ? "Offense" : "Defense"} rivals</h3>
              {([1, 2] as const).map((slot) => {
                const slotInfo = rivals?.[side]?.find((row) => row.slot === slot) ?? null;
                const busyKey = `${side}:${slot}`;
                const busy = busySlotKey === busyKey;
                return (
                  <div key={slot} className="rise-question">
                    <p>
                      <strong>Rival #{slot}</strong>{" "}
                      {slotInfo?.teamId ? `— currently ${teamLabel(slotInfo)}` : "— none set"}
                      {slotInfo?.teamId ? ` · streak: ${slotInfo.streakSeasons} season${slotInfo.streakSeasons === 1 ? "" : "s"}` : ""}
                    </p>
                    {slotInfo?.lockedReason ? <p className="site-muted rise-rivals-locked">{slotInfo.lockedReason}</p> : null}
                    <div className="rise-options">
                      {teams.map((team) => {
                        const label = team.display_team_name ?? team.default_team_name ?? team.default_abbreviation;
                        const active = slotInfo?.teamId === team.team_id;
                        const disabled = busy || (!active && slotInfo != null && !slotInfo.canChange);
                        return (
                          <button key={team.team_id} type="button" className={`site-btn ${active ? "site-btn-primary" : "site-btn-ghost"}`}
                            disabled={disabled}
                            onClick={async () => {
                              setBusySlotKey(busyKey); setError(null);
                              try { await siteApi.immortalitySetRival({ guildId, side, slot, rivalTeamId: team.team_id }); await reload(); }
                              catch (err) { setError(err instanceof Error ? err.message : "Could not set that rival."); }
                              finally { setBusySlotKey(null); }
                            }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
          <div className="rise-side-tabs">
            {([1, 2] as const).map((slot) => (
              <button key={slot} type="button" className={`wizard-game-card ${historySlot === slot ? "wizard-game-card-active" : ""}`}
                onClick={() => setHistorySlot(slot)}>Rival #{slot}</button>
            ))}
          </div>
          {!history ? <p className="site-muted">Loading…</p> : history.length === 0 ? (
            <p className="site-muted">No logged matchups against this rival yet.</p>
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
