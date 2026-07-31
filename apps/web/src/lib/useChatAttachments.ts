import { useCallback, useEffect, useState } from "react";
import type { ChatChannelType } from "@rec/shared";
import type { ChatAttachment } from "../types/api.js";
import { recApi } from "./rec-api-client.js";

const POLL_INTERVAL_MS = 5000;

/** Same shape as useChatReactions — polled alongside the message feed, keyed by messageId. */
export function useChatAttachments(input: { guildId: string; channelType: ChatChannelType | null; messageIds: string[] }) {
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, ChatAttachment[]>>({});
  const messageIdsKey = input.messageIds.join(",");

  const fetchAttachments = useCallback(() => {
    if (!input.channelType || !input.messageIds.length) {
      setAttachmentsByMessage({});
      return;
    }
    recApi
      .listChatAttachments({ guildId: input.guildId, channelType: input.channelType, messageIds: input.messageIds })
      .then((res) => {
        const grouped: Record<string, ChatAttachment[]> = {};
        for (const a of res.attachments) {
          const list = grouped[a.messageId] ?? [];
          list.push(a);
          grouped[a.messageId] = list;
        }
        setAttachmentsByMessage(grouped);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.guildId, input.channelType, messageIdsKey]);

  useEffect(() => {
    fetchAttachments();
    const interval = setInterval(fetchAttachments, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAttachments]);

  return { attachmentsByMessage, refetch: fetchAttachments };
}
