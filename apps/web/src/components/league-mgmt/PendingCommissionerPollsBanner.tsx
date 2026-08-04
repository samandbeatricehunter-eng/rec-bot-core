import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { ChatTopic } from "../../types/api.js";

// Persists on the League Mgmt landing page until the viewing commissioner/co-commissioner
// has voted — a commissioner-only poll otherwise only surfaces inside the Commissioner's
// Office chat tab, which is easy to miss.
export function PendingCommissionerPollsBanner() {
  const { guildId, discordId } = useReadyAuth();
  const [topics, setTopics] = useState<ChatTopic[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    recApi.listChatTopics(guildId).then((r) => setTopics(r.topics)).catch(() => undefined);
  }
  useEffect(load, [guildId]);

  const pending = (topics ?? []).filter(
    (t) => (t.audience ?? "commissioners") === "commissioners" && t.status === "open" && !t.voters.some((v) => v.voterDiscordId === discordId),
  );
  if (!pending.length) return null;

  async function vote(topicId: string, optionIndex: number) {
    setBusy(topicId);
    try {
      await recApi.voteOnChatTopic({ guildId, topicId, optionIndex });
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="league-mgmt-poll-banner">
      {pending.map((topic) => (
        <div key={topic.id} className="league-mgmt-poll-banner-card">
          <p className="league-mgmt-poll-banner-title">🗳️ Commissioner poll awaiting your vote: <strong>{topic.title}</strong></p>
          <div className="league-mgmt-poll-banner-options">
            {topic.options.map((option, index) => (
              <button
                key={index}
                type="button"
                className="btn btn-secondary btn-compact"
                disabled={busy === topic.id}
                onClick={() => void vote(topic.id, index)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
