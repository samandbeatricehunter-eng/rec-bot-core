import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { CommissionerPoll } from "../../types/api.js";

// Site-first surface for Media-page Commissioner Polls — previously Discord-native-poll-only
// with zero presence on the site. Same collapsed-card pattern as PublicPollsBlock/
// EosAwardVotingBlock, mounted alongside them on Campus Buzz. Discord (if a voting-polls
// channel is configured) only gets an informational mirror; voting here is what counts.
export function CommissionerPollsVotingBlock() {
  const { guildId } = useReadyAuth();
  const [polls, setPolls] = useState<CommissionerPoll[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busyPollId, setBusyPollId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    recApi.listCommissionerPolls({ guildId }).then((res) => setPolls(res.polls)).catch(() => setPolls([]));
  }

  useEffect(reload, [guildId]);

  if (!polls || !polls.length) return null;

  const openPolls = polls.filter((p) => p.status === "open");
  const needsAttention = openPolls.some((p) => !p.hasVoted);

  async function vote(pollId: string, optionId: number) {
    setBusyPollId(pollId);
    setError(null);
    try {
      await recApi.voteOnCommissionerPoll({ guildId, pollId, optionId });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record your vote.");
    } finally {
      setBusyPollId(null);
    }
  }

  return (
    <details className="hub-eos-vote-block" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <span className={needsAttention ? "hub-eos-vote-flash" : ""}>{needsAttention ? "Vote Now: Commissioner Polls" : "Commissioner Polls"}</span>
        <span className="hub-eos-vote-count">{openPolls.length} open</span>
      </summary>
      <div className="hub-eos-vote-body">
        {error && <p className="hub-schedule-missing">{error}</p>}
        {polls.map((poll) => (
          <article key={poll.id} className="hub-eos-vote-card">
            <div className="hub-eos-vote-header">
              <h4>{poll.question}</h4>
              {poll.status !== "open" && <span>{poll.status === "closed" ? "Closed" : "Cancelled"}</span>}
            </div>
            <div className="hub-eos-vote-nominees">
              {poll.tally.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={poll.myVoteOptionId === option.id ? "active" : ""}
                  disabled={busyPollId === poll.id || poll.status !== "open"}
                  onClick={() => void vote(poll.id, option.id)}
                >
                  <span>{option.text}</span>
                  <strong>{option.votes} vote{option.votes === 1 ? "" : "s"}</strong>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
