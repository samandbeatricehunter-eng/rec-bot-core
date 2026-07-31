import type { WebSocket } from "ws";
import type { ChatChannelType } from "@rec/shared";

// In-memory pub/sub for chat push events, scoped to this API process. Fine for a single
// Railway instance (the deployment this project actually runs); if the API is ever scaled to
// multiple instances, this needs to move to Postgres LISTEN/NOTIFY or a shared broker (Redis)
// so a broadcast on instance A reaches a socket connected to instance B — polling remains the
// fallback specifically so that gap never produces a dropped message, only a delayed one.
export type ChatRealtimeEvent =
  | { kind: "message"; row: Record<string, unknown> }
  | { kind: "edit"; row: Record<string, unknown> }
  | { kind: "delete"; messageId: string }
  | { kind: "reaction"; messageId: string }
  | { kind: "attachment"; messageId: string };

function channelKey(channelType: ChatChannelType, channelId: string): string {
  return `${channelType}:${channelId}`;
}

const socketsByChannel = new Map<string, Set<WebSocket>>();
const channelsBySocket = new Map<WebSocket, Set<string>>();

export function subscribeSocket(socket: WebSocket, channelType: ChatChannelType, channelId: string): void {
  const key = channelKey(channelType, channelId);
  if (!socketsByChannel.has(key)) socketsByChannel.set(key, new Set());
  socketsByChannel.get(key)!.add(socket);
  if (!channelsBySocket.has(socket)) channelsBySocket.set(socket, new Set());
  channelsBySocket.get(socket)!.add(key);
}

export function unsubscribeSocket(socket: WebSocket, channelType: ChatChannelType, channelId: string): void {
  const key = channelKey(channelType, channelId);
  socketsByChannel.get(key)?.delete(socket);
  channelsBySocket.get(socket)?.delete(key);
}

export function dropSocket(socket: WebSocket): void {
  const keys = channelsBySocket.get(socket);
  if (keys) {
    for (const key of keys) socketsByChannel.get(key)?.delete(socket);
  }
  channelsBySocket.delete(socket);
}

export function broadcastChatEvent(channelType: ChatChannelType, channelId: string, event: ChatRealtimeEvent): void {
  const key = channelKey(channelType, channelId);
  const sockets = socketsByChannel.get(key);
  if (!sockets || !sockets.size) return;
  const payload = JSON.stringify({ channelType, channelId, event });
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      try { socket.send(payload); } catch { /* dead socket — next pong/close cycle cleans it up */ }
    }
  }
}
