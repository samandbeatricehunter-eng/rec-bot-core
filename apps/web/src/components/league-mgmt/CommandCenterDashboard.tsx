import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stageLabel } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { AdvanceGame, AdvanceResultInput, AdvanceWeekGames, GotwCandidate, GotwPollStatus } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";
import { Modal } from "../ui/Modal.js";
import { UploadBoxScoreModal } from "../../routes/league-mgmt/manage-league/UploadBoxScoreModal.js";
import { ReviewBoxScoreModal } from "../box-score/ReviewBoxScoreModal.js";
import { HighlightUploadModal } from "../hub/HighlightUploadModal.js";
import { ManageLeagueHome } from "../../routes/league-mgmt/manage-league/ManageLeagueHome.js";
import { PendingItemsPanel } from "../../routes/league-mgmt/notifications/PendingItemsPanel.js";

const TZ_LABELS = ["EST", "CST", "MST", "PST", "AKST"];
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

type GameEntry = { awayScore: string; homeScore: string };
type AdvanceTimeDraft = { date: string; hour: string; minute: string; meridiem: "AM" | "PM"; tzLabel: string };

function deriveOutcome(awayScore: string, homeScore: string): "home" | "away" | "tie" | null {
  const away = Number(awayScore);
  const home = Number(homeScore);
  if (awayScore.trim() === "" || homeScore.trim() === "" || Number.isNaN(away) || Number.isNaN(home)) return null;
  return home > away ? "home" : away > home ? "away" : "tie";
}
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

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`section-heading ${className}`} style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-lg)" }}>{children}</h2>;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon,
}: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        className={`collapsible-header ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {icon && <span style={{ color: "var(--text-secondary)" }}>{icon}</span>}
          {title}
        </span>
        <span
          style={{
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          ▼
        </span>
      </button>
      <div
        className="collapsible-content"
        style={{
          overflow: "hidden",
          maxHeight: open ? "none" : "0",
          opacity: open ? 1 : 0,
          transition: "max-height 0.25s ease, opacity 0.2s ease",
          marginTop: open ? "var(--space-3)" : 0,
        }}
      >
        {open && children}
      </div>
    </Card>
  );
}

// Everything the old standalone Advance page (/league-mgmt/advance) had, minus "Jump Ahead"
// (removed per Samuel's request — catching up several weeks at once wasn't worth the extra
// surface area once this section already fronts the weekly workflow directly). That page and
// its "Advance" League Actions button are gone; this is now the only place to advance a week.
function AdvanceReadinessSection() {
  const { guildId, discordId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const [data, setData] = useState<AdvanceWeekGames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, GameEntry>>({});
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceDate, setAdvanceDate] = useState<AdvanceTimeDraft>(() => blankAdvanceDate());
  const [boxScoreGame, setBoxScoreGame] = useState<AdvanceGame | null>(null);
  const [reviewBoxScoreId, setReviewBoxScoreId] = useState<string | null>(null);
  const [highlightGame, setHighlightGame] = useState<AdvanceGame | null>(null);
  const [nextGotwCandidates, setNextGotwCandidates] = useState<GotwCandidate[] | null>(null);
  const [nextGotwGameId, setNextGotwGameId] = useState("");
  const [gotwPolls, setGotwPolls] = useState<GotwPollStatus[] | null>(null);
  const [notifyBusyGameId, setNotifyBusyGameId] = useState<string | null>(null);

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

  const emptyEntry: GameEntry = { awayScore: "", homeScore: "" };
  function setEntry(gameId: string, patch: Partial<GameEntry>) {
    setEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  async function notify(gameId: string, target: "home" | "away" | "both") {
    setNotifyBusyGameId(gameId);
    setNotice(null);
    try {
      await recApi.notifyMissingBoxScore({ guildId, gameId, target });
      setNotice("Notified.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to notify.");
    } finally {
      setNotifyBusyGameId(null);
    }
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
    if (data.nextSeasonStage === "regular_season" && (nextGotwCandidates?.length ?? 0) > 0 && !nextGotwGameId) {
      setError("Select the Game of the Week for the week you are advancing into.");
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
      const nextAdvance = completeAdvanceTimeDraft()
        ? (() => {
            const [year, month, day] = advanceDate.date.split("-").map(Number);
            return { year, month, day, hour: toTwentyFourHour(advanceDate.hour, advanceDate.meridiem), minute: Number(advanceDate.minute), tzLabel: advanceDate.tzLabel };
          })()
        : null;
      const result = await recApi.completeAdvanceWeek({
        guildId,
        nextWeekNumber: data.nextWeekNumber,
        nextSeasonStage: data.nextSeasonStage,
        results,
        nextGotwGameId: data.nextSeasonStage === "regular_season" ? nextGotwGameId || null : null,
        nextAdvance,
      });
      const relay = result.discord;
      const channels = result.gameChannels;
      setNotice(`Advanced to ${data.nextLabel}. Next advance: ${result.nextAdvanceLabel}. League inbox notifications sent; ${channels?.created.length ?? 0} Discord game channel${channels?.created.length === 1 ? "" : "s"} created.${channels?.error ? ` (${channels.error})` : ""}${relay ? ` Discord announcement ${relay.announcementPosted ? "posted" : "not posted"}${relay.error ? ` (${relay.error})` : ""}.` : ""}`);
      setEntries({});
      setShowAdvanceModal(false);
      setAdvanceDate(blankAdvanceDate());
      setNextGotwCandidates(null);
      setNextGotwGameId("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance.");
    } finally {
      setAdvancing(false);
    }
  }

  async function openAdvanceReview() {
    if (!data) return;
    setError(null);
    setShowAdvanceModal(true);
    if (data.nextSeasonStage !== "regular_season") {
      setNextGotwCandidates([]);
      setNextGotwGameId("");
      return;
    }
    setNextGotwCandidates(null);
    try {
      const result = await recApi.getGotwCandidates({ guildId, weekNumber: data.nextWeekNumber });
      setNextGotwCandidates(result.candidates);
      setNextGotwGameId(result.candidates.find((candidate) => candidate.recommended)?.gameId ?? result.candidates[0]?.gameId ?? "");
    } catch (err) {
      setShowAdvanceModal(false);
      setError(err instanceof Error ? err.message : "Failed to load next week's GOTW choices.");
    }
  }

  if (error && !data) return <Card><ErrorState message={error} /></Card>;
  if (!data) return <Card><SectionHeading>Advance Readiness</SectionHeading><LoadingState /></Card>;

  const pollByGameId = new Map((gotwPolls ?? []).map((p) => [p.game_id, p]));
  const missingScoreGames = data.gamesNeedingInput.filter((g) => involvesHuman(g) && !entryHasScores(entries[g.gameId]));
  const readyToAdvance = missingScoreGames.length === 0;

  return (
    <Card className="advance-card advance-card-primary">
      <div className="advance-card-heading">
        <SectionHeading>Advance Readiness</SectionHeading>
        <Badge status={data.games.length ? "info" : "pending"}>{data.games.length ? `${data.games.length} game${data.games.length === 1 ? "" : "s"}` : "No games"}</Badge>
      </div>
      {notice && <p className="advance-notice">{notice}</p>}
      {error && <ErrorState message={error} />}

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
              <div className="advance-game-actions">
                <Button variant="secondary" onClick={() => setBoxScoreGame(g)}>Submit Box Score</Button>
                <Button variant="ghost" onClick={() => setHighlightGame(g)}>Upload Highlight</Button>
                {g.needsInput && g.isH2h && (
                  <>
                    <Button variant="secondary" size="compact" disabled={notifyBusyGameId === g.gameId} onClick={() => void notify(g.gameId, "home")}>Notify Home</Button>
                    <Button variant="secondary" size="compact" disabled={notifyBusyGameId === g.gameId} onClick={() => void notify(g.gameId, "away")}>Notify Away</Button>
                    <Button variant="secondary" size="compact" disabled={notifyBusyGameId === g.gameId} onClick={() => void notify(g.gameId, "both")}>Notify Both</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!data.games.length && <p className="advance-empty">No games scheduled for this week.</p>}
      </div>

      <div className="advance-target-panel">
        <div>
          <span className="advance-eyebrow">Next Advance</span>
          <strong className={readyToAdvance ? "advance-ready-label" : "advance-not-ready-label"}>{data.nextLabel}</strong>
          {!readyToAdvance && <span className="form-hint">{missingScoreGames.length} game{missingScoreGames.length === 1 ? "" : "s"} involving a human still need a final score.</span>}
        </div>
        <Button variant="tactical" onClick={() => void openAdvanceReview()} disabled={advancing || !readyToAdvance}>
          Complete Advance
        </Button>
      </div>

      <div className="advance-card advance-legacy-manual-control" style={{ marginTop: "var(--space-4)" }}>
        <h2>Game of the Week</h2>
        <p className="form-hint">Matchups are ranked by the GOTW nomination score (rivalry, parity, quality, recent form). Voting and closing happen on the Hub matchup page.</p>
        <div className="advance-stack">
          {(gotwPolls ?? []).map((poll) => (
            <div key={poll.id} className="advance-inline-row">
              <span>{poll.away_team_name} @ {poll.home_team_name}</span>
              <Badge status={poll.status === "settled" ? "approved" : poll.status === "closed" ? "info" : "pending"}>{poll.status}</Badge>
            </div>
          ))}
          {!(gotwPolls ?? []).length && <p className="advance-empty">No GOTW assigned this week yet.</p>}
        </div>
      </div>

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
              <h3>Game of the Week</h3>
              {data.nextSeasonStage !== "regular_season"
                ? <p className="form-hint">Every postseason H2H matchup is automatically assigned as a Game of the Week.</p>
                : nextGotwCandidates == null
                  ? <p className="form-hint">Loading eligible next-week H2H matchups…</p>
                  : nextGotwCandidates.length
                    ? (
                      <select className="form-select" value={nextGotwGameId} onChange={(event) => setNextGotwGameId(event.target.value)}>
                        <option value="">Select a matchup…</option>
                        {nextGotwCandidates.map((candidate) => (
                          <option key={candidate.gameId} value={candidate.gameId}>
                            {candidate.recommended ? "Recommended — " : ""}{candidate.awayTeamName} @ {candidate.homeTeamName}
                          </option>
                        ))}
                      </select>
                    )
                    : <p className="form-hint">No eligible H2H matchup is scheduled, so this step is skipped.</p>}
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
      {boxScoreGame && (
        <UploadBoxScoreModal
          guildId={guildId}
          discordId={discordId}
          weekNumber={boxScoreGame.weekNumber}
          seasonNumber={data.seasonNumber}
          gameId={boxScoreGame.gameId}
          commissionerSubmission
          onClose={() => setBoxScoreGame(null)}
          onSubmitted={(submissionId) => {
            setBoxScoreGame(null);
            setReviewBoxScoreId(submissionId);
          }}
        />
      )}
      {reviewBoxScoreId && (
        <ReviewBoxScoreModal
          submissionId={reviewBoxScoreId}
          onClose={() => setReviewBoxScoreId(null)}
          onResolved={() => {
            setReviewBoxScoreId(null);
            load();
          }}
        />
      )}
      {highlightGame && (
        <HighlightUploadModal
          guildId={guildId}
          gameId={highlightGame.gameId}
          onClose={() => setHighlightGame(null)}
          onSubmitted={() => {
            setHighlightGame(null);
            setNotice("Highlight uploaded and queued for the league reel.");
          }}
        />
      )}
    </Card>
  );
}

// Manage League used to be a Link straight to its own routed page; it's now an inline
// collapsible so the whole team list + header actions (including Settings and Media, moved
// here from the old League Actions button row) live directly on the Command Center. Clicking
// into a specific team still navigates away normally (ManageLeagueHome's own useNavigate calls
// are unaffected by where the component happens to be mounted).
function ManageLeagueSection() {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const [currentStageLabel, setCurrentStageLabel] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getAdvanceWeekGames(guildId)
      .then((data) => setCurrentStageLabel(stageLabel(data.currentStage, data.currentWeek, game)))
      .catch(() => setCurrentStageLabel(null));
  }, [guildId, game]);

  return (
    <CollapsibleSection
      title={<span>Manage League{currentStageLabel ? ` — ${currentStageLabel}` : ""}</span>}
      icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
    >
      <ManageLeagueHome />
    </CollapsibleSection>
  );
}

// Urgency-ordered Commissioner Command Center dashboard:
// Advance Readiness → Manage League (collapsible) → Awaiting Review
export function CommandCenterDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <AdvanceReadinessSection />
      <ManageLeagueSection />
      <Card>
        <SectionHeading>Awaiting Review</SectionHeading>
        <PendingItemsPanel />
      </Card>
    </div>
  );
}
