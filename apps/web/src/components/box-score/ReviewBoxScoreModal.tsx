import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import type { BoxScoreSubmissionDetail } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";
import { LoadingState } from "../ui/LoadingState.js";

function labelForStat(key: string) {
  const abbreviations: Record<string, string> = { off: "Offensive", tds: "TDs", fgs: "FGs" };
  return key.split("_").map((part) => abbreviations[part] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

export function ReviewBoxScoreModal({ submissionId, onClose, onResolved }: {
  submissionId: string;
  onClose: () => void;
  onResolved: (action: "approve" | "deny") => void;
}) {
  const [submission, setSubmission] = useState<BoxScoreSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [team1Score, setTeam1Score] = useState("");
  const [team2Score, setTeam2Score] = useState("");
  const [team1Quarters, setTeam1Quarters] = useState("");
  const [team2Quarters, setTeam2Quarters] = useState("");
  const [stats, setStats] = useState<Record<string, { team1: string; team2: string }>>({});

  function hydrate(row: BoxScoreSubmissionDetail) {
    setSubmission(row);
    const team1IsHome = Boolean(row.team1_id && row.home_team_id && row.team1_id === row.home_team_id);
    setTeam1Score(String((team1IsHome ? row.home_score : row.away_score) ?? ""));
    setTeam2Score(String((team1IsHome ? row.away_score : row.home_score) ?? ""));
    setTeam1Quarters((row.quarter_scores?.team1 ?? []).join(", "));
    setTeam2Quarters((row.quarter_scores?.team2 ?? []).join(", "));
    setStats(Object.fromEntries(Object.entries(row.team_stats ?? {}).map(([key, value]) => [key, {
      team1: String(value?.team1 ?? ""), team2: String(value?.team2 ?? ""),
    }])));
  }

  useEffect(() => {
    recApi.getBoxScoreSubmission(submissionId).then(hydrate).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load submission."));
  }, [submissionId]);

  const statKeys = useMemo(() => Object.keys(stats).sort(), [stats]);

  async function handleReview(action: "approve" | "deny") {
    setBusy(true); setError(null);
    try {
      await recApi.reviewBoxScore({ submissionId, action, deniedReason: action === "deny" ? denyReason : undefined });
      window.dispatchEvent(new Event("rec:notifications-changed"));
      onResolved(action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to review submission.");
      setBusy(false);
    }
  }

  async function saveCorrections() {
    setBusy(true); setError(null);
    try {
      await recApi.correctBoxScore({ submissionId, field: "score", team1: team1Score, team2: team2Score });
      await recApi.correctBoxScore({ submissionId, field: "quarters", team1: team1Quarters, team2: team2Quarters });
      for (const key of statKeys) {
        await recApi.correctBoxScore({ submissionId, field: key, team1: stats[key].team1, team2: stats[key].team2 });
      }
      const refreshed = await recApi.getBoxScoreSubmission(submissionId);
      hydrate(refreshed);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save corrections.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Review Box Score" onClose={onClose}>
    {error && <ErrorState message={error} />}
    {!submission && !error && <LoadingState />}
    {submission && <div className="box-score-review">
      <p className="box-score-review__matchup">Week {submission.week_number ?? "?"}: {submission.team1_abbr ?? "Team 1"} vs {submission.team2_abbr ?? "Team 2"}</p>
      {submission.image_storage_url && <a href={submission.image_storage_url} target="_blank" rel="noreferrer">
        <img className="box-score-review__image" src={submission.image_storage_url} alt="Submitted box score screenshot" />
      </a>}
      {(submission.flag_reasons?.length || submission.parse_warnings?.length) ? <div className="box-score-review__warnings">
        {[...(submission.flag_reasons ?? []), ...(submission.parse_warnings ?? [])].map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
      </div> : null}

      <div className="box-score-review__parsed">
        <h3>Parsed Results</h3>
        <div className="box-score-review__grid box-score-review__grid--score">
          <label><span>{submission.team1_abbr ?? "Team 1"} final</span><input className="form-input" disabled={!editing || busy} inputMode="numeric" value={team1Score} onChange={(event) => setTeam1Score(event.target.value)} /></label>
          <label><span>{submission.team2_abbr ?? "Team 2"} final</span><input className="form-input" disabled={!editing || busy} inputMode="numeric" value={team2Score} onChange={(event) => setTeam2Score(event.target.value)} /></label>
          <label><span>{submission.team1_abbr ?? "Team 1"} quarters</span><input className="form-input" disabled={!editing || busy} value={team1Quarters} onChange={(event) => setTeam1Quarters(event.target.value)} /></label>
          <label><span>{submission.team2_abbr ?? "Team 2"} quarters</span><input className="form-input" disabled={!editing || busy} value={team2Quarters} onChange={(event) => setTeam2Quarters(event.target.value)} /></label>
        </div>
        {statKeys.length > 0 && <div className="box-score-review__stats">
          <div className="box-score-review__stat-head"><span>Field</span><span>{submission.team1_abbr ?? "Team 1"}</span><span>{submission.team2_abbr ?? "Team 2"}</span></div>
          {statKeys.map((key) => <div className="box-score-review__stat-row" key={key}>
            <span>{labelForStat(key)}</span>
            <input className="form-input" disabled={!editing || busy} value={stats[key].team1} onChange={(event) => setStats((current) => ({ ...current, [key]: { ...current[key], team1: event.target.value } }))} />
            <input className="form-input" disabled={!editing || busy} value={stats[key].team2} onChange={(event) => setStats((current) => ({ ...current, [key]: { ...current[key], team2: event.target.value } }))} />
          </div>)}
        </div>}
      </div>

      <div className="box-score-review__actions">
        {editing ? <>
          <Button variant="primary" onClick={saveCorrections} disabled={busy}>{busy ? "Saving…" : "Save Corrections"}</Button>
          <Button variant="secondary" onClick={() => { hydrate(submission); setEditing(false); }} disabled={busy}>Cancel</Button>
        </> : <>
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>Correct Fields</Button>
          <Button variant="primary" onClick={() => handleReview("approve")} disabled={busy}>Approve & Issue Payout</Button>
          <Button variant="danger" onClick={() => setShowDenyInput(true)} disabled={busy}>Deny</Button>
        </>}
      </div>
      {showDenyInput && !editing && <div className="form-field box-score-review__deny">
        <label className="form-label" htmlFor="deny-reason">Reason sent to the submitter by DM</label>
        <textarea id="deny-reason" className="form-input" rows={3} placeholder="Explain what needs to be corrected" value={denyReason} onChange={(event) => setDenyReason(event.target.value)} />
        <Button variant="danger" onClick={() => handleReview("deny")} disabled={busy || !denyReason.trim()}>Deny & Send Reason</Button>
      </div>}
    </div>}
  </Modal>;
}
