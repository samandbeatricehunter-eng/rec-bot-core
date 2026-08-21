import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import type { EosAwardVotingPoll, EosBallotSessionInfo } from "../../types/api.js";

// One-award-at-a-time ballot flow (spec §14): "Award X of N", auto-save per pick (unchanged —
// still castEosAwardVote on each click), Previous/Next/Skip navigation, and a Review Ballot
// screen before Submit. Session progress/resume comes from rec_eos_ballot_sessions; abstaining
// on a category is allowed — submission doesn't require every award to have a pick.
export function EosAwardVotingBlock() {
  const { guildId, discordId } = useReadyAuth();
  const [polls, setPolls] = useState<EosAwardVotingPoll[] | null>(null);
  const [session, setSession] = useState<EosBallotSessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftVotes, setDraftVotes] = useState<Record<string, string>>({});

  function reload(resumeFromSession = false) {
    Promise.all([
      recApi.getEosAwardVotingBlock({ guildId, discordId }),
      recApi.getEosBallotSession({ guildId, discordId }),
    ])
      .then(([voteBlock, sessionInfo]) => {
        setPolls(voteBlock.polls);
        setSession(sessionInfo);
        if (resumeFromSession && sessionInfo?.lastPollId) {
          const resumeIndex = voteBlock.polls.findIndex((p) => p.id === sessionInfo.lastPollId);
          if (resumeIndex >= 0) setIndex(resumeIndex);
        }
      })
      .catch(() => {
        setPolls([]);
        setSession(null);
      });
  }

  useEffect(() => reload(true), [guildId, discordId]);

  if (!polls || !polls.length) return null;

  const votedCount = polls.filter((p) => p.myVote != null).length;
  const isSubmitted = session?.status === "submitted";
  const needsAttention = !isSubmitted && votedCount < polls.length;
  const current = polls[Math.min(index, polls.length - 1)];

  function goTo(nextIndex: number) {
    const clamped = Math.max(0, Math.min(polls!.length - 1, nextIndex));
    setIndex(clamped);
    setReviewing(false);
    void recApi.advanceEosBallotSession({ guildId, discordId, pollId: polls![clamped].id }).catch(() => undefined);
  }

  async function vote(nomineeUserId: string) {
    setBusy(true);
    setError(null);
    try {
      await recApi.castEosAwardVote({ guildId, discordId, pollId: current.id, nomineeUserId });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cast vote.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBallot() {
    setBusy(true);
    setError(null);
    try {
      await recApi.submitEosBallot({ guildId, discordId });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit ballot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="hub-eos-vote-block" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <span className={needsAttention ? "hub-eos-vote-flash" : ""}>
          {isSubmitted ? "End-of-Season Awards — Ballot Submitted" : needsAttention ? "Vote Now: End-of-Season Awards" : "End-of-Season Awards Voting"}
        </span>
        <span className="hub-eos-vote-count">{votedCount}/{polls.length} awards picked</span>
      </summary>
      <div className="hub-eos-vote-body">
        {error && <p className="hub-schedule-missing">{error}</p>}

        {reviewing ? (
          <div className="hub-eos-ballot-review">
            <h4>Review Ballot</h4>
            <ul className="hub-eos-ballot-review-list">
              {polls.map((poll, i) => (
                <li key={poll.id}>
                  <button type="button" className="hub-eos-ballot-review-row" onClick={() => goTo(i)}>
                    <span>{poll.categoryLabel}</span>
                    <span>{poll.nominees.find((n) => n.userId === poll.myVote)?.teamName ?? "No selection"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hub-eos-ballot-actions">
              <Button variant="secondary" onClick={() => setReviewing(false)}>Back to Ballot</Button>
              <Button variant="primary" disabled={busy || isSubmitted} onClick={() => void submitBallot()}>
                {isSubmitted ? "Submitted" : busy ? "Submitting…" : "Submit Ballot"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="hub-eos-ballot-header">
              <span>Award {index + 1} of {polls.length}</span>
            </div>
            <article className="hub-eos-vote-card">
              <div className="hub-eos-vote-header"><h4>{current.categoryLabel}</h4><span>${current.amount}</span></div>
              <label className="form-field"><span className="form-label">Select a nominee</span><select className="form-input" value={draftVotes[current.id] ?? current.myVote ?? ""} disabled={busy || isSubmitted} onChange={(event) => setDraftVotes((values) => ({ ...values, [current.id]: event.target.value }))}><option value="">Choose a user-controlled team</option>{current.nominees.map((nominee) => <option key={nominee.userId} value={nominee.userId}>{nominee.teamName}{nominee.displayName ? ` — ${nominee.displayName}` : ""} · {nominee.detail}</option>)}</select></label>
              <Button variant="primary" disabled={busy || isSubmitted || !(draftVotes[current.id] ?? current.myVote)} onClick={() => void vote(draftVotes[current.id] ?? current.myVote!)}>{current.myVote ? "Update Vote" : "Submit Vote"}</Button>
            </article>
            <div className="hub-eos-ballot-actions">
              <Button variant="ghost" disabled={index === 0} onClick={() => goTo(index - 1)}>Previous Award</Button>
              {index < polls.length - 1 ? (
                <Button variant="secondary" onClick={() => goTo(index + 1)}>{current.myVote ? "Next Award" : "Skip / Abstain"}</Button>
              ) : null}
              <Button variant="primary" onClick={() => setReviewing(true)}>Review Ballot</Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
