import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { AdvanceResultInput, AdvanceWeekGames, GotwPollStatus } from "../../../types/api.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { Modal } from "../../../components/ui/Modal.js";

const TZ_LABELS = ["EST", "CST", "PST", "AKST"];

type GameEntry = { outcome: "home" | "away" | "tie" | ""; homeScore: string; awayScore: string };
type AdvanceTimeDraft = { year: string; month: string; day: string; hour: string; minute: string; tzLabel: string };

function titleCaseStage(stage: string) {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AdvanceHome() {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const isCfb = game === "cfb_27";
  const [data, setData] = useState<AdvanceWeekGames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, GameEntry>>({});
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceDate, setAdvanceDate] = useState<AdvanceTimeDraft>({ year: "", month: "", day: "", hour: "", minute: "", tzLabel: "EST" });

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
        recApi.listGotwPollsForWeek({ guildId, weekNumber: res.currentWeek }).then((r) => setGotwPolls(r.polls)).catch(() => setGotwPolls([]));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }

  useEffect(load, [guildId]);

  const emptyEntry: GameEntry = { outcome: "", homeScore: "", awayScore: "" };

  function setEntry(gameId: string, patch: Partial<GameEntry>) {
    setEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  function hasAdvanceTimeDraft() {
    return Boolean(advanceDate.year || advanceDate.month || advanceDate.day || advanceDate.hour || advanceDate.minute);
  }

  function completeAdvanceTimeDraft() {
    return Boolean(advanceDate.year && advanceDate.month && advanceDate.day && advanceDate.hour && advanceDate.minute);
  }

  async function handleAdvance() {
    if (!data) return;
    if (hasAdvanceTimeDraft() && !completeAdvanceTimeDraft()) {
      setError("Fill in the full next advance time, or leave it blank to skip.");
      return;
    }
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
        nextWeekNumber: data.nextWeekNumber,
        nextSeasonStage: data.nextSeasonStage,
        results,
      });
      const relay = result.discord;
      if (completeAdvanceTimeDraft()) {
        await recApi.setNextAdvanceTime({
          guildId,
          year: Number(advanceDate.year),
          month: Number(advanceDate.month),
          day: Number(advanceDate.day),
          hour: Number(advanceDate.hour),
          minute: Number(advanceDate.minute),
          tzLabel: advanceDate.tzLabel,
        });
      }
      setNotice(`Advanced to ${data.nextLabel}. GOTW settled, EOS payouts checked, and the Weekly Submissions panel refreshed.${relay ? ` Discord announcement ${relay.announcementPosted ? "posted" : "not posted"}${relay.error ? ` (${relay.error})` : ""}.` : ""}`);
      setEntries({});
      setShowAdvanceModal(false);
      setAdvanceDate({ year: "", month: "", day: "", hour: "", minute: "", tzLabel: "EST" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance.");
    } finally {
      setAdvancing(false);
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
  const currentLabel = data.currentStage === "regular_season" ? `Week ${data.currentWeek}` : titleCaseStage(data.currentStage);

  return (
    <div className="advance-page">
      <PageHeader title="Advance" subtitle={`${data.league.name} - ${currentLabel}`} />
      {notice && <p className="advance-notice">{notice}</p>}
      {error && <ErrorState message={error} />}

      <Card className="advance-card advance-card-primary">
        <div className="advance-card-heading">
          <div>
            <span className="advance-eyebrow">Current Slate</span>
            <h2>This Week's Games</h2>
          </div>
          <Badge status={data.games.length ? "info" : "pending"}>{data.games.length ? `${data.games.length} game${data.games.length === 1 ? "" : "s"}` : "No games"}</Badge>
        </div>

        <div className="advance-game-list">
          {data.games.map((g) => {
            const entry = entries[g.gameId];
            return (
              <div key={g.gameId} className="advance-game-row">
                <div className="advance-game-title">
                  <strong>{g.awayTeamName} @ {g.homeTeamName}</strong>
                  {!g.needsInput && <Badge status="approved">{g.existingResultSource ?? "Has result"}</Badge>}
                  {g.needsInput && <Badge status="pending">Needs input</Badge>}
                  {pollByGameId.has(g.gameId) && <Badge status="info">GOTW</Badge>}
                  {g.isBowlGame && <Badge status="info">Bowl Game</Badge>}
                  {g.isNationalChampionship && <Badge status="info">National Championship</Badge>}
                </div>
                {g.needsInput && (
                  <div className="advance-score-entry">
                    <select className="form-select" value={entry?.outcome ?? ""} onChange={(e) => setEntry(g.gameId, { outcome: e.target.value as GameEntry["outcome"] })}>
                      <option value="">Outcome...</option>
                      <option value="home">{g.homeTeamName} Win</option>
                      <option value="away">{g.awayTeamName} Win</option>
                      <option value="tie">Tie</option>
                    </select>
                    <input className="form-input" type="number" placeholder="Home" value={entry?.homeScore ?? ""} onChange={(e) => setEntry(g.gameId, { homeScore: e.target.value })} />
                    <input className="form-input" type="number" placeholder="Away" value={entry?.awayScore ?? ""} onChange={(e) => setEntry(g.gameId, { awayScore: e.target.value })} />
                  </div>
                )}
                {isCfb && isPostseasonWeek && g.isH2h && (
                  <div className="advance-flag-row">
                    <label>
                      <input type="checkbox" disabled={flagBusyGameId === g.gameId} checked={g.isBowlGame} onChange={(e) => handlePostseasonFlag(g.gameId, { isBowlGame: e.target.checked })} />
                      Bowl Game
                    </label>
                    <label>
                      <input type="checkbox" disabled={flagBusyGameId === g.gameId} checked={g.isNationalChampionship} onChange={(e) => handlePostseasonFlag(g.gameId, { isNationalChampionship: e.target.checked })} />
                      National Championship
                    </label>
                    <span className="form-hint">Bowl games and the national championship are automatic Game of the Week matchups.</span>
                  </div>
                )}
              </div>
            );
          })}
          {!data.games.length && <p className="advance-empty">No games scheduled for this week.</p>}
        </div>

        <div className="advance-target-panel">
          <div>
            <span className="advance-eyebrow">Next Advance</span>
            <strong>{data.nextLabel}</strong>
          </div>
          <Button variant="tactical" onClick={() => setShowAdvanceModal(true)} disabled={advancing}>
            Complete Advance
          </Button>
        </div>
      </Card>

      <Card className="advance-card">
        <h2>Game of the Week</h2>
        <p className="form-hint">Assign this week's GOTW matchup. Voting and closing happen on the Hub matchup page.</p>
        <div className="advance-stack">
          {(gotwPolls ?? []).map((poll) => (
            <div key={poll.id} className="advance-inline-row">
              <span>{poll.away_team_name} @ {poll.home_team_name}</span>
              <Badge status={poll.status === "settled" ? "approved" : poll.status === "closed" ? "info" : "pending"}>{poll.status}</Badge>
            </div>
          ))}
          {!(gotwPolls ?? []).length && <p className="advance-empty">No GOTW assigned this week yet.</p>}
        </div>
        <div className="advance-control-row">
          <select className="form-select" value={gotwGameId} onChange={(e) => setGotwGameId(e.target.value)} disabled={!h2hGames.length}>
            <option value="">{h2hGames.length ? "Select an H2H game..." : "No H2H games this week"}</option>
            {h2hGames.filter((g) => !pollByGameId.has(g.gameId)).map((g) => <option key={g.gameId} value={g.gameId}>{g.awayTeamName} @ {g.homeTeamName}</option>)}
          </select>
          <Button variant="primary" disabled={!gotwGameId || assigningGotw} onClick={handleAssignGotw}>
            {assigningGotw ? "Assigning..." : "Assign GOTW"}
          </Button>
        </div>
      </Card>

      <Card className="advance-card">
        <h2>Game Channels</h2>
        <p className="form-hint">Creates a Discord channel for each current-week H2H matchup, replacing last week's tracked channels.</p>
        <Button variant="secondary" disabled={creatingChannels} onClick={handleCreateGameChannels}>
          {creatingChannels ? "Creating..." : "Create Game Channels"}
        </Button>
      </Card>

      {showAdvanceModal && (
        <Modal title="Complete Advance" onClose={() => !advancing && setShowAdvanceModal(false)}>
          <div className="advance-modal-body">
            <div className="advance-modal-target">
              <span className="advance-eyebrow">Advancing To</span>
              <strong>{data.nextLabel}</strong>
            </div>
            <p className="form-hint">Set the next advance time now, or leave these fields blank to skip it.</p>
            <div className="advance-time-grid">
              {(["year", "month", "day", "hour", "minute"] as const).map((field) => (
                <div key={field} className="form-field">
                  <label className="form-label" htmlFor={`adv-${field}`}>{field}</label>
                  <input id={`adv-${field}`} className="form-input" type="number" value={advanceDate[field]} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, [field]: e.target.value }))} />
                </div>
              ))}
              <div className="form-field">
                <label className="form-label" htmlFor="adv-tz">Timezone</label>
                <select id="adv-tz" className="form-select" value={advanceDate.tzLabel} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, tzLabel: e.target.value }))}>
                  {TZ_LABELS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div className="advance-modal-actions">
              <Button variant="ghost" onClick={() => setShowAdvanceModal(false)} disabled={advancing}>Cancel</Button>
              <Button variant="tactical" onClick={handleAdvance} disabled={advancing}>{advancing ? "Advancing..." : "Submit Advance"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
