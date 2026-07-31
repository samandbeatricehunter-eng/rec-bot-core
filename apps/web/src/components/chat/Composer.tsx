import { useMemo, useState } from "react";
import { mentionQueryFromDraft, insertMentionToken } from "../../lib/chat-utils.js";
import { Button } from "../ui/Button.js";

export function Composer({
  onSend,
  sending,
  mentionOptions,
  placeholder = "Message… (@ to mention someone)",
}: {
  onSend: (body: string) => Promise<void> | void;
  sending: boolean;
  mentionOptions: Array<{ token: string; label: string }>;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const mentionQuery = useMemo(() => mentionQueryFromDraft(draft), [draft]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionOptions.filter((opt) => opt.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionOptions]);

  function insertMention(token: string) {
    setDraft((prev) => insertMentionToken(prev, token));
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    await onSend(body);
    setDraft("");
  }

  return (
    <div className="commissioner-chat-composer">
      {mentionMatches.length > 0 && (
        <div
          className="card"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            right: 0,
            marginBottom: "var(--space-1)",
            padding: "var(--space-1)",
            maxHeight: 180,
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          {mentionMatches.map((opt) => (
            <button
              key={opt.token}
              className="btn btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
              onClick={() => insertMention(opt.token)}
            >
              @{opt.label}
            </button>
          ))}
        </div>
      )}
      <div className="commissioner-chat-input-row">
        <input
          className="form-input"
          placeholder={placeholder}
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button variant="primary" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
