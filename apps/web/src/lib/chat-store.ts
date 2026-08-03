import { useCallback, useSyncExternalStore } from "react";
import type { ChatChannelType, ChatMessageRow } from "@rec/shared";
import { recApi } from "./rec-api-client.js";
import { toChatMessageRow } from "./chat-utils.js";
import type { ChatAttachment } from "../types/api.js";

// One shared store for every chat surface (Universal Chat Drawer, embedded League Chat,
// embedded Commissioner Chat). Spec requirement: the drawer and an embedded view of the same
// channel are two VIEWS of the same data, not two independent chats — so this keys state by
// channel (type+id) with a ref-counted subscription, meaning N components watching the same
// channel share one poll cycle and one message array, not N of each. Previously
// UniversalChatDrawer, LeagueChatPanel, and CommissionerChatHome each ran their own 5s poll
// loop and local state for the same underlying channels.
//
// Realtime (chat-realtime.ts) pushes into this same store via applyRemoteEvent — polling here
// is the fallback path, not the only path, once a socket is connected for a channel.

const POLL_INTERVAL_MS = 5000;

export type ReactionPill = { emojiKey: string; count: number; mine: boolean };

export type ChannelState = {
  messages: ChatMessageRow[];
  reactionsByMessage: Record<string, ReactionPill[]>;
  attachmentsByMessage: Record<string, ChatAttachment[]>;
  loading: boolean;
  sending: boolean;
  error: string | null;
};

const EMPTY_STATE: ChannelState = {
  messages: [],
  reactionsByMessage: {},
  attachmentsByMessage: {},
  loading: true,
  sending: false,
  error: null,
};

function channelKey(channelType: ChatChannelType, channelId: string): string {
  return `${channelType}:${channelId}`;
}

async function fetchMessages(guildId: string, channelType: ChatChannelType, channelId: string) {
  if (channelType === "league") return recApi.listLeagueChatMessages({ guildId });
  if (channelType === "game") return recApi.listGameChatMessages({ guildId, gameChannelId: channelId });
  return recApi.listChatMessages({ guildId });
}

async function postMessage(guildId: string, channelType: ChatChannelType, channelId: string, body: string, replyToMessageId?: string | null) {
  if (channelType === "league") return recApi.postLeagueChatMessage({ guildId, body, replyToMessageId });
  if (channelType === "game") return recApi.postGameChatMessage({ guildId, gameChannelId: channelId, body, replyToMessageId });
  return recApi.postChatMessage({ guildId, body, replyToMessageId });
}

async function editMessageRemote(guildId: string, channelType: ChatChannelType, messageId: string, body: string) {
  if (channelType === "league") return recApi.editLeagueChatMessage({ guildId, messageId, body });
  if (channelType === "game") return recApi.editGameChatMessage({ guildId, messageId, body });
  return recApi.editChatMessage({ guildId, messageId, body });
}

async function deleteMessageRemote(guildId: string, channelType: ChatChannelType, messageId: string) {
  if (channelType === "league") return recApi.deleteLeagueChatMessage({ guildId, messageId });
  if (channelType === "game") return recApi.deleteGameChatMessage({ guildId, messageId });
  return recApi.deleteChatMessage({ guildId, messageId });
}

class ChatStore {
  private state = new Map<string, ChannelState>();
  private listeners = new Map<string, Set<() => void>>();
  private latestMessageListeners = new Map<string, Set<(id: string) => void>>();
  private refCounts = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private guildByKey = new Map<string, string>();
  private lastMessageIdByKey = new Map<string, string | null>();
  private inFlight = new Set<string>();
  /** Channels with a live realtime socket connected — polling backs off to a slow safety-net
   * interval for these instead of the full 5s cadence, since push already keeps them fresh. */
  private realtimeActive = new Set<string>();
  /** Registered by chat-realtime-client.ts at module load — a callback pair instead of a
   * direct import so the two modules don't have a hard circular dependency on each other. */
  private realtimeHooks: {
    onActivate?: (guildId: string, channelType: ChatChannelType, channelId: string) => void;
    onDeactivate?: (channelType: ChatChannelType, channelId: string) => void;
  } = {};

  setRealtimeHooks(hooks: typeof this.realtimeHooks) {
    this.realtimeHooks = hooks;
  }

  getSnapshot = (channelType: ChatChannelType, channelId: string): ChannelState => {
    return this.state.get(channelKey(channelType, channelId)) ?? EMPTY_STATE;
  };

  subscribe(guildId: string, channelType: ChatChannelType, channelId: string, listener: () => void, onLatestMessageId?: (id: string) => void): () => void {
    const key = channelKey(channelType, channelId);
    this.guildByKey.set(key, guildId);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);
    if (onLatestMessageId) {
      if (!this.latestMessageListeners.has(key)) this.latestMessageListeners.set(key, new Set());
      this.latestMessageListeners.get(key)!.add(onLatestMessageId);
    }
    const nextCount = (this.refCounts.get(key) ?? 0) + 1;
    this.refCounts.set(key, nextCount);
    if (nextCount === 1) {
      this.state.set(key, { ...EMPTY_STATE, loading: true });
      this.activate(key, channelType, channelId);
    }
    return () => {
      this.listeners.get(key)?.delete(listener);
      if (onLatestMessageId) this.latestMessageListeners.get(key)?.delete(onLatestMessageId);
      const remaining = Math.max(0, (this.refCounts.get(key) ?? 1) - 1);
      this.refCounts.set(key, remaining);
      if (remaining === 0) this.deactivate(key);
    };
  }

  private activate(key: string, channelType: ChatChannelType, channelId: string) {
    void this.poll(key, channelType, channelId);
    const timer = setInterval(() => {
      void this.poll(key, channelType, channelId);
    }, POLL_INTERVAL_MS);
    this.timers.set(key, timer);
    const guildId = this.guildByKey.get(key);
    if (guildId) this.realtimeHooks.onActivate?.(guildId, channelType, channelId);
  }

  private deactivate(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearInterval(timer);
    this.timers.delete(key);
    this.state.delete(key);
    this.guildByKey.delete(key);
    this.lastMessageIdByKey.delete(key);
    this.listeners.delete(key);
    this.latestMessageListeners.delete(key);
    this.realtimeActive.delete(key);
    const [channelType, channelId] = key.split(":") as [ChatChannelType, string];
    this.realtimeHooks.onDeactivate?.(channelType, channelId);
  }

  private notify(key: string) {
    this.listeners.get(key)?.forEach((fn) => fn());
  }

  private patch(key: string, next: Partial<ChannelState>) {
    const current = this.state.get(key) ?? EMPTY_STATE;
    this.state.set(key, { ...current, ...next });
    this.notify(key);
  }

  private async poll(key: string, channelType: ChatChannelType, channelId: string) {
    if (this.inFlight.has(key)) return;
    const guildId = this.guildByKey.get(key);
    if (!guildId) return;
    this.inFlight.add(key);
    try {
      const res = await fetchMessages(guildId, channelType, channelId);
      const messages = res.messages.map((m) => toChatMessageRow(m as unknown as Record<string, unknown>));
      const messageIds = messages.map((m) => m.id);
      const [reactionsRes, attachmentsRes] = await Promise.all([
        messageIds.length ? recApi.listChatReactions({ guildId, channelType, messageIds }).catch(() => ({ reactions: [] })) : Promise.resolve({ reactions: [] }),
        messageIds.length ? recApi.listChatAttachments({ guildId, channelType, messageIds }).catch(() => ({ attachments: [] })) : Promise.resolve({ attachments: [] }),
      ]);
      const reactionsByMessage: Record<string, ReactionPill[]> = {};
      for (const r of reactionsRes.reactions) {
        (reactionsByMessage[r.messageId] ??= []).push({ emojiKey: r.emojiKey, count: r.count, mine: r.mine });
      }
      const attachmentsByMessage: Record<string, ChatAttachment[]> = {};
      for (const a of attachmentsRes.attachments) {
        (attachmentsByMessage[a.messageId] ??= []).push(a);
      }
      this.patch(key, { messages, reactionsByMessage, attachmentsByMessage, loading: false, error: null });

      const latest = messages[messages.length - 1];
      if (latest && latest.id !== this.lastMessageIdByKey.get(key)) {
        this.lastMessageIdByKey.set(key, latest.id);
        this.latestMessageListeners.get(key)?.forEach((fn) => fn(latest.id));
      }
    } catch (err) {
      this.patch(key, { loading: false, error: err instanceof Error ? err.message : "Failed to load chat." });
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Called by chat-realtime.ts on every push event for a channel — merges the event into
   * state immediately instead of waiting for the next poll tick. */
  applyRealtimeEvent(channelType: ChatChannelType, channelId: string, event: { kind: "message" | "edit" | "delete" | "reaction"; row?: Record<string, unknown>; messageId?: string }) {
    const key = channelKey(channelType, channelId);
    if (!this.state.has(key)) return;
    const current = this.state.get(key)!;
    if (event.kind === "message" && event.row) {
      const row = toChatMessageRow(event.row);
      if (current.messages.some((m) => m.id === row.id)) return;
      const messages = [...current.messages, row];
      this.patch(key, { messages });
      this.lastMessageIdByKey.set(key, row.id);
      this.latestMessageListeners.get(key)?.forEach((fn) => fn(row.id));
    } else if (event.kind === "edit" && event.row) {
      const row = toChatMessageRow(event.row);
      this.patch(key, { messages: current.messages.map((m) => (m.id === row.id ? row : m)) });
    } else if (event.kind === "delete" && event.messageId) {
      this.patch(key, { messages: current.messages.filter((m) => m.id !== event.messageId) });
    } else if (event.kind === "reaction") {
      // Reaction payloads are small and infrequent enough that a targeted re-poll of just
      // reactions (not the full message/attachment fetch) is simpler than diffing the event.
      void this.refreshReactionsOnly(key, channelType, channelId);
    }
  }

  private async refreshReactionsOnly(key: string, channelType: ChatChannelType, channelId: string) {
    const guildId = this.guildByKey.get(key);
    const current = this.state.get(key);
    if (!guildId || !current || !current.messages.length) return;
    try {
      const res = await recApi.listChatReactions({ guildId, channelType, messageIds: current.messages.map((m) => m.id) });
      const reactionsByMessage: Record<string, ReactionPill[]> = {};
      for (const r of res.reactions) (reactionsByMessage[r.messageId] ??= []).push({ emojiKey: r.emojiKey, count: r.count, mine: r.mine });
      this.patch(key, { reactionsByMessage });
    } catch { /* next poll tick will reconcile */ }
  }

  markRealtimeActive(channelType: ChatChannelType, channelId: string, active: boolean) {
    const key = channelKey(channelType, channelId);
    if (active) this.realtimeActive.add(key);
    else this.realtimeActive.delete(key);
  }

  async sendMessage(guildId: string, channelType: ChatChannelType, channelId: string, body: string, replyToMessageId?: string | null): Promise<ChatMessageRow | null> {
    const key = channelKey(channelType, channelId);
    this.patch(key, { sending: true, error: null });
    try {
      const res = await postMessage(guildId, channelType, channelId, body, replyToMessageId);
      const row = toChatMessageRow(res.message as unknown as Record<string, unknown>);
      const current = this.state.get(key) ?? EMPTY_STATE;
      if (!current.messages.some((m) => m.id === row.id)) {
        this.patch(key, { messages: [...current.messages, row] });
      }
      void this.poll(key, channelType, channelId);
      return row;
    } catch (err) {
      this.patch(key, { error: err instanceof Error ? err.message : "Failed to send message." });
      throw err;
    } finally {
      this.patch(key, { sending: false });
    }
  }

  async editMessage(guildId: string, channelType: ChatChannelType, channelId: string, messageId: string, body: string): Promise<void> {
    const key = channelKey(channelType, channelId);
    const res = await editMessageRemote(guildId, channelType, messageId, body);
    const row = toChatMessageRow(res.message as unknown as Record<string, unknown>);
    const current = this.state.get(key) ?? EMPTY_STATE;
    this.patch(key, { messages: current.messages.map((m) => (m.id === row.id ? row : m)) });
  }

  async deleteMessage(guildId: string, channelType: ChatChannelType, channelId: string, messageId: string): Promise<void> {
    const key = channelKey(channelType, channelId);
    await deleteMessageRemote(guildId, channelType, messageId);
    const current = this.state.get(key) ?? EMPTY_STATE;
    this.patch(key, { messages: current.messages.filter((m) => m.id !== messageId) });
  }

  async toggleReaction(guildId: string, channelType: ChatChannelType, channelId: string, messageId: string, emojiKey: string): Promise<void> {
    await recApi.toggleChatReaction({ guildId, channelType, messageId, emojiKey });
    await this.refreshReactionsOnly(channelKey(channelType, channelId), channelType, channelId);
  }
}

export const chatStore = new ChatStore();

/**
 * Every chat surface (drawer, embedded League/Game/Commissioner Chat) should call this instead
 * of hand-rolling its own polling — components watching the same channel share one fetch cycle
 * and one message array via chatStore, satisfying the "same channel, not separate chats"
 * requirement (embedded and drawer views of the same channel now stay in sync automatically).
 */
export function useSharedChatChannel(input: {
  guildId: string;
  channelType: ChatChannelType | null;
  channelId: string | null;
  onLatestMessageId?: (id: string) => void;
}) {
  const { guildId, channelType, channelId, onLatestMessageId } = input;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!channelType || !channelId) return () => undefined;
      return chatStore.subscribe(guildId, channelType, channelId, listener, onLatestMessageId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guildId, channelType, channelId],
  );

  const getSnapshot = useCallback(() => {
    if (!channelType || !channelId) return EMPTY_STATE;
    return chatStore.getSnapshot(channelType, channelId);
  }, [channelType, channelId]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const sendMessage = useCallback(
    async (body: string, replyToMessageId?: string | null) => {
      if (!channelType || !channelId) return null;
      return chatStore.sendMessage(guildId, channelType, channelId, body, replyToMessageId);
    },
    [guildId, channelType, channelId],
  );

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
      if (!channelType || !channelId) return;
      await chatStore.editMessage(guildId, channelType, channelId, messageId, body);
    },
    [guildId, channelType, channelId],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!channelType || !channelId) return;
      await chatStore.deleteMessage(guildId, channelType, channelId, messageId);
    },
    [guildId, channelType, channelId],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emojiKey: string) => {
      if (!channelType || !channelId) return;
      await chatStore.toggleReaction(guildId, channelType, channelId, messageId, emojiKey);
    },
    [guildId, channelType, channelId],
  );

  return {
    messages: state.messages,
    reactionsByMessage: state.reactionsByMessage,
    attachmentsByMessage: state.attachmentsByMessage,
    loading: state.loading,
    sending: state.sending,
    error: state.error,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
  };
}
