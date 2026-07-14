import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { AdvanceResultInput, AdvanceWeekGames, DivisionWinnerOptions, GotwPollStatus } from "../../../types/api.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const SEASON_STAGES = [
  "preseason_training_camp", "regular_season", "wild_card", "divisional",
  "conference_championship", "super_bowl", "offseason", "coach_hiring",
  "final_resigning", "free_agency", "draft",
];
const TZ_LABELS = ["EST", "CST", "PST", "AKST"];

type GameEntry = { outcome: "home" | "away" | "tie" | ""; homeScore: string; awayScore: string };

// The sole advance surface — there is no Discord advance wizard any more. Completing an
// advance here triggers every side effect the old wizard used to (GOTW settlement, EOS
// auto-trigger, Weekly Submissions panel refresh, power-rankings snapshot, @everyone
// announcement) server-side, via Discord's REST API. GOTW assignment and game-channel
// creation/deletion are commissioner actions on this page too.
export function AdvanceHome() {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const isCfb = game === "cfb_27";
  const [data, setData] = useState<AdvanceWeekGames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, GameEntry>>({});
  const [nextWeekNumber, setNextWeekNumber] = useState("");
  const [nextSeasonStage, setNextSeasonStage] = useState("regular_season");
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [divisions, setDivisions] = useState<DivisionWinnerOptions | null>(null);
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [savingWinners, setSavingWinners] = useState(false);

  const [advanceDate, setAdvanceDate] = useState({ year: new Date().getFullYear(), month: 1, day: 1, hour: 20, minute: 0, tzLabel: "EST" });
  const [savingTime, setSavingTime] = useState(false);

  const [gotwPolls, setGotwPolls] = useState<GotwPollStatus[] | null>(null);
  const [gotwGameId, setGotwGameId] = useState("");
  const [assigningGotw, setAssigningGotw] = useState(false);

  const [creatingChannels, setCreatingChannels] = useState(false);
  const [flagBusyGameId, setFlagBusyGameId] = useState<string | null>(null);

  function load() {
    recApi
      .getAdvanceWeekGames(guildId)
      .then((res) => {
        setData(res);
        setNextWeekNumber(String(res.currentWeek + 1));
        setNextSeasonStage(res.currentStage);
        recApi.listGotwPollsForWeek({ guildId, weekNumber: res.currentWeek }).then((r) => setGotwPolls(r.polls)).catch(() => setGotwPolls([]));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }

  useEffect(load, [guildId]);

  const emptyEntry: GameEntry = { outcome: "", homeScore: "", awayScore: "" };

  function setEntry(gameId: string, patch: Partial<GameEntry>) {
    setEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  async function handleAdvance() {
    if (!data) return;
    setAdvancing(true);
    setError(null);
    setNotice(null);
    const results: AdvanceResultInput[] = data.gamesNeedingInput.flatMap((g): AdvanceResultInput[] => {
      const entry = entries[g.gameId];
      if (!entry?.outcome) return [];
      return [{
        gameId: g.gameId,
        outcome: entry.outcome as "home" | "away" | "tie",
        homeScore: entry.homeScore.trim() === "" ? null : Number(entry.homeScore),
        awayScore: entry.awayScore.trim() === "" ? null : Number(entry.awayScore),
      }];
    });
    try {
      const result = await recApi.completeAdvanceWeek({
        guildId,
        nextWeekNumber: Number(nextWeekNumber),
        nextSeasonStage,
        results,
      });
      const relay = result.discord;
      setNotice(`Advanced to Week ${nextWeekNumber} (${nextSeasonStage}). GOTW settled, EOS payouts checked, and the Weekly Submissions panel refreshed.${relay ? ` Discord announcement ${relay.announcementPosted ? "posted" : "not posted"}${relay.error ? ` (${relay.error})` : ""}.` : ""}`);
      setEntries({});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance.");
    } finally {
      setAdvancing(false);
    }
  }

  function loadDivisions() {
    recApi
      .getDivisionWinnerOptions(guildId)
      .then(setDivisions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load division winner options."));
  }

  async function handleSaveWinners() {
    if (!divisions) return;
    setSavingWinners(true);
    setError(null);
    const selected = Object.entries(winners).filter(([, teamId]) => teamId);
    try {
      await recApi.saveDivisionWinners({
        guildId,
        seasonNumber: divisions.league.seasonNumber,
        winners: selected.map(([divisionKey, teamId]) => ({ divisionKey, teamId })),
      });
      setNotice("Division winners saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save division winners.");
    } finally {
      setSavingWinners(false);
    }
  }

  async function handleSaveTime() {
    setSavingTime(true);
    setError(null);
    try {
      await recApi.setNextAdvanceTime({ guildId, ...advanceDate });
      setNotice("Next advance time saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the next advance time.");
    } finally {
      setSavingTime(false);
    }
  }

  async function handleAssignGotw() {
    if (!data || !gotwGameId) return;
    const target = data.games.find((g) => g.gameId === gotwGameId);
    if (!target) return;
    setAssigningGotw(true);
    setError(null);
    try {
      await recApi.assignGotwPoll({
        guildId,
        gameId: target.gameId,
        awayTeamId: target.awayTeamId!,
        homeTeamId: target.homeTeamId!,
        awayUserId: target.awayUserId,
        homeUserId: target.homeUserId,
        awayTeamName: target.awayTeamName,
        homeTeamName: target.homeTeamName,
        weekNumber: data.currentWeek,
      });
      setNotice(`Game of the Week assigned: ${target.awayTeamName} @ ${target.homeTeamName}. Voting is live on the Hub.`);
      setGotwGameId("");
      recApi.listGotwPollsForWeek({ guildId, weekNumber: data.currentWeek }).then((r) => setGotwPolls(r.polls)).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign Game of the Week.");
    } finally {
      setAssigningGotw(false);
    }
  }

  async function handleCreateGameChannels() {
    setCreatingChannels(true);
    setError(null);
    try {
      const result = await recApi.createGameChannelsForCurrentWeek(guildId);
      setNotice(`Created ${result.created.length} game channel${result.created.length === 1 ? "" : "s"} (replaced ${result.deleted} from last week).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game channels.");
    } finally {
      setCreatingChannels(false);
    }
  }

  async function handlePostseasonFlag(gameId: string, patch: { isBowlGame?: boolean; isNationalChampionship?: boolean }) {
    if (!data) return;
    const target = data.games.find((g) => g.gameId === gameId);
    if (!target) return;
    setFlagBusyGameId(gameId);
    setError(null);
    try {
      await recApi.setGamePostseasonFlags({
        guildId,
        gameId,
        isBowlGame: patch.isBowlGame ?? target.isBowlGame,
        isNationalChampionship: patch.isNationalChampionship ?? target.isNationalChampionship,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save postseason flags.");
    } finally {
      setFlagBusyGameId(null);
    }
  }

  if (error && !data) return <div><PageHeader title="Advance" subtitle="Weekly league advance." /><ErrorState message={error} /></div>;
  if (!data) return <LoadingState />;

  const pollByGameId = new Map((gotwPolls ?? []).map((p) => [p.game_id, p]));
  const isPostseasonWeek = data.currentStage !== "regular_season";
  const h2hGames = data.games.filter((g) => g.isH2h);

  return (
    <div>
      <PageHeader title="Advance" subtitle={`${data.league.name} — Week ${data.currentWeek}, ${data.currentStage.replace(/_/g, " ")}`} />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>This Week's Games</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {data.games.map((g) => {
            const entry = entries[g.gameId];
            return (
              <div key={g.gameId} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
                  <span>{g.awayTeamName} @ {g.homeTeamName}</span>
                  {!g.needsInput && <Badge status="approved">{g.existingResultSource ?? "Has result"}</Badge>}
                  {g.needsInput && <Badge status="pending">Needs input</Badge>}
                  {pollByGameId.has(g.gameId) && <Badge status="info">GOTW</Badge>}
                  {g.isBowlGame && <Badge status="info">Bowl Game</Badge>}
                  {g.isNationalChampionship && <Badge status="info">National Championship</Badge>}
                </div>
                {g.needsInput && (
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
                    <select className="form-select" style={{ width: "auto" }} value={entry?.outcome ?? ""} onChange={(e) => setEntry(g.gameId, { outcome: e.target.value as GameEntry["outcome"] })}>
                      <option value="">Outcome…</option>
                      <option value="home">{g.homeTeamName} Win</option>
                      <option value="away">{g.awayTeamName} Win</option>
                      <option value="tie">Tie</option>
                    </select>
                    <input className="form-input" style={{ width: 90 }} type="number" placeholder="Home" value={entry?.homeScore ?? ""} onChange={(e) => setEntry(g.gameId, { homeScore: e.target.value })} />
                    <input className="form-input" style={{ width: 90 }} type="number" placeholder="Away" value={entry?.awayScore ?? ""} onChange={(e) => setEntry(g.gameId, { awayScore: e.target.value })} />
                  </div>
                )}
                {isCfb && isPostseasonWeek && g.isH2h && (
                  <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", fontSize: "var(--text-sm)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                      <input type="checkbox" disabled={flagBusyGameId === g.gameId} checked={g.isBowlGame} onChange={(e) => handlePostseasonFlag(g.gameId, { isBowlGame: e.target.checked })} />
                      Bowl Game
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                      <input type="checkbox" disabled={flagBusyGameId === g.gameId} checked={g.isNationalChampionship} onChange={(e) => handlePostseasonFlag(g.gameId, { isNationalChampionship: e.target.checked })} />
                      National Championship
                    </label>
                    <span className="form-hint" style={{ margin: 0 }}>Bowl games and the national championship are automatic Game of the Week matchups.</span>
                  </div>
                )}
              </div>
            );
          })}
          {!data.games.length && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No games scheduled for this week.</p>}
        </div>

        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="next-week">Next Week</label>
            <input id="next-week" className="form-input" type="number" min={0} max={30} value={nextWeekNumber} onChange={(e) => setNextWeekNumber(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="next-stage">Next Season Stage</label>
            <select id="next-stage" className="form-select" value={nextSeasonStage} onChange={(e) => setNextSeasonStage(e.target.value)}>
              {SEASON_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: "var(--space-4)" }}>
          <Button variant="tactical" onClick={handleAdvance} disabled={advancing || !nextWeekNumber}>
            {advancing ? "Advancing…" : "Complete Advance"}
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Game of the Week</h2>
        <p className="form-hint">Assign this week's GOTW matchup — voting and closing happen on the Hub matchup page.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          {(gotwPolls ?? []).map((poll) => (
            <div key={poll.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span>{poll.away_team_name} @ {poll.home_team_name}</span>
              <Badge status={poll.status === "settled" ? "approved" : poll.status === "closed" ? "info" : "pending"}>{poll.status}</Badge>
            </div>
          ))}
          {!(gotwPolls ?? []).length && <p style={{ margin: 0, color: "var(--text-secondary)" }}>No GOTW assigned this week yet.</p>}
        </div>
        {h2hGames.length > 0 && (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <select className="form-select" style={{ width: "auto", minWidth: 220 }} value={gotwGameId} onChange={(e) => setGotwGameId(e.target.value)}>
              <option value="">Select a game…</option>
              {h2hGames.filter((g) => !pollByGameId.has(g.gameId)).map((g) => <option key={g.gameId} value={g.gameId}>{g.awayTeamName} @ {g.homeTeamName}</option>)}
            </select>
            <Button variant="primary" disabled={!gotwGameId || assigningGotw} onClick={handleAssignGotw}>
              {assigningGotw ? "Assigning…" : "Assign GOTW"}
            </Button>
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Game Channels</h2>
        <p className="form-hint">Creates a Discord channel for each current-week H2H matchup, replacing last week's tracked channels.</p>
        <Button variant="secondary" disabled={creatingChannels} onClick={handleCreateGameChannels}>
          {creatingChannels ? "Creating…" : "Create Game Channels"}
        </Button>
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Division Winners</h2>
        {!divisions && <Button variant="secondary" onClick={loadDivisions}>Load Division Winners</Button>}
        {divisions && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              {divisions.divisions.map((d) => (
                <div key={d.key} className="form-field" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor={`div-${d.key}`}>{d.label}</label>
                  <select id={`div-${d.key}`} className="form-select" value={winners[d.key] ?? ""} onChange={(e) => setWinners((prev) => ({ ...prev, [d.key]: e.target.value }))}>
                    <option value="">—</option>
                    {d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <Button variant="primary" onClick={handleSaveWinners} disabled={savingWinners}>
              {savingWinners ? "Saving…" : "Save Division Winners"}
            </Button>
          </>
        )}
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Set Next Advance Time</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          {(["year", "month", "day", "hour", "minute"] as const).map((field) => (
            <div key={field} className="form-field" style={{ marginBottom: 0, width: 100 }}>
              <label className="form-label" htmlFor={`adv-${field}`}>{field}</label>
              <input id={`adv-${field}`} className="form-input" type="number" value={advanceDate[field]} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, [field]: Number(e.target.value) }))} />
            </div>
          ))}
          <div className="form-field" style={{ marginBottom: 0, width: 100 }}>
            <label className="form-label" htmlFor="adv-tz">Timezone</label>
            <select id="adv-tz" className="form-select" value={advanceDate.tzLabel} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, tzLabel: e.target.value }))}>
              {TZ_LABELS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <Button variant="primary" onClick={handleSaveTime} disabled={savingTime}>
          {savingTime ? "Saving…" : "Save Advance Time"}
        </Button>
      </Card>
    </div>
  );
}
