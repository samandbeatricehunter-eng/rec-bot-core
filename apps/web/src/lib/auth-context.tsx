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
  const fromSearch = new URLSearchParams(window.location.search).get("token");
  if (fromSearch) return fromSearch;
  // HashRouter: token may live on the hash query (#/?token=… or #/path?token=…).
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex >= 0) return new URLSearchParams(hash.slice(qIndex + 1)).get("token");
  return null;
}

function sitePublicUrl() {
  return (import.meta.env.VITE_SITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "")
    || "https://rec-leagues.com";
}

function siteLoginUrl() {
  return `${sitePublicUrl()}/login`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = readTokenFromUrl();
    if (!token) {
      const loginUrl = siteLoginUrl();
      try {
        if (new URL(loginUrl).origin === window.location.origin) {
          // Misconfigured deploy: hub and site share an origin → replace() would loop forever.
          setState({
            status: "error",
            message: "Open your league from Discord with /app. This hub URL needs a personal session link.",
          });
          return;
        }
      } catch {
        // fall through to replace
      }
      window.location.replace(loginUrl);
      const failsafe = window.setTimeout(() => {
        setState((current) =>
          current.status === "loading"
            ? {
                status: "error",
                message: `Redirect stalled. Sign in at ${loginUrl}, then run /app again in Discord.`,
              }
            : current,
        );
      }, 2500);
      return () => window.clearTimeout(failsafe);
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