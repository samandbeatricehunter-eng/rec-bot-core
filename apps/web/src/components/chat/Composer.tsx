import { useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { ChatChannelType } from "@rec/shared";
import { mentionQueryFromDraft, insertMentionToken } from "../../lib/chat-utils.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";

type PendingAttachment = { storageKey: string; url: string; mimeType: string; filename: string | null; sizeBytes: number };

export function Composer({
  onSend,
  sending,
  mentionOptions,
  placeholder = "Message… (@ to mention someone)",
  replyTo,
  onCancelReply,
  guildId,
  channelType,
}: {
  /** May return the sent message's id so a pending attachment can be linked to it afterward —
   * omit the return value entirely if the caller doesn't need attachment support. */
  onSend: (body: string) => Promise<{ id: string } | void> | { id: string } | void;
  sending: boolean;
  mentionOptions: Array<{ token: string; label: string }>;
  placeholder?: string;
  /** Purely visual — the actual reply-to id is threaded through onSend's closure by the
   * caller, not through this prop, so Composer's onSend signature never has to change. */
  replyTo?: { preview: string } | null;
  onCancelReply?: () => void;
  /** Attachments are opt-in: pass both to enable the paperclip button, omit either to skip it
   * entirely (kept optional so every existing caller works unchanged). */
  guildId?: string;
  channelType?: ChatChannelType;
}) {
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsEnabled = Boolean(guildId && channelType);

  const mentionQuery = useMemo(() => mentionQueryFromDraft(draft), [draft]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionOptions.filter((opt) => opt.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionOptions]);

  function insertMention(token: string) {
    setDraft((prev) => insertMentionToken(prev, token));
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file || !guildId) return;
    setAttachError(null);
    setUploading(true);
    try {
      const res = await recApi.uploadChatAttachment(guildId, file);
      setPendingAttachment(res);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Failed to upload file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    try {
      const result = await onSend(body);
      if (result && "id" in result && pendingAttachment && guildId && channelType) {
        await recApi
          .attachChatFile({ guildId, channelType, messageId: result.id, ...pendingAttachment })
          .catch(() => undefined);
      }
      setDraft("");
      setPendingAttachment(null);
    } catch {
      // Caller is responsible for surfacing its own error state — swallow here so a failed
      // send doesn't produce an unhandled rejection, while still leaving the draft in place.
    }
  }

  return (
    <div className="commissioner-chat-composer">
      {replyTo && (
        <div className="chat-reply-preview">
          <span>Replying to: {replyTo.preview}</span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply">
            ×
          </button>
        </div>
      )}
      {attachError && <p className="hub-transfer-status">{attachError}</p>}
      {pendingAttachment && (
        <div className="chat-attachment-preview">
          <img src={pendingAttachment.url} alt="" />
          <span>{pendingAttachment.filename ?? "attachment"}</span>
          <button type="button" onClick={() => setPendingAttachment(null)} aria-label="Remove attachment">
            <X size={14} />
          </button>
        </div>
      )}
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
        {attachmentsEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => void handleFileSelected(e.target.files?.[0])}
            />
            <button
              type="button"
              className="chat-attach-btn"
              disabled={uploading || sending}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach image"
            >
              <Paperclip size={16} />
            </button>
          </>
        )}
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
        <Button variant="primary" onClick={() => void handleSend()} disabled={sending || uploading || !draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
