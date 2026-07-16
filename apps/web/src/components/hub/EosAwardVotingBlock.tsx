import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import type { EosAwardVotingPoll } from "../../types/api.js";

// Collapsed by default, above the headlines feed — flashes shut only once every open
// poll has this coach's vote. Disappears entirely once the league advances out of the
// first offseason stage (the API just stops returning open polls at that point).
export function EosAwardVotingBlock() {
  const { guildId, discordId } = useReadyAuth();
  const [polls, setPolls] = useState<EosAwardVotingPoll[] | null>(null);
  const [hasVotedAll, setHasVotedAll] = useState(true);
  const [open, setOpen] = useState(false);
  const [busyPollId, setBusyPollId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    recApi.getEosAwardVotingBlock({ guildId, discordId })
      .then((res) => { setPolls(res.polls); setHasVotedAll(res.hasVotedAll); })
      .catch(() => { setPolls([]); setHasVotedAll(true); });
  }

  useEffect(reload, [guildId, discordId]);

  if (!polls || !polls.length) return null;

  async function vote(pollId: string, nomineeUserId: string) {
    setBusyPollId(pollId);
    setError(null);
    try {
      await recApi.castEosAwardVote({ guildId, discordId, pollId, nomineeUserId });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cast vote.");
    } finally {
      setBusyPollId(null);
    }
  }

  return (
    <details className="hub-eos-vote-block" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <span className={hasVotedAll ? "" : "hub-eos-vote-flash"}>
          {hasVotedAll ? "End-of-Season Awards Voting" : "Vote Now: End-of-Season Awards"}
        </span>
        <span className="hub-eos-vote-count">{polls.length} award{polls.length === 1 ? "" : "s"} open</span>
      </summary>
      <div className="hub-eos-vote-body">
        {error && <p className="hub-schedule-missing">{error}</p>}
        {polls.map((poll) => (
          <article key={poll.id} className="hub-eos-vote-card">
            <div className="hub-eos-vote-header"><h4>{poll.categoryLabel}</h4><span>${poll.amount}</span></div>
            <div className="hub-eos-vote-nominees">
              {poll.nominees.map((nominee) => (
                <button
                  type="button"
                  key={nominee.userId}
                  className={poll.myVote === nominee.userId ? "active" : ""}
                  disabled={busyPollId === poll.id}
                  onClick={() => void vote(poll.id, nominee.userId)}
                >
                  <span>{nominee.teamName}{nominee.displayName ? ` — ${nominee.displayName}` : ""}</span>
                  <small>{nominee.record} · {nominee.detail}</small>
                  <strong>{nominee.votes} vote{nominee.votes === 1 ? "" : "s"}</strong>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
