import { Client } from "pg";
import { env } from "../../config/env.js";
import { broadcastChatEvent } from "./chat-realtime.js";

const CHANNEL = "rec_chat_changes";
let client: Client | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

type ChatNotification = {
  channelType: "league" | "game" | "commissioner";
  channelId: string;
};

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, 2_000);
}

async function connect() {
  try {
    // LISTEN/NOTIFY needs a genuine session-mode connection held open indefinitely — the
    // shared pool now points at the transaction-mode pooler, which reclaims the backend
    // connection between transactions and would silently stop delivering notifications.
    // This standalone Client uses its own connection, separate from getPgPool()'s budget.
    const next = new Client({ connectionString: env.REC_DATABASE_URL_SESSION ?? env.REC_DATABASE_URL });
    await next.connect();
    client = next;
    next.on("notification", (notification) => {
      if (notification.channel !== CHANNEL || !notification.payload) return;
      try {
        const event = JSON.parse(notification.payload) as ChatNotification;
        if (event.channelId && ["league", "game", "commissioner"].includes(event.channelType)) {
          broadcastChatEvent(event.channelType, event.channelId, { kind: "refresh" });
        }
      } catch (error) {
        console.error("[chat-realtime] Invalid database notification", error);
      }
    });
    const disconnected = () => {
      if (client === next) client = null;
      next.end().catch(() => {});
      scheduleReconnect();
    };
    next.once("error", disconnected);
    next.once("end", disconnected);
    await next.query(`LISTEN ${CHANNEL}`);
    console.log("[chat-realtime] Listening for database chat changes");
  } catch (error) {
    console.error("[chat-realtime] Database listener failed", error);
    scheduleReconnect();
  }
}

export async function startChatDatabaseListener() {
  if (!client && !reconnectTimer) await connect();
}
