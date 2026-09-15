import type { ChatChannelType } from "@rec/shared";
import { getAuthToken, wsBaseUrl } from "./rec-api-client.js";

// One WebSocket connection per browser tab, reused across channel switches (subscribe/
// unsubscribe messages over the same socket) rather than opening a new connection per channel.
// Only remaining consumer is the Fantasy Draft Board's live-refresh transport (the chat
// messaging feature this was originally built for has been removed, but Fantasy Draft depends
// on this transport independently).
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

type PendingSub = { channelType: ChatChannelType; channelId: string; action: "subscribe" | "unsubscribe" };

/** A lightweight event payload (e.g. `{ kind: "refresh" }` for the fantasy draft). */
export type ChannelEvent = { kind: string; [key: string]: unknown };

class ChatRealtimeClient {
  private socket: WebSocket | null = null;
  private guildId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeChannels = new Set<string>();
  private pendingQueue: PendingSub[] = [];
  private intentionalClose = false;
  private eventListeners = new Map<string, Set<(event: ChannelEvent) => void>>();

  private channelKey(channelType: ChatChannelType, channelId: string) {
    return `${channelType}:${channelId}`;
  }

  connect(guildId: string) {
    if (this.socket && this.guildId === guildId && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.socket) this.teardown();
    this.guildId = guildId;
    this.intentionalClose = false;
    this.open();
  }

  private open() {
    const token = getAuthToken();
    if (!token || !this.guildId) return;
    const url = `${wsBaseUrl()}/v1/chat/socket?token=${encodeURIComponent(token)}&guildId=${encodeURIComponent(this.guildId)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      // Re-subscribe every channel still active (covers both a fresh connect and a reconnect
      // after a drop).
      for (const key of this.activeChannels) {
        const [channelType, channelId] = key.split(":") as [ChatChannelType, string];
        this.send({ type: "subscribe", channelType, channelId });
      }
      this.flushQueue();
    });

    socket.addEventListener("message", (event) => {
      let parsed: { channelType: ChatChannelType; channelId: string; event: ChannelEvent } | null = null;
      try { parsed = JSON.parse(event.data); } catch { return; }
      if (!parsed) return;
      const key = this.channelKey(parsed.channelType, parsed.channelId);
      this.eventListeners.get(key)?.forEach((listener) => listener(parsed.event));
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.intentionalClose) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.activeChannels.size) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.activeChannels.size) this.open();
    }, delay);
  }

  private teardown() {
    this.intentionalClose = true;
    this.socket?.close();
    this.socket = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.pendingQueue.push(message as unknown as PendingSub);
    }
  }

  private flushQueue() {
    const queue = this.pendingQueue;
    this.pendingQueue = [];
    for (const message of queue) this.send(message as unknown as Record<string, unknown>);
  }

  subscribeChannel(guildId: string, channelType: ChatChannelType, channelId: string) {
    this.connect(guildId);
    this.activeChannels.add(this.channelKey(channelType, channelId));
    this.send({ type: "subscribe", channelType, channelId });
  }

  unsubscribeChannel(channelType: ChatChannelType, channelId: string) {
    const key = this.channelKey(channelType, channelId);
    this.activeChannels.delete(key);
    this.send({ type: "unsubscribe", channelType, channelId });
    if (!this.activeChannels.size) this.teardown();
  }

  /** Subscribe to plain push events on a channel (fantasy draft refresh, etc.). Returns an
   * unsubscribe function; the socket stays open for this channel until every listener is gone. */
  onChannelEvent(guildId: string, channelType: ChatChannelType, channelId: string, listener: (event: ChannelEvent) => void): () => void {
    const key = this.channelKey(channelType, channelId);
    if (!this.eventListeners.has(key)) this.eventListeners.set(key, new Set());
    this.eventListeners.get(key)!.add(listener);
    this.subscribeChannel(guildId, channelType, channelId);
    return () => {
      const set = this.eventListeners.get(key);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.eventListeners.delete(key);
        this.unsubscribeChannel(channelType, channelId);
      }
    };
  }
}

export const chatRealtimeClient = new ChatRealtimeClient();
