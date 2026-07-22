import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken } from "./rec-api-client.js";

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

function readTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function sitePublicUrl() {
  return (import.meta.env.VITE_SITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "")
    || "https://rec-leagues.com";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = readTokenFromUrl();
    if (!token) {
      // Direct browser visits belong on the public site, not the Discord Activity hub.
      window.location.replace(sitePublicUrl());
      return;
    }
    try {
      const payload = decodeJwtPayload<{ discordId: string; guildId: string; exp: number }>(token);
      if (payload.exp * 1000 < Date.now()) {
        setState({ status: "error", message: "This link has expired — run /app again in Discord." });
        return;
      }
      setAuthToken(token);
      setState({ status: "ready", discordId: payload.discordId, guildId: payload.guildId });
    } catch {
      setState({ status: "error", message: "This link is malformed — run /app again in Discord." });
    }
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useReadyAuth(): { discordId: string; guildId: string } {
  const auth = useAuth();
  if (auth.status !== "ready") throw new Error("useReadyAuth() called outside AuthGate");
  return auth;
}
