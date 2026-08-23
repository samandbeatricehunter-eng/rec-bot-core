import { useEffect, useMemo, useState } from "react";
import { siteApi, type SiteTournamentLottery, type SiteTournamentTeamOption } from "../lib/site-api.js";

function countdownLabel(targetIso: string | null | undefined): string {
  if (!targetIso) return "";
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function TournamentLotteryPanel({
  tournamentId, isAdmin, currentUserId, onChanged,
}: {
  tournamentId: string; isAdmin: boolean; currentUserId: string | null; onChanged: () => void;
}) {
  const [lottery, setLottery] = useState<SiteTournamentLottery | null>(null);
  const [teams, setTeams] = useState<SiteTournamentTeamOption[]>([]);
  const [claimedTeams, setClaimedTeams] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [pickTeamAbbr, setPickTeamAbbr] = useState("");
  const [pickGamerTag, setPickGamerTag] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignTeamAbbr, setAssignTeamAbbr] = useState("");
  const [assignGamerTag, setAssignGamerTag] = useState("");
  const [revealCount, setRevealCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [lotteryResult, tournamentResult] = await Promise.all([
      siteApi.getTournamentLottery(tournamentId),
      siteApi.getTournament(tournamentId),
    ]);
    setLottery(lotteryResult);
    setTeams(tournamentResult.teams);
    setClaimedTeams(tournamentResult.claimedTeams ?? []);
  }

  useEffect(() => {
    void reload();
    const interval = setInterval(() => void reload(), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reveal the (already-known, server-computed) draw order one name at a time for effect.
  useEffect(() => {
    if (!lottery?.drawOrder?.length) { setRevealCount(0); return; }
    setRevealCount(0);
    const order = lottery.drawOrder;
    const timer = setInterval(() => {
      setRevealCount((n) => {
        if (n >= order.length) { clearInterval(timer); return n; }
        return n + 1;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [lottery?.drawOrder]);

  const openTeams = useMemo(() => {
    const claimed = new Set(claimedTeams);
    return teams.filter((team) => !claimed.has(team.abbr));
  }, [teams, claimedTeams]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (!lottery) return null;
  const isMyTurn = lottery.status === "picking" && lottery.currentUserId === currentUserId;
  const isMyOpenPoolTurn = lottery.status === "open_pool" &&
    (lottery.skipped ?? []).some((s) => s.userId === currentUserId && !s.resolved);
  const canPick = isMyTurn || isMyOpenPoolTurn;

  return (
    <div className="site-tournament-lottery">
      <h3>Draft Lottery</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}

      {lottery.status === "not_scheduled" ? (
        <p className="site-muted">The team draft lottery hasn't been scheduled yet.</p>
      ) : null}

      {lottery.status === "scheduled" ? (
        <p key={tick}>
          Lottery drawing in <strong>{countdownLabel(lottery.scheduledAt)}</strong>
          {lottery.scheduledAt ? ` (${new Date(lottery.scheduledAt).toLocaleString()})` : ""}
        </p>
      ) : null}

      {lottery.drawOrder?.length ? (
        <div>
          <strong>Draw order</strong>
          <ol className="site-tournament-lottery-order">
            {lottery.drawOrder.slice(0, revealCount).map((entry, index) => (
              <li key={entry.userId} className={lottery.currentUserId === entry.userId ? "is-current" : undefined}>
                {index + 1}. {entry.displayName}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {lottery.status === "picking" ? (
        <p key={tick}>
          On the clock: <strong>{lottery.drawOrder?.find((e) => e.userId === lottery.currentUserId)?.displayName ?? "—"}</strong>
          {" "}— {countdownLabel(lottery.currentPickDeadlineAt)} left to pick
        </p>
      ) : null}

      {lottery.status === "open_pool" ? (
        <p key={tick}>Open pool — anyone skipped can grab a remaining team. {countdownLabel(lottery.openPoolDeadlineAt)} left before random assignment.</p>
      ) : null}

      {lottery.status === "completed" ? <p>The lottery is complete — every team has been claimed or assigned.</p> : null}

      {canPick ? (
        <form
          className="site-tournament-lottery-pick"
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => siteApi.pickLotteryTeam({ tournamentId, teamAbbr: pickTeamAbbr, gamerTag: pickGamerTag }));
          }}
        >
          <label className="site-field">
            <span>Your team</span>
            <select className="site-select" value={pickTeamAbbr} onChange={(event) => setPickTeamAbbr(event.target.value)} required>
              <option value="">Select a team…</option>
              {openTeams.map((team) => (
                <option key={team.abbr} value={team.abbr}>{team.name} ({team.abbr})</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Gamertag / PSN / EA name</span>
            <input value={pickGamerTag} onChange={(event) => setPickGamerTag(event.target.value)} required minLength={2} maxLength={32} />
          </label>
          <button className="site-btn site-btn-primary" type="submit" disabled={busy || !pickTeamAbbr}>
            {busy ? "Claiming…" : "Claim team"}
          </button>
        </form>
      ) : null}

      {isAdmin ? (
        <div className="site-tournament-lottery-admin">
          {lottery.status === "not_scheduled" || lottery.status === "scheduled" ? (
            <>
              <label className="site-field">
                <span>Schedule lottery for</span>
                <input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
              </label>
              <button
                className="site-btn site-btn-ghost"
                disabled={busy || !scheduleAt}
                onClick={() => void act(() => siteApi.scheduleTournamentLottery({ tournamentId, scheduledAt: new Date(scheduleAt).toISOString() }))}
              >
                Schedule
              </button>
              <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.runTournamentLotteryNow(tournamentId))}>
                Run lottery now
              </button>
            </>
          ) : null}
          {lottery.status === "picking" || lottery.status === "open_pool" ? (
            <>
              {lottery.status === "picking" ? (
                <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.skipLotteryPick(tournamentId))}>
                  Skip current pick
                </button>
              ) : null}
              <form
                className="site-tournament-lottery-assign"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(() => siteApi.assignLotteryTeam({ tournamentId, userId: assignUserId, teamAbbr: assignTeamAbbr, gamerTag: assignGamerTag }));
                }}
              >
                <label className="site-field">
                  <span>Assign for user</span>
                  <select className="site-select" value={assignUserId} onChange={(event) => setAssignUserId(event.target.value)} required>
                    <option value="">Select…</option>
                    {lottery.status === "picking" && lottery.currentUserId
                      ? (() => {
                          const entry = lottery.drawOrder?.find((e) => e.userId === lottery.currentUserId);
                          return entry ? <option value={entry.userId}>{entry.displayName}</option> : null;
                        })()
                      : (lottery.skipped ?? []).filter((s) => !s.resolved).map((s) => {
                          const entry = lottery.drawOrder?.find((e) => e.userId === s.userId);
                          return <option key={s.userId} value={s.userId}>{entry?.displayName ?? s.userId}</option>;
                        })}
                  </select>
                </label>
                <label className="site-field">
                  <span>Team</span>
                  <select className="site-select" value={assignTeamAbbr} onChange={(event) => setAssignTeamAbbr(event.target.value)} required>
                    <option value="">Select a team…</option>
                    {openTeams.map((team) => (
                      <option key={team.abbr} value={team.abbr}>{team.name} ({team.abbr})</option>
                    ))}
                  </select>
                </label>
                <label className="site-field">
                  <span>Gamertag</span>
                  <input value={assignGamerTag} onChange={(event) => setAssignGamerTag(event.target.value)} required minLength={2} maxLength={32} />
                </label>
                <button className="site-btn site-btn-ghost" type="submit" disabled={busy || !assignUserId || !assignTeamAbbr}>
                  Assign team
                </button>
              </form>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
