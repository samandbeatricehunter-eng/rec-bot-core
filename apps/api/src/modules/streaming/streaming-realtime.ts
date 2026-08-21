import type { WebSocket } from "ws";

export type StreamingRealtimeEvent =
  | {
      kind: "went_live";
      promptId: string;
      sessionId: string;
      platform: string;
      streamUrl: string;
      matchups: Array<{ gameId: string; label: string }>;
    }
  | { kind: "ended"; sessionId: string };

const socketsByUser = new Map<string, Set<WebSocket>>();
const userBySocket = new Map<WebSocket, string>();

export function subscribeStreamingSocket(socket: WebSocket, userId: string): void {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId)!.add(socket);
  userBySocket.set(socket, userId);
}

export function dropStreamingSocket(socket: WebSocket): void {
  const userId = userBySocket.get(socket);
  userBySocket.delete(socket);
  if (!userId) return;
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (!set.size) socketsByUser.delete(userId);
}

export function pushStreamingEvent(userId: string, event: StreamingRealtimeEvent): void {
  const set = socketsByUser.get(userId);
  if (!set?.size) return;
  const payload = JSON.stringify(event);
  for (const socket of set) {
    try {
      socket.send(payload);
    } catch {
      dropStreamingSocket(socket);
    }
  }
}
