import { DiscordSDK } from "@discord/embedded-app-sdk";

// Singleton — the SDK opens a message-channel handshake with the surrounding Discord
// client on construction, so there must be exactly one instance for the app's lifetime.
export const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

let readyPromise: Promise<void> | null = null;

export function ensureDiscordSdkReady(): Promise<void> {
  if (!readyPromise) readyPromise = discordSdk.ready();
  return readyPromise;
}
