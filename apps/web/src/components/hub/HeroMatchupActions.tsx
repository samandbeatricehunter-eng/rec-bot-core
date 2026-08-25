import { useEffect, useState } from "react";
import { BarChart3, ClipboardList, Film, LifeBuoy, Share2 } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubMatchupGame } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { AvailabilityModal } from "./AvailabilityModal.js";
import { ProposeTimeModal } from "../matchups/ProposeTimeModal.js";

type CantMakeOptions = { canGrantForceWin: boolean; canRequestFairSim: boolean };
type SchedulingSnapshot = Awaited<ReturnType<typeof recApi.getSchedulingMatchupStatus>>;

export function HeroMatchupActions({
  guildId,
  matchup,
  boxScoreMode,
  onChanged,
  onOpenBoxScore,
  onOpenPlayerStats,
  onOpenShareStream,
  onUploadHighlight,
  onOpenRequestHelp,
}: {
  guildId: string;
  matchup: HubMatchupGame;
  boxScoreMode: boolean;
  onChanged: () => void;
  onOpenBoxScore?: () => void;
  onOpenPlayerStats?: () => void;
  onOpenShareStream?: () => void;
  onUploadHighlight?: () => void;
  onOpenRequestHelp?: () => void;
}) {
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [cantMakeOpen, setCantMakeOpen] = useState(false);
  const [cantMakeOptions, setCantMakeOptions] = useState<CantMakeOptions | null>(null);
  const [violationOpen, setViolationOpen] = useState(false);
  const [violationKind, setViolationKind] = useState<"rule" | "dashing">("rule");
  const [violationDescription, setViolationDescription] = useState("");
  const [completedOpen, setCompletedOpen] = useState(false);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<SchedulingSnapshot | null>(null);

  const isH2h = matchup.matchupType === "h2h";
  const schedulingInactiveReason = isH2h
    ? undefined
    : "Scheduling and Force Win aren't available for bye weeks, the offseason, or CPU matchups.";
  const myPendingProposal = scheduling?.pendingProposal?.proposedByMe ? scheduling.pendingProposal : null;

  useEffect(() => {
    if (!isH2h) return;
    let cancelled = false;
    recApi.getSchedulingMatchupStatus({ guildId, gameId: matchup.gameId })
      .then((result) => { if (!cancelled) setScheduling(result); })
      .catch(() => { if (!cancelled) setScheduling(null); });
    return () => { cancelled = true; };
  }, [guildId, matchup.gameId, isH2h]);

  function actionSucceeded(message: string) {
    setNotice(message);
    setError(null);
    onChanged();
    if (isH2h) recApi.getSchedulingMatchupStatus({ guildId, gameId: matchup.gameId }).then(setScheduling).catch(() => undefined);
  }

  async function cancelProposal() {
    if (!myPendingProposal) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.respondToSchedulingProposal({ guildId, gameId: matchup.gameId, proposalId: myPendingProposal.id, action: "withdraw" });
      actionSucceeded("Proposal canceled. Discord and the site were updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't cancel the proposal.");
    } finally {
      setBusy(false);
    }
  }

  function openCantMake() {
    setCantMakeOpen(true);
    setCantMakeOptions(null);
    setError(null);
    recApi.getSchedulingCantMakeGameOptions({ guildId, gameId: matchup.gameId })
      .then(setCantMakeOptions)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't load the available options."));
  }

  async function submitCantMake(choice: "grant_fw" | "request_fs") {
    setBusy(true);
    setError(null);
    try {
      await recApi.markSchedulingCantMakeGame({ guildId, gameId: matchup.gameId, choice });
      setCantMakeOpen(false);
      actionSucceeded(choice === "grant_fw"
        ? "You conceded the Force Win to your opponent. Commissioners were notified."
        : "Your opponent was asked to choose Fair Sim or AutoPilot.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update the game.");
    } finally {
      setBusy(false);
    }
  }

  async function submitViolation() {
    if (violationKind === "rule" && !violationDescription.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (violationKind === "dashing") {
        await recApi.reportSchedulingDashing({ guildId, gameId: matchup.gameId });
      } else {
        await recApi.reportSchedulingViolation({ guildId, gameId: matchup.gameId, description: violationDescription.trim() });
      }
      setViolationOpen(false);
      setViolationDescription("");
      actionSucceeded(violationKind === "dashing"
        ? "Dashing was reported to the commissioner team."
        : "Your violation report was submitted to the commissioner team.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't submit the report.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCompleted() {
    const parsedHome = homeScore.trim() ? Number(homeScore) : undefined;
    const parsedAway = awayScore.trim() ? Number(awayScore) : undefined;
    if ((parsedHome != null && (!Number.isInteger(parsedHome) || parsedHome < 0)) ||
        (parsedAway != null && (!Number.isInteger(parsedAway) || parsedAway < 0))) {
      setError("Scores must be whole numbers of zero or more.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.markGameOver({ guildId, gameId: matchup.gameId, homeScore: parsedHome, awayScore: parsedAway });
      setCompletedOpen(false);
      setHomeScore("");
      setAwayScore("");
      actionSucceeded("Game marked completed. The Discord announcement and site status were updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't mark the game completed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="hub-hero-action-area">
      <div className="hub-hero-action-pills" role="group" aria-label="Your matchup actions">
        <button type="button" disabled={!isH2h} title={schedulingInactiveReason} onClick={() => setAvailabilityOpen(true)}>Set Availability</button>
        {isH2h && <>
          {myPendingProposal ? <>
            <button type="button" onClick={() => setProposeOpen(true)}>Edit Proposal</button>
            <button type="button" disabled={busy} onClick={() => void cancelProposal()}>Cancel Proposal</button>
          </> : <button type="button" onClick={() => setProposeOpen(true)}>{scheduling?.pendingProposal ? "Counter Proposal" : "Propose Time"}</button>}
          <button type="button" onClick={openCantMake}>Can't Make Game</button>
          <button type="button" onClick={() => { setViolationOpen(true); setError(null); }}>Report Violation</button>
          <button type="button" disabled={matchup.isFinal} onClick={() => { setCompletedOpen(true); setError(null); }}>Game Completed</button>
        </>}
      </div>
      {matchup.involvesMe && <div className="matchup-actions hub-hero-game-actions" role="group" aria-label="Game tools">
        {boxScoreMode && <button type="button" className="matchup-action" disabled={!onOpenBoxScore || matchup.isFinal || Boolean(matchup.boxScoreSubmissionId)} onClick={onOpenBoxScore}><ClipboardList size={16} /> Box Score</button>}
        {boxScoreMode && <button type="button" className="matchup-action" disabled={!onOpenPlayerStats || !matchup.boxScoreSubmissionId || matchup.boxScoreStatus === "denied"} onClick={onOpenPlayerStats}><BarChart3 size={16} /> Player Stats</button>}
        <button type="button" className="matchup-action" disabled={!onOpenShareStream} onClick={onOpenShareStream}><Share2 size={16} /> Share Stream</button>
        <button type="button" className="matchup-action" disabled={!onUploadHighlight} onClick={onUploadHighlight}><Film size={16} /> Upload Highlight(s)</button>
        <button type="button" className="matchup-action" disabled={!isH2h || !onOpenRequestHelp} title={schedulingInactiveReason} onClick={onOpenRequestHelp}><LifeBuoy size={16} /> Request Help</button>
      </div>}
      {notice && <p className="hub-hero-action-notice">{notice}</p>}
      {error && !cantMakeOpen && !violationOpen && !completedOpen && <p className="hub-transfer-status">{error}</p>}
    </div>

    {availabilityOpen && <AvailabilityModal guildId={guildId} onClose={() => { setAvailabilityOpen(false); onChanged(); }} />}
    {proposeOpen && <ProposeTimeModal guildId={guildId} gameId={matchup.gameId} title={myPendingProposal ? "Edit Proposal" : scheduling?.pendingProposal ? "Counter Proposal" : "Propose Time"} onClose={() => setProposeOpen(false)} onDone={(message) => { setProposeOpen(false); actionSucceeded(message); }} />}

    {cantMakeOpen && <Modal title="Can't Make Game" onClose={() => setCantMakeOpen(false)}>
      <div className="hub-hero-action-modal">
        <p>You can't make this game before the deadline. How would you like to proceed?</p>
        {error && <p className="hub-transfer-status">{error}</p>}
        {!cantMakeOptions ? <p className="hub-muted">Loading available options…</p> : <div className="hub-hero-action-modal-buttons">
          {cantMakeOptions.canGrantForceWin && <Button variant="danger" disabled={busy} onClick={() => void submitCantMake("grant_fw")}>Grant Force Win to Opponent</Button>}
          {cantMakeOptions.canRequestFairSim && <Button variant="primary" disabled={busy} onClick={() => void submitCantMake("request_fs")}>Request Fair Sim</Button>}
          {!cantMakeOptions.canGrantForceWin && !cantMakeOptions.canRequestFairSim && <p className="hub-muted">Neither Force Win nor Fair Sim is enabled for this stage. Contact a commissioner.</p>}
        </div>}
      </div>
    </Modal>}

    {violationOpen && <Modal title="Report Violation" onClose={() => setViolationOpen(false)}>
      <div className="hub-hero-action-modal">
        <div className="hub-funds-switcher" role="tablist" aria-label="Violation type">
          <button type="button" className={violationKind === "rule" ? "active" : ""} onClick={() => setViolationKind("rule")}>Rule Violation</button>
          <button type="button" className={violationKind === "dashing" ? "active" : ""} onClick={() => setViolationKind("dashing")}>Opponent Dashed</button>
        </div>
        {violationKind === "rule" ? <label className="form-field">
          <span className="form-label">What rule did they violate?</span>
          <textarea className="form-input" rows={4} maxLength={500} value={violationDescription} onChange={(event) => setViolationDescription(event.target.value)} placeholder="Describe what happened" />
        </label> : <p>Report that your opponent quit before halftime instead of conceding.</p>}
        {error && <p className="hub-transfer-status">{error}</p>}
        <Button variant={violationKind === "dashing" ? "danger" : "primary"} disabled={busy || (violationKind === "rule" && !violationDescription.trim())} onClick={() => void submitViolation()}>{busy ? "Submitting…" : "Submit Report"}</Button>
      </div>
    </Modal>}

    {completedOpen && <Modal title="Game Completed" onClose={() => setCompletedOpen(false)}>
      <div className="hub-hero-action-modal">
        <p>Mark this game over. Scores are optional and can still be verified through the normal box-score workflow.</p>
        <div className="hub-hero-score-inputs">
          <label className="form-field"><span className="form-label">{matchup.awayTeamName} score</span><input className="form-input" type="number" min="0" step="1" value={awayScore} onChange={(event) => setAwayScore(event.target.value)} /></label>
          <label className="form-field"><span className="form-label">{matchup.homeTeamName} score</span><input className="form-input" type="number" min="0" step="1" value={homeScore} onChange={(event) => setHomeScore(event.target.value)} /></label>
        </div>
        {error && <p className="hub-transfer-status">{error}</p>}
        <Button variant="primary" disabled={busy} onClick={() => void submitCompleted()}>{busy ? "Updating…" : "Mark Game Completed"}</Button>
      </div>
    </Modal>}
  </>;
}
