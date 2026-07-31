import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatChannelType, ChatMessageRow } from "@rec/shared";
import { recApi } from "./rec-api-client.js";
import { toChatMessageRow } from "./chat-utils.js";

const POLL_INTERVAL_MS = 5000;

async function fetchChannelMessages(guildId: string, channelType: ChatChannelType, channelId: string) {
  if (channelType === "league") return recApi.listLeagueChatMessages({ guildId });
  if (channelType === "game") return recApi.listGameChatMessages({ guildId, gameChannelId: channelId });
  return recApi.listChatMessages({ guildId });
}

async function sendChannelMessage(guildId: string, channelType: ChatChannelType, channelId: string, body: string) {
  if (channelType === "league") return recApi.postLeagueChatMessage({ guildId, body });
  if (channelType === "game") return recApi.postGameChatMessage({ guildId, gameChannelId: channelId, body });
  return recApi.postChatMessage({ guildId, body });
}

/** Per-channel polling (same proven 5s + in-flight-guard pattern as LeagueChatPanel/
 * CommissionerChatHome) for whichever channel is currently selected in the drawer.
 * `onLatestMessageId` fires only when the newest message id actually changes, so callers can
 * drive mark-channel-read without writing on every poll tick. */
export function useChatChannel(input: {
  guildId: string;
  channelType: ChatChannelType | null;
  channelId: string | null;
  onLatestMessageId?: (id: string) => void;
}) {
  const { guildId, channelType, channelId, onLatestMessageId } = input;
  const active = Boolean(channelType && channelId);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollInFlightRef = useRef(false);
  const lastSeenIdRef = useRef<string | null>(null);
  const onLatestMessageIdRef = useRef(onLatestMessageId);
  onLatestMessageIdRef.current = onLatestMessageId;

  const fetchMessages = useCallback(() => {
    if (!active || !channelType || !channelId) return;
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    fetchChannelMessages(guildId, channelType, channelId)
      .then((res) => {
        const rows = res.messages.map((m) => toChatMessageRow(m as unknown as Record<string, unknown>));
        setMessages(rows);
        const latest = rows[rows.length - 1];
        if (latest && latest.id !== lastSeenIdRef.current) {
          lastSeenIdRef.current = latest.id;
          onLatestMessageIdRef.current?.(latest.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chat."))
      .finally(() => {
        pollInFlightRef.current = false;
        setLoading(false);
      });
  }, [active, guildId, channelType, channelId]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setLoading(active);
    lastSeenIdRef.current = null;
    if (!active) return;
    fetchMessages();
    const interval = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, channelType, channelId]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!active || !channelType || !channelId) return;
      setSending(true);
      setError(null);
      try {
        const res = await sendChannelMessage(guildId, channelType, channelId, body);
        const row = toChatMessageRow(res.message as unknown as Record<string, unknown>);
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        fetchMessages();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send message.");
        throw err;
      } finally {
        setSending(false);
      }
    },
    [active, guildId, channelType, channelId, fetchMessages],
  );

  return { messages, sendMessage, loading, sending, error };
}
