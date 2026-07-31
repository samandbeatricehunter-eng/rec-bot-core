import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { PublicPoll } from "../../types/api.js";

// League-audience polls (spec §13) — general community polls/rule votes a commissioner opens
// to the whole league, distinct from the co_commissioner-only Commissioner Chat topics. Same
// collapsed-card pattern as EosAwardVotingBlock, mounted alongside it on Campus Buzz.
export function PublicPollsBlock() {
  const { guildId, discordId } = useReadyAuth();
  const [polls, setPolls] = useState<PublicPoll[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busyPollId, setBusyPollId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    recApi.listPublicPolls({ guildId, discordId }).then((res) => setPolls(res.polls)).catch(() => setPolls([]));
  }

  useEffect(reload, [guildId, discordId]);

  if (!polls || !polls.length) return null;

  const openPolls = polls.filter((p) => p.status === "open");
  const needsAttention = openPolls.some((p) => p.myVoteOptionIndex == null);

  async function vote(pollId: string, optionIndex: number) {
    setBusyPollId(pollId);
    setError(null);
    try {
      await recApi.voteOnPublicPoll({ guildId, topicId: pollId, optionIndex });
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
        <span className={needsAttention ? "hub-eos-vote-flash" : ""}>{needsAttention ? "Vote Now: League Polls" : "League Polls"}</span>
        <span className="hub-eos-vote-count">{openPolls.length} open</span>
      </summary>
      <div className="hub-eos-vote-body">
        {error && <p className="hub-schedule-missing">{error}</p>}
        {polls.map((poll) => (
          <article key={poll.id} className="hub-eos-vote-card">
            <div className="hub-eos-vote-header">
              <h4>{poll.title}</h4>
              {poll.status === "closed" && <span>Closed</span>}
            </div>
            {poll.description && <p style={{ margin: "0 0 var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{poll.description}</p>}
            <div className="hub-eos-vote-nominees">
              {poll.options.map((option, index) => (
                <button
                  type="button"
                  key={option}
                  className={poll.myVoteOptionIndex === index ? "active" : ""}
                  disabled={busyPollId === poll.id || poll.status !== "open"}
                  onClick={() => void vote(poll.id, index)}
                >
                  <span>{option}</span>
                  <strong>{poll.tally[index] ?? 0} vote{(poll.tally[index] ?? 0) === 1 ? "" : "s"}</strong>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
