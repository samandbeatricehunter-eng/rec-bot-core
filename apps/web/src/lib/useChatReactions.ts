import { useCallback, useEffect, useState } from "react";
import type { ChatChannelType } from "@rec/shared";
import { recApi } from "./rec-api-client.js";

const POLL_INTERVAL_MS = 5000;

export type ReactionPill = { emojiKey: string; count: number; mine: boolean };

/** Reactions for whichever message batch is currently rendered, polled alongside the message
 * feed itself. Deliberately separate from useChatChannel — the message list already re-renders
 * on its own 5s cycle; keeping reactions as their own small poll avoids coupling the two. */
export function useChatReactions(input: { guildId: string; channelType: ChatChannelType | null; messageIds: string[] }) {
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, ReactionPill[]>>({});
  const messageIdsKey = input.messageIds.join(",");

  const fetchReactions = useCallback(() => {
    if (!input.channelType || !input.messageIds.length) {
      setReactionsByMessage({});
      return;
    }
    recApi
      .listChatReactions({ guildId: input.guildId, channelType: input.channelType, messageIds: input.messageIds })
      .then((res) => {
        const grouped: Record<string, ReactionPill[]> = {};
        for (const r of res.reactions) {
          const list = grouped[r.messageId] ?? [];
          list.push({ emojiKey: r.emojiKey, count: r.count, mine: r.mine });
          grouped[r.messageId] = list;
        }
        setReactionsByMessage(grouped);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.guildId, input.channelType, messageIdsKey]);

  useEffect(() => {
    fetchReactions();
    const interval = setInterval(fetchReactions, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchReactions]);

  const toggle = useCallback(
    async (messageId: string, emojiKey: string) => {
      if (!input.channelType) return;
      await recApi.toggleChatReaction({ guildId: input.guildId, channelType: input.channelType, messageId, emojiKey });
      fetchReactions();
    },
    [input.guildId, input.channelType, fetchReactions],
  );

  return { reactionsByMessage, toggle };
}
