import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { AdvanceGame, AdvanceResultInput, AdvanceWeekGames, GotwCandidate, GotwPollStatus } from "../../../types/api.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { Modal } from "../../../components/ui/Modal.js";

const TZ_LABELS = ["EST", "CST", "MST", "PST", "AKST"];
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

// Scores-only entry: the outcome is always derived from the two final scores (the score
// always reflects the result), so there is no separate winner/tie selector.
type GameEntry = { awayScore: string; homeScore: string };
type AdvanceTimeDraft = { date: string; hour: string; minute: string; meridiem: "AM" | "PM"; tzLabel: string };

function titleCaseStage(stage: string) {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deriveOutcome(awayScore: string, homeScore: string): "home" | "away" | "tie" | null {
  const away = Number(awayScore);
  const home = Number(homeScore);
  if (awayScore.trim() === "" || homeScore.trim() === "" || Number.isNaN(away) || Number.isNaN(home)) return null;
  return home > away ? "home" : away > home ? "away" : "tie";
}

// Any game with at least one linked human requires a final score before advancing.
function involvesHuman(g: AdvanceGame): boolean {
  return Boolean(g.homeUserId || g.awayUserId);
}

function entryHasScores(entry?: GameEntry): boolean {
  return Boolean(entry && deriveOutcome(entry.awayScore, entry.homeScore) !== null);
}

function localTzLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === "America/New_York") return "EST";
  if (zone === "America/Chicago") return "CST";
  if (zone === "America/Denver" || zone === "America/Phoenix") return "MST";
  if (zone === "America/Los_Angeles") return "PST";
  if (zone === "America/Anchorage") return "AKST";
  return "CST";
}

function blankAdvanceDate(): AdvanceTimeDraft {
  return { date: "", hour: "", minute: "00", meridiem: "PM", tzLabel: localTzLabel() };
}

function toTwentyFourHour(hour: string, meridiem: "AM" | "PM"): number {
  const numericHour = Number(hour);
  if (meridiem === "AM") return numericHour === 12 ? 0 : numericHour;
  return numericHour === 12 ? 12 : numericHour + 12;
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
  const [advanceDate, setAdvanceDate] = useState<AdvanceTimeDraft>(() => blankAdvanceDate());

  const [gotwPolls, setGotwPolls] = useState<GotwPollStatus[] | null>(null);
  const [gotwCandidates, setGotwCandidates] = useState<GotwCandidate[] | null>(null);
  const [gotwGameId, setGotwGameId] = useState("");
  const [assigningGotw, setAssigningGotw] = useState(false);

  const [creatingChannels, setCreatingChannels] = useState(false);
  const [flagBusyGameId, setFlagBusyGameId] = useState<string | null>(null);

  const [jumpTargets, setJumpTargets] = useState<{ currentLabel: string; targets: Array<{ weekNumber: number; seasonStage: string; label: string }> } | null>(null);
  const [jumpTargetKey, setJumpTargetKey] = useState("");
  const [jumpPlan, setJumpPlan] = useState<{ steps: Array<{ weekNumber: number; seasonStage: string; label: string; gamesNeedingInput: AdvanceGame[] }>; targetLabel: string; reachable: boolean } | null>(null);
  const [jumpPlanLoading, setJumpPlanLoading] = useState(false);
  const [jumpEntries, setJumpEntries] = useState<Record<string, GameEntry>>({});
  const [jumpBusy, setJumpBusy] = useState(false);
  const [showJumpModal, setShowJumpModal] = useState(false);

  function loadJumpTargets() {
    recApi.getAdvanceJumpTargets(guildId).then(setJumpTargets).catch(() => setJumpTargets(null));
  }

  useEffect(loadJumpTargets, [guildId]);

  async function loadJumpPlan(key: string) {
    setJumpTargetKey(key);
    setJumpPlan(null);
    setJumpEntries({});
    if (!key) return;
    const [weekNumber, seasonStage] = key.split("::");
    setJumpPlanLoading(true);
    try {
      const plan = await recApi.getAdvanceJumpPlan({ guildId, targetWeekNumber: Number(weekNumber), targetSeasonStage: seasonStage });
      setJumpPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview the advance jump.");
    } finally {
      setJumpPlanLoading(false);
    }
  }

  function setJumpEntry(gameId: string, patch: Partial<GameEntry>) {
    setJumpEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  async function handleConfirmJump() {
    if (!jumpPlan || !jumpTargetKey) return;
    const [weekNumber, seasonStage] = jumpTargetKey.split("::");
    const jumpGames = jumpPlan.steps.flatMap((step) => step.gamesNeedingInput);
    const missing = jumpGames.filter((g) => involvesHuman(g) && !entryHasScores(jumpEntries[g.gameId]));
    if (missing.length) {
      setError(`Enter a final score for all ${missing.length} game${missing.length === 1 ? "" : "s"} involving a human across the skipped weeks before jumping.`);
      return;
    }
    setJumpBusy(true);
    setError(null);
    const results: AdvanceResultInput[] = jumpGames.flatMap((g): AdvanceResultInput[] => {
      const entry = jumpEntries[g.gameId];
      const outcome = entry ? deriveOutcome(entry.awayScore, entry.homeScore) : null;
      if (!outcome || !entry) return [];
      return [{ gameId: g.gameId, outcome, homeScore: Number(entry.homeScore), awayScore: Number(entry.awayScore) }];
    });
    try {
      const result = await recApi.completeAdvanceJump({ guildId, targetWeekNumber: Number(weekNumber), targetSeasonStage: seasonStage, results });
      const relay = result.discord;
      setNotice(`Advanced ${result.steps} week${result.steps === 1 ? "" : "s"} to ${result.landedLabel}.${relay ? ` Discord announcement ${relay.announcementPosted ? "posted" : "not posted"}${relay.error ? ` (${relay.error})` : ""}.` : ""}`);
      setJumpPlan(null);
      setJumpEntries({});
      setJumpTargetKey("");
      setShowJumpModal(false);
      loadJumpTargets();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance jump.");
    } finally {
      setJumpBusy(false);
    }
  }

  function load() {
    recApi
      .getAdvanceWeekGames(guildId)
      .then((res) => {
        setData(res);
        recApi.listGotwPollsForWeek({ guildId, weekNumber: res.currentWeek }).then((r) => setGotwPolls(r.polls)).catch(() => setGotwPolls([]));
        recApi.getGotwCandidates({ guildId, weekNumber: res.currentWeek }).then((r) => {
          setGotwCandidates(r.candidates);
          const recommended = r.candidates.find((c) => c.recommended);
          if (recommended) setGotwGameId((prev) => prev || recommended.gameId);
        }).catch(() => setGotwCandidates([]));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }

  useEffect(load, [guildId]);

  const emptyEntry: GameEntry = { awayScore: "", homeScore: "" };

  function setEntry(gameId: string, patch: Partial<GameEntry>) {
    setEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  function hasAdvanceTimeDraft() {
    return Boolean(advanceDate.date || advanceDate.hour);
  }

  function completeAdvanceTimeDraft() {
    return Boolean(advanceDate.date && advanceDate.hour);
  }

  async function handleAdvance() {
    if (!data) return;
    if (hasAdvanceTimeDraft() && !completeAdvanceTimeDraft()) {
      setError("Fill in the full next advance time, or leave it blank to skip.");
      return;
    }
    const missing = data.gamesNeedingInput.filter((g) => involvesHuman(g) && !entryHasScores(entries[g.gameId]));
    if (missing.length) {
      setError(`Enter a final score for all ${missing.length} remaining game${missing.length === 1 ? "" : "s"} involving a human before advancing.`);
      return;
    }
    setAdvancing(true);
    setError(null);
    setNotice(null);
    const results: AdvanceResultInput[] = data.gamesNeedingInput.flatMap((g): AdvanceResultInput[] => {
      const entry = entries[g.gameId];
      const outcome = entry ? deriveOutcome(entry.awayScore, entry.homeScore) : null;
      if (!outcome || !entry) return [];
      return [{ gameId: g.gameId, outcome, homeScore: Number(entry.homeScore), awayScore: Number(entry.awayScore) }];
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
        const [year, month, day] = advanceDate.date.split("-").map(Number);
        const hour = toTwentyFourHour(advanceDate.hour, advanceDate.meridiem);
        const minute = Number(advanceDate.minute);
        await recApi.setNextAdvanceTime({
          guildId,
          year,
          month,
          day,
          hour,
          minute,
          tzLabel: advanceDate.tzLabel,
        });
      }
      setNotice(`Advanced to ${data.nextLabel}. GOTW settled, EOS payouts checked, and the Weekly Submissions panel refreshed.${relay ? ` Discord announcement ${relay.announcementPosted ? "posted" : "not posted"}${relay.error ? ` (${relay.error})` : ""}.` : ""}`);
      setEntries({});
      setShowAdvanceModal(false);
      setAdvanceDate(blankAdvanceDate());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance.");
    } finally {
      setAdvancing(false);
    }
  }

  async function handleAssignGotw() {
    if (!data || !gotwGameId) return;
    const target = (gotwCandidates ?? []).find((c) => c.gameId === gotwGameId);
    if (!target) return;
    setAssigningGotw(true);
    setError(null);
    try {
      await recApi.assignGotwPoll({
        guildId,
        gameId: target.gameId,
        awayTeamId: target.awayTeamId,
        homeTeamId: target.homeTeamId,
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
  const openCandidates = (gotwCandidates ?? []).filter((c) => !pollByGameId.has(c.gameId));
  const missingScoreGames = data.gamesNeedingInput.filter((g) => involvesHuman(g) && !entryHasScores(entries[g.gameId]));
  const readyToAdvance = missingScoreGames.length === 0;
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
                    <label className="advance-score-field">
                      <span>{g.awayTeamName} <em>Away</em></span>
                      <input className="form-input" type="number" inputMode="numeric" placeholder="Away score" value={entry?.awayScore ?? ""} onChange={(e) => setEntry(g.gameId, { awayScore: e.target.value })} />
                    </label>
                    <label className="advance-score-field">
                      <span>{g.homeTeamName} <em>Home</em></span>
                      <input className="form-input" type="number" inputMode="numeric" placeholder="Home score" value={entry?.homeScore ?? ""} onChange={(e) => setEntry(g.gameId, { homeScore: e.target.value })} />
                    </label>
                    {entryHasScores(entry)
                      ? <span className="advance-derived-outcome">{deriveOutcome(entry!.awayScore, entry!.homeScore) === "tie" ? "Tie" : `${deriveOutcome(entry!.awayScore, entry!.homeScore) === "away" ? g.awayTeamName : g.homeTeamName} win`}</span>
                      : involvesHuman(g) && <span className="advance-score-required">Score required</span>}
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
            {!readyToAdvance && <span className="form-hint">{missingScoreGames.length} game{missingScoreGames.length === 1 ? "" : "s"} involving a human still need a final score.</span>}
          </div>
          <Button variant="tactical" onClick={() => setShowAdvanceModal(true)} disabled={advancing || !readyToAdvance}>
            Complete Advance
          </Button>
        </div>
      </Card>

      <Card className="advance-card">
        <h2>Game of the Week</h2>
        <p className="form-hint">Matchups are ranked by the GOTW nomination score (rivalry, parity, quality, recent form). The recommended game is <strong>bold</strong> at the top — pick it or override. Voting and closing happen on the Hub matchup page.</p>
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
          <select className="form-select advance-gotw-select" value={gotwGameId} onChange={(e) => setGotwGameId(e.target.value)} disabled={!openCandidates.length}>
            <option value="">{gotwCandidates == null ? "Scoring matchups..." : openCandidates.length ? "Select the Game of the Week..." : "No eligible H2H matchups"}</option>
            {openCandidates.map((c) => (
              <option key={c.gameId} value={c.gameId} style={c.recommended ? { fontWeight: 700 } : undefined}>
                {c.recommended ? "★ Recommended — " : ""}{c.awayTeamName} @ {c.homeTeamName} · {c.score}{c.isRivalry ? " · Rivalry" : ""}
              </option>
            ))}
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

      <Card className="advance-card">
        <h2>Jump Ahead</h2>
        <p className="form-hint">Fallen behind? Pick a target week or stage and catch up in one action — every skipped week still runs its normal advance (records, badges, payouts).</p>
        <div className="advance-control-row">
          <select className="form-select" value={jumpTargetKey} onChange={(e) => void loadJumpPlan(e.target.value)} disabled={!jumpTargets?.targets.length}>
            <option value="">{jumpTargets?.targets.length ? "Select a target..." : "Loading targets..."}</option>
            {jumpTargets?.targets.map((t) => <option key={`${t.weekNumber}::${t.seasonStage}`} value={`${t.weekNumber}::${t.seasonStage}`}>{t.label}</option>)}
          </select>
          <Button variant="tactical" disabled={!jumpPlan || !jumpPlan.reachable || jumpPlanLoading} onClick={() => setShowJumpModal(true)}>
            Review Jump
          </Button>
        </div>
        {jumpPlanLoading && <p className="form-hint">Loading skipped weeks...</p>}
        {jumpPlan && !jumpPlan.reachable && <p className="advance-empty">Couldn't plan a path to that target — advance manually instead.</p>}
      </Card>

      {showAdvanceModal && (
        <Modal title="Complete Advance" onClose={() => !advancing && setShowAdvanceModal(false)}>
          <div className="advance-modal-body">
            <div className="advance-modal-target">
              <div>
                <span className="advance-eyebrow">Advancing To</span>
                <strong>{data.nextLabel}</strong>
              </div>
            </div>
            <div className="advance-modal-copy">
              <h3>Next advance time</h3>
              <p className="form-hint">Set the next advance deadline now, or leave date and time blank to skip.</p>
            </div>
            <div className="advance-time-grid">
              <div className="form-field">
                <label className="form-label" htmlFor="adv-date">Date</label>
                <input id="adv-date" className="form-input" type="date" value={advanceDate.date} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, date: e.target.value }))} />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="adv-hour">Time</label>
                <div className="advance-clock-row">
                  <select id="adv-hour" className="form-select" value={advanceDate.hour} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, hour: e.target.value }))}>
                    <option value="">Hour</option>
                    {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                  </select>
                  <select aria-label="Advance minute" className="form-select" value={advanceDate.minute} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, minute: e.target.value }))}>
                    {MINUTE_OPTIONS.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                  </select>
                  <select aria-label="AM or PM" className="form-select" value={advanceDate.meridiem} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, meridiem: e.target.value as AdvanceTimeDraft["meridiem"] }))}>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="adv-tz">Timezone</label>
                <select id="adv-tz" className="form-select" value={advanceDate.tzLabel} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, tzLabel: e.target.value }))}>
                  {TZ_LABELS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div className="advance-modal-actions">
              <Button variant="ghost" onClick={() => setShowAdvanceModal(false)} disabled={advancing}>Cancel</Button>
              <Button variant="tactical" onClick={handleAdvance} disabled={advancing}>{advancing ? "Advancing..." : completeAdvanceTimeDraft() ? "Submit with Time" : "Submit and Skip Time"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {showJumpModal && jumpPlan && (
        <Modal title={`Jump Ahead to ${jumpPlan.targetLabel}`} onClose={() => !jumpBusy && setShowJumpModal(false)}>
          <div className="advance-modal-body">
            <p className="form-hint">Fill in any skipped week's games below — every step still runs its normal advance (records, badges, EOS payouts) in order.</p>
            {jumpPlan.steps.map((step) => (
              <div key={`${step.weekNumber}::${step.seasonStage}`} className="advance-jump-step">
                <h3>{step.label}</h3>
                {step.gamesNeedingInput.length ? step.gamesNeedingInput.map((g) => {
                  const entry = jumpEntries[g.gameId];
                  return (
                    <div key={g.gameId} className="advance-game-row">
                      <div className="advance-game-title"><strong>{g.awayTeamName} @ {g.homeTeamName}</strong></div>
                      <div className="advance-score-entry">
                        <label className="advance-score-field">
                          <span>{g.awayTeamName} <em>Away</em></span>
                          <input className="form-input" type="number" inputMode="numeric" placeholder="Away score" value={entry?.awayScore ?? ""} onChange={(e) => setJumpEntry(g.gameId, { awayScore: e.target.value })} />
                        </label>
                        <label className="advance-score-field">
                          <span>{g.homeTeamName} <em>Home</em></span>
                          <input className="form-input" type="number" inputMode="numeric" placeholder="Home score" value={entry?.homeScore ?? ""} onChange={(e) => setJumpEntry(g.gameId, { homeScore: e.target.value })} />
                        </label>
                        {entryHasScores(entry)
                          ? <span className="advance-derived-outcome">{deriveOutcome(entry!.awayScore, entry!.homeScore) === "tie" ? "Tie" : `${deriveOutcome(entry!.awayScore, entry!.homeScore) === "away" ? g.awayTeamName : g.homeTeamName} win`}</span>
                          : involvesHuman(g) && <span className="advance-score-required">Score required</span>}
                      </div>
                    </div>
                  );
                }) : <p className="advance-empty">No games needing input this step.</p>}
              </div>
            ))}
            <div className="advance-modal-actions">
              <Button variant="ghost" onClick={() => setShowJumpModal(false)} disabled={jumpBusy}>Cancel</Button>
              <Button variant="tactical" onClick={handleConfirmJump} disabled={jumpBusy}>{jumpBusy ? "Advancing..." : `Confirm Jump (${jumpPlan.steps.length} week${jumpPlan.steps.length === 1 ? "" : "s"})`}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
