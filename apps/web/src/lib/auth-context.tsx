import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken } from "./rec-api-client.js";

// Reads the (unverified — verification happens server-side on every API call) payload of
// a JWT client-side, just to know who's signed in and when the session expires without a
// round-trip. No library needed for this; it's a base64url decode of the middle segment.
function decodeJwtPayload<T>(token: string): T {
  const [, payload] = token.split(".");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  return JSON.parse(atob(base64)) as T;
}

type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; discordId: string; guildId: string };

const AuthContext = createContext<AuthState>({ status: "loading" });

// The bot mints this token server-side (right after verifying the click via a real
// Discord interaction and the commissioner/co-commissioner check) and embeds it directly
// in the Link button's URL — no OAuth round-trip happens in the browser at all. This just
// reads it off the URL once on load; there's no silent "re-authenticate" path if it
// expires, since there's no ongoing Discord session here to draw a fresh token from —
// the user just re-opens the dashboard from Discord to get a new link.
function readTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = readTokenFromUrl();
    if (!token) {
      setState({ status: "error", message: "This link is missing or invalid — run /hub again in Discord." });
      return;
    }
    try {
      const payload = decodeJwtPayload<{ discordId: string; guildId: string; exp: number }>(token);
      if (payload.exp * 1000 < Date.now()) {
        setState({ status: "error", message: "This link has expired — run /hub again in Discord." });
        return;
      }
      setAuthToken(token);
      setState({ status: "ready", discordId: payload.discordId, guildId: payload.guildId });
    } catch {
      setState({ status: "error", message: "This link is malformed — run /hub again in Discord." });
    }
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// Every screen renders only inside App.tsx's AuthGate, which already blocks rendering
// until status is "ready" — this just gives screens a non-nullable type for that fact
// instead of re-narrowing `useAuth()` in every component.
export function useReadyAuth(): { discordId: string; guildId: string } {
  const auth = useAuth();
  if (auth.status !== "ready") throw new Error("useReadyAuth() called outside AuthGate");
  return auth;
}
